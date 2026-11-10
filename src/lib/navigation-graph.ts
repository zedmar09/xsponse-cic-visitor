import {
  areaLabelPoint, doorwayReviewIssues, portalMidpoint, suggestDoorwaySides,
  type FloorArea, type FloorPlanRecord, type PixelPoint,
} from "@/lib/floor-plan";
import { landingOnFloor, type Staircase } from "@/lib/staircases";
import { findAutomaticLandingAccess, matchVerticalFloors, verticalKind, verticalName } from "@/lib/vertical-connections";

/** Approval is scoped to the two original polygon outlines. Moving or editing
 * either polygon invalidates the approval automatically, without deleting it.
 * This is topology metadata, NOT a physical route or a safety certification.
 */
export type WalkwayApproval = {
  areaAId:string;
  areaBId:string;
  geometryKey:string;
};
export type NavNode = {
  id:string;floorId:string;label:string;
  kind:"room"|"walkable"|"outside"|"staircase"|"elevator";
  point:PixelPoint;
};
export type NavEdge = {
  id:string;floorId:string;fromId:string;toId:string;
  kind:"door"|"walkway"|"stair-access"|"vertical";
  status:"ready"|"candidate";
  label:string;
  // For diagnostics only. Never use a straight center-to-center overlay as a physical route.
  start:PixelPoint;end:PixelPoint;
  /** Actual opening location, not a center-to-center drawing. */
  doorPoint?:PixelPoint;
  /** Saved doorway rectangle thickness, to allow a route through its mapped opening even when room/walkway outlines are separated by a wall-width gap. */
  doorSpanPx?:number;
  direction:"both"|"forward"|"backward";
};
export type NavIssue = {
  id:string;floorId:string;severity:"warning"|"info";
  category:"door"|"space"|"walkway"|"staircase";
  entityId:string;message:string;
};
export type WalkwayCandidate = {
  id:string;floorId:string;areaAId:string;areaBId:string;
  label:string;geometryKey:string;approved:boolean;stale:boolean;
};
export type NavigationAudit = {
  nodes:NavNode[];edges:NavEdge[];issues:NavIssue[];walkways:WalkwayCandidate[];
  readyDoorCount:number;reviewDoorCount:number;
  connectedSpaceCount:number;spaceCount:number;
};
const nodeId=(floorId:string,kind:string,id:string)=>`${floorId}:${kind}:${id}`;
export const walkwayPairId=(a:string,b:string)=>[a,b].sort().join("::");
export function walkwayGeometryKey(a:FloorArea,b:FloorArea):string {
  return [a,b].sort((x,y)=>x.id.localeCompare(y.id))
    .map(x=>`${x.id}=${JSON.stringify(x.points)}`).join("|");
}
const distance=(a:PixelPoint,b:PixelPoint)=>Math.hypot(a.x-b.x,a.y-b.y);
const cross=(a:PixelPoint,b:PixelPoint,c:PixelPoint)=>
  (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
function inPolygon(p:PixelPoint,points:PixelPoint[]):boolean {
  let inside=false;
  for(let i=0,j=points.length-1;i<points.length;j=i++){
    const a=points[i],b=points[j];
    if((a.y>p.y)!==(b.y>p.y) &&
       p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)inside=!inside;
  }
  return inside;
}
function interiorOverlap(a:PixelPoint[],b:PixelPoint[]):boolean {
  // Strictly contained vertex OR real segment crossing, never a touch at one corner.
  for(const p of a)if(inPolygon(p,b) && boundaryDistance(p,b)>0.7)return true;
  for(const p of b)if(inPolygon(p,a) && boundaryDistance(p,a)>0.7)return true;
  for(let i=0;i<a.length;i++)for(let j=0;j<b.length;j++){
    const p=a[i],q=a[(i+1)%a.length],r=b[j],s=b[(j+1)%b.length];
    const d1=cross(p,q,r),d2=cross(p,q,s),d3=cross(r,s,p),d4=cross(r,s,q);
    if(d1*d2< -1e-4 && d3*d4< -1e-4)return true;
  }
  return false;
}
function segmentDistance(p:PixelPoint,a:PixelPoint,b:PixelPoint):number {
  const dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;
  const t=length>0?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/length)):0;
  return distance(p,{x:a.x+t*dx,y:a.y+t*dy});
}
function boundaryDistance(p:PixelPoint,polygon:PixelPoint[]):number {
  return Math.min(...polygon.map((a,i)=>segmentDistance(p,a,polygon[(i+1)%polygon.length])));
}
/** A shared collinear wall/border is a geometric candidate, not a proven opening. */
function sharedEdge(a:PixelPoint[],b:PixelPoint[]):boolean {
  for(let i=0;i<a.length;i++)for(let j=0;j<b.length;j++){
    const p=a[i],q=a[(i+1)%a.length],r=b[j],s=b[(j+1)%b.length];
    const dx=q.x-p.x,dy=q.y-p.y,len=Math.hypot(dx,dy);
    if(len<4 || distance(r,s)<4)continue;
    if(Math.abs(cross(p,q,r))/len>1 || Math.abs(cross(p,q,s))/len>1)continue;
    const proj=(t:PixelPoint)=>((t.x-p.x)*dx+(t.y-p.y)*dy)/len;
    const overlap=Math.max(0,Math.min(len,Math.max(proj(r),proj(s)))-
      Math.max(0,Math.min(proj(r),proj(s))));
    if(overlap>3)return true;
  }
  return false;
}
export function potentialWalkwayPair(a:FloorArea,b:FloorArea):boolean {
  return a.kind==="walkable" && b.kind==="walkable" &&
    a.id!==b.id && a.floorId===b.floorId &&
    (sharedEdge(a.points,b.points)||interiorOverlap(a.points,b.points));
}
const issue=(issues:NavIssue[],floorId:string,category:NavIssue["category"],
  entityId:string,message:string,severity:NavIssue["severity"]="warning")=>{
  issues.push({id:`${floorId}:${category}:${entityId}:${issues.length}`,
    floorId,category,entityId,message,severity});
};
/** A proposed graph used for ADMIN AUDIT only: it contains NO route trajectories.
 * Nodes are derived from saved geometry; only checked doorways and explicitly
 * approved open-walkway joins count toward connected components.
 */
