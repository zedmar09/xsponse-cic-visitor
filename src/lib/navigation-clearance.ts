import type { FloorArea, PixelPoint } from "@/lib/floor-plan";

/**
 * Conservative A* routing on a floor-plan polygon's navigable interior.
 * A doorway is allowed exactly on the polygon boundary; every other sampled
 * point must retain clearance from the polygon boundary AND room obstacles.
 * The uploaded plan's raster artwork cannot be interpreted as walls.
 */
const distance=(a:PixelPoint,b:PixelPoint)=>Math.hypot(a.x-b.x,a.y-b.y);
const project=(p:PixelPoint,a:PixelPoint,b:PixelPoint):PixelPoint=>{
  const dx=b.x-a.x,dy=b.y-a.y,len=dx*dx+dy*dy;
  const t=len?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/len)):0;
  return {x:a.x+dx*t,y:a.y+dy*t};
};
const boundaryDistance=(p:PixelPoint,poly:PixelPoint[])=>Math.min(...poly.map(
  (a,i)=>distance(p,project(p,a,poly[(i+1)%poly.length])),
));
const within=(p:PixelPoint,poly:PixelPoint[])=>{
  let inside=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
    const a=poly[i],b=poly[j];
    if((a.y>p.y)!==(b.y>p.y)&&
       p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)inside=!inside;
  }
  return inside;
};
const isOn=(p:PixelPoint,poly:PixelPoint[])=>boundaryDistance(p,poly)<0.8;
const inOrOn=(p:PixelPoint,poly:PixelPoint[])=>within(p,poly)||isOn(p,poly);
const nearEqual=(a:PixelPoint,b:PixelPoint)=>distance(a,b)<0.1;

export const DEFAULT_WALL_CLEARANCE_PX=7;
const roomObstacles=(area:FloorArea,rooms:FloorArea[])=>
  area.kind==="walkable"?rooms.filter(r=>r.id!==area.id):[];
function areaClearance(p:PixelPoint,area:FloorArea,rooms:FloorArea[]):number {
  if(!inOrOn(p,area.points))return -1;
  let clearance=boundaryDistance(p,area.points);
  for(const room of roomObstacles(area,rooms)){
    if(within(p,room.points)&&!isOn(p,room.points))return -1;
    clearance=Math.min(clearance,boundaryDistance(p,room.points));
  }
  return clearance;
}
export function segmentKeepsClearance(
  a:PixelPoint,b:PixelPoint,area:FloorArea,rooms:FloorArea[],
  clearance=DEFAULT_WALL_CLEARANCE_PX,
  endpointAnchors:PixelPoint[]=[],
):boolean {
  if(!inOrOn(a,area.points)||!inOrOn(b,area.points))return false;
  const length=distance(a,b);
  const count=Math.max(1,Math.ceil(length/1.5));
  // Only exact, reviewed doorway endpoints may be at the polygon boundary.
  const entry=endpointAnchors.some(p=>nearEqual(a,p));
  const exit=endpointAnchors.some(p=>nearEqual(b,p));
  for(let i=0;i<=count;i++){
    const t=i/count,p={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};
    const available=areaClearance(p,area,rooms);
    if(available<0)return false;
    const fromEntry=entry?length*t:Infinity;
    const fromExit=exit?length*(1-t):Infinity;
    // Clearance grows gradually only as we step away from the actual
    // doorway opening; a path elsewhere cannot hug the wall.
    const required=Math.min(clearance,fromEntry*.75,fromExit*.75);
    if(available+0.85<required)return false;
  }
  return true;
}
type QueueItem={id:number;priority:number};
class MinHeap {
  private data:QueueItem[]=[];
  push(item:QueueItem){
    const heap=this.data;heap.push(item);let index=heap.length-1;
    while(index>0){
      const parent=Math.floor((index-1)/2);
      if(heap[parent].priority<=item.priority)break;
      heap[index]=heap[parent];index=parent;
    }
    heap[index]=item;
  }
  pop():QueueItem|undefined{
    const heap=this.data,first=heap[0],last=heap.pop();
    if(!last||heap.length===0)return first;
    let index=0;
    while(index*2+1<heap.length){
      let child=index*2+1;
      if(child+1<heap.length&&heap[child+1].priority<heap[child].priority)child++;
      if(heap[child].priority>=last.priority)break;
      heap[index]=heap[child];index=child;
    }
    heap[index]=last;return first;
  }
  get size(){return this.data.length;}
}
/**
 * Return a wall-inset route between two mapped openings. Supports concave and
 * irregular polygons; will return null rather than use polygon edges as roads.
 * Endpoints stay fixed (typically the actual starting/ending door midpoint).
 */
