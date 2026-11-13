import type {PixelPoint} from "@/lib/floor-plan";

export type RestrictedRoomCandidate={
  floorId:string;
  floorRecordId:string;
  roomId:string;
  name:string;
  points:PixelPoint[];
};

/** One GPS-style fix. Positions stay in floor-image pixels so the map projects
 * them with exactly the same placement it uses to draw that floor's polygons. */
export type VisitorMapSnapshot={
  id:string;
  fullName:string;
  avatarUrl:string;
  /** hierarchy floor id (navigation graph id). */
  floorId:string;
  /** FloorPlanRecord.id, the key of the rendered outdoor floor preview. */
  floorRecordId:string;
  floorName:string;
  /** Current fix position. */
  point:PixelPoint;
  /** Path walked since the previous fix (previous fix → corners → current fix). */
  segment:PixelPoint[];
  /** Recent walked path on this floor, ending at the current fix. */
  trail:PixelPoint[];
  /** Mapped space containing the visitor, e.g. "Records Room". */
  locationName:string;
  color:string;
  fixSequence:number;
  alerting:boolean;
};

export type VisitorAlertEvent={
  id:string;
  visitorId:string;
  visitorName:string;
  areaName:string;
};

type RestrictedFloorSource={
  id:string;
  planId:string;
  outdoorPlacement?:unknown;
  hierarchy?:{floor:{id:string}};
  areas?:Array<{
    id:string;
    floorId:string;
    kind:"room"|"walkable";
    name:string;
    points:PixelPoint[];
  }>;
};

/** Restriction eligibility is intentionally semantic, never inferred from map layers. */
export function eligibleRestrictedRooms(floors:ReadonlyArray<RestrictedFloorSource>):RestrictedRoomCandidate[]{
  return floors.flatMap(floor=>{
    if(!floor.outdoorPlacement)return [];
    const floorId=floor.hierarchy?.floor.id??floor.planId;
    return (floor.areas??[]).filter(area=>area.kind==="room"&&area.points.length>=3)
      .map(area=>({
        floorId,
        floorRecordId:floor.id,
        roomId:area.id,
        name:area.name.trim()||"Room",
        points:area.points,
      }));
  });
}

/** Small deterministic PRNG used only after a session-specific seed is created. */
export function createSeededRandom(seed:string):()=>number{
  let state=2166136261;
  for(let index=0;index<seed.length;index++){
    state^=seed.charCodeAt(index);
    state=Math.imul(state,16777619);
  }
  if(state===0)state=0x9e3779b9;
  return ()=>{
    state+=0x6d2b79f5;
    let value=state;
    value=Math.imul(value^(value>>>15),value|1);
    value^=value+Math.imul(value^(value>>>7),value|61);
    return ((value^(value>>>14))>>>0)/4294967296;
  };
}

export function pickRandom<T>(items:ReadonlyArray<T>,random:()=>number):T|null{
  if(!items.length)return null;
  return items[Math.min(items.length-1,Math.floor(random()*items.length))]??null;
}

export function pointInPolygon(point:PixelPoint,polygon:ReadonlyArray<PixelPoint>):boolean{
  if(polygon.length<3)return false;
  let inside=false;
  for(let index=0,previous=polygon.length-1;index<polygon.length;previous=index++){
    const a=polygon[index],b=polygon[previous];
    if((a.y>point.y)!==(b.y>point.y)&&
      point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x)inside=!inside;
  }
  return inside;
}

export type PathMovement={point:PixelPoint;segmentIndex:number;done:boolean};
export type PathWalk=PathMovement&{
  /** Every path vertex passed during this step, followed by the final point. */
  traversed:PixelPoint[];
};

/** Advance along a polyline, recording the corners passed so a drawn trail
 * follows the validated path instead of cutting straight across a wall. */
export function walkAlongPath(
  points:ReadonlyArray<PixelPoint>,segmentIndex:number,current:PixelPoint,distance:number,
):PathWalk{
  if(points.length<2){
    const point=points[0]??current;
    return {point,segmentIndex:0,done:true,traversed:[{...point}]};
  }
  let point={...current};
  const traversed:PixelPoint[]=[];
  let targetIndex=Math.max(1,Math.min(segmentIndex,points.length-1));
  let remaining=Math.max(0,distance);
  const finish=(done:boolean):PathWalk=>{
    const last=traversed.at(-1);
    const ends=last&&Math.hypot(last.x-point.x,last.y-point.y)<0.0001;
    return {point,segmentIndex:targetIndex,done,
      traversed:ends?traversed:[...traversed,{...point}]};
  };
  while(remaining>0){
    const target=points[targetIndex];
    const dx=target.x-point.x,dy=target.y-point.y,length=Math.hypot(dx,dy);
    if(length<=0.0001){
      point={...target};
      if(targetIndex>=points.length-1)return finish(true);
      targetIndex++;
      continue;
    }
    if(remaining<length){
      const ratio=remaining/length;
      point={x:point.x+dx*ratio,y:point.y+dy*ratio};
      return finish(false);
    }
    remaining-=length;
    point={...target};
    if(targetIndex>=points.length-1)return finish(true);
    traversed.push({...point});
    targetIndex++;
  }
  return finish(false);
}

