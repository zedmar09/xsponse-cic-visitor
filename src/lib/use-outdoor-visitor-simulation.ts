"use client";

import {useCallback,useEffect,useMemo,useRef,useState} from "react";
import {DEMO_VISITORS,type DemoVisitor} from "@/lib/demo-visitors";
import type {FloorPlanRecord,PixelPoint} from "@/lib/floor-plan";
import {buildNavigationAudit,type DestinationRoute,type NavNode} from "@/lib/navigation-graph";
import {findShortestMappedRoute} from "@/lib/navigation-shortest-route";
import {buildFloorRouteSteps} from "@/lib/navigation-multifloor";
import {routeInsideArea} from "@/lib/navigation-route-geometry";
import {landingOnFloor,type Staircase} from "@/lib/staircases";
import {verticalKind} from "@/lib/vertical-connections";
import {
  createSeededRandom,eligibleRestrictedRooms,locateInSpaces,mappedSpaceLabel,
  pathStaysInMappedSpace,pickRandom,pointInPolygon,walkAlongPath,
  type MappedSpace,type RestrictedRoomCandidate,type VisitorAlertEvent,type VisitorMapSnapshot,
} from "@/lib/visitor-simulation";

/** Visitors report a position like a phone GPS: one fix every two seconds. */
export const VISITOR_FIX_INTERVAL_MS=2000;
/** Seconds a visitor needs to walk the floor-image diagonal (sets a slow pace
 * that is independent of the floor picture's pixel resolution). */
const FLOOR_DIAGONAL_WALK_SECONDS=150;
const MIN_WALK_PX_PER_SECOND=3;
const MAX_WALK_PX_PER_SECOND=14;
const CONNECTOR_SECONDS=6;
const TRAIL_POINT_LIMIT=120;
const VISITOR_COLORS=["#2563eb","#db2777","#059669","#d97706","#7c3aed"];

type RouteLeg={floorId:string;points:PixelPoint[];connectorAfter:boolean;connectorName:string|null};
type VisitorRoutePlan={fromId:string;toId:string;legs:RouteLeg[]};
type FloorInfo={record:FloorPlanRecord;name:string;spaces:MappedSpace[];walkSpeed:number};
type SimulationContext={
  floorsById:Map<string,FloorInfo>;
  rooms:NavNode[];
  restrictedCandidates:RestrictedRoomCandidate[];
  routeBetween:(fromId:string,toId:string)=>VisitorRoutePlan|null;
};
type RuntimePhase="waiting"|"walking"|"connector"|"dwell"|"idle";
type VisitorRuntime={
  profile:DemoVisitor;
  color:string;
  currentNodeId:string;
  route:VisitorRoutePlan|null;
  legIndex:number;
  segmentIndex:number;
  floorId:string;
  point:PixelPoint;
  speedFactor:number;
  phase:RuntimePhase;
  pauseUntil:number;
  insideRestricted:boolean;
  segment:PixelPoint[];
  trail:PixelPoint[];
  connectorName:string|null;
  fixSequence:number;
};

const floorKey=(floor:FloorPlanRecord)=>floor.hierarchy?.floor.id??floor.planId;
const dedupePoints=(points:PixelPoint[])=>points.filter((point,index)=>index===0||
  Math.hypot(point.x-points[index-1].x,point.y-points[index-1].y)>.01);

/** Rooms, walkable areas and stair/elevator landings drawn on one floor. */
function floorSpaces(floor:FloorPlanRecord,stairs:Staircase[]):MappedSpace[]{
  const id=floorKey(floor);
  const areas:MappedSpace[]=(floor.areas??[]).filter(area=>area.points.length>=3)
    .map(area=>({id:area.id,name:area.name,kind:area.kind,points:area.points}));
  const landings:MappedSpace[]=stairs.flatMap(stair=>{
    const landing=landingOnFloor(stair,id);
    return landing&&landing.outline.length>=3?[{id:stair.id,name:stair.name,
      kind:verticalKind(stair),points:landing.outline}]:[];
  });
  return [...areas,...landings];
}

