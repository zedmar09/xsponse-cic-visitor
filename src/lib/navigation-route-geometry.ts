import { type FloorArea, type FloorPlanRecord, type PixelPoint } from "@/lib/floor-plan";
import type { DestinationRoute, NavEdge } from "@/lib/navigation-graph";
import type { Staircase } from "@/lib/staircases";
import { clearanceAStar, segmentKeepsClearance, DEFAULT_WALL_CLEARANCE_PX } from "@/lib/navigation-clearance";

/** An image-pixel route preview, not an accessibility or emergency-escape route.
 * Every subpath must stay inset from the actual drawn room/walkable polygon boundary.
 * We never connect polygon centers directly across an unverified boundary.
 */
export type GuidedRoute = {
  status:"guided"|"unavailable"|"needs-review";
  points:PixelPoint[];
  message:string;
};
const dist=(a:PixelPoint,b:PixelPoint)=>Math.hypot(a.x-b.x,a.y-b.y);
const close=(a:PixelPoint,b:PixelPoint)=>dist(a,b)<0.01;
const cross=(a:PixelPoint,b:PixelPoint,p:PixelPoint)=>
  (b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x);
const dot=(a:PixelPoint,b:PixelPoint)=>a.x*b.x+a.y*b.y;
const sub=(a:PixelPoint,b:PixelPoint)=>({x:a.x-b.x,y:a.y-b.y});
function projection(p:PixelPoint,a:PixelPoint,b:PixelPoint):PixelPoint{
  const ab=sub(b,a),len=dot(ab,ab);
  const t=len>0?Math.max(0,Math.min(1,dot(sub(p,a),ab)/len)):0;
  return {x:a.x+t*ab.x,y:a.y+t*ab.y};
}
function onBoundary(p:PixelPoint,polygon:PixelPoint[]):boolean{
  return polygon.some((a,i)=>dist(p,projection(p,a,polygon[(i+1)%polygon.length]))<=1.25);
}
function inPolygon(p:PixelPoint,polygon:PixelPoint[]):boolean {
  let inside=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const a=polygon[i],b=polygon[j];
    if((a.y>p.y)!==(b.y>p.y)&&
      p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)inside=!inside;
  }
  return inside;
}
const inOrOn=(p:PixelPoint,points:PixelPoint[])=>inPolygon(p,points)||onBoundary(p,points);
/** A segment must remain inside the chosen polygon (including its boundary).
 * Samples also reject crossing other room interiors while following a corridor.
 * Image-background walls are not interpreted; the polygon must accurately trace them.
 */
/** Grid A* with measured clearance from drawn walls and room obstacles.
 * Doorway endpoints remain fixed; corridor points must be inset from walls.
 */
export function routeInsideArea(
  start:PixelPoint,end:PixelPoint,area:FloorArea,rooms:FloorArea[]=[],
):PixelPoint[]|null {
  return clearanceAStar(start,end,area,rooms,DEFAULT_WALL_CLEARANCE_PX);
}
/** Round corners by a bounded quadratic curve, without moving the first or
 * last point. For verified geometry, a validator checks EVERY new segment; if a
 * corner-cut crosses a mapped wall, preserve the original sharp corner.
 */
