import type { FloorPlanRecord } from "@/lib/floor-plan";
import type { Staircase } from "@/lib/staircases";
import type { DestinationRoute, NavEdge, NavNode } from "@/lib/navigation-graph";
import { buildGuidedRoute, type GuidedRoute } from "@/lib/navigation-route-geometry";

export type FloorRouteStep={
  floorId:string;
  floorName:string;
  nodes:NavNode[];
  edges:NavEdge[];
  guidance:GuidedRoute;
  transitionAfter:NavEdge|null;
};
export function buildFloorRouteSteps(
  floors:FloorPlanRecord[],stairs:Staircase[],route:DestinationRoute,
):FloorRouteStep[]{
  if(route.status!=="ready"||!route.nodes.length)return [];
  const result:FloorRouteStep[]=[];
  let nodes:NavNode[]=[route.nodes[0]],edges:NavEdge[]=[];
  let transitions:NonNullable<DestinationRoute["transitions"]>=[];
  const push=(transitionAfter:NavEdge|null)=>{
    const floorId=nodes[0].floorId;
    const floor=floors.find(f=>f.hierarchy?.floor.id===floorId);
    if(!floor)return;
    const local:DestinationRoute={status:"ready",nodes:[...nodes],edges:[...edges],transitions:[...transitions]};
    result.push({floorId,floorName:floor.hierarchy?.floor.name??floor.name,
      nodes:local.nodes,edges:local.edges,
      guidance:local.nodes.length>1?buildGuidedRoute(floor,local,stairs):
        {status:"unavailable",points:[],message:"Only a vertical transition is mapped on this floor."},
      transitionAfter});
  };
  for(let i=0;i<route.edges.length;i++){
    const edge=route.edges[i],next=route.nodes[i+1];
    if(edge.kind==="vertical"){
      push(edge);
      nodes=[next];edges=[];transitions=[];
    }else{
      edges.push(edge);nodes.push(next);
      if(route.transitions?.[i])transitions.push(route.transitions[i]);
    }
  }
  push(null);
  return result;
}