function buildRoutePlan(
  floors:FloorPlanRecord[],stairs:Staircase[],route:DestinationRoute,
  floorsById:Map<string,FloorInfo>,
):VisitorRoutePlan|null{
  if(route.status!=="ready"||route.nodes.length<2)return null;
  const steps=buildFloorRouteSteps(floors,stairs,route);
  if(!steps.length||steps.some(step=>step.guidance.status!=="guided"||
    step.guidance.points.length<2))return null;
  const startNode=route.nodes[0],endNode=route.nodes.at(-1)!;
  const legs:RouteLeg[]=steps.map(step=>({
    floorId:step.floorId,
    points:[...step.guidance.points],
    connectorAfter:Boolean(step.transitionAfter),
    connectorName:step.transitionAfter?.label??null,
  }));
  const startFloor=floorsById.get(startNode.floorId)?.record;
  const startArea=startFloor?.areas?.find(area=>
    `${startNode.floorId}:area:${area.id}`===startNode.id);
  if(!startFloor||!startArea)return null;
  const startExtension=routeInsideArea(startNode.point,legs[0].points[0],startArea,
    (startFloor.areas??[]).filter(area=>area.kind==="room"));
  if(!startExtension)return null;
  legs[0].points=dedupePoints([...startExtension,...legs[0].points]);

  const endFloor=floorsById.get(endNode.floorId)?.record;
  const endArea=endFloor?.areas?.find(area=>
    `${endNode.floorId}:area:${area.id}`===endNode.id);
  if(!endFloor||!endArea)return null;
  const lastLeg=legs[legs.length-1];
  const endExtension=routeInsideArea(lastLeg.points.at(-1)!,endNode.point,endArea,
    (endFloor.areas??[]).filter(area=>area.kind==="room"));
  if(!endExtension)return null;
  lastLeg.points=dedupePoints([...lastLeg.points,...endExtension]);
  if(legs.some(leg=>leg.points.length<2))return null;

  // Final strict check: every point of every leg stays on its floor image and
  // inside a drawn space. The only allowed gaps are the reviewed openings the
  // route actually crosses on that floor.
  for(const leg of legs){
    const info=floorsById.get(leg.floorId);
    if(!info)return null;
    const crossings=route.edges.flatMap((edge,index)=>{
      const gap=route.transitions?.[index];
      return edge.kind!=="vertical"&&edge.floorId===leg.floorId&&gap?[gap]:[];
    });
    if(!pathStaysInMappedSpace(leg.points,info.spaces,
      {width:info.record.width,height:info.record.height},crossings))return null;
  }
  return {fromId:startNode.id,toId:endNode.id,legs};
}

function makeSimulationContext(floors:FloorPlanRecord[],stairs:Staircase[]):SimulationContext{
  const audit=buildNavigationAudit(floors,stairs);
  const floorsById=new Map<string,FloorInfo>(floors.map(floor=>{
    const diagonal=Math.hypot(floor.width,floor.height);
    const walkSpeed=Math.max(MIN_WALK_PX_PER_SECOND,Math.min(MAX_WALK_PX_PER_SECOND,
      diagonal/FLOOR_DIAGONAL_WALK_SECONDS));
    return [floorKey(floor),{record:floor,
      name:floor.hierarchy?.floor.name??floor.name,
      spaces:floorSpaces(floor,stairs),walkSpeed}];
  }));
  // A visitor may only start/stop at a room whose resting point is inside a
  // drawn room on a floor that is placed on the outdoor map.
  const rooms=audit.nodes.filter(node=>{
    if(node.kind!=="room")return false;
    const info=floorsById.get(node.floorId);
    return Boolean(info?.record.outdoorPlacement&&
      pathStaysInMappedSpace([node.point],info.spaces,
        {width:info.record.width,height:info.record.height}));
  });
  const cache=new Map<string,VisitorRoutePlan|null>();
  const routeBetween=(fromId:string,toId:string)=>{
    const key=`${fromId}→${toId}`;
    if(cache.has(key))return cache.get(key)??null;
    const result=findShortestMappedRoute(audit,floors,stairs,fromId,toId);
    const plan=buildRoutePlan(floors,stairs,result,floorsById);
    cache.set(key,plan);
    return plan;
  };
  return {floorsById,rooms,routeBetween,
    restrictedCandidates:eligibleRestrictedRooms(floors)};
}

const shuffled=<T,>(items:ReadonlyArray<T>,random:()=>number):T[]=>{
  const result=[...items];
  for(let index=result.length-1;index>0;index--){
    const swap=Math.floor(random()*(index+1));
    [result[index],result[swap]]=[result[swap],result[index]];
  }
  return result;
};

function resetTrail(runtime:VisitorRuntime){
  runtime.trail=[{...runtime.point}];
  runtime.segment=[{...runtime.point}];
}

function appendTrail(runtime:VisitorRuntime,points:PixelPoint[]){
  runtime.trail=dedupePoints([...runtime.trail,...points]).slice(-TRAIL_POINT_LIMIT);
}

function assignRoute(runtime:VisitorRuntime,plan:VisitorRoutePlan,now:number,delay:number){
  const first=plan.legs[0];
  runtime.route=plan;
  runtime.legIndex=0;
  runtime.segmentIndex=1;
  if(runtime.floorId!==first.floorId){
    runtime.floorId=first.floorId;
    runtime.point={...first.points[0]};
    resetTrail(runtime);
  }else runtime.point={...first.points[0]};
  runtime.phase="waiting";
  runtime.pauseUntil=now+delay;
}

