/** Project saved indoor pixel geometry onto a floor's independent outdoor placement.
 * Display-only GeoJSON: the saved indoor coordinates are never mutated.
 * Both indoor vectors and the MapLibre image source use the same four corners.
 */
import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { FloorArea, FloorMarker, FloorPortal, PixelPoint } from "@/lib/floor-plan";
import { floorImageCorners, type OutdoorFloorPlacement } from "@/lib/outdoor-floor-placement";
import type { LocationDevice } from "@/lib/location-devices";
import { cameraCoveragePolygon } from "@/lib/device-spatial";

export type OutdoorFloorLanding={
  id:string; name:string; kind:"staircase"|"elevator"; outline:PixelPoint[];
};
export type IndoorGeometryPreview={
  floorId:string; name:string;
  imageWidth:number; imageHeight:number;
  placement:OutdoorFloorPlacement;
  areas:FloorArea[]; portals:FloorPortal[]; markers:FloorMarker[];
  landings:OutdoorFloorLanding[];
  devices?:LocationDevice[];
};
/** Four-corner mapping interpolated in Web Mercator, MapLibre's outdoor plane.
 * Aligns all four corners with the image overlay, including resized/skewed floors.
 * MapLibre's raster image source triangulates its corner quad; interiors of
 * extremely distorted quadrilaterals can differ slightly from bilinear vectors.
 */
/** Cache the shared four corners and Web Mercator projection for the
 * entire frame. Recomputing image corners for every room vertex during a live
 * drag is needlessly expensive on complex indoor maps.
 */
function projectedPointFromCorners(corners:ReturnType<typeof floorImageCorners>,
  width:number,height:number) {
  const mercatorY=(lat:number)=>Math.log(Math.tan(Math.PI/4+lat*Math.PI/360));
  const ys=corners.map(c=>mercatorY(c[1]));
  return (point:PixelPoint):[number,number]=>{
    const u=point.x/width,v=point.y/height;
    const w0=(1-u)*(1-v),w1=u*(1-v),w2=u*v,w3=(1-u)*v;
    const lng=corners[0][0]*w0+corners[1][0]*w1+corners[2][0]*w2+corners[3][0]*w3;
    const y=ys[0]*w0+ys[1]*w1+ys[2]*w2+ys[3]*w3;
    return [lng,(2*Math.atan(Math.exp(y))-Math.PI/2)*180/Math.PI];
  };
}
export function indoorPointToLngLat(
  point:PixelPoint,placement:OutdoorFloorPlacement,width:number,height:number,
):[number,number] {
  return projectedPointFromCorners(floorImageCorners(placement,width,height),width,height)(point);
}
export function doorwayOverlayCorners(start:PixelPoint,end:PixelPoint,depth=14):PixelPoint[]{
  const dx=end.x-start.x,dy=end.y-start.y,len=Math.hypot(dx,dy);
  if(len<1||!Number.isFinite(depth))return [];
  const half=Math.max(4,Math.min(80,depth))/2;
  const nx=-dy/len*half,ny=dx/len*half;
  return [
    {x:start.x+nx,y:start.y+ny},{x:end.x+nx,y:end.y+ny},
    {x:end.x-nx,y:end.y-ny},{x:start.x-nx,y:start.y-ny},
  ];
}

