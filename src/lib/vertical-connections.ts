import { areaLabelPoint, type FloorArea, type FloorPlanRecord, type PixelPoint } from "@/lib/floor-plan";
import type { Staircase, StairLanding } from "@/lib/staircases";

const distance=(a:PixelPoint,b:PixelPoint)=>Math.hypot(a.x-b.x,a.y-b.y);
const project=(p:PixelPoint,a:PixelPoint,b:PixelPoint):PixelPoint=>{
  const dx=b.x-a.x,dy=b.y-a.y,den=dx*dx+dy*dy;
  const t=den?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/den)):0;
  return {x:a.x+t*dx,y:a.y+t*dy};
};
const onBoundary=(point:PixelPoint,polygon:PixelPoint[])=>polygon.some((v,i)=>
  distance(project(point,v,polygon[(i+1)%polygon.length]),point)<1.1);
export function polygonContains(point:PixelPoint,polygon:PixelPoint[]):boolean {
  if(onBoundary(point,polygon))return true;
  let inside=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const a=polygon[i],b=polygon[j];
    if((a.y>point.y)!==(b.y>point.y)&&
      point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x)inside=!inside;
  }
  return inside;
}
const strictInside=(p:PixelPoint,poly:PixelPoint[])=>
  !onBoundary(p,poly)&&polygonContains(p,poly);
function commonPoint(outline:PixelPoint[],walkable:PixelPoint[]):PixelPoint|null {
  // A single touching corner is not a usable doorway/vertical transition.
  // A shared boundary requires nontrivial overlap, not just coincident endpoints.
  for(let i=0;i<outline.length;i++)for(let j=0;j<walkable.length;j++){
    const a=outline[i],b=outline[(i+1)%outline.length];
    const c=walkable[j],d=walkable[(j+1)%walkable.length];
    const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy);
    if(len<4||distance(c,d)<4)continue;
    const cross=(p:PixelPoint)=>Math.abs((p.x-a.x)*dy-(p.y-a.y)*dx)/len;
    if(cross(c)>0.8||cross(d)>0.8)continue;
    const projection=(p:PixelPoint)=>((p.x-a.x)*dx+(p.y-a.y)*dy)/len;
    const lo=Math.max(0,Math.min(projection(c),projection(d)));
    const hi=Math.min(len,Math.max(projection(c),projection(d)));
    if(hi-lo<=3)continue;
    const t=(lo+hi)/2;
    return {x:a.x+t*dx/len,y:a.y+t*dy/len};
  }
  const samples:PixelPoint[]=[areaLabelPoint(outline),areaLabelPoint(walkable)];
  for(const poly of [outline,walkable])for(let i=0;i<poly.length;i++){
    const a=poly[i],b=poly[(i+1)%poly.length];
    samples.push(a,{x:(a.x+b.x)/2,y:(a.y+b.y)/2});
  }
  // Include actual crossings and shared-boundary contacts.
  for(let i=0;i<outline.length;i++)for(let j=0;j<walkable.length;j++){
    const a=outline[i],b=outline[(i+1)%outline.length];
    const c=walkable[j],d=walkable[(j+1)%walkable.length];
    const den=(b.x-a.x)*(d.y-c.y)-(b.y-a.y)*(d.x-c.x);
    if(Math.abs(den)<1e-8)continue;
    const t=((c.x-a.x)*(d.y-c.y)-(c.y-a.y)*(d.x-c.x))/den;
    const u=((c.x-a.x)*(b.y-a.y)-(c.y-a.y)*(b.x-a.x))/den;
    if(t>=0&&t<=1&&u>=0&&u<=1)samples.push({
      x:a.x+t*(b.x-a.x),y:a.y+t*(b.y-a.y),
    });
  }
  for(const p of samples){
    if(strictInside(p,outline)&&strictInside(p,walkable))return p;
  }
  // Overlap may be entirely enclosed. Sample the actual intersected bounds.
  const limits=(p:PixelPoint[])=>({
    l:Math.min(...p.map(v=>v.x)),r:Math.max(...p.map(v=>v.x)),
    t:Math.min(...p.map(v=>v.y)),b:Math.max(...p.map(v=>v.y)),
  });
  const a=limits(outline),b=limits(walkable);
  const l=Math.max(a.l,b.l),r=Math.min(a.r,b.r);
  const t=Math.max(a.t,b.t),bottom=Math.min(a.b,b.b);
  for(let i=0;i<9;i++)for(let j=0;j<9;j++){
    const p={x:l+(r-l)*(i+.5)/9,y:t+(bottom-t)*(j+.5)/9};
    if(strictInside(p,outline)&&strictInside(p,walkable))return p;
  }
  return null;
}
/** No admin registration required: a vertical zone touches or overlaps a
 * saved green walking area. Never create an access link across a spatial gap.
 */