function randomPlanFrom(
  context:SimulationContext,fromId:string,random:()=>number,
):VisitorRoutePlan|null{
  for(const target of shuffled(context.rooms.filter(room=>room.id!==fromId),random)){
    const route=context.routeBetween(fromId,target.id);
    if(route)return route;
  }
  return null;
}

function runtimeSnapshot(runtime:VisitorRuntime,context:SimulationContext):VisitorMapSnapshot|null{
  const info=context.floorsById.get(runtime.floorId);
  if(!info?.record.outdoorPlacement)return null;
  const locationName=runtime.phase==="connector"&&runtime.connectorName?
    runtime.connectorName:
    mappedSpaceLabel(locateInSpaces(runtime.point,info.spaces));
  return {id:runtime.profile.id,fullName:runtime.profile.fullName,
    avatarUrl:runtime.profile.avatarUrl,floorId:runtime.floorId,
    floorRecordId:info.record.id,floorName:info.name,
    point:{...runtime.point},segment:runtime.segment.map(point=>({...point})),
    trail:runtime.trail.map(point=>({...point})),locationName,color:runtime.color,
    fixSequence:runtime.fixSequence,alerting:runtime.insideRestricted};
}

export function useOutdoorVisitorSimulation({
  locationId,floors,stairs,ready,
}:{
  locationId:string|null;
  floors:FloorPlanRecord[];
  stairs:Staircase[];
  ready:boolean;
}){
  const context=useMemo(()=>makeSimulationContext(ready?floors:[],ready?stairs:[]),
    [ready,floors,stairs]);
  const [visitors,setVisitors]=useState<VisitorMapSnapshot[]>([]);
  const [restricted,setRestricted]=useState<RestrictedRoomCandidate|null>(null);
  const [alert,setAlert]=useState<VisitorAlertEvent|null>(null);
  const alertTimerRef=useRef<ReturnType<typeof setTimeout>|null>(null);

  const dismissAlert=useCallback(()=>{
    if(alertTimerRef.current)clearTimeout(alertTimerRef.current);
    alertTimerRef.current=null;
    setAlert(null);
  },[]);

  useEffect(()=>{
    if(alertTimerRef.current)clearTimeout(alertTimerRef.current);
    alertTimerRef.current=null;
    let cancelled=false;
    let interval:ReturnType<typeof setInterval>|null=null;
    if(!locationId||!ready||!context.restrictedCandidates.length||!context.rooms.length){
      void Promise.resolve().then(()=>{
        if(cancelled)return;
        setVisitors([]);setRestricted(null);setAlert(null);
      });
      return ()=>{cancelled=true;};
    }

    const sessionToken=typeof crypto!=="undefined"&&"randomUUID" in crypto?
      crypto.randomUUID():`${Date.now()}-${Math.random()}`;
    const random=createSeededRandom(`${locationId}:${sessionToken}`);
    const roomById=new Map(context.rooms.map(room=>[room.id,room]));
    let restrictedRoom:RestrictedRoomCandidate|null=null;
    let demonstrationRoute:VisitorRoutePlan|null=null;
    for(const candidate of shuffled(context.restrictedCandidates,random)){
      const restrictedNodeId=`${candidate.floorId}:area:${candidate.roomId}`;
      for(const source of shuffled(context.rooms.filter(room=>room.id!==restrictedNodeId),random)){
        const route=context.routeBetween(source.id,restrictedNodeId);
        if(route){restrictedRoom=candidate;demonstrationRoute=route;break;}
      }
      if(restrictedRoom)break;
    }
    restrictedRoom??=pickRandom(context.restrictedCandidates,random);
    const initialRestricted=restrictedRoom;
    if(!initialRestricted)return ()=>{cancelled=true;};
    const restrictedNodeId=`${initialRestricted.floorId}:area:${initialRestricted.roomId}`;
    const isInsideRestricted=(runtime:VisitorRuntime)=>
      runtime.floorId===initialRestricted.floorId&&
      pointInPolygon(runtime.point,initialRestricted.points);

    const now=Date.now();
    const demonstrationIndex=demonstrationRoute?
      Math.floor(random()*DEMO_VISITORS.length):-1;
    const runtimes:VisitorRuntime[]=DEMO_VISITORS.flatMap((profile,index)=>{
      let plan=index===demonstrationIndex?demonstrationRoute:null;
      if(!plan){
        for(const source of shuffled(context.rooms.filter(room=>room.id!==restrictedNodeId),random)){
          plan=randomPlanFrom(context,source.id,random);
          if(plan)break;
        }
      }
      // Always start at a validated resting point inside a drawn room; never
      // at a polygon vertex (which lies on the wall).
      const source=plan?roomById.get(plan.fromId):
        pickRandom(context.rooms.filter(room=>room.id!==restrictedNodeId),random);
      if(!source)return [];
      const runtime:VisitorRuntime={profile,color:VISITOR_COLORS[index%VISITOR_COLORS.length],
        currentNodeId:source.id,route:null,legIndex:0,segmentIndex:1,
        floorId:source.floorId,point:{...source.point},speedFactor:.8+random()*.35,
        phase:"idle",pauseUntil:now+8000,insideRestricted:false,segment:[],trail:[],
        connectorName:null,fixSequence:0};
      resetTrail(runtime);
      runtime.insideRestricted=isInsideRestricted(runtime);
      if(plan)assignRoute(runtime,plan,now,1500+index*2500+random()*1500);
      return [runtime];
    });

    let alertSequence=0;
    const publish=()=>setVisitors(runtimes.flatMap(runtime=>{
      const snapshot=runtimeSnapshot(runtime,context);
      return snapshot?[snapshot]:[];
    }));
    const showAlert=(runtime:VisitorRuntime)=>{
      const event={id:`${locationId}:${++alertSequence}:${Date.now()}`,
        visitorId:runtime.profile.id,visitorName:runtime.profile.fullName,
        areaName:initialRestricted.name};
      setAlert(event);
      if(alertTimerRef.current)clearTimeout(alertTimerRef.current);
      alertTimerRef.current=setTimeout(()=>{
        alertTimerRef.current=null;
        setAlert(current=>current?.id===event.id?null:current);
      },6000);
    };

    let previousFix=now;
    /** One GPS fix: advance each visitor by the distance walked since the
     * previous fix, strictly along its validated route polyline. */
    const fix=()=>{
      if(cancelled)return;
      const time=Date.now();
      const elapsedSeconds=Math.min(4,Math.max(0,(time-previousFix)/1000));
      previousFix=time;
      for(const runtime of runtimes){
        runtime.segment=[{...runtime.point}];
        runtime.fixSequence++;
        if(runtime.phase==="waiting"&&time>=runtime.pauseUntil)runtime.phase="walking";
        if(runtime.phase==="connector"&&time>=runtime.pauseUntil&&runtime.route){
          runtime.legIndex++;
          const leg=runtime.route.legs[runtime.legIndex];
          runtime.floorId=leg.floorId;
          runtime.point={...leg.points[0]};
          runtime.segmentIndex=1;
          runtime.connectorName=null;
          runtime.phase="walking";
          resetTrail(runtime);
        }
        if((runtime.phase==="dwell"||runtime.phase==="idle")&&time>=runtime.pauseUntil){
          const next=randomPlanFrom(context,runtime.currentNodeId,random);
          if(next)assignRoute(runtime,next,time,500+random()*1500);
          else{runtime.phase="idle";runtime.pauseUntil=time+15000;}
        }
        if(runtime.phase==="walking"&&runtime.route){
          const leg=runtime.route.legs[runtime.legIndex];
          const speed=(context.floorsById.get(leg.floorId)?.walkSpeed??MIN_WALK_PX_PER_SECOND)*
            runtime.speedFactor;
          const moved=walkAlongPath(leg.points,runtime.segmentIndex,runtime.point,
            speed*elapsedSeconds);
          runtime.point=moved.point;
          runtime.segmentIndex=moved.segmentIndex;
          runtime.segment=dedupePoints([...runtime.segment,...moved.traversed]);
          appendTrail(runtime,moved.traversed);
          if(moved.done){
            if(runtime.legIndex<runtime.route.legs.length-1){
              runtime.phase="connector";
              runtime.connectorName=leg.connectorName;
              runtime.pauseUntil=time+CONNECTOR_SECONDS*1000;
            }else{
              runtime.currentNodeId=runtime.route.toId;
              runtime.route=null;
              runtime.phase="dwell";
              runtime.pauseUntil=time+8000+random()*10000;
            }
          }
        }
        const inside=isInsideRestricted(runtime);
        if(inside&&!runtime.insideRestricted)showAlert(runtime);
        runtime.insideRestricted=inside;
      }
      publish();
    };
    void Promise.resolve().then(()=>{
      if(cancelled)return;
      setRestricted(initialRestricted);
      setAlert(null);
      publish();
      interval=setInterval(fix,VISITOR_FIX_INTERVAL_MS);
    });
    return ()=>{
      cancelled=true;
      if(interval)clearInterval(interval);
      if(alertTimerRef.current)clearTimeout(alertTimerRef.current);
      alertTimerRef.current=null;
    };
  },[locationId,ready,context]);

  return {
    visitors,
    restrictedRoom:restricted?{...restricted,
      active:visitors.some(visitor=>visitor.alerting)}:null,
    alert,
    dismissAlert,
  };
}
