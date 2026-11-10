import { ensureSpatialFoundation, spatialFoundationError, type FloorPlanRecord } from "@/lib/floor-plan";
import { staircaseError, type Staircase } from "@/lib/staircases";

const DB_NAME = "maplibre-lab-indoor";
const STORE_NAME = "floor-plans"; // existing v1 store is preserved unchanged
const SETTINGS_STORE = "floor-plan-settings";
const STAIRCASE_STORE = "building-staircases";
const DB_VERSION = 3;
const CURRENT_KEY = "current-floor";

type SelectedFloor = { id: typeof CURRENT_KEY; floorId: string };

async function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve,reject)=>{
    if(typeof indexedDB==="undefined") {
      reject(new Error("This browser does not support IndexedDB storage."));return;
    }
    const request=indexedDB.open(DB_NAME,DB_VERSION);
    request.onupgradeneeded=()=>{
      const db=request.result;
      // Do not delete, overwrite or move the original "active" plan.
      if(!db.objectStoreNames.contains(STORE_NAME))
        db.createObjectStore(STORE_NAME,{keyPath:"id"});
      if(!db.objectStoreNames.contains(SETTINGS_STORE))
        db.createObjectStore(SETTINGS_STORE,{keyPath:"id"});
      // Additive v3 upgrade: preserves both legacy and multi-floor plan records.
      if(!db.objectStoreNames.contains(STAIRCASE_STORE))
        db.createObjectStore(STAIRCASE_STORE,{keyPath:"id"});
    };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error??new Error("Unable to open floor-plan storage."));
    request.onblocked=()=>reject(new Error("Close other tabs using the map editor and try again."));
  });
}
async function requestFromStore<T>(
  storeName:string,mode:IDBTransactionMode,makeRequest:(store:IDBObjectStore)=>IDBRequest<T>,
):Promise<T> {
  const db=await openDatabase();
  try {
    return await new Promise<T>((resolve,reject)=>{
      const tx=db.transaction(storeName,mode);
      let output:T;
      let request:IDBRequest<T>;
      try{request=makeRequest(tx.objectStore(storeName));}
      catch(error){reject(error);return;}
      request.onsuccess=()=>{output=request.result;};
      tx.oncomplete=()=>resolve(output);
      tx.onabort=()=>reject(tx.error??new Error("Floor-plan transaction was aborted."));
      tx.onerror=()=>reject(tx.error??new Error("Floor-plan storage transaction failed."));
    });
  }finally {db.close();}
}

