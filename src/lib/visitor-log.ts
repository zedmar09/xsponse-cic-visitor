import type {PixelPoint} from "@/lib/floor-plan";
import type {VisitorMapSnapshot} from "@/lib/visitor-simulation";

/** The visitor log samples every visitor's position on a fixed cadence. */
export const VISITOR_LOG_INTERVAL_MS=3000;
export const VISITOR_LOG_LIMIT=200;

export type VisitorLogRow={
  visitorId:string;
  fullName:string;
  color:string;
  locationName:string;
  floorName:string;
  /** Floor-image pixel position. */
  x:number;
  y:number;
  /** WGS84 position, null when the visitor's floor is not placed on the map. */
  latitude:number|null;
  longitude:number|null;
  alerting:boolean;
};
export type VisitorLogEntry={id:string;timestamp:string;rows:VisitorLogRow[]};

const round=(value:number,digits:number)=>{
  const factor=10**digits;
  return Math.round(value*factor)/factor;
};

/** One timestamped sample of every visitor's coordinates. */
export function createVisitorLogEntry(
  time:Date,visitors:ReadonlyArray<VisitorMapSnapshot>,
  project:(visitor:VisitorMapSnapshot,point:PixelPoint)=>[number,number]|null,
):VisitorLogEntry{
  const rows=visitors.map(visitor=>{
    const lngLat=project(visitor,visitor.point);
    return {
      visitorId:visitor.id,fullName:visitor.fullName,color:visitor.color,
      locationName:visitor.locationName,floorName:visitor.floorName,
      x:round(visitor.point.x,1),y:round(visitor.point.y,1),
      longitude:lngLat?round(lngLat[0],7):null,
      latitude:lngLat?round(lngLat[1],7):null,
      alerting:visitor.alerting,
    };
  });
  return {id:`${time.getTime()}`,timestamp:time.toISOString(),rows};
}

/** Newest first, bounded so a long-running demo cannot grow without limit. */
export function appendVisitorLog(
  entries:ReadonlyArray<VisitorLogEntry>,entry:VisitorLogEntry,limit=VISITOR_LOG_LIMIT,
):VisitorLogEntry[]{
  return [entry,...entries].slice(0,limit);
}

const csvCell=(value:string|number|boolean|null)=>{
  const text=value===null?"":String(value);
  return /[",\n]/.test(text)?`"${text.replace(/"/g,'""')}"`:text;
};

/** Oldest first, one row per visitor per sample. */
export function visitorLogCsv(entries:ReadonlyArray<VisitorLogEntry>):string{
  const header=["timestamp","visitor","location","floor","latitude","longitude",
    "pixel_x","pixel_y","restricted"];
  const lines=[...entries].reverse().flatMap(entry=>entry.rows.map(row=>[
    entry.timestamp,row.fullName,row.locationName,row.floorName,row.latitude,
    row.longitude,row.x,row.y,row.alerting,
  ].map(csvCell).join(",")));
  return [header.join(","),...lines].join("\n");
}