/** Advance along a polyline without skipping a corner when one step is late. */
export function moveAlongPath(
  points:ReadonlyArray<PixelPoint>,segmentIndex:number,current:PixelPoint,distance:number,
):PathMovement{
  const {point,segmentIndex:index,done}=walkAlongPath(points,segmentIndex,current,distance);
  return {point,segmentIndex:index,done};
}

/** A named, drawn space on one floor: room, walkable area or stair/elevator landing. */
export type MappedSpace={
  id:string;
  name:string;
  kind:"room"|"walkable"|"staircase"|"elevator";
  points:PixelPoint[];
};

const segmentDistance=(p:PixelPoint,a:PixelPoint,b:PixelPoint)=>{
  const dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;
  const t=length>0?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/length)):0;
  return Math.hypot(p.x-(a.x+t*dx),p.y-(a.y+t*dy));
};
const onPolygonEdge=(point:PixelPoint,polygon:ReadonlyArray<PixelPoint>,tolerance:number)=>
  polygon.some((a,index)=>segmentDistance(point,a,polygon[(index+1)%polygon.length])<=tolerance);
const insideSpace=(point:PixelPoint,space:MappedSpace,tolerance=1.25)=>
  pointInPolygon(point,space.points)||onPolygonEdge(point,space.points,tolerance);

/** Strict guard for simulated visitors: every sampled point of the walking
 * line must lie on the floor image AND inside a drawn room, walkable area or
 * stair/elevator landing. The only exception is the short hop between the two
 * sides of a reviewed opening (doorway / stair access), passed as `crossings`.
 */
export function pathStaysInMappedSpace(
  points:ReadonlyArray<PixelPoint>,
  spaces:ReadonlyArray<MappedSpace>,
  bounds:{width:number;height:number},
  crossings:ReadonlyArray<{from:PixelPoint;to:PixelPoint}>=[],
  sampleStep=1.5,
):boolean{
  if(!points.length)return false;
  const same=(a:PixelPoint,b:PixelPoint)=>Math.hypot(a.x-b.x,a.y-b.y)<0.6;
  const isCrossing=(a:PixelPoint,b:PixelPoint)=>crossings.some(gap=>
    (same(a,gap.from)&&same(b,gap.to))||(same(a,gap.to)&&same(b,gap.from)));
  const onFloor=(p:PixelPoint)=>p.x>=0&&p.y>=0&&p.x<=bounds.width&&p.y<=bounds.height;
  const covered=(p:PixelPoint)=>onFloor(p)&&spaces.some(space=>insideSpace(p,space));
  if(points.length===1)return covered(points[0]);
  for(let index=1;index<points.length;index++){
    const a=points[index-1],b=points[index];
    if(!onFloor(a)||!onFloor(b))return false;
    if(isCrossing(a,b))continue;
    const length=Math.hypot(b.x-a.x,b.y-a.y);
    const count=Math.max(1,Math.ceil(length/sampleStep));
    for(let step=0;step<=count;step++){
      const t=step/count;
      if(!covered({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t}))return false;
    }
  }
  return true;
}

/** Name of the most specific mapped space containing a point. Rooms win over
 * corridors, so a visitor standing in a doorway of a room reads as that room. */
export function locateInSpaces(
  point:PixelPoint,spaces:ReadonlyArray<MappedSpace>,
):MappedSpace|null{
  const order:MappedSpace["kind"][]=["room","staircase","elevator","walkable"];
  for(const kind of order){
    const found=spaces.find(space=>space.kind===kind&&insideSpace(point,space,0.5));
    if(found)return found;
  }
  return null;
}

export function mappedSpaceLabel(space:MappedSpace|null):string{
  if(!space)return "Doorway";
  const name=space.name.trim();
  if(name)return name;
  return space.kind==="room"?"Room":space.kind==="walkable"?"Walkway":
    space.kind==="elevator"?"Elevator":"Staircase";
}

export function restrictedPresenceTransition(
  previous:ReadonlySet<string>,currentIds:Iterable<string>,
):{inside:Set<string>;entered:string[];exited:string[]}{
  const inside=new Set(currentIds);
  return {
    inside,
    entered:[...inside].filter(id=>!previous.has(id)),
    exited:[...previous].filter(id=>!inside.has(id)),
  };
}

export function visitorInitials(fullName:string):string{
  const names=fullName.trim().split(/\s+/).filter(Boolean);
  return names.slice(0,2).map(name=>name[0]?.toUpperCase()??"").join("")||"V";
}
