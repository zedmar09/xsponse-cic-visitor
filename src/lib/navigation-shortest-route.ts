import type { FloorArea, FloorPlanRecord, PixelPoint } from "@/lib/floor-plan";
import type { Staircase } from "@/lib/staircases";
import {
  type DestinationRoute, type NavEdge, type NavigationAudit, type NavNode,
} from "@/lib/navigation-graph";
import {
  navTransitionPair, routeInsideArea, walkwayPassageCandidates,
} from "@/lib/navigation-route-geometry";

/** Route through physical door/open-passage coordinates rather than area labels.
 * A state is an opening on one side of an edge. Traveling through an area costs
 * the length of its clearance-checked A* line; crossing a door costs ~0 px.
 * This also evaluates multiple approved crossing points on long open boundaries.
 */
type Port={
  id:number;nodeId:string;edge:NavEdge;side:"from"|"to";
  point:PixelPoint;opposite:number;
};
const dist=(a:PixelPoint,b:PixelPoint)=>Math.hypot(a.x-b.x,a.y-b.y);
const length=(points:PixelPoint[])=>points.slice(1).reduce(
  (sum,p,i)=>sum+dist(points[i],p),0,
);
export function findShortestMappedRoute(
  audit:NavigationAudit,floors:FloorPlanRecord[],stairs:Staircase[],
  startId:string|null,endId:string|null,
):DestinationRoute {
  const empty=(status:DestinationRoute["status"]):DestinationRoute=>({
    status,nodes:[],edges:[],
  });
  if(!startId||!endId)return empty("missing");
  const nodes=new Map(audit.nodes.map(n=>[n.id,n]));
  const from=nodes.get(startId),to=nodes.get(endId);
  if(!from||!to)return empty("missing");
  if(startId===endId)return {status:"same",nodes:[from],edges:[],distancePx:0};
  const floorById=new Map(floors.map(f=>[f.hierarchy?.floor.id??f.planId,f]));
  const areas=new Map<string,FloorArea>();
  for(const floor of floors){
    const fid=floor.hierarchy?.floor.id??floor.planId;
    for(const area of floor.areas??[])areas.set(`${fid}:area:${area.id}`,area);
  }
  for(const stair of stairs)for(const landing of stair.landings){
    areas.set(`${landing.floorId}:stair:${stair.id}`,{
      id:stair.id,floorId:landing.floorId,kind:"walkable",name:stair.name,
      points:landing.outline,
    });
  }
  const ports:Port[]=[],byNode=new Map<string,number[]>();
  const add=(nodeId:string,edge:NavEdge,side:Port["side"],point:PixelPoint)=>{
    const id=ports.length;ports.push({id,nodeId,edge,side,point,opposite:-1});
    const list=byNode.get(nodeId)??[];
    list.push(id);byNode.set(nodeId,list);
    return id;
  };
  const accessByStair=new Map<string,PixelPoint>();
  for(const edge of audit.edges){
    if(edge.status==="ready"&&edge.kind==="stair-access"&&edge.doorPoint){
      const stairId=nodes.get(edge.fromId)?.kind==="staircase"||
        nodes.get(edge.fromId)?.kind==="elevator"?edge.fromId:edge.toId;
      accessByStair.set(stairId,edge.doorPoint);
    }
  }
  for(const edge of audit.edges){
    if(edge.status!=="ready")continue;
    const src=nodes.get(edge.fromId),dest=nodes.get(edge.toId);
    if(!src||!dest||src.kind==="outside"||dest.kind==="outside")continue;
    let points:{from:PixelPoint;to:PixelPoint}[]=[];
    if(edge.kind==="vertical"){
      const a=accessByStair.get(edge.fromId),b=accessByStair.get(edge.toId);
      if(a&&b)points=[{from:a,to:b}];
    }else{
      const a=areas.get(edge.fromId),b=areas.get(edge.toId);
      if(!a||!b)continue;
      if(edge.kind==="walkway"){
        points=walkwayPassageCandidates(a,b).map(p=>({from:p,to:p}));
      }else{
        const at=navTransitionPair(edge,a,b);
        if(at)points=[at];
      }
    }
    for(const pt of points){
      const id1=add(edge.fromId,edge,"from",pt.from);
      const id2=add(edge.toId,edge,"to",pt.to);
      ports[id1].opposite=id2;ports[id2].opposite=id1;
    }
  }
  // Bound graph size. The editor should never hang on an exceptionally large map.
  if(ports.length>600)return empty("unreachable");
  const starts=byNode.get(startId)??[],goals=new Set(byNode.get(endId)??[]);
  if(!starts.length||!goals.size)return empty("unreachable");
  const costs=new Float64Array(ports.length).fill(Infinity);
  const visited=new Uint8Array(ports.length);
  const previous=new Map<number,{id:number;cross:boolean}>();
  const localDistance=new Map<string,number>();
  const shortestWithin=(a:Port,b:Port):number=>{
    const lo=Math.min(a.id,b.id),hi=Math.max(a.id,b.id),key=`${lo}:${hi}`;
    const cached=localDistance.get(key);
    if(cached!==undefined)return cached;
    const area=areas.get(a.nodeId),floor=floorById.get(nodes.get(a.nodeId)!.floorId);
    if(!area||!floor)return Infinity;
    const obstacles=(floor.areas??[]).filter(x=>x.kind==="room");
    const line=routeInsideArea(a.point,b.point,area,obstacles);
    const result=line?length(line):Infinity;
    localDistance.set(key,result);
    return result;
  };
  for(const id of starts)costs[id]=0;
  let chosen=-1;
  for(let iterations=0;iterations<ports.length;iterations++){
    let current=-1;
    for(let i=0;i<ports.length;i++)
      if(!visited[i]&&(current<0||costs[i]<costs[current]))current=i;
    if(current<0||!Number.isFinite(costs[current]))break;
    if(goals.has(current)){chosen=current;break;}
    visited[current]=1;
    const port=ports[current],edge=port.edge;
    const permitted=port.side==="from"?edge.direction!=="backward":
      edge.direction!=="forward";
    if(permitted){
      const other=port.opposite;
      // A floor change is an actual connector; include a small transition
      // cost in equivalent pixel units, but never use shaft label coordinates.
      const levelDiff=Math.abs(
        (floorById.get(nodes.get(port.nodeId)!.floorId)?.hierarchy?.floor.level??0)-
        (floorById.get(nodes.get(ports[other].nodeId)!.floorId)?.hierarchy?.floor.level??0));
      const crossing=edge.kind==="vertical"?45*Math.max(1,levelDiff):
        Math.max(0.01,dist(port.point,ports[other].point));
      const candidate=costs[current]+crossing;
      if(candidate<costs[other]){
        costs[other]=candidate;previous.set(other,{id:current,cross:true});
      }
    }
    for(const id of byNode.get(port.nodeId)??[]){
      if(id===current||visited[id])continue;
      const walk=shortestWithin(port,ports[id]);
      const candidate=costs[current]+walk;
      if(candidate<costs[id]){
        costs[id]=candidate;previous.set(id,{id:current,cross:false});
      }
    }
  }
  if(chosen<0)return empty("unreachable");
  const crossed:{edge:NavEdge;next:NavNode;from:PixelPoint;to:PixelPoint}[]=[];
  let cursor=chosen;
  while(previous.has(cursor)){
    const step=previous.get(cursor)!;
    if(step.cross){
      crossed.push({edge:ports[cursor].edge,next:nodes.get(ports[cursor].nodeId)!,
        from:ports[step.id].point,to:ports[cursor].point});
    }
    cursor=step.id;
  }
  crossed.reverse();
  const selectedNodes:NavNode[]=[from],selectedEdges:NavEdge[]=[];
  const transitions:{from:PixelPoint;to:PixelPoint}[]=[];
  for(const step of crossed){
    selectedEdges.push(step.edge);
    selectedNodes.push(step.next);
    transitions.push({from:step.from,to:step.to});
  }
  if(selectedNodes.at(-1)?.id!==endId)return empty("unreachable");
  return {status:"ready",nodes:selectedNodes,edges:selectedEdges,transitions,
    distancePx:costs[chosen]};
}
