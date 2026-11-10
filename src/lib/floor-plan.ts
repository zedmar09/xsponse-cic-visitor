import type { OutdoorFloorPlacement } from "@/lib/outdoor-floor-placement";

export type PixelPoint = { x: number; y: number };
export type Calibration = { start: PixelPoint; end: PixelPoint; distanceMeters: number };
export type AreaKind = "room" | "walkable";
export type SpatialHierarchy = {
  site: { id:string; name:string };
  building: { id:string; siteId:string; name:string };
  floor: { id:string; buildingId:string; name:string; level:number|null };
};
export type MarkerKind = "entrance" | "exit" | "camera" | "device"; // legacy entrance/exit point markers stay readable
export type DoorUsage = "entrance" | "exit" | "both" | "internal";
export type PortalRole = "room" | "main"; // legacy field, read only
export type DoorPurpose = "interior" | "building" | "emergency";
export type DoorSideSuggestion = {
  status: "two-spaces" | "one-space" | "ambiguous" | "none";
  sideAId: string | null;
  sideBId: string | null;
};
export type FloorPortal = {
  id: string;
  floorId: string;
  name: string;
  usage: DoorUsage;
  role?: PortalRole; // legacy values stay readable
  purpose?: DoorPurpose; // separate physical door purpose from movement direction
  reviewed?: boolean; // user-confirmed floor-plan placement & space assignments
  displayDepthPx?: number; // rectangle preview thickness, original image pixels
  start: PixelPoint;
  end: PixelPoint;
  spaceAId: string | null;
  spaceBId: string | null;
};
export type ImageCleanup = "off" | "gentle" | "strong";
export type ImageOptions = { cleanup: ImageCleanup; enhance: boolean };
export type WalkwayApproval = { areaAId:string;areaBId:string;geometryKey:string };
export type FloorArea = { id: string; floorId: string; kind: AreaKind; name: string; points: PixelPoint[] };
export type FloorMarker = { id: string; floorId: string; kind: MarkerKind; name: string; point: PixelPoint };
export type FloorPlanRecord = {
  id: string; // "active" remains valid for legacy saved floors; new floors use unique IDs
  planId: string;
  /** Selected outdoor location ID. Legacy indoor plans remain unassigned. */
  locationId?: string | null;
  /** Geographic alignment of this individual floor image at its saved location. */
  outdoorPlacement?: OutdoorFloorPlacement | null;
  hierarchy?: SpatialHierarchy; // optional for legacy IndexedDB records
  name: string;
  width: number;
  height: number;
  mimeType: string;
  image: Blob;
  calibration: Calibration | null; // legacy optional setup; never required for drawing
  areas?: FloorArea[];
  markers?: FloorMarker[];
  portals?: FloorPortal[];
  walkwayApprovals?: WalkwayApproval[]; // reviewed open passages, invalidated if polygons change
  originalImage?: Blob;
  imageOptions?: ImageOptions;
  createdAt: string;
  updatedAt: string;
};

