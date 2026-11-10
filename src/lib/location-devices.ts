import type { PixelPoint } from "@/lib/floor-plan";
import { DEFAULT_CAMERA_COVERAGE, validCameraCoverage, validDeviceSize, supportsCamera, type CameraCoverage } from "@/lib/device-spatial";

/** One icon per model, reused by every physical device instance. */
export const DEVICE_MODELS = [
  { type: "single-sided", label: "Single-sided", icon: "/single-sided.svg" },
  { type: "double-sided", label: "Double-sided", icon: "/double-sided.svg" },
  { type: "p-button", label: "Push button", icon: "/p-button.svg" },
  { type: "shield", label: "Shield", icon: "/shield.svg" },
] as const;

export type DeviceType = (typeof DEVICE_MODELS)[number]["type"];
export type LocationDevice = {
  uuid: string;
  locationId: string;
  type: DeviceType;
  name: string;
  /** Unplaced inventory stays at the location, not on a floor. */
  floorId: string | null;
  point: PixelPoint | null;
  sizePx: number;
  /** Distinguishes an old 38px default from a newly user-selected 38px. */
  sizeVersion?: 2;
  camera: CameraCoverage | null;
};

export const DEVICE_DRAG_TYPE = "application/x-maplibre-indoor-device";
const STORAGE_KEY = "maplibre-location-device-inventory-v1";
const modelTypes = new Set<string>(DEVICE_MODELS.map(model => model.type));

function readAll(): Record<string, LocationDevice[]> {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return {};
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const data: Record<string, LocationDevice[]> = {};
  for (const [locationId, value] of Object.entries(parsed)) {
    if (!Array.isArray(value)) continue;
    data[locationId] = value.filter((device): device is LocationDevice =>
      device && typeof device === "object" &&
      typeof device.uuid === "string" && typeof device.name === "string" &&
      device.locationId === locationId && modelTypes.has(device.type) &&
      (device.floorId === null || typeof device.floorId === "string") &&
      (device.point === null || (device.point && Number.isFinite(device.point.x) &&
        Number.isFinite(device.point.y)))).map(device=>({
      ...device,
      // Non-destructive migration of the existing v1 demo inventory.
      // The original 38px default was oversized. Retain explicitly customized sizes.
      sizePx:device.sizeVersion!==2&&device.sizePx===38?24:
        validDeviceSize(device.sizePx)?device.sizePx:24,
      sizeVersion:2 as const,
      camera:supportsCamera(device.type)
        ? device.camera&&validCameraCoverage(device.camera)
          ? device.camera:{...DEFAULT_CAMERA_COVERAGE}
        :null,
    }));
  }
  return data;
}

function saveAll(data: Record<string, LocationDevice[]>): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

/** Seed exactly once per location (including previously saved locations). */
export function ensureLocationDevices(locationId: string): LocationDevice[] {
  if (!locationId) return [];
  const data = readAll();
  if (Object.prototype.hasOwnProperty.call(data, locationId)) return data[locationId];
  const inventory = DEVICE_MODELS.flatMap(model => {
    const count = 3 + Math.floor(Math.random() * 8);
    return Array.from({ length: count }, (_, index): LocationDevice => ({
      uuid: crypto.randomUUID(),
      locationId,
      type: model.type,
      name: model.label + " " + String(index + 1).padStart(2, "0"),
      floorId: null,
      point: null,
      sizePx:24,
      sizeVersion:2 as const,
      camera:supportsCamera(model.type)?{...DEFAULT_CAMERA_COVERAGE}:null,
    }));
  });
  data[locationId] = inventory;
  saveAll(data);
  return inventory;
}


/** Editing operations are pure: nothing reaches the outdoor map or localStorage
 * until the user explicitly chooses Save device placement.
 */
