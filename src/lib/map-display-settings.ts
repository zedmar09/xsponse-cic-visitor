/** Personal presentation preferences only: changing these never alters map geometry. */
export type MapDisplaySettings={
  roomLabels:boolean;
  roomColors:boolean;
  walkingColors:boolean;
  doorwayIcons:boolean;
  doorwayShapes:boolean;
  stairLabels:boolean;
  deviceMarkers:boolean;
  entranceExitMarkers:boolean;
  guideLine:boolean;
};
export const DEFAULT_DISPLAY_SETTINGS:MapDisplaySettings={
  roomLabels:true,roomColors:true,walkingColors:true,
  doorwayIcons:true,doorwayShapes:true,stairLabels:true,
  deviceMarkers:true,entranceExitMarkers:true,guideLine:true,
};
export const DISPLAY_SETTINGS_KEY="indoor-map-display-v1";
export function parseDisplaySettings(value:unknown):MapDisplaySettings {
  if(!value||typeof value!=="object")return {...DEFAULT_DISPLAY_SETTINGS};
  const obj=value as Record<string,unknown>;
  const settings={...DEFAULT_DISPLAY_SETTINGS};
  for(const key of Object.keys(settings) as (keyof MapDisplaySettings)[]){
    if(typeof obj[key]==="boolean")settings[key]=obj[key];
  }
  return settings;
}