/** Stable, deterministic ancestor IDs derived from an existing floor's planId. */
export function defaultSpatialHierarchy(planId:string):SpatialHierarchy {
  const siteId=`site-${planId}`,buildingId=`building-${planId}`;
  return {
    site:{id:siteId,name:"Site 1"},
    building:{id:buildingId,siteId,name:"Building 1"},
    floor:{id:planId,buildingId,name:"Floor 1",level:null},
  };
}
/** Add floor ownership to legacy features without changing geometry or other IDs. */
export function ensureSpatialFoundation(source:FloorPlanRecord):FloorPlanRecord {
  const hierarchy=source.hierarchy??defaultSpatialHierarchy(source.planId);
  const floorId=hierarchy.floor.id;
  return {...source,hierarchy,
    areas:(source.areas??[]).map(a=>a.floorId?a:{...a,floorId}),
    portals:(source.portals??[]).map(p=>p.floorId?p:{...p,floorId}),
    markers:(source.markers??[]).map(m=>m.floorId?m:{...m,floorId}),
  };
}
/** Prevent inconsistent relationships from being saved or exported. */
export function spatialFoundationError(record:FloorPlanRecord):string|null {
  const h=record.hierarchy;
  if(record.locationId!=null&&(typeof record.locationId!=="string"||!record.locationId.trim()))
    return "A linked outdoor location must have a valid ID.";
  if(record.outdoorPlacement){
    if(!record.locationId)return "Assign this floor to an outdoor location before placement.";
    const p=record.outdoorPlacement;
    if(!Number.isFinite(p.longitude)||p.longitude < -180||p.longitude > 180||
      !Number.isFinite(p.latitude)||p.latitude < -80||p.latitude > 80||
      !Number.isFinite(p.widthMeters)||p.widthMeters < 2||p.widthMeters > 5000||
      !Number.isFinite(p.rotationDegrees)||p.rotationDegrees < -180||p.rotationDegrees > 180||
      (p.heightMeters!==undefined&&(!Number.isFinite(p.heightMeters)||p.heightMeters<2||p.heightMeters>5000))||
      (p.skewXDegrees!==undefined&&(!Number.isFinite(p.skewXDegrees)||Math.abs(p.skewXDegrees)>35))||
      (p.skewYDegrees!==undefined&&(!Number.isFinite(p.skewYDegrees)||Math.abs(p.skewYDegrees)>35))||
      (p.cornerWarpOffsets!==undefined&&
        (!Array.isArray(p.cornerWarpOffsets)||p.cornerWarpOffsets.length!==4||
          p.cornerWarpOffsets.some(offset=>!Array.isArray(offset)||offset.length!==2||
            offset.some(value=>!Number.isFinite(value)||Math.abs(value)>5000))))||
      !Number.isFinite(p.opacity)||p.opacity < .1||p.opacity > 1)
      return "The outdoor floor placement contains invalid coordinates or dimensions.";
  }
  if(!h)return "Site, building and floor are required.";
  if(!h.site.id||!h.building.id||!h.floor.id)return "Spatial IDs are required.";
  if(!h.site.name.trim()||!h.building.name.trim()||!h.floor.name.trim())return "Site, building and floor names are required.";
  if(h.building.siteId!==h.site.id)return "Building must belong to the selected site.";
  if(h.floor.buildingId!==h.building.id)return "Floor must belong to the selected building.";
  if(h.floor.id!==record.planId)return "Floor identity must match the floor plan.";
  if(h.floor.level!==null&&!Number.isInteger(h.floor.level))return "Floor level must be a whole number.";
  for(const [kind,items] of [["Area",record.areas??[]],["Doorway",record.portals??[]],["Marker",record.markers??[]]] as const) {
    const seen=new Set<string>();
    for(const item of items) {
      if(!item.id||seen.has(item.id))return `${kind} identifiers must be unique.`;
      seen.add(item.id);
      if(item.floorId!==h.floor.id)return `${kind} belongs to a different floor.`;
    }
  }
  return null;
}
/** For old doors, show the recorded category without pretending it was reviewed. */
export function displayDoorPurpose(portal: FloorPortal): DoorPurpose | null {
  if (portal.purpose === "interior" || portal.purpose === "building" || portal.purpose === "emergency") return portal.purpose;
  if (portal.role === "room") return "interior";
  if (portal.role === "main") return "building";
  return null;
}

/** A and B are explicit sides, not "entrance"/"exit" classifications.
 * An entrance direction traverses A -> B; exit traverses B -> A.
 * Building/exterior doors use outside as A, with an interior area as B.
 * This only checks data references; navigation/physical verification is later.
 */
