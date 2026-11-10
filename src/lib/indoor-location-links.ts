import type { FloorPlanRecord } from "@/lib/floor-plan";

/** A location owns many indoor maps/floors. There is no outdoor building layer.
 * Internal legacy building IDs are retained solely for stairs/elevators and
 * cross-floor navigation compatibility, not used as geographic parents.
 */
export function locationFloors(floors:FloorPlanRecord[],locationId:string|null):FloorPlanRecord[]{
  return locationId?floors.filter(f=>f.locationId===locationId):[];
}

export function unassignedLocationFloors(floors:FloorPlanRecord[],validLocationIds:string[]):FloorPlanRecord[]{
  const valid=new Set(validLocationIds);
  return floors.filter(f=>!f.locationId||!valid.has(f.locationId));
}

export function assignFloorLocation(
  floor:FloorPlanRecord,locationId:string,
  allFloors:FloorPlanRecord[],validLocationIds:string[],now:string,
):FloorPlanRecord{
  if(!validLocationIds.includes(locationId))
    throw new Error("Select a saved outdoor location first.");
  if(floor.locationId&&floor.locationId!==locationId&&validLocationIds.includes(floor.locationId))
    throw new Error("Unassign this floor from its previous location first.");
  // An existing multistorey stair/elevator group may not be split between two
  // geographical locations; its saved navigation graph must remain coherent.
  if(allFloors.some(f=>f.id!==floor.id&&
    f.hierarchy?.building.id===floor.hierarchy?.building.id&&
    f.locationId&&f.locationId!==locationId&&validLocationIds.includes(f.locationId)))
    throw new Error("Related indoor floors are assigned elsewhere. Keep their navigation group in one location.");
  // Orphaned old links may be recovered at another location, but their
  // geographic alignment must be reset rather than silently reused there.
  return {...floor,locationId,
    outdoorPlacement:floor.locationId===locationId?floor.outdoorPlacement:null,
    updatedAt:now};
}

export function unassignFloorLocation(floor:FloorPlanRecord,locationId:string,now:string):FloorPlanRecord{
  if(floor.locationId!==locationId)
    throw new Error("This indoor floor does not belong to the selected location.");
  return {...floor,locationId:null,outdoorPlacement:null,updatedAt:now};
}