export function smoothRouteCorners(
  path:PixelPoint[],
  validSegment?:(a:PixelPoint,b:PixelPoint)=>boolean,
  radius=14,
):PixelPoint[] {
  if(path.length<3)return [...path];
  const result:PixelPoint[]=[path[0]];
  for(let i=1;i<path.length-1;i++){
    const prev=path[i-1],corner=path[i],next=path[i+1];
    const before=dist(prev,corner),after=dist(corner,next);
    if(before<2||after<2){result.push(corner);continue;}
    const tangent=Math.min(radius,before*.28,after*.28);
    const enter={x:corner.x+(prev.x-corner.x)*tangent/before,
      y:corner.y+(prev.y-corner.y)*tangent/before};
    const leave={x:corner.x+(next.x-corner.x)*tangent/after,
      y:corner.y+(next.y-corner.y)*tangent/after};
    const curve:PixelPoint[]=[enter];
    for(let j=1;j<=8;j++){
      const t=j/8,u=1-t;
      curve.push({x:u*u*enter.x+2*u*t*corner.x+t*t*leave.x,
        y:u*u*enter.y+2*u*t*corner.y+t*t*leave.y});
    }
    const candidate=[result[result.length-1],...curve];
    const safe=!validSegment||candidate.slice(1).every((p,index)=>
      validSegment(candidate[index],p));
    if(safe)result.push(...curve);
    else result.push(corner);
  }
  const end=path[path.length-1];
  if(!close(result[result.length-1],end))result.push(end);
  return result;
}
function sharedBoundaryPoint(a:FloorArea,b:FloorArea):PixelPoint|null{
  // Actual overlapping collinear boundary segments, not two room centers.
  let best:null|{length:number;point:PixelPoint}=null;
  for(let i=0;i<a.points.length;i++)for(let j=0;j<b.points.length;j++){
    const p=a.points[i],q=a.points[(i+1)%a.points.length];
    const r=b.points[j],s=b.points[(j+1)%b.points.length];
    const pq=sub(q,p),length=dist(p,q);
    if(length<3||dist(r,s)<3)continue;
    if(Math.abs(cross(p,q,r))/length>1||Math.abs(cross(p,q,s))/length>1)continue;
    const unit={x:pq.x/length,y:pq.y/length};
    const project=(v:PixelPoint)=>dot(sub(v,p),unit);
    const left=Math.max(0,Math.min(project(r),project(s)));
    const right=Math.min(length,Math.max(project(r),project(s)));
    if(right-left>2 && (!best||right-left>best.length)){
      const t=(left+right)/2;
      best={length:right-left,point:{x:p.x+unit.x*t,y:p.y+unit.y*t}};
    }
  }
  if(best)return best.point;
  // For administrator-approved overlapping walkable polygons, use a point
  // demonstrably contained in both areas; otherwise no line is generated.
  const bounds=(points:PixelPoint[])=>({
    minX:Math.min(...points.map(p=>p.x)),maxX:Math.max(...points.map(p=>p.x)),
    minY:Math.min(...points.map(p=>p.y)),maxY:Math.max(...points.map(p=>p.y)),
  });
  const aa=bounds(a.points),bb=bounds(b.points);
  const left=Math.max(aa.minX,bb.minX),right=Math.min(aa.maxX,bb.maxX);
  const top=Math.max(aa.minY,bb.minY),bottom=Math.min(aa.maxY,bb.maxY);
  if(right<=left||bottom<=top)return null;
  const center={x:(left+right)/2,y:(top+bottom)/2};
  if(inPolygon(center,a.points)&&inPolygon(center,b.points))return center;
  for(let i=0;i<13;i++)for(let j=0;j<13;j++){
    const p={x:left+(i+.5)*(right-left)/13,y:top+(j+.5)*(bottom-top)/13};
    if(inPolygon(p,a.points)&&inPolygon(p,b.points))return p;
  }
  return null;
}
/** Candidate physical openings for an explicitly approved corridor join.
 * Several positions along a shared edge let the shortest-path solver select
 * the near opening instead of routing to the area's visual/label center.
 */
export function walkwayPassageCandidates(a:FloorArea,b:FloorArea):PixelPoint[] {
  const candidates:PixelPoint[]=[];
  const add=(p:PixelPoint)=>{
    if(inOrOn(p,a.points)&&inOrOn(p,b.points)&&
      !candidates.some(q=>dist(p,q)<3))candidates.push(p);
  };
  for(let i=0;i<a.points.length;i++)for(let j=0;j<b.points.length;j++){
    const p=a.points[i],q=a.points[(i+1)%a.points.length];
    const r=b.points[j],t=b.points[(j+1)%b.points.length];
    const length=dist(p,q);
    if(length<4||dist(r,t)<4||
      Math.abs(cross(p,q,r))/length>1||
      Math.abs(cross(p,q,t))/length>1)continue;
    const ux=(q.x-p.x)/length,uy=(q.y-p.y)/length;
    const projection=(x:PixelPoint)=>(x.x-p.x)*ux+(x.y-p.y)*uy;
    const low=Math.max(0,Math.min(projection(r),projection(t)));
    const high=Math.min(length,Math.max(projection(r),projection(t)));
    if(high-low<4)continue;
    const inset=Math.min(8,(high-low)/5);
    for(const factor of [0,.25,.5,.75,1]){
      const pos=low+inset+(high-low-2*inset)*factor;
      add({x:p.x+ux*pos,y:p.y+uy*pos});
    }
  }
  if(!candidates.length){
    const first=sharedBoundaryPoint(a,b);
    if(first)add(first);
  }
  return candidates;
}
/** The point where a registered graph edge physically joins two mapped areas.
 * It must never be substituted with an area label coordinate.
 */