export async function listFloorPlans():Promise<FloorPlanRecord[]> {
  const records=await requestFromStore<FloorPlanRecord[]>(STORE_NAME,"readonly",store=>store.getAll());
  return records.map(ensureSpatialFoundation).sort((a,b)=>{
    const aLevel=a.hierarchy?.floor.level,bLevel=b.hierarchy?.floor.level;
    if(aLevel!==null && aLevel!==undefined && bLevel!==null && bLevel!==undefined)
      return aLevel-bLevel || a.createdAt.localeCompare(b.createdAt);
    if(aLevel!==null && aLevel!==undefined)return -1;
    if(bLevel!==null && bLevel!==undefined)return 1;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

async function selectedFloorId():Promise<string|null> {
  const selection=await requestFromStore<SelectedFloor|undefined>(
    SETTINGS_STORE,"readonly",store=>store.get(CURRENT_KEY));
  return selection?.floorId??null;
}

/** With no argument, reopen the previously selected floor on refresh.
 * Version-1 records keyed "active" are still available unchanged.
 */
export async function loadFloorPlan(id?:string):Promise<FloorPlanRecord|null> {
  if(id){
    const result=await requestFromStore<FloorPlanRecord|undefined>(
      STORE_NAME,"readonly",store=>store.get(id));
    return result?ensureSpatialFoundation(result):null;
  }
  const selected=await selectedFloorId();
  if(selected){
    const record=await loadFloorPlan(selected);
    if(record)return record;
  }
  const legacy=await loadFloorPlan("active");
  if(legacy)return legacy;
  return (await listFloorPlans())[0]??null;
}

export async function selectFloorPlan(id:string):Promise<void> {
  const record=await loadFloorPlan(id);
  if(!record)throw new Error("This floor no longer exists.");
  await requestFromStore<IDBValidKey>(SETTINGS_STORE,"readwrite",
    store=>store.put({id:CURRENT_KEY,floorId:id}));
}

export async function saveFloorPlan(record:FloorPlanRecord):Promise<void> {
  const updated=ensureSpatialFoundation(record);
  const error=spatialFoundationError(updated);
  if(error)throw new Error(error);
  await requestFromStore<IDBValidKey>(STORE_NAME,"readwrite",store=>store.put(updated));
}

/** New floor creation must never overwrite an existing floor, including the legacy record. */
export async function addFloorPlan(record:FloorPlanRecord):Promise<void> {
  const updated=ensureSpatialFoundation(record);
  const error=spatialFoundationError(updated);
  if(error)throw new Error(error);
  await requestFromStore<IDBValidKey>(STORE_NAME,"readwrite",store=>store.add(updated));
}

/** Site and building names are shared across floors with the same parent IDs;
 * update them together while preserving all other floor data and original image blobs.
 */
export async function saveBuildingHierarchy(record:FloorPlanRecord):Promise<void> {
  const normalized=ensureSpatialFoundation(record);
  const error=spatialFoundationError(normalized);
  if(error)throw new Error(error);
  const h=normalized.hierarchy!;
  const db=await openDatabase();
  try {
    await new Promise<void>((resolve,reject)=>{
      const tx=db.transaction(STORE_NAME,"readwrite");
      const store=tx.objectStore(STORE_NAME);
      const cursorRequest=store.openCursor();
      cursorRequest.onsuccess=()=>{
        const cursor=cursorRequest.result;
        if(!cursor)return;
        const other=ensureSpatialFoundation(cursor.value as FloorPlanRecord);
        const current=other.id===normalized.id;
        const sameBuilding=other.hierarchy?.building.id===h.building.id &&
          other.hierarchy.site.id===h.site.id;
        if(current||sameBuilding) {
          const recordToSave=current?normalized:{
            ...other,hierarchy:{
              ...other.hierarchy!,
              site:{...other.hierarchy!.site,name:h.site.name},
              building:{...other.hierarchy!.building,name:h.building.name},
            },
            updatedAt:new Date().toISOString(),
          };
          cursor.update(recordToSave);
        }
        cursor.continue();
      };
      tx.oncomplete=()=>resolve();
      tx.onerror=()=>reject(tx.error??new Error("Unable to save building details."));
      tx.onabort=()=>reject(tx.error??new Error("Building update was cancelled."));
    });
  }finally{db.close();}
}

/** Building-level records survive refresh and can contain only one floor.
 * Validate every linked landing against existing floors before saving.
 */
export async function listStaircases(buildingId:string):Promise<Staircase[]> {
  if(!buildingId)return [];
  const all=await requestFromStore<Staircase[]>(STAIRCASE_STORE,"readonly",store=>store.getAll());
  return all.filter(s=>s.buildingId===buildingId)
    .sort((a,b)=>a.name.localeCompare(b.name));
}
export async function saveStaircase(stair:Staircase):Promise<void> {
  const floors=(await listFloorPlans()).filter(f=>f.hierarchy?.building.id===stair.buildingId);
  const error=staircaseError(stair,floors);
  if(error)throw new Error(error);
  // Atomic add for the first save, preventing accidental overwrite of a different staircase.
  const prior=await requestFromStore<Staircase|undefined>(STAIRCASE_STORE,"readonly",
    store=>store.get(stair.id));
  if(prior && prior.buildingId!==stair.buildingId)
    throw new Error("Staircase cannot be moved between buildings.");
  await requestFromStore<IDBValidKey>(STAIRCASE_STORE,"readwrite",
    store=>prior?store.put(stair):store.add(stair));
}

/** Replacing an image invalidates only staircase geometry for that floor.
 * A single transaction prevents leaving old landing pixels over a new image.
 */
export async function replaceFloorPlanImage(record:FloorPlanRecord):Promise<void> {
  const updated=ensureSpatialFoundation(record);
  const error=spatialFoundationError(updated);
  if(error)throw new Error(error);
  const db=await openDatabase();
  try {
    await new Promise<void>((resolve,reject)=>{
      const tx=db.transaction([STORE_NAME,STAIRCASE_STORE],"readwrite");
      tx.objectStore(STORE_NAME).put(updated);
      const request=tx.objectStore(STAIRCASE_STORE).openCursor();
      request.onsuccess=()=>{
        const cursor=request.result;
        if(!cursor)return;
        const stair=cursor.value as Staircase;
        if(stair.buildingId===updated.hierarchy!.building.id) {
          const landings=stair.landings.filter(l=>l.floorId!==updated.hierarchy!.floor.id);
          if(landings.length!==stair.landings.length) {
            if(!landings.length)cursor.delete();
            else cursor.update({...stair,landings,updatedAt:new Date().toISOString()});
          }
        }
        cursor.continue();
      };
      tx.oncomplete=()=>resolve();
      tx.onerror=()=>reject(tx.error??new Error("Could not replace the floor image."));
      tx.onabort=()=>reject(tx.error??new Error("Floor image replacement was cancelled."));
    });
  }finally{db.close();}
}

/** Deleting a floor also removes only its own staircase landing, while keeping
 * the staircase and its other floor landings intact. Everything is one transaction.
 */
export async function removeFloorPlan(id:string):Promise<void> {
  if(!id)throw new Error("Specify which floor to delete.");
  const floor=await loadFloorPlan(id);
  if(!floor)throw new Error("Floor not found.");
  const floorId=floor.hierarchy!.floor.id;
  const buildingId=floor.hierarchy!.building.id;
  const db=await openDatabase();
  try {
    await new Promise<void>((resolve,reject)=>{
      const tx=db.transaction([STORE_NAME,STAIRCASE_STORE],"readwrite");
      tx.objectStore(STORE_NAME).delete(id);
      const request=tx.objectStore(STAIRCASE_STORE).openCursor();
      request.onsuccess=()=>{
        const cursor=request.result;
        if(!cursor)return;
        const stair=cursor.value as Staircase;
        if(stair.buildingId===buildingId){
          const remaining=stair.landings.filter(landing=>landing.floorId!==floorId);
          if(remaining.length!==stair.landings.length||
             stair.servedFloorIds?.includes(floorId)){
            if(remaining.length===0)cursor.delete();
            else cursor.update({...stair,landings:remaining,
              servedFloorIds:stair.servedFloorIds?.filter(id=>id!==floorId),
              updatedAt:new Date().toISOString()});
          }
        }
        cursor.continue();
      };
      tx.oncomplete=()=>resolve();
      tx.onerror=()=>reject(tx.error??new Error("Could not delete the selected floor."));
      tx.onabort=()=>reject(tx.error??new Error("Floor deletion was cancelled."));
    });
  }finally{db.close();}
  const current=await selectedFloorId();
  if(current===id){
    const remaining=await listFloorPlans();
    if(remaining.length)await selectFloorPlan(remaining[0].id);
    else await requestFromStore<undefined>(SETTINGS_STORE,"readwrite",store=>store.delete(CURRENT_KEY));
  }
}
