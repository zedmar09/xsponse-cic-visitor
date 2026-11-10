/** Text search results from OpenStreetMap Nominatim, not building plan data. */
export type OutdoorLocation={
  id:string;
  label:string;
  longitude:number;
  latitude:number;
  zoom:number;
  /** Defined only for manually selected outdoor map coordinates. */
  source?:"map";
};

export function normalizeOutdoorQuery(value:unknown):string|null {
  if(typeof value!=="string")return null;
  const cleaned=value.replace(/\s+/g," ").trim();
  if(cleaned.length<2||cleaned.length>140)return null;
  return cleaned;
}

function mapZoom(kind:string):number {
  if(["country","continent"].includes(kind))return 5;
  if(["state","province","region"].includes(kind))return 8;
  if(["county","district"].includes(kind))return 10;
  if(["city","town","municipality"].includes(kind))return 12;
  if(["village","suburb","neighbourhood","quarter"].includes(kind))return 14;
  return 16;
}

/** Treat provider JSON as untrusted. Never send invalid coordinates to MapLibre. */
export function parseOutdoorResults(value:unknown):OutdoorLocation[]{
  if(!Array.isArray(value))return [];
  const seen=new Set<string>(),results:OutdoorLocation[]=[];
  for(const item of value){
    if(!item||typeof item!=="object")continue;
    const object=item as Record<string,unknown>;
    const label=object.display_name;
    if(!["string","number"].includes(typeof object.lat)||
       !["string","number"].includes(typeof object.lon)||
       String(object.lat).trim()===""||String(object.lon).trim()==="")continue;
    const lat=Number(object.lat),lon=Number(object.lon);
    if(typeof label!=="string"||!label.trim()||label.length>500||
       !Number.isFinite(lat)||!Number.isFinite(lon)||
       lat< -90||lat>90||lon< -180||lon>180)continue;
    const id=typeof object.place_id==="number"||typeof object.place_id==="string"?
      String(object.place_id):`${lat},${lon}`;
    const key=`${lat.toFixed(6)}:${lon.toFixed(6)}:${label}`;
    if(seen.has(key))continue;
    seen.add(key);
    const kind=typeof object.addresstype==="string"?object.addresstype:
      typeof object.type==="string"?object.type:"";
    results.push({id,label:label.trim(),longitude:lon,latitude:lat,zoom:mapZoom(kind)});
    if(results.length===5)break;
  }
  return results;
}

/** Click-to-pick mode uses the map's real longitude/latitude, not a geocoded
 * address or any floor-plan image coordinate. A meaningful name is added by
 * the administrator before the point is persisted.
 */
export function outdoorLocationFromMapPoint(
  longitude:number,latitude:number,zoom:number,
):OutdoorLocation|null{
  if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||
     !Number.isFinite(zoom)||latitude< -90||latitude>90||
     longitude< -180||longitude>180)return null;
  const lat=Number(latitude.toFixed(6));
  const lng=Number(longitude.toFixed(6));
  return {
    id:`map-point:${lat.toFixed(6)}:${lng.toFixed(6)}`,
    label:`Map point: ${lat.toFixed(6)}, ${lng.toFixed(6)}`,
    latitude:lat,longitude:lng,zoom:Math.min(19,Math.max(2,zoom)),
    source:"map",
  };
}