export function buildNavigationAudit(floors:FloorPlanRecord[],stairs:Staircase[]):NavigationAudit {
  const nodes:NavNode[]=[],edges:NavEdge[]=[],issues:NavIssue[]=[],walkways:WalkwayCandidate[]=[];
  let readyDoorCount=0,reviewDoorCount=0;
  for(const floor of floors) {
    const floorId=floor.hierarchy?.floor.id??floor.planId;
    const spaces=floor.areas??[],byId=new Map(spaces.map(a=>[a.id,a]));
    const portals=floor.portals??[],walkables=spaces.filter(a=>a.kind==="walkable");
    for(const area of spaces)nodes.push({id:nodeId(floorId,"area",area.id),floorId,label:area.name,
      kind:area.kind,point:areaLabelPoint(area.points)});
    const outsideId=nodeId(floorId,"outside","outside");
    const seenApproved=new Set<string>();
    const approvedByPair=new Map((floor.walkwayApprovals??[]).map(a=>
      [walkwayPairId(a.areaAId,a.areaBId),a]));
    for(let i=0;i<walkables.length;i++)for(let j=i+1;j<walkables.length;j++){
      const a=walkables[i],b=walkables[j];
      if(!potentialWalkwayPair(a,b))continue;
      const id=walkwayPairId(a.id,b.id),key=walkwayGeometryKey(a,b);
      const approval=approvedByPair.get(id);
      const approved=approval?.geometryKey===key;
      const stale=Boolean(approval&&!approved);
      seenApproved.add(id);
      walkways.push({id,floorId,areaAId:a.id,areaBId:b.id,
        label:`${a.name} ↔ ${b.name}`,geometryKey:key,approved,stale});
      edges.push({id:`${floorId}:walkway:${id}`,floorId,
        fromId:nodeId(floorId,"area",a.id),toId:nodeId(floorId,"area",b.id),
        kind:"walkway",status:approved?"ready":"candidate",
        label:`${a.name} ↔ ${b.name}`,start:areaLabelPoint(a.points),
        end:areaLabelPoint(b.points),direction:"both"});
      if(stale)issue(issues,floorId,"walkway",id,
        `${a.name} / ${b.name}: geometry changed. Recheck and reapprove this passage.`);
      else if(!approved)issue(issues,floorId,"walkway",id,
        `${a.name} / ${b.name}: touching walking areas need confirmation that no wall blocks passage.`);
    }
    for(const id of approvedByPair.keys()){
      if(!seenApproved.has(id))issue(issues,floorId,"walkway",id,
        "An old walking-area approval no longer matches any adjacent spaces. Review or remove it.");
    }
    for(const portal of portals){
      const doorIssues=doorwayReviewIssues(portal,spaces);
      const a=portal.spaceAId?byId.get(portal.spaceAId):null;
      const b=portal.spaceBId?byId.get(portal.spaceBId):null;
      if(doorIssues.length){
        reviewDoorCount++;
        issue(issues,floorId,"door",portal.id,`${portal.name}: ${doorIssues[0]}`);
        continue;
      }
      const external=portal.purpose==="building"||portal.purpose==="emergency";
      if(!b||(!external&&!a)){
        reviewDoorCount++;
        issue(issues,floorId,"door",portal.id,`${portal.name}: connected spaces are incomplete.`);
        continue;
      }
      const suggested=suggestDoorwaySides(portal.start,portal.end,spaces);
      const expected=new Set(external?[b.id]:[a!.id,b.id]);
      const found=[suggested.sideAId,suggested.sideBId].filter((x):x is string=>Boolean(x));
      const geometryOK=external?
        found.includes(b.id):
        suggested.status==="two-spaces"&&found.length===2&&
        found.every(x=>expected.has(x));
      if(!geometryOK){
        reviewDoorCount++;
        issue(issues,floorId,"door",portal.id,
          `${portal.name}: saved room links could not be confirmed on both sides of its drawn opening. Recheck door placement and polygon boundaries.`);
        continue;
      }
      if(external&&!nodes.some(n=>n.id===outsideId))
        nodes.push({id:outsideId,floorId,label:"Outside",kind:"outside",point:portalMidpoint(portal)});
      edges.push({id:`${floorId}:door:${portal.id}`,floorId,
        fromId:external?outsideId:nodeId(floorId,"area",a!.id),
        toId:nodeId(floorId,"area",b.id),kind:"door",status:"ready",
        label:portal.name,doorPoint:portalMidpoint(portal),
        doorSpanPx:portal.displayDepthPx??14,
        start:external?portalMidpoint(portal):areaLabelPoint(a!.points),
        end:areaLabelPoint(b.points),
        direction:portal.usage==="entrance"?"forward":
          portal.usage==="exit"?"backward":"both"});
      readyDoorCount++;
    }
    for(const stair of stairs.filter(s=>s.buildingId===floor.hierarchy?.building.id)){
      const landing=landingOnFloor(stair,floorId);
      if(!landing)continue;
      const node=nodeId(floorId,"stair",stair.id);
      const type=verticalKind(stair);
      const access=findAutomaticLandingAccess(landing,floor);
      nodes.push({id:node,floorId,kind:type,label:stair.name,
        point:areaLabelPoint(landing.outline)});
      if(access){
        edges.push({id:`${floorId}:vertical-access:${stair.id}`,floorId,
          fromId:node,toId:nodeId(floorId,"area",access.area.id),
          kind:"stair-access",status:"ready",
          label:`${stair.name} ↔ ${access.area.name}`,
          start:areaLabelPoint(landing.outline),end:areaLabelPoint(access.area.points),
          doorPoint:access.point,direction:"both"});
        if(access.estimated)issue(issues,floorId,"staircase",stair.id,
          `${stair.name}: automatically connected to its nearest walking area. Please check the estimated gap against the floor image.`,"info");
      }else issue(issues,floorId,"staircase",stair.id,
        `${stair.name}: no walking area is nearby. Draw a green walking area near this ${type} to preview directions.`);
    }
  }
  // Floor-to-floor matching also supports separately drawn, reciprocally
  // selected Staircase 1 (Floor 1) and Staircase 2 (Floor 2).
  const matches=matchVerticalFloors(floors,stairs);
  for(const pending of matches.pending){
    const hasSameTypeOnTarget=stairs.some(other=>other.id!==pending.zone.id
      &&other.buildingId===pending.zone.buildingId
      &&verticalKind(other)===verticalKind(pending.zone)
      &&other.landings.some(l=>l.floorId===pending.floorId));
    issue(issues,pending.floorId,"staircase",pending.zone.id,
      pending.reason.includes("intermediate floor")?pending.reason:
      hasSameTypeOnTarget?
        `${pending.zone.name}: a ${verticalKind(pending.zone)} is drawn here but multiple connections remain ambiguous. Choose the original floor as its destination.`:
        `${pending.zone.name}: draw a ${verticalKind(pending.zone)} on this floor and choose the original floor as its destination.`);
  }
  for(const {first,second} of matches.links){
    const accessA=findAutomaticLandingAccess(first.landing,first.floor);
    const accessB=findAutomaticLandingAccess(second.landing,second.floor);
    if(!accessA||!accessB)continue;
    const low=first.floor.hierarchy!.floor.id,high=second.floor.hierarchy!.floor.id;
    // For two separate zones, each direction must be permitted by both settings.
    const canUp=first.zone.direction!=="down"&&second.zone.direction!=="down";
    const canDown=first.zone.direction!=="up"&&second.zone.direction!=="up";
    if(!canUp&&!canDown)continue;
    edges.push({
      id:`${first.zone.id}:${second.zone.id}:${low}:${high}`,
      floorId:low,fromId:nodeId(low,"stair",first.zone.id),
      toId:nodeId(high,"stair",second.zone.id),
      kind:"vertical",status:"ready",
      label:`${verticalName(first.zone)}: ${first.zone.name}`,
      start:areaLabelPoint(first.landing.outline),
      end:areaLabelPoint(second.landing.outline),
      direction:canUp&&canDown?"both":canUp?"forward":"backward",
    });
  }
  // Count undirected, audit-only connectivity. One-way restrictions are recorded
  // on edges but intentionally NOT evaluated as a route or visitor permission.
  const adjacency=new Map(nodes.map(n=>[n.id,new Set<string>()]));
  for(const e of edges.filter(e=>e.status==="ready")){
    adjacency.get(e.fromId)?.add(e.toId);
    adjacency.get(e.toId)?.add(e.fromId);
  }
  const connected=new Set<string>();
  // A walkable network is considered an anchor even when no exterior doorway exists;
  // every room should be able to reach some walkable polygon.
  const seeds=nodes.filter(n=>n.kind==="walkable" &&
    (adjacency.get(n.id)?.size??0)>0);
  for(const seed of seeds){
    if(connected.has(seed.id))continue;
    const queue=[seed.id];
    for(let i=0;i<queue.length;i++){
      const cur=queue[i];if(connected.has(cur))continue;connected.add(cur);
      for(const next of adjacency.get(cur)??[])if(!connected.has(next))queue.push(next);
    }
  }
  // Isolated walking areas may be valid on a different level/zone; flag them.
  for(const n of nodes.filter(n=>n.kind==="room"||n.kind==="walkable")){
    if(!connected.has(n.id))issue(issues,n.floorId,"space",n.id,
      `${n.label}: no validated connection to a walking-area network.`);
  }
  const spaceNodes=nodes.filter(n=>n.kind==="room"||n.kind==="walkable");
  return {nodes,edges,issues,walkways,readyDoorCount,reviewDoorCount,
    connectedSpaceCount:spaceNodes.filter(n=>connected.has(n.id)).length,
    spaceCount:spaceNodes.length};
}

