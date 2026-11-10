import type { OutdoorLocation } from "@/lib/outdoor-search";

/** Geographic location anchors for future building placement. NOT floor-image pixels. */
export type SavedOutdoorLocation={
  id:string;
  name:string;
  address:string;
  latitude:number;
  longitude:number;
  zoom:number;
  createdAt:string;
  updatedAt:string;
};

export function validateLocationCoordinates(latitude:number,longitude:number):boolean {
  return Number.isFinite(latitude)&&Number.isFinite(longitude)&&
    latitude>=-90&&latitude<=90&&longitude>=-180&&longitude<=180;
}

export function validSavedLocation(value:SavedOutdoorLocation):boolean {
  return typeof value.id==="string"&&value.id.length>0&&
    typeof value.name==="string"&&value.name.trim().length>=2&&
    value.name.trim().length<=90&&
    typeof value.address==="string"&&value.address.length<=500&&
    validateLocationCoordinates(value.latitude,value.longitude)&&
    Number.isFinite(value.zoom)&&value.zoom>=1&&value.zoom<=20&&
    typeof value.createdAt==="string"&&typeof value.updatedAt==="string";
}

/** The administrator chooses a search result, then supplies their own site name. */
export function createSavedLocation(
  place:OutdoorLocation,name:string,
  id:string,now:string,
):SavedOutdoorLocation{
  const location:SavedOutdoorLocation={
    id,name:name.trim().replace(/\s+/g," "),address:place.label,
    latitude:place.latitude,longitude:place.longitude,
    zoom:Math.min(19,Math.max(2,place.zoom)),createdAt:now,updatedAt:now,
  };
  if(!validSavedLocation(location))throw new Error("Enter a location name (2–90 characters) and select a valid map result.");
  return location;
}

export function renameSavedLocation(
  previous:SavedOutdoorLocation,name:string,now:string,
):SavedOutdoorLocation{
  const updated={...previous,name:name.trim().replace(/\s+/g," "),updatedAt:now};
  if(!validSavedLocation(updated))throw new Error("Enter a location name between 2 and 90 characters.");
  return updated;
}

export function asOutdoorSearchTarget(place:SavedOutdoorLocation):OutdoorLocation{
  return {
    id:place.id,label:place.name,
    longitude:place.longitude,latitude:place.latitude,zoom:place.zoom,
  };
}