export function stageDevicePlacement(
  inventory:ReadonlyArray<LocationDevice>,locationId:string,
  deviceId:string,floorId:string,point:PixelPoint,
):LocationDevice[]{
  if(!floorId||!Number.isFinite(point.x)||!Number.isFinite(point.y))
    throw new Error("Choose a valid indoor floor position.");
  if(!inventory.some(d=>d.uuid===deviceId&&d.locationId===locationId))
    throw new Error("The device does not belong to this location.");
  return inventory.map(device=>device.uuid===deviceId
    ? {...device,floorId,point:{...point}}:device);
}
export function stageDeviceConfiguration(
  inventory:ReadonlyArray<LocationDevice>,locationId:string,
  deviceId:string,patch:{sizePx?:number;camera?:CameraCoverage},
):LocationDevice[]{
  if(patch.sizePx!==undefined&&!validDeviceSize(patch.sizePx))
    throw new Error("Device size must be between 16 and 160 pixels.");
  if(patch.camera!==undefined&&!validCameraCoverage(patch.camera))
    throw new Error("Invalid camera field of view.");
  if(!inventory.some(d=>d.uuid===deviceId&&d.locationId===locationId))
    throw new Error("The device does not belong to this location.");
  return inventory.map(device=>device.uuid!==deviceId?device:{
    ...device,
    sizePx:patch.sizePx??device.sizePx,
    sizeVersion:2 as const,
    camera:supportsCamera(device.type)?patch.camera??device.camera:null,
  });
}
export function stageDeviceUnplacement(
  inventory:ReadonlyArray<LocationDevice>,locationId:string,deviceId:string,
):LocationDevice[]{
  if(!inventory.some(d=>d.uuid===deviceId&&d.locationId===locationId))
    throw new Error("The device does not belong to this location.");
  return inventory.map(device=>device.uuid===deviceId
    ? {...device,floorId:null,point:null}:device);
}
export function deviceChangesPending(
  current:ReadonlyArray<LocationDevice>,saved:ReadonlyArray<LocationDevice>,
):boolean {
  return JSON.stringify(current)!==JSON.stringify(saved);
}
/** Commits one complete location-scoped snapshot with identity/geometry checks. */
export function saveDevicePlacement(
  locationId:string,devices:ReadonlyArray<LocationDevice>,
):LocationDevice[]{
  const data=readAll(),existing=data[locationId];
  if(!existing||devices.length!==existing.length)
    throw new Error("The saved device inventory changed. Reload this location before saving.");
  const ids=new Map(existing.map(device=>[device.uuid,device]));
  const uniqueIds=new Set<string>();
  for(const device of devices){
    const original=ids.get(device.uuid);
    if(!original||uniqueIds.has(device.uuid)||device.type!==original.type||
      device.locationId!==locationId||
      !validDeviceSize(device.sizePx)||
      (device.floorId!==null&&typeof device.floorId!=="string")||
      (device.point!==null&&(!Number.isFinite(device.point.x)||!Number.isFinite(device.point.y)))||
      (device.floorId===null)!==(device.point===null)||
      (supportsCamera(device.type)
        ? !device.camera||!validCameraCoverage(device.camera)
        : device.camera!==null))
      throw new Error("Invalid or outdated device inventory. Changes were not saved.");
    uniqueIds.add(device.uuid);
  }
  data[locationId]=devices.map(device=>({
    ...device,
    point:device.point?{...device.point}:null,
    sizeVersion:2 as const,
    camera:device.camera?{...device.camera}:null,
  }));
  saveAll(data);
  return readAll()[locationId];
}

export function placeLocationDevice(
  locationId: string, deviceId: string, floorId: string, point: PixelPoint,
): LocationDevice[] {
  if (!floorId || !Number.isFinite(point.x) || !Number.isFinite(point.y))
    throw new Error("Choose a valid floor-plan position.");
  const data = readAll();
  const inventory = data[locationId];
  if (!inventory) throw new Error("This location has no device inventory.");
  if (!inventory.some(device => device.uuid === deviceId))
    throw new Error("The dragged device does not belong to this location.");
  const next = inventory.map(device => device.uuid === deviceId
    ? { ...device, floorId, point: { ...point } } : device);
  data[locationId] = next;
  saveAll(data);
  return next;
}

export function updateLocationDevice(
  locationId:string, deviceId:string, patch:{sizePx?:number;camera?:CameraCoverage},
):LocationDevice[]{
  if(patch.sizePx!==undefined&&!validDeviceSize(patch.sizePx))
    throw new Error("Device size must be between 16 and 160 pixels.");
  if(patch.camera!==undefined&&!validCameraCoverage(patch.camera))
    throw new Error("Camera field of view contains invalid dimensions.");
  const data=readAll(),inventory=data[locationId];
  if(!inventory||!inventory.some(device=>device.uuid===deviceId))
    throw new Error("This device does not belong to the selected location.");
  const next=inventory.map(device=>device.uuid!==deviceId?device:{
    ...device,
    sizePx:patch.sizePx??device.sizePx,
    sizeVersion:2 as const,
    camera:supportsCamera(device.type)?patch.camera??device.camera:null,
  });
  data[locationId]=next;
  saveAll(data);
  return next;
}

export function unplaceLocationDevice(locationId: string, deviceId: string): LocationDevice[] {
  const data = readAll();
  const inventory = data[locationId];
  if (!inventory || !inventory.some(device => device.uuid === deviceId))
    throw new Error("The device is not assigned to this location.");
  const next = inventory.map(device => device.uuid === deviceId
    ? { ...device, floorId: null, point: null } : device);
  data[locationId] = next;
  saveAll(data);
  return next;
}

export function deleteLocationDevices(locationId: string): void {
  const data = readAll();
  delete data[locationId];
  saveAll(data);
}