type FeatureProperties={floorId:string;category:string;id:string;name:string;kind?:string;usage?:string};
export type OutdoorIndoorCollection=FeatureCollection<Geometry,FeatureProperties>;
export function outdoorIndoorFeatures(floor:IndoorGeometryPreview):OutdoorIndoorCollection {
  const features:Feature<Geometry,FeatureProperties>[]=[];
  const project=projectedPointFromCorners(
    floorImageCorners(floor.placement,floor.imageWidth,floor.imageHeight),
    floor.imageWidth,floor.imageHeight,
  );
  const polygon=(points:PixelPoint[],properties:FeatureProperties)=>{
    if(points.length<3)return;
    features.push({type:"Feature",properties,geometry:{
      type:"Polygon",coordinates:[[...points,points[0]].map(project)],
    }});
  };
  const point=(p:PixelPoint,properties:FeatureProperties)=>{
    features.push({type:"Feature",properties,geometry:{type:"Point",coordinates:project(p)}});
  };
  const labelPoint=(points:PixelPoint[]):PixelPoint=>{
    // Largest available inscribed area label is not required for geometry;
    // centroid of vertices is stable and independent of geographic transform.
    const n=points.length||1;
    return {x:points.reduce((a,p)=>a+p.x,0)/n,y:points.reduce((a,p)=>a+p.y,0)/n};
  };
  for(const device of floor.devices??[]){
    if(!device.point||!device.camera)continue;
    const coverage=cameraCoveragePolygon(device.point,device.camera);
    polygon(coverage,{floorId:floor.floorId,category:"camera-fov",
      id:device.uuid,name:device.name,kind:device.camera.shape});
  }
  for(const area of floor.areas){
    if(area.points.length<3)continue;
    const props={floorId:floor.floorId,category:area.kind,id:area.id,name:area.name};
    polygon(area.points,props);
    if(area.name.trim())point(labelPoint(area.points),{...props,category:"area-label"});
  }
  for(const door of floor.portals){
    const props={floorId:floor.floorId,category:"doorway",id:door.id,name:door.name,usage:door.usage};
    polygon(doorwayOverlayCorners(door.start,door.end,door.displayDepthPx??14),props);
    point({x:(door.start.x+door.end.x)/2,y:(door.start.y+door.end.y)/2},
      {...props,category:"doorway-label"});
  }
  for(const landing of floor.landings){
    const props={floorId:floor.floorId,category:landing.kind,id:landing.id,
      name:landing.name,kind:landing.kind};
    polygon(landing.outline,props);
    if(landing.outline.length>=3)
      point(labelPoint(landing.outline),{...props,category:"vertical-label"});
  }
  for(const marker of floor.markers){
    point(marker.point,{floorId:floor.floorId,category:marker.kind,
      id:marker.id,name:marker.name,kind:marker.kind});
  }
  return {type:"FeatureCollection",features};
}

/** Only actual mapped indoor polygons (not text labels or unrelated basemap
 * features) can open the outdoor inspection card. Coordinates are the user's
 * precise clicked point in WGS84, not the polygon centroid.
 */
export type OutdoorIndoorInspection={
  floorId:string;
  featureId:string;
  category:"room"|"walkable"|"doorway"|"staircase"|"elevator";
  name:string;
  longitude:number;
  latitude:number;
};
const inspectableCategories=["room","walkable","doorway","staircase","elevator"] as const;
export function inspectOutdoorIndoorFeature(
  features:ReadonlyArray<{properties?:unknown}>,
  visibleFloorIds:ReadonlyArray<string>,
  longitude:number,latitude:number,
):OutdoorIndoorInspection|null {
  if(!Number.isFinite(longitude)||!Number.isFinite(latitude)||
    longitude < -180||longitude > 180||latitude < -90||latitude > 90)return null;
  for(const feature of features){
    const props=feature.properties;
    if(!props||typeof props!=="object"||Array.isArray(props))continue;
    const data=props as Record<string,unknown>;
    if(typeof data.floorId!=="string"||!visibleFloorIds.includes(data.floorId)||
      typeof data.category!=="string"||
      !inspectableCategories.some(category=>category===data.category))continue;
    const category=data.category as OutdoorIndoorInspection["category"];
    const defaultNames:Record<OutdoorIndoorInspection["category"],string>={
      room:"Room",walkable:"Walkable area",doorway:"Doorway",
      staircase:"Staircase",elevator:"Elevator",
    };
    return {
      floorId:data.floorId,
      featureId:typeof data.id==="string"?data.id:"",
      category,
      name:typeof data.name==="string"&&data.name.trim()?
        data.name.trim():defaultNames[category],
      longitude,latitude,
    };
  }
  return null;
}
