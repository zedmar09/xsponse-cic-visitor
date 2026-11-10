import type { FloorPlanRecord } from "@/lib/floor-plan";
import { validateLocationCoordinates } from "@/lib/saved-outdoor-locations";

/** Geographic exterior footprint: longitude and latitude, never floor-image pixels. */
export type GeographicPoint={longitude:number;latitude:number};
export type OutdoorBuilding={
  id:string;
  locationId:string;
  name:string;
  latitude:number;
  longitude:number;
  footprint:GeographicPoint[];
  /** Identity of a pre-existing indoor building; never mutates indoor hierarchy. */
  indoorBuildingId:string|null;
  /** Exact saved FloorPlanRecord.id values, not floor labels/levels. */
  floorPlanIds:string[];
  createdAt:string;
  updatedAt:string;
};
export const buildingPointValid=(point:GeographicPoint)=>validateLocationCoordinates(
  point.latitude,point.longitude,
);
export function buildingValid(building:OutdoorBuilding):boolean{
  return typeof building.id==="string"&&building.id.length>0&&
    typeof building.locationId==="string"&&building.locationId.length>0&&
    typeof building.name==="string"&&building.name.trim().length>=2&&
    building.name.length<=90&&
    validateLocationCoordinates(building.latitude,building.longitude)&&
    Array.isArray(building.footprint)&&building.footprint.length<=80&&
    (building.footprint.length===0||building.footprint.length>=3)&&
    building.footprint.every(buildingPointValid)&&
    (building.indoorBuildingId===null||
      (typeof building.indoorBuildingId==="string"&&building.indoorBuildingId.length>0))&&
    Array.isArray(building.floorPlanIds)&&building.floorPlanIds.length<=200&&
    building.floorPlanIds.every(id=>typeof id==="string"&&id.length>0)&&
    new Set(building.floorPlanIds).size===building.floorPlanIds.length&&
    (building.floorPlanIds.length===0)===(building.indoorBuildingId===null)&&
    typeof building.createdAt==="string"&&typeof building.updatedAt==="string";
}
export function createBuilding(
  locationId:string,name:string,point:GeographicPoint,id:string,now:string,
):OutdoorBuilding{
  const building:OutdoorBuilding={
    id,locationId,name:name.trim().replace(/\s+/g," "),
    latitude:point.latitude,longitude:point.longitude,footprint:[],
    indoorBuildingId:null,floorPlanIds:[],createdAt:now,updatedAt:now,
  };
  if(!buildingValid(building))throw new Error("Choose a map point and name this building (2–90 characters).");
  return building;
}
export function setBuildingFootprint(
  building:OutdoorBuilding,footprint:GeographicPoint[],now:string,
):OutdoorBuilding{
  const next={...building,footprint,updatedAt:now};
  if(!buildingValid(next)||!polygonValid(footprint))throw new Error("Draw a valid outline with at least three distinct corners.");
  return next;
}
export function polygonValid(points:GeographicPoint[]):boolean{
  if(points.length===0)return true;
  if(points.length<3||points.length>80||!points.every(buildingPointValid))return false;
  const unique=new Set(points.map(p=>`${p.longitude.toFixed(8)}:${p.latitude.toFixed(8)}`));
  if(unique.size<3)return false;
  // Reject zero-area polygons (shoelace in degree space).
  const origin=points[0],vertices=points.map(p=>({
    x:p.longitude-origin.longitude,y:p.latitude-origin.latitude,
  }));
  const twiceArea=vertices.reduce((sum,p,i)=>{
    const q=vertices[(i+1)%vertices.length];
    return sum+p.x*q.y-q.x*p.y;
  },0);
  if(Math.abs(twiceArea)<1e-14)return false;
  const orient=(a:GeographicPoint,b:GeographicPoint,c:GeographicPoint)=>
    (b.longitude-a.longitude)*(c.latitude-a.latitude)-
    (b.latitude-a.latitude)*(c.longitude-a.longitude);
  const crosses=(a:GeographicPoint,b:GeographicPoint,c:GeographicPoint,d:GeographicPoint)=>{
    const ab1=orient(a,b,c),ab2=orient(a,b,d);
    const cd1=orient(c,d,a),cd2=orient(c,d,b);
    return ((ab1>0&&ab2<0)||(ab1<0&&ab2>0))&&
      ((cd1>0&&cd2<0)||(cd1<0&&cd2>0));
  };
  for(let i=0;i<points.length;i++)
    for(let j=i+1;j<points.length;j++){
      if(j===i+1||(i===0&&j===points.length-1))continue;
      if(crosses(points[i],points[(i+1)%points.length],
        points[j],points[(j+1)%points.length]))return false;
    }
  return true;
}

/** Refuse to split/link unrelated existing indoor building groups.
 * A floor is exclusively associated with one outdoor building at a time.
 */
export function assignFloors(
  building:OutdoorBuilding,
  selectedFloorRecordIds:string[],
  floors:FloorPlanRecord[],
  otherBuildings:OutdoorBuilding[],
  now:string,
):OutdoorBuilding{
  const ids=[...new Set(selectedFloorRecordIds)];
  const matched=ids.map(id=>floors.find(f=>f.id===id));
  if(matched.some(f=>!f))throw new Error("A selected indoor floor is no longer saved in this browser.");
  const groups=new Set(matched.map(f=>f!.hierarchy?.building.id));
  if(groups.has(undefined)||groups.size>1)
    throw new Error("Select floors from one existing indoor building. Create another outdoor building for other indoor maps.");
  if(otherBuildings.some(b=>b.id!==building.id&&
    (ids.some(id=>b.floorPlanIds.includes(id))||
      (groups.size>0&&b.indoorBuildingId===Array.from(groups)[0]))))
    throw new Error("These indoor floors are already associated with another outdoor building.");
  const updated={...building,
    floorPlanIds:ids,indoorBuildingId:groups.size?Array.from(groups)[0]!:null,
    updatedAt:now,
  };
  if(!buildingValid(updated))throw new Error("Invalid building floor associations.");
  return updated;
}