export function doorwaySetupError(portal: FloorPortal, areas: FloorArea[]): string | null {
  if (portal.purpose) {
    if (!["interior", "building", "emergency"].includes(portal.purpose)) return "Choose a supported doorway purpose.";
    if (!["entrance", "exit", "both"].includes(portal.usage)) return "Choose an explicit movement direction.";
    if (portal.purpose === "emergency" && portal.usage === "entrance")
      return "An emergency exit must permit exit from Side B toward Outside (Side A).";
    if (portal.spaceAId && !areas.some(a => a.id === portal.spaceAId && a.floorId === portal.floorId))
      return "Side A refers to a missing space on this floor.";
    if (portal.spaceBId && !areas.some(a => a.id === portal.spaceBId && a.floorId === portal.floorId))
      return "Side B refers to a missing space on this floor.";
    if (portal.spaceAId && portal.spaceAId === portal.spaceBId) return "Side A and Side B must be different spaces.";
    if (portal.purpose !== "interior" && portal.spaceAId) return "An exterior doorway must have Outside as Side A.";
    return null; // incomplete doors can be saved as drafts; they are not reviewed/route-ready
  }

  // Retain previous semantics for legacy role records, including older exports.
  if (!portal.role) return null;
  if (portal.role !== "room" && portal.role !== "main") return "Select the doorway category.";
  if (portal.usage === "internal") return "Choose Entrance only, Exit only, or Entrance & exit.";
  if (!portal.spaceBId || !areas.some(a => a.id === portal.spaceBId && a.floorId === portal.floorId))
    return portal.role === "main" ? "Select an inside lobby, hall or room for the main building doorway."
      : "Select the room or facility this doorway enters (Side B).";
  if (portal.spaceAId && !areas.some(a => a.id === portal.spaceAId && a.floorId === portal.floorId))
    return "Side A references a space that does not exist on this floor.";
  if (portal.spaceAId === portal.spaceBId) return "Side A and Side B must be different spaces.";
  if (portal.role === "main" && portal.spaceAId) return "Main building access must start from Outside (Side A).";
  return null;
}

/** Whether a saved doorway has enough explicitly confirmed information for later topology work.
 * This is NOT a declaration of physical safety, accessibility, or active access enforcement.
 */
export function doorwayReviewIssues(portal: FloorPortal, areas: FloorArea[]): string[] {
  const issues: string[] = [];
  const structuralError = doorwaySetupError(portal, areas);
  if (structuralError) issues.push(structuralError);
  if (!portal.purpose) issues.push("Choose and save the door purpose using the updated editor.");
  if (!portal.spaceBId) issues.push("Select the space on Side B.");
  if (portal.purpose === "interior" && !portal.spaceAId) issues.push("Select the connecting space on Side A.");
  if (!portal.reviewed) issues.push("Confirm the door opening and connections against the floor plan.");
  return issues;
}

function pointInArea(point: PixelPoint, polygon: PixelPoint[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i=0, j=polygon.length-1; i<polygon.length; j=i++) {
    const a=polygon[i], b=polygon[j];
    if ((a.y>point.y)!==(b.y>point.y) &&
        point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x) inside=!inside;
  }
  return inside;
}

/** A readable interior label position, never just the bounding-box center.
 * Samples the polygon to handle L-shaped/concave rooms and hallways.
 * All positions are retained as original floor-image pixels.
 */
export function areaLabelPoint(points: PixelPoint[]): PixelPoint {
  if (!points.length) return {x:0,y:0};
  if (points.length<3) return points[0];
  const minX=Math.min(...points.map(p=>p.x)),maxX=Math.max(...points.map(p=>p.x));
  const minY=Math.min(...points.map(p=>p.y)),maxY=Math.max(...points.map(p=>p.y));
  const distanceToEdges=(point:PixelPoint)=>{
    let distance=Infinity;
    for(let i=0;i<points.length;i++) {
      const a=points[i],b=points[(i+1)%points.length];
      const dx=b.x-a.x,dy=b.y-a.y,len2=dx*dx+dy*dy;
      const t=len2>0?Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/len2)):0;
      distance=Math.min(distance,Math.hypot(point.x-(a.x+t*dx),point.y-(a.y+t*dy)));
    }
    return distance;
  };
  const center={x:(minX+maxX)/2,y:(minY+maxY)/2};
  let best:PixelPoint|null=null,bestDistance=-1;
  const consider=(point:PixelPoint)=>{
    if(!pointInArea(point,points))return;
    const clearance=distanceToEdges(point);
    if(clearance>bestDistance){best=point;bestDistance=clearance;}
  };
  consider(center);
  const spanX=maxX-minX,spanY=maxY-minY;
  for(let y=0;y<17;y++)for(let x=0;x<17;x++) {
    consider({x:minX+(x+.5)*spanX/17,y:minY+(y+.5)*spanY/17});
  }
  return best??points[0];
}

