import type { PixelPoint, FloorArea, FloorPortal } from "@/lib/floor-plan";
import type { LocationDevice } from "@/lib/location-devices";

/** All measurements use original floor-plan image pixels. They follow the floor's
 * geographic transform on the outdoor map; they are not fabricated metres.
 */
export type CameraCoverage = {
  shape: "circle" | "cone";
  radiusPx: number;
  /** Cone reach/length ("wide") measured from the device to its far edge. */
  widePx: number;
  /** Full width of the cone at its far edge. */
  widthPx: number;
  rotationDegrees: number;
};
export const DEFAULT_CAMERA_COVERAGE: CameraCoverage = {
  shape: "cone",radiusPx:100,widePx:130,widthPx:110,rotationDegrees:0,
};
export type DeviceSpatialMatch={
  id:string; name:string; category:"room"|"walkable"|"doorway"|"staircase"|"elevator";
};
export type DeviceLanding={id:string;name:string;kind:"staircase"|"elevator";outline:PixelPoint[]};

const inRange=(value:number,min:number,max:number)=>Number.isFinite(value)&&value>=min&&value<=max;
export function validDeviceSize(value:number):boolean{return inRange(value,16,160);}
export function validCameraCoverage(value:CameraCoverage):boolean {
  return (value.shape==="circle"||value.shape==="cone")&&
    inRange(value.radiusPx,5,3000)&&inRange(value.widePx,5,3000)&&
    inRange(value.widthPx,5,3000)&&inRange(value.rotationDegrees,-360,360);
}
export function supportsCamera(type:LocationDevice["type"]):boolean{return type!=="p-button";}

/** Ray casting with a boundary check, to prevent edge drops being unclassified. */
export function pointWithinPolygon(p:PixelPoint,points:PixelPoint[]):boolean{
  if(points.length<3)return false;
  let inside=false;
  for(let i=0,j=points.length-1;i<points.length;j=i++){
    const a=points[i],b=points[j];
    const dx=b.x-a.x,dy=b.y-a.y;
    const cross=(p.x-a.x)*dy-(p.y-a.y)*dx;
    const projection=(p.x-a.x)*dx+(p.y-a.y)*dy;
    if(dx*dx+dy*dy>.000001&&Math.abs(cross)<.001&&projection>=0&&projection<=dx*dx+dy*dy)return true;
    if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)inside=!inside;
  }
  return inside;
}
function doorPolygon(door:FloorPortal):PixelPoint[]{
  const dx=door.end.x-door.start.x,dy=door.end.y-door.start.y;
  const length=Math.hypot(dx,dy);
  if(length<1)return [];
  const half=Math.max(4,Math.min(80,door.displayDepthPx??14))/2;
  const nx=-dy/length*half,ny=dx/length*half;
  return [
    {x:door.start.x+nx,y:door.start.y+ny},
    {x:door.end.x+nx,y:door.end.y+ny},
    {x:door.end.x-nx,y:door.end.y-ny},
    {x:door.start.x-nx,y:door.start.y-ny},
  ];
}
/** Detect all intersecting mapped features. Do not guess room ownership by proximity. */
export function identifyDeviceSpaces(
  point:PixelPoint,
  areas:ReadonlyArray<FloorArea>,
  portals:ReadonlyArray<FloorPortal>,
  landings:ReadonlyArray<DeviceLanding>=[],
):DeviceSpatialMatch[]{
  const matches:DeviceSpatialMatch[]=[];
  for(const landing of landings){
    if(pointWithinPolygon(point,landing.outline))
      matches.push({id:landing.id,name:landing.name,category:landing.kind});
  }
  for(const door of portals){
    if(pointWithinPolygon(point,doorPolygon(door)))
      matches.push({id:door.id,name:door.name,category:"doorway"});
  }
  for(const area of areas){
    if(pointWithinPolygon(point,area.points))
      matches.push({id:area.id,name:area.name,category:area.kind});
  }
  return matches;
}
/** Apply an in-progress marker drag to coverage/selection rendering only.
 * The saved inventory remains untouched until drop/dragend confirms placement.
 */
export function previewDevicePosition(
  devices:ReadonlyArray<LocationDevice>,deviceId:string,point:PixelPoint,
):LocationDevice[]{
  return devices.map(device=>device.uuid===deviceId
    ? {...device,point:{...point}}:device);
}
/** Circle approximation / oriented triangular cone for indoor and outdoor overlays. */
export function cameraCoveragePolygon(point:PixelPoint,coverage:CameraCoverage):PixelPoint[]{
  if(!validCameraCoverage(coverage))return [];
  if(coverage.shape==="circle"){
    return Array.from({length:48},(_,i)=>{
      const angle=2*Math.PI*i/48;
      return {x:point.x+Math.cos(angle)*coverage.radiusPx,
        y:point.y+Math.sin(angle)*coverage.radiusPx};
    });
  }
  const angle=coverage.rotationDegrees*Math.PI/180;
  const forward={x:Math.sin(angle),y:-Math.cos(angle)};
  const right={x:Math.cos(angle),y:Math.sin(angle)};
  const far={
    x:point.x+forward.x*coverage.widePx,
    y:point.y+forward.y*coverage.widePx,
  };
  return [point,
    {x:far.x-right.x*coverage.widthPx/2,y:far.y-right.y*coverage.widthPx/2},
    {x:far.x+right.x*coverage.widthPx/2,y:far.y+right.y*coverage.widthPx/2},
  ];
}