export type PhysicalOpening={from:PixelPoint;to:PixelPoint};
/** A reviewed doorway can bridge the wall-width gap between two separately
 * outlined areas. Its two anchors lie on the *respective* saved boundaries.
 * No route across a gap is invented without an explicitly reviewed doorway.
 */
export function navTransitionPair(edge:NavEdge,from:FloorArea,to:FloorArea):PhysicalOpening|null {
  if(edge.kind!=="door"&&edge.kind!=="stair-access"){
    const same=transitionPoint(edge,from,to);
    return same?{from:same,to:same}:null;
  }
  const actual=edge.doorPoint;
  if(!actual)return null;
  // A staircase/elevator can overlap the green walking-area polygon. Its
  // automatically detected shared point is already inside *both* shapes:
  // there is no doorway boundary to project it onto.
  if(edge.kind==="stair-access"&&inOrOn(actual,from.points)&&
     inOrOn(actual,to.points))return {from:actual,to:actual};
  const closest=(poly:PixelPoint[])=>{
    let best:PixelPoint|null=null,bestDist=Infinity;
    for(let i=0;i<poly.length;i++){
      const q=projection(actual,poly[i],poly[(i+1)%poly.length]);
      if(dist(actual,q)<bestDist){bestDist=dist(actual,q);best=q;}
    }
    return best?{point:best,distance:bestDist}:null;
  };
  const a=closest(from.points),b=closest(to.points);
  if(!a||!b)return null;
  const span=Math.max(6,edge.doorSpanPx??14);
  const maxSideDistance=edge.kind==="door"?Math.min(29,span/2+4):14;
  const maxGap=edge.kind==="door"?span+9:18;
  // A real doorway spans the two opposing wall faces, so each saved
  // boundary must be near the actual door center, not merely somewhere
  // within a broad radius of an unrelated room corner.
  if(a.distance>maxSideDistance||b.distance>maxSideDistance||
     dist(a.point,b.point)>maxGap)return null;
  const midpoint={x:(a.point.x+b.point.x)/2,y:(a.point.y+b.point.y)/2};
  if(dist(actual,midpoint)>maxSideDistance)return null;
  if(!inOrOn(a.point,from.points)||!inOrOn(b.point,to.points))return null;
  return {from:a.point,to:b.point};
}
export function navTransitionPoint(edge:NavEdge,from:FloorArea,to:FloorArea):PixelPoint|null {
  const pair=navTransitionPair(edge,from,to);
  return pair&&dist(pair.from,pair.to)<=1.5?pair.from:null;
}
function transitionPoint(edge:NavEdge,from:FloorArea,to:FloorArea):PixelPoint|null{
  if(edge.kind==="door") {
    const p=edge.doorPoint;
    if(!p)return null;
    if(onBoundary(p,from.points)&&onBoundary(p,to.points))return p;
    // Reviewed doors may be drawn a few image pixels off the exact boundary.
    // Snap to the *same physical boundary*, never to a distant wall or a gap.
    const closest=(polygon:PixelPoint[])=>{
      let best={point:polygon[0],distance:Infinity};
      for(let i=0;i<polygon.length;i++){
        const q=projection(p,polygon[i],polygon[(i+1)%polygon.length]);
        const d=dist(p,q);
        if(d<best.distance)best={point:q,distance:d};
      }
      return best;
    };
    const a=closest(from.points),b=closest(to.points);
    if(a.distance>14||b.distance>14||dist(a.point,b.point)>2.5)return null;
    const contact={x:(a.point.x+b.point.x)/2,y:(a.point.y+b.point.y)/2};
    return inOrOn(contact,from.points)&&inOrOn(contact,to.points)?contact:null;
  }
  if(edge.kind==="stair-access"){
    const p=edge.doorPoint;
    return p&&inOrOn(p,from.points)&&inOrOn(p,to.points)?p:null;
  }
  if(edge.kind==="walkway")return sharedBoundaryPoint(from,to);
  return null;
}
/** Compose one continuous line from proven door/approved walking-area transitions
 * and visibility-graph paths contained by their *specific* mapped polygons.
 */
