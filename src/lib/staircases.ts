import { polygonError, type FloorPlanRecord, type PixelPoint } from "@/lib/floor-plan";

/** A staircase is a single building-level identity with independent outlines and
 * optional access points on each floor. A one-floor record is a valid draft.
 */
export type StairDirection = "both" | "up" | "down";
export type StairLanding = {
  floorId:string; // immutable hierarchy.floor.id; never array index or floor name
  outline:PixelPoint[];
  entryPoint:PixelPoint|null;
  walkableAreaId:string|null;
};
export type Staircase = {
  id:string;
  buildingId:string;
  name:string;
  direction:StairDirection;
  /** Existing records without kind are staircases. */
  kind?:"staircase"|"elevator";
  landings:StairLanding[];
  /** Floors selected by admin to be served; a selected floor may not have a landing yet. */
  servedFloorIds?:string[];
  createdAt:string;
  updatedAt:string;
};
export function staircaseError(stair:Staircase,buildingFloors:FloorPlanRecord[]):string|null {
  if(!stair.id||!stair.buildingId||!stair.name.trim())return "Name this staircase.";
  if(!["both","up","down"].includes(stair.direction))return "Choose a valid stair direction.";
  if(stair.kind&&stair.kind!=="staircase"&&stair.kind!=="elevator")return "Choose stairs or elevator.";
  if(stair.landings.length===0)return "Draw the staircase on at least one floor.";
  if(stair.servedFloorIds){
    const served=new Set(stair.servedFloorIds);
    if(served.size!==stair.servedFloorIds.length)
      return "A staircase destination is listed more than once.";
    if(stair.servedFloorIds.some(id=>!buildingFloors.some(f=>
      f.hierarchy?.floor.id===id&&f.hierarchy.building.id===stair.buildingId)))
      return "A selected destination floor does not exist in this building.";
    if(stair.landings.some(landing=>!served.has(landing.floorId)))
      return "Every mapped staircase landing must be included in the floors served.";
  }
  const seen=new Set<string>();
  for(const landing of stair.landings) {
    if(seen.has(landing.floorId))return "This staircase has more than one landing on the same floor.";
    seen.add(landing.floorId);
    const floor=buildingFloors.find(f=>f.hierarchy?.floor.id===landing.floorId&&
      f.hierarchy.building.id===stair.buildingId);
    if(!floor)return "The staircase references an unknown floor in this building.";
    const error=polygonError(landing.outline);
    if(error)return `Invalid staircase outline on ${floor.hierarchy?.floor.name??"floor"}: ${error}`;
    if(landing.outline.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)||
       p.x<0||p.y<0||p.x>floor.width||p.y>floor.height))
      return "A staircase outline extends outside its floor plan.";
    // Legacy entryPoint/walkableAreaId fields are preserved for older plans,
    // but intentionally ignored. A vertical zone needs only its drawn outline.
  }
  return null;
}
/** Mapped landings are not proof of a verified, traversable stair route. */
export function stairConnectionLabel(stair:Staircase):string {
  const mapped=new Set(stair.landings.map(l=>l.floorId));
  const pending=(stair.servedFloorIds??[]).filter(id=>!mapped.has(id));
  if(stair.landings.length===1&&pending.length===0)return "Saved · choose other floors later";
  if(pending.length>0)return `${pending.length} floor${pending.length===1?"":"s"} selected · outline needed on destination`;
  return `${stair.landings.length} floor locations mapped`;
}
export function landingOnFloor(stair:Staircase,floorId:string):StairLanding|null {
  return stair.landings.find(landing=>landing.floorId===floorId)??null;
}