/** Suggest the polygons on opposite sides of a drawn doorway opening.
 * The portal line follows the wall; its perpendicular normal samples both
 * sides. Suggestions are intentionally non-authoritative and NEVER auto-saved.
 * Overlapping polygons are ambiguous and require explicit manual assignment.
 */
export function suggestDoorwaySides(start: PixelPoint, end: PixelPoint, areas: FloorArea[]): DoorSideSuggestion {
  const dx=end.x-start.x, dy=end.y-start.y;
  const span=Math.hypot(dx,dy);
  if (span<3) return {status:"none",sideAId:null,sideBId:null};
  const midpoint={x:(start.x+end.x)/2,y:(start.y+end.y)/2};
  const offset=Math.max(3,Math.min(20,span*0.45));
  const normal={x:-dy/span,y:dx/span};
  const side1={x:midpoint.x+normal.x*offset,y:midpoint.y+normal.y*offset};
  const side2={x:midpoint.x-normal.x*offset,y:midpoint.y-normal.y*offset};
  const matches=(p:PixelPoint)=>areas.filter(a=>pointInArea(p,a.points));
  const first=matches(side1),second=matches(side2);
  if (first.length>1 || second.length>1 || (first.length===1 && second.length===1 && first[0].id===second[0].id))
    return {status:"ambiguous",sideAId:null,sideBId:null};
  if (first.length===1 && second.length===1)
    return {status:"two-spaces",sideAId:first[0].id,sideBId:second[0].id};
  if (first.length===1 || second.length===1)
    return {status:"one-space",sideAId:null,sideBId:(first[0]??second[0]).id};
  return {status:"none",sideAId:null,sideBId:null};
}