export function findAutomaticLandingAccess(
  landing:StairLanding,floor:FloorPlanRecord,
):{area:FloorArea;point:PixelPoint;estimated:boolean}|null {
  const walking=(floor.areas??[]).filter(a=>a.kind==="walkable");
  for(const area of walking){
    const point=commonPoint(landing.outline,area.points);
    if(point)return {area,point,estimated:false};
  }
  // Administrators need only draw the vertical zone. A narrow drawing gap to
  // an existing walking area can be matched automatically, but its connection
  // is an ESTIMATE and must be visually reviewed, not certified wall-clear.
  let nearest:{area:FloorArea;point:PixelPoint;distance:number}|null=null;
  for(const area of walking){
    for(const a of landing.outline){
      for(let i=0;i<area.points.length;i++){
        const point=project(a,area.points[i],area.points[(i+1)%area.points.length]);
        const d=distance(a,point);
        if(!nearest||d<nearest.distance)nearest={area,point,distance:d};
      }
    }
  }
  const maxGap=Math.min(90,Math.max(30,Math.min(floor.width,floor.height)*.06));
  return nearest&&nearest.distance<=maxGap?
    {area:nearest.area,point:nearest.point,estimated:true}:null;
}
export const verticalKind=(stair:Staircase)=>stair.kind??"staircase";
export const verticalName=(stair:Staircase)=>verticalKind(stair)==="elevator"?"Elevator":"Staircase";

/** Connect independently drawn zones by their selected destination floors.
 * A two-floor staircase can be drawn as two separate records; it is NOT
 * necessary to re-open the first record on the second floor.
 * Never pair two ambiguous shafts merely because they share a level.
 */
export type VerticalFloorLink = {
  first:{zone:Staircase;landing:StairLanding;floor:FloorPlanRecord};
  second:{zone:Staircase;landing:StairLanding;floor:FloorPlanRecord};
};
export function matchVerticalFloors(
  floors:FloorPlanRecord[],zones:Staircase[],
):{links:VerticalFloorLink[];pending:{zone:Staircase;floorId:string;reason:string}[]} {
  const links:VerticalFloorLink[]=[],pending: {zone:Staircase;floorId:string;reason:string}[]=[];
  const done=new Set<string>();
  const byFloor=new Map(floors.map(f=>[f.hierarchy?.floor.id??f.planId,f]));
  const ordered=[...floors].sort((a,b)=>
    (a.hierarchy?.floor.level??0)-(b.hierarchy?.floor.level??0));
  const floorIndex=(id:string)=>ordered.findIndex(f=>f.hierarchy?.floor.id===id);
  for(const zone of zones){
    for(const origin of zone.landings){
      const originFloor=byFloor.get(origin.floorId);
      if(!originFloor)continue;
      for(const destId of zone.servedFloorIds??zone.landings.map(l=>l.floorId)){
        if(destId===origin.floorId)continue;
        const target=byFloor.get(destId);
        if(!target||target.hierarchy?.building.id!==zone.buildingId)continue;
        const isStair=verticalKind(zone)==="staircase";
        if(isStair&&Math.abs(floorIndex(origin.floorId)-floorIndex(destId))!==1){
          // A staircase must be drawn on every intermediate level; preserve
          // a clear reason rather than claiming its endpoint is not drawn.
          pending.push({zone,floorId:destId,reason:
            `${zone.name}: intermediate floor staircase locations are required between these levels.`});
          continue;
        }
        const sameRecord=zone.landings.find(l=>l.floorId===destId);
        let other:Staircase|undefined=zone;
        let destination=sameRecord;
        if(!destination){
          const allOnDestination=zones.filter(z=>z.id!==zone.id&&z.buildingId===zone.buildingId
            &&verticalKind(z)===verticalKind(zone)
            &&z.landings.some(l=>l.floorId===destId));
          // A reciprocal selection works even if the two independently drawn
          // zones have different names. If there is only one candidate of this
          // type on that floor, a one-sided destination selection is sufficient.
          const candidates=allOnDestination.filter(z=>
            (z.servedFloorIds??[]).includes(origin.floorId));
          if(candidates.length===0&&allOnDestination.length===1){
            const other=allOnDestination[0];
            const targets=other.servedFloorIds??[destId];
            // A counterpart with an explicitly different destination is not
            // silently repurposed just because it is the only zone on the floor.
            if(targets.length===1&&targets[0]===destId)candidates.push(other);
          }
          const named=candidates.filter(z=>z.name.trim().toLowerCase()===zone.name.trim().toLowerCase());
          const selected=named.length===1?named[0]:candidates.length===1?candidates[0]:undefined;
          if(selected){other=selected;destination=selected.landings.find(l=>l.floorId===destId);}
        }
        if(!destination||!other){
          pending.push({zone,floorId:destId,reason:
            "No uniquely matching vertical zone on this floor. Draw it here and select the original floor as its destination."});
          continue;
        }
        const key=[`${zone.id}:${origin.floorId}`,`${other.id}:${destId}`].sort().join("|");
        if(done.has(key))continue;
        done.add(key);
        // Store in ascending floor order so "up" means increasing level.
        const pair=[
          {zone,landing:origin,floor:originFloor},
          {zone:other,landing:destination,floor:target},
        ].sort((a,b)=>(a.floor.hierarchy?.floor.level??0)-(b.floor.hierarchy?.floor.level??0));
        links.push({first:pair[0],second:pair[1]});
      }
    }
  }
  return {links,pending};
}