export function clearanceAStar(
  start:PixelPoint,end:PixelPoint,area:FloorArea,rooms:FloorArea[]=[],
  clearance=DEFAULT_WALL_CLEARANCE_PX,
):PixelPoint[]|null {
  if(!area.points?.length||!inOrOn(start,area.points)||!inOrOn(end,area.points))return null;
  if(nearEqual(start,end))return [start];
  const xs=area.points.map(p=>p.x),ys=area.points.map(p=>p.y);
  const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  const width=maxX-minX,height=maxY-minY;
  if(width<=0||height<=0)return null;
  const step=Math.max(2,Math.min(6,Math.sqrt(width*height/16000)));
  const cols=Math.ceil(width/step),rows=Math.ceil(height/step);
  if(cols*rows>36000)return null;
  const total=cols*rows,allowed=new Uint8Array(total);
  const point=(index:number):PixelPoint=>({
    x:minX+(index%cols+.5)*step,
    y:minY+(Math.floor(index/cols)+.5)*step,
  });
  const eligible:number[]=[];
  for(let i=0;i<total;i++){
    const p=point(i),m=areaClearance(p,area,rooms);
    if(m>=clearance){
      allowed[i]=1;eligible.push(i);
    }
  }
  if(!eligible.length)return null;

  // Door anchors on the boundary are connected only by a verified short
  // segment into the inset mask. The connection may not skim along a wall.
  const maxConnector=Math.max(16,clearance*4,step*5);
  const candidates=(anchor:PixelPoint)=>eligible
    .map(id=>({id,d:distance(point(id),anchor)}))
    .filter(c=>c.d<=maxConnector)
    .sort((a,b)=>a.d-b.d)
    .slice(0,64)
    .filter(c=>segmentKeepsClearance(anchor,point(c.id),area,rooms,clearance,[anchor]))
    .slice(0,12);
  const entrances=candidates(start),exits=candidates(end);
  if(!entrances.length||!exits.length)return null;
  const exitsById=new Map(exits.map(c=>[c.id,c.d]));
  const costs=new Float64Array(total).fill(Infinity),previous=new Int32Array(total).fill(-1);
  const heap=new MinHeap();
  for(const c of entrances){
    costs[c.id]=c.d;
    heap.push({id:c.id,priority:c.d+distance(point(c.id),end)});
  }
  const dirs=[[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];
  let best=-1,bestCost=Infinity,expanded=0;
  while(heap.size && expanded<total*6){
    const item=heap.pop()!,id=item.id,location=point(id);
    const heuristic=distance(location,end);
    if(item.priority>costs[id]+heuristic+0.0001)continue;
    if(costs[id]+heuristic>=bestCost)continue;
    const finalLength=exitsById.get(id);
    if(finalLength!==undefined&&costs[id]+finalLength<bestCost){
      bestCost=costs[id]+finalLength;best=id;
    }
    expanded++;
    const x=id%cols,y=Math.floor(id/cols);
    for(const [dx,dy] of dirs){
      const nx=x+dx,ny=y+dy;
      if(nx<0||ny<0||nx>=cols||ny>=rows)continue;
      const to=ny*cols+nx;
      if(!allowed[to])continue;
      if(dx&&dy&&(!allowed[y*cols+nx]||!allowed[ny*cols+x]))continue;
      const next=point(to);
      if(!segmentKeepsClearance(location,next,area,rooms,clearance))continue;
      // Minimum geometric walking distance, subject to the wall-clearance
      // constraint. A room or corridor label is never an A* waypoint.
      const candidate=costs[id]+distance(location,next);
      if(candidate<costs[to]){
        costs[to]=candidate;previous[to]=id;
        heap.push({id:to,priority:candidate+distance(next,end)});
      }
    }
  }
  if(best<0)return null;
  const ids=[best];let cur=best;
  while(previous[cur]>=0){
    cur=previous[cur];ids.push(cur);
    if(ids.length>total)return null;
  }
  ids.reverse();
  const raw=[start,...ids.map(point),end];
  // Prune only line-of-sight segments with the same wall clearance.
  const result=[raw[0]];let i=0;
  while(i<raw.length-1){
    let next=i+1;
    for(let j=raw.length-1;j>i+1;j--){
      const anchorStart=i===0?[start]:[];
      const anchors=j===raw.length-1?[...anchorStart,end]:anchorStart;
      if(segmentKeepsClearance(raw[i],raw[j],area,rooms,clearance,anchors)){
        next=j;break;
      }
    }
    if(!segmentKeepsClearance(raw[i],raw[next],area,rooms,clearance,
      [raw[i]===start?start:({x:Infinity,y:Infinity}),...(next===raw.length-1?[end]:[])]))
      return null;
    result.push(raw[next]);i=next;
  }
  return result;
}