export const FLOOR_PLANE_MAX_EDGE = 100;
export function getPlaneBounds(width: number, height: number) {
  if (width <= 0 || height <= 0) throw new Error("Invalid image dimensions");
  const scale = FLOOR_PLANE_MAX_EDGE / Math.max(width, height);
  return { halfWidth: (width * scale) / 2, halfHeight: (height * scale) / 2, scale };
}
export function pixelsToPlane(point: PixelPoint, width: number, height: number): [number, number] {
  const { halfWidth, halfHeight, scale } = getPlaneBounds(width, height);
  return [point.x * scale - halfWidth, halfHeight - point.y * scale];
}
export function planeToPixels(coordinates: { lng: number; lat: number }, width: number, height: number): PixelPoint | null {
  const { halfWidth, halfHeight, scale } = getPlaneBounds(width, height);
  const x = (coordinates.lng + halfWidth) / scale;
  const y = (halfHeight - coordinates.lat) / scale;
  const epsilon = .00001;
  if (x < -epsilon || x > width + epsilon || y < -epsilon || y > height + epsilon) return null;
  return { x: Math.round(Math.max(0, Math.min(width, x)) * 100) / 100,
    y: Math.round(Math.max(0, Math.min(height, y)) * 100) / 100 };
}
export function normalizedPoint(point: PixelPoint, width: number, height: number) {
  return { x: Math.round(point.x / width * 1e6) / 1e6, y: Math.round(point.y / height * 1e6) / 1e6 };
}
export function polygonArea(points: PixelPoint[]) {
  return Math.abs(points.reduce((sum, point, i) => {
    const next = points[(i + 1) % points.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0)) / 2;
}
function orientation(a: PixelPoint,b: PixelPoint,c:PixelPoint) {
  return (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
}
function onSegment(a: PixelPoint,b: PixelPoint,p:PixelPoint) {
  return p.x >= Math.min(a.x,b.x)-1e-6 && p.x <= Math.max(a.x,b.x)+1e-6 &&
    p.y >= Math.min(a.y,b.y)-1e-6 && p.y <= Math.max(a.y,b.y)+1e-6;
}
function intersects(a:PixelPoint,b:PixelPoint,c:PixelPoint,d:PixelPoint) {
  const o1=orientation(a,b,c),o2=orientation(a,b,d),o3=orientation(c,d,a),o4=orientation(c,d,b);
  if ((o1>0&&o2<0||o1<0&&o2>0)&&(o3>0&&o4<0||o3<0&&o4>0)) return true;
  return Math.abs(o1)<1e-7&&onSegment(a,b,c)||Math.abs(o2)<1e-7&&onSegment(a,b,d)||
    Math.abs(o3)<1e-7&&onSegment(c,d,a)||Math.abs(o4)<1e-7&&onSegment(c,d,b);
}
export function polygonError(points: PixelPoint[]): string | null {
  if (points.length < 3) return "Choose at least three different corners.";
  for (let i=0;i<points.length;i++) {
    const a=points[i],b=points[(i+1)%points.length];
    if (Math.hypot(b.x-a.x,b.y-a.y)<1) return "Corners must be at least one image pixel apart.";
  }
  if (polygonArea(points)<4) return "This shape is too narrow. Choose a larger outline.";
  for (let i=0;i<points.length;i++) {
    for (let j=i+1;j<points.length;j++) {
      if (j===i+1 || (i===0&&j===points.length-1)) continue;
      if (intersects(points[i],points[(i+1)%points.length],points[j],points[(j+1)%points.length])) {
        return "The outline crosses itself. Undo a corner and follow the walls in order.";
      }
    }
  }
  return null;
}
export function segmentImageLength(start: PixelPoint, end: PixelPoint) {
  return Math.hypot(end.x-start.x, end.y-start.y);
}
export const DOOR_DEPTH_DEFAULT = 14;

/** The four-sided representation is a display overlay, not a measured door footprint.
 * Two endpoints remain the canonical, backwards-compatible doorway geometry.
 */
/** The blue thickness grip sits beyond the rectangle edge at a fixed screen-space
 * distance, converted to image pixels by the canvas. It can be grabbed even at
 * small zoom levels, and does not overlap the doorway's two yellow end handles.
 */
export function doorwayThicknessHandle(
  start:PixelPoint,end:PixelPoint,depth:number,clearancePx:number,
):PixelPoint|null {
  const dx=end.x-start.x,dy=end.y-start.y,len=Math.hypot(dx,dy);
  if(len<1||!Number.isFinite(clearancePx))return null;
  const reach=Math.max(0,depth)/2+Math.max(0,clearancePx);
  return {x:(start.x+end.x)/2-dy/len*reach,
    y:(start.y+end.y)/2+dx/len*reach};
}

/** One image-pixel increment from the map drag; independent of map zoom.
 * This is visual overlay thickness, not a building measurement.
 */
export function doorwayThicknessFromPointer(
  start:PixelPoint,end:PixelPoint,pointer:PixelPoint,clearancePx:number,
  min=6,max=48,
):number {
  const dx=end.x-start.x,dy=end.y-start.y,len=Math.hypot(dx,dy);
  if(len<1)return min;
  const center={x:(start.x+end.x)/2,y:(start.y+end.y)/2};
  const normalDistance=((pointer.x-center.x)*(-dy)+(pointer.y-center.y)*dx)/len;
  return Math.max(min,Math.min(max,Math.round(2*(normalDistance-Math.max(0,clearancePx)))));
}

export function doorwayRectangle(start:PixelPoint,end:PixelPoint,depth=DOOR_DEPTH_DEFAULT):PixelPoint[] {
  const dx=end.x-start.x,dy=end.y-start.y;
  const len=Math.hypot(dx,dy);
  if(len<1 || !Number.isFinite(depth))return [];
  const thickness=Math.max(4,Math.min(80,depth))/2;
  const nx=-dy/len*thickness,ny=dx/len*thickness;
  return [
    {x:start.x+nx,y:start.y+ny},
    {x:end.x+nx,y:end.y+ny},
    {x:end.x-nx,y:end.y-ny},
    {x:start.x-nx,y:start.y-ny},
  ];
}

function closestOnSegment(p:PixelPoint,a:PixelPoint,b:PixelPoint):PixelPoint {
  const dx=b.x-a.x,dy=b.y-a.y;
  const d=dx*dx+dy*dy;
  const t=d<=0?0:Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/d));
  return {x:a.x+t*dx,y:a.y+t*dy};
}

/** Click near a drawn wall to align a doorway automatically. If no nearby
 * boundary is found, create a horizontal free-placement overlay.
 * desiredWidth, snapDistance and returned coordinates use original image pixels.
 */
export function proposeDoorwayPlacement(
  point:PixelPoint,areas:FloorArea[],desiredWidth=60,snapDistance=35,
):{start:PixelPoint;end:PixelPoint;aligned:boolean} {
  const width=Math.max(8,Math.min(160,desiredWidth));
  let nearest:{start:PixelPoint;end:PixelPoint;distance:number}|null=null;
  for(const area of areas) {
    for(let i=0;i<area.points.length;i++) {
      const start=area.points[i],end=area.points[(i+1)%area.points.length];
      const segmentLength=Math.hypot(end.x-start.x,end.y-start.y);
      if(segmentLength<8)continue;
      const projected=closestOnSegment(point,start,end);
      const distance=Math.hypot(point.x-projected.x,point.y-projected.y);
      if(distance<=snapDistance&&(!nearest||distance<nearest.distance)){
        nearest={start,end,distance};
      }
    }
  }
  if(nearest) {
    const wall: {start:PixelPoint;end:PixelPoint;distance:number}=nearest;
    const vx=wall.end.x-wall.start.x,vy=wall.end.y-wall.start.y;
    const length=Math.hypot(vx,vy);
    const half=Math.min(width,length)/2;
    const unit={x:vx/length,y:vy/length};
    const projection=(point.x-wall.start.x)*unit.x+(point.y-wall.start.y)*unit.y;
    const position=Math.max(half,Math.min(length-half,projection));
    const center={x:wall.start.x+position*unit.x,y:wall.start.y+position*unit.y};
    return {
      start:{x:center.x-unit.x*half,y:center.y-unit.y*half},
      end:{x:center.x+unit.x*half,y:center.y+unit.y*half},
      aligned:true,
    };
  }
  return {start:{x:point.x-width/2,y:point.y},end:{x:point.x+width/2,y:point.y},aligned:false};
}

export function portalMidpoint(portal: Pick<FloorPortal, "start" | "end">): PixelPoint {
  return {x:(portal.start.x+portal.end.x)/2, y:(portal.start.y+portal.end.y)/2};
}
export function exportFloorPlanMetadata(source: FloorPlanRecord) {
  const record=ensureSpatialFoundation(source);
  const problem=spatialFoundationError(record);
  if(problem)throw new Error(problem);
  return {
    schemaVersion: 4,
    hierarchy: record.hierarchy,
    locationId: record.locationId??null,
    outdoorPlacement: record.outdoorPlacement??null,
    planId: record.planId,
    name: record.name,
    image: { fileType: record.mimeType, width: record.width, height: record.height, includedInExport: false },
    coordinates: { origin: "top-left", xAxis: "right", yAxis: "down", unit: "pixel", normalizedRange: [0, 1] },
    areas: (record.areas ?? []).map(a => ({ ...a, normalizedPoints: a.points.map(p => normalizedPoint(p,record.width,record.height)) })),
    markers: (record.markers ?? []).map(m => ({ ...m, normalizedPoint: normalizedPoint(m.point,record.width,record.height) })),
    walkwayApprovals:record.walkwayApprovals??[],
    portals: (record.portals ?? []).map(p => ({ ...p,
      startNormalized: normalizedPoint(p.start, record.width, record.height),
      endNormalized: normalizedPoint(p.end, record.width, record.height),
      imagePixelSpan: segmentImageLength(p.start,p.end),
    })),
    imageOptions: record.imageOptions ?? {cleanup:"off",enhance:false},
    calibration: record.calibration ? { ...record.calibration } : null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}