export function buildGuidedRoute(floor:FloorPlanRecord,route:DestinationRoute,stairs:Staircase[]=[]):GuidedRoute {
  const fail=(message:string,status:GuidedRoute["status"]="needs-review"):GuidedRoute=>({
    status,points:[],message,
  });
  if(route.status!=="ready")return fail("No verified room-to-room connection is available.","unavailable");
  const floorId=floor.hierarchy?.floor.id??floor.planId;
  if(route.nodes.some(n=>n.floorId!==floorId))return fail("Cross-floor walking lines are not available.","unavailable");
  const spaces=floor.areas??[];
  const areaFor=(id:string)=>{
    const area=spaces.find(a=>`${floorId}:area:${a.id}`===id);
    if(area)return area;
    const stair=stairs.find(s=>`${floorId}:stair:${s.id}`===id);
    const landing=stair?.landings.find(l=>l.floorId===floorId);
    return landing?{id:stair!.id,floorId,kind:"walkable" as const,
      name:stair!.name,points:landing.outline}:undefined;
  };
  const pathAreas=route.nodes.map(n=>areaFor(n.id));
  if(pathAreas.some(a=>!a))return fail("A mapped room or walking area is missing. Edit the map; no line will be drawn through unknown walls.");
  const areas=pathAreas as FloorArea[],rooms=spaces.filter(a=>a.kind==="room");
  const transitions:PhysicalOpening[]=[];
  for(let i=0;i<route.edges.length;i++){
    const transition=route.transitions?.[i]??
      navTransitionPair(route.edges[i],areas[i],areas[i+1]);
    if(!transition)return fail(`The mapped opening at "${route.edges[i].label}" could not be aligned with the adjacent areas. Check this doorway's position.`);
    transitions.push(transition);
  }
  const points:PixelPoint[]=[];
  for(let i=0;i<areas.length;i++){
    // Room/vertical-zone visits start and finish at their real mapped opening.
    // Do not run a long line into a room's area-label/centroid marker.
    const first=i===0,last=i===areas.length-1;
    const start=first&&route.nodes[0].kind!=="walkable"?
      transitions[0].from:first?route.nodes[0].point:transitions[i-1].to;
    const end=last&&route.nodes[route.nodes.length-1].kind!=="walkable"?
      transitions[transitions.length-1].to:last?
      route.nodes[route.nodes.length-1].point:transitions[i].from;
    const segment=routeInsideArea(start,end,areas[i],rooms);
    if(!segment)return fail(`No wall-clear path through "${areas[i].name}". Adjust the green walking-area outline or doorway. A line through the wall has been hidden.`);
    const smooth=smoothRouteCorners(segment,(a,b)=>segmentKeepsClearance(
      a,b,areas[i],rooms,DEFAULT_WALL_CLEARANCE_PX,[start,end]));
    for(const p of smooth)if(!points.length||!close(points[points.length-1],p))points.push(p);
  }
  if(points.length<2)return fail("No wall-clear path could be drawn. Check the walking-area and doorway geometry.");
  return {status:"guided",points,
    message:"Preview follows saved polygon interiors and confirmed openings. Check the floor-plan image for unmapped walls or obstacles before using it for wayfinding."};
}
