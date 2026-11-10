import {
  validSavedLocation, type SavedOutdoorLocation,
} from "@/lib/saved-outdoor-locations";
import { buildingValid, type OutdoorBuilding } from "@/lib/outdoor-buildings";

/** A separate IndexedDB database keeps existing floor images and annotations
 * fully isolated from outdoor location CRUD and future migration work.
 */
const DB_NAME="maplibre-lab-outdoor-locations";
const STORE="locations";
const BUILDING_STORE="outdoor-buildings";
const VERSION=2;

async function openDatabase():Promise<IDBDatabase>{
  if(typeof indexedDB==="undefined")throw new Error("This browser cannot save locations offline.");
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB_NAME,VERSION);
    request.onupgradeneeded=()=>{
      const db=request.result;
      if(!db.objectStoreNames.contains(STORE))
        db.createObjectStore(STORE,{keyPath:"id"});
      // Additive only: do not alter existing Phase 1 records.
      if(!db.objectStoreNames.contains(BUILDING_STORE))
        db.createObjectStore(BUILDING_STORE,{keyPath:"id"});
    };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error??new Error("Could not open location storage."));
    request.onblocked=()=>reject(new Error("Close other tabs using the location editor and try again."));
  });
}
async function transact<T>(
  mode:IDBTransactionMode,perform:(store:IDBObjectStore)=>IDBRequest<T>,
):Promise<T>{
  const db=await openDatabase();
  try{
    return await new Promise<T>((resolve,reject)=>{
      const tx=db.transaction(STORE,mode);
      let value:T;
      let request:IDBRequest<T>;
      try{request=perform(tx.objectStore(STORE));}
      catch(error){reject(error);return;}
      request.onsuccess=()=>{value=request.result;};
      tx.oncomplete=()=>resolve(value);
      tx.onerror=()=>reject(tx.error??new Error("Location storage failed."));
      tx.onabort=()=>reject(tx.error??new Error("Location storage was cancelled."));
    });
  }finally{db.close();}
}
export async function listOutdoorLocations():Promise<SavedOutdoorLocation[]>{
  const values=await transact<SavedOutdoorLocation[]>("readonly",store=>store.getAll());
  return values.filter(validSavedLocation)
    .sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
}
export async function addOutdoorLocation(place:SavedOutdoorLocation):Promise<void>{
  if(!validSavedLocation(place))throw new Error("The location name or coordinates are invalid.");
  // add(), never put(): a duplicate ID must not replace an earlier location.
  await transact<IDBValidKey>("readwrite",store=>store.add(place));
}
export async function updateOutdoorLocation(place:SavedOutdoorLocation):Promise<void>{
  if(!validSavedLocation(place))throw new Error("The location name or coordinates are invalid.");
  const exists=await transact<SavedOutdoorLocation|undefined>("readonly",
    store=>store.get(place.id));
  if(!exists)throw new Error("This location no longer exists.");
  await transact<IDBValidKey>("readwrite",store=>store.put(place));
}
export async function deleteOutdoorLocation(id:string):Promise<void>{
  if(!id.trim())throw new Error("Choose a saved location to remove.");
  // The parent and its exterior buildings must be deleted atomically; indoor
  // floor plans live in another database and are NEVER deleted here.
  const db=await openDatabase();
  try{
    await new Promise<void>((resolve,reject)=>{
      const tx=db.transaction([STORE,BUILDING_STORE],"readwrite");
      const loc=tx.objectStore(STORE),buildings=tx.objectStore(BUILDING_STORE);
      const request=buildings.getAll();
      request.onsuccess=()=>{
        for(const b of request.result as OutdoorBuilding[])
          if(b.locationId===id)buildings.delete(b.id);
        loc.delete(id);
      };
      tx.oncomplete=()=>resolve();
      tx.onerror=()=>reject(tx.error??new Error("Unable to delete this location."));
      tx.onabort=()=>reject(tx.error??new Error("Location deletion was cancelled."));
    });
  }finally{db.close();}
}

/** All building records stay in the outdoor database; indoor IDs are links only. */
export async function listOutdoorBuildings():Promise<OutdoorBuilding[]>{
  const values=await requestBuildings<OutdoorBuilding[]>("readonly",store=>store.getAll());
  return values.filter(buildingValid)
    .sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
}
async function requestBuildings<T>(
  mode:IDBTransactionMode,perform:(store:IDBObjectStore)=>IDBRequest<T>,
):Promise<T>{
  const db=await openDatabase();
  try{
    return await new Promise<T>((resolve,reject)=>{
      const tx=db.transaction(BUILDING_STORE,mode);
      let result:T;
      let req:IDBRequest<T>;
      try{req=perform(tx.objectStore(BUILDING_STORE));}
      catch(error){reject(error);return;}
      req.onsuccess=()=>{result=req.result;};
      tx.oncomplete=()=>resolve(result);
      tx.onerror=()=>reject(tx.error??new Error("Building storage failed."));
      tx.onabort=()=>reject(tx.error??new Error("Building change was cancelled."));
    });
  }finally{db.close();}
}
async function saveBuilding(building:OutdoorBuilding,operation:"add"|"update"):Promise<void>{
  if(!buildingValid(building))throw new Error("Invalid building location or floor associations.");
  const db=await openDatabase();
  try{
    await new Promise<void>((resolve,reject)=>{
      const tx=db.transaction([STORE,BUILDING_STORE],"readwrite");
      const locations=tx.objectStore(STORE),buildings=tx.objectStore(BUILDING_STORE);
      let failure:Error|null=null;
      const failed=(message:string)=>{
        failure=new Error(message);tx.abort();
      };
      const parentRequest=locations.get(building.locationId);
      parentRequest.onsuccess=()=>{
        if(!parentRequest.result){failed("The parent location no longer exists.");return;}
        const current=buildings.get(building.id);
        current.onsuccess=()=>{
          if(operation==="add"&&current.result){
            failed("This building already exists.");return;
          }
          if(operation==="update"&&!current.result){
            failed("This building no longer exists.");return;
          }
          if(operation==="update"&&(current.result as OutdoorBuilding).locationId!==building.locationId){
            failed("Moving a building between locations is not supported.");return;
          }
          const all=buildings.getAll();
          all.onsuccess=()=>{
            const conflict=(all.result as OutdoorBuilding[]).some(other=>
              other.id!==building.id&&(
                (building.indoorBuildingId!==null&&other.indoorBuildingId===building.indoorBuildingId)||
                building.floorPlanIds.some(id=>other.floorPlanIds.includes(id))
              ));
            if(conflict){
              failed("These indoor floors are already attached to another outdoor building.");return;
            }
            if(operation==="add")buildings.add(building);
            else buildings.put(building);
          };
        };
      };
      tx.oncomplete=()=>resolve();
      tx.onerror=()=>reject(failure??tx.error??new Error("Could not save building."));
      tx.onabort=()=>reject(failure??tx.error??new Error("Building save was cancelled."));
    });
  }finally{db.close();}
}
export async function addOutdoorBuilding(building:OutdoorBuilding):Promise<void>{
  await saveBuilding(building,"add");
}
export async function updateOutdoorBuilding(building:OutdoorBuilding):Promise<void>{
  await saveBuilding(building,"update");
}
export async function deleteOutdoorBuilding(id:string):Promise<void>{
  if(!id.trim())throw new Error("Choose a building to remove.");
  await requestBuildings<undefined>("readwrite",store=>store.delete(id));
}
