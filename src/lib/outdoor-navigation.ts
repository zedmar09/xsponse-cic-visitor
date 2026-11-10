/** Outdoor projection of ALREADY VALIDATED indoor navigation.
 * Never join floor levels with a flat map line or substitute area centroids
 * for physical openings. Routes are derived from the existing indoor audit,
 * shortest-path engine, and wall-clear guided floor paths.
 */
import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { FloorPlanRecord } from "@/lib/floor-plan";
import type { DestinationRoute } from "@/lib/navigation-graph";
import type { FloorRouteStep } from "@/lib/navigation-multifloor";
import { floorImageCorners } from "@/lib/outdoor-floor-placement";
import { indoorPointToLngLat } from "@/lib/outdoor-indoor-geometry";

export type OutdoorNavigationFeatureProperties={
  kind:"route-segment"|"route-start"|"route-end"|"floor-transition"|"floor-entry";
  floorId:string;
  label:string;
};
export type OutdoorNavigationOverlay=FeatureCollection<Geometry,OutdoorNavigationFeatureProperties>;

export function buildOutdoorNavigationOverlay(
  route:DestinationRoute,steps:FloorRouteStep[],floors:FloorPlanRecord[],
):OutdoorNavigationOverlay{
  const features:Feature<Geometry,OutdoorNavigationFeatureProperties>[]=[];
  if(route.status!=="ready")return {type:"FeatureCollection",features};
  const placed=new Map<string,FloorPlanRecord>();
  for(const floor of floors){
    if(!floor.outdoorPlacement)continue;
    const id=floor.hierarchy?.floor.id??floor.planId;
    try{floorImageCorners(floor.outdoorPlacement,floor.width,floor.height);}
    catch{continue;}
    placed.set(id,floor);
  }
  const point=(floor:FloorPlanRecord,px:{x:number;y:number}):[number,number]=>
    indoorPointToLngLat(px,floor.outdoorPlacement!,floor.width,floor.height);
  const pin=(floor:FloorPlanRecord,kind:OutdoorNavigationFeatureProperties["kind"],
    floorId:string,label:string,pixel:{x:number;y:number})=>{
    features.push({type:"Feature",properties:{kind,floorId,label},
      geometry:{type:"Point",coordinates:point(floor,pixel)}});
  };
  for(const [index,step] of steps.entries()){
    const floor=placed.get(step.floorId);
    if(!floor)continue; // No geographic placement: no deceptive map route
    const path=step.guidance.status==="guided"?step.guidance.points:[];
    if(path.length>=2){
      features.push({type:"Feature",properties:{
        kind:"route-segment",floorId:step.floorId,label:step.floorName,
      },geometry:{type:"LineString",coordinates:path.map(px=>point(floor,px))}});
      if(index===0)pin(floor,"route-start",step.floorId,
        route.nodes[0]?.label??"Route start",path[0]);
      if(index===steps.length-1)pin(floor,"route-end",step.floorId,
        route.nodes.at(-1)?.label??"Destination",path[path.length-1]);
    }
    if(index>0&&step.nodes[0]&&
      (step.nodes[0].kind==="staircase"||step.nodes[0].kind==="elevator"))
      pin(floor,"floor-entry",step.floorId,
        `Enter ${step.floorName} by ${step.nodes[0].label}`,step.nodes[0].point);
    if(step.transitionAfter){
      const connector=step.nodes.at(-1);
      if(connector&&(connector.kind==="staircase"||connector.kind==="elevator")){
        const next=steps[index+1];
        pin(floor,"floor-transition",step.floorId,
          `Use ${connector.label} to reach ${next?.floorName??"the next floor"}`,
          connector.point);
      }
    }
  }
  return {type:"FeatureCollection",features};
}

/** Information shown next to the outdoor map. A connected graph is not proof
 * that each floor has enough approved geometric clearance for a route line.
 */
export function outdoorNavigationSummary(
  route:DestinationRoute,steps:FloorRouteStep[],placedFloorIds:ReadonlySet<string>,
):{drawable:number;needsReview:string[];unplaced:string[]}{
  if(route.status!=="ready")return {drawable:0,needsReview:[],unplaced:[]};
  return {
    drawable:steps.filter(step=>placedFloorIds.has(step.floorId)&&
      step.guidance.status==="guided"&&step.guidance.points.length>=2).length,
    needsReview:steps.filter(step=>step.guidance.status!=="guided")
      .map(step=>`${step.floorName}: ${step.guidance.message}`),
    unplaced:steps.filter(step=>!placedFloorIds.has(step.floorId))
      .map(step=>step.floorName),
  };
}