/** Find the sequence of validated space/door connections for a chosen pair.
 * Never infer a route from an overlapping polygon, an unreviewed door, or an
 * unvalidated stair. This intentionally does NOT return a drawn route line:
 * straight line geometry across room centers was the original accuracy bug.
 */
export type DestinationRoute = {
  status:"ready"|"same"|"unreachable"|"different-floor"|"missing";
  nodes:NavNode[];
  edges:NavEdge[];
  /** Chosen physical opening at either end of each traversed edge.
   * These points are independent of room/corridor label locations.
   */
  transitions?:{from:PixelPoint;to:PixelPoint}[];
  distancePx?:number;
  /** "topology" means the saved connections exist but the shortest physical trajectory needs validation. */
  routeSource?:"topology"|"shortest";
};
export function findValidatedRoute(
  audit:NavigationAudit,startId:string|null,endId:string|null,
):DestinationRoute {
  const empty=(status:DestinationRoute["status"]):DestinationRoute=>({
    status,nodes:[],edges:[],
  });
  if(!startId||!endId)return empty("missing");
  const nodes=new Map(audit.nodes.map(n=>[n.id,n]));
  const start=nodes.get(startId),end=nodes.get(endId);
  if(!start||!end)return empty("missing");
  if(start.id===end.id)return {status:"same",nodes:[start],edges:[]};
  const links=new Map<string,{nextId:string;edge:NavEdge}[]>();
  const add=(from:string,to:string,edge:NavEdge)=>{
    const existing=links.get(from)??[];
    existing.push({nextId:to,edge});
    links.set(from,existing);
  };
  for(const edge of audit.edges) {
    if(edge.status!=="ready")continue;
    // Never shortcut between rooms by exiting and re-entering through unrelated
    // exterior/emergency doors. Outdoor routing is a separate, audited network.
    if(nodes.get(edge.fromId)?.kind==="outside"||nodes.get(edge.toId)?.kind==="outside")continue;
    if(edge.direction==="both"||edge.direction==="forward")
      add(edge.fromId,edge.toId,edge);
    if(edge.direction==="both"||edge.direction==="backward")
      add(edge.toId,edge.fromId,edge);
  }
  // Dijkstra, rather than BFS: the closest *reachable* stair or elevator
  // wins over an arbitrary connector earlier in the stored array.
  const cost=new Map<string,number>([[startId,0]]);
  const settled=new Set<string>();
  const previous=new Map<string,{parent:string;edge:NavEdge}>();
  while(true){
    let current:string|null=null,lowest=Infinity;
    for(const [id,value] of cost)
      if(!settled.has(id)&&value<lowest){current=id;lowest=value;}
    if(!current)break;
    if(current===endId)break;
    settled.add(current);
    for(const {nextId,edge} of links.get(current)??[]){
      const a=nodes.get(current)!,b=nodes.get(nextId)!;
      const weight=edge.kind==="vertical"?120:
        Math.max(1,Math.hypot(a.point.x-b.point.x,a.point.y-b.point.y));
      const candidate=lowest+weight;
      if(candidate<(cost.get(nextId)??Infinity)){
        cost.set(nextId,candidate);
        previous.set(nextId,{parent:current,edge});
      }
    }
  }
  if(!cost.has(endId))return empty("unreachable");
  const orderedNodes:NavNode[]=[end],orderedEdges:NavEdge[]=[];
  let current=endId;
  while(current!==startId){
    const item=previous.get(current);
    if(!item)return empty("unreachable");
    orderedEdges.push(item.edge);
    orderedNodes.push(nodes.get(item.parent)!);
    current=item.parent;
  }
  return {status:"ready",nodes:orderedNodes.reverse(),edges:orderedEdges.reverse()};
}
