"use client";
import { useCallback, useEffect, useRef } from "react";
import type { Map as MapLibreMap, Marker as MapMarker } from "maplibre-gl";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { loadMapLibre } from "@/lib/maplibre-loader";
import {
  areaLabelPoint, doorwayRectangle, doorwayThicknessHandle, doorwayThicknessFromPointer,
  getPlaneBounds, pixelsToPlane, planeToPixels, portalMidpoint,
  proposeDoorwayPlacement,
  type PixelPoint, type FloorArea, type FloorMarker, type FloorPortal, type DoorUsage,
} from "@/lib/floor-plan";
import type { MapStatus } from "@/components/map/map-canvas";
import { landingOnFloor, type Staircase } from "@/lib/staircases";
import { verticalKind } from "@/lib/vertical-connections";
import type { MapDisplaySettings } from "@/lib/map-display-settings";
import { createNavigationPinElement, NAVIGATION_PIN_Z_INDEX } from "@/lib/navigation-pin";
import { DEVICE_DRAG_TYPE, DEVICE_MODELS, type LocationDevice } from "@/lib/location-devices";
import { cameraCoveragePolygon, previewDevicePosition, validDeviceSize } from "@/lib/device-spatial";
import { createDeviceIconElement, applyDeviceIconDimensions } from "@/lib/device-icon";


export type EditorMode = "move" | "room" | "walkable" | "door" | "camera" | "device" | "inspect" | "staircase" | "stair-landing";
type Props = {
  imageUrl: string;
  width: number;
  height: number;
  areas: FloorArea[];
  markers: FloorMarker[];
  placedDevices: LocationDevice[];
  deviceResetKey:number;
  selectedDeviceId: string | null;
  onDeviceSelect: (deviceId:string) => void;
  onDeviceResize: (deviceId:string,sizePx:number) => void;
  onDeviceDrop: (deviceId:string,point:PixelPoint) => void;
  onDeviceMove: (deviceId:string,point:PixelPoint) => void;
  portals: FloorPortal[];
  staircases: Staircase[];
  floorId: string;
  navigationSelection:{start:PixelPoint;end:PixelPoint;checkpoints:PixelPoint[];path:PixelPoint[];estimated:boolean}|null;
  navigationFocusRequest:number;
  displaySettings:MapDisplaySettings;
  drawing: PixelPoint[];
  drawingClosed: boolean;
  portalDraft: PixelPoint[];
  portalDepth: number;
  onDoorDepthChange: (depth: number) => void;
  onDoorPlace: (start: PixelPoint, end: PixelPoint, aligned: boolean) => void;
  editing: boolean;
  onVertexDragStart: () => void;
  onVertexDragMove: (index: number, point: PixelPoint) => void;
  onVertexDragEnd: () => void;
  mode: EditorMode;
  selectedPoint: PixelPoint | null;
  fitRequest: number;
  onPointClick: (point: PixelPoint) => void;
  onCloseDrawing: () => void;
  onStatusChange: (status: MapStatus) => void;
};
type Geojson = FeatureCollection<Geometry>;
const emptyData = (): Geojson => ({type:"FeatureCollection",features:[]});
const place=(p:PixelPoint,w:number,h:number)=>pixelsToPlane(p,w,h);
function imagePixelsPerScreenPixel(map:MapLibreMap,width:number,height:number):number {
  const sample=Math.min(100,width);
  const first=map.project(place({x:0,y:0},width,height));
  const second=map.project(place({x:sample,y:0},width,height));
  return sample/Math.max(.01,Math.hypot(first.x-second.x,first.y-second.y));
}
const colorForDoor=(kind:DoorUsage)=>kind==="entrance"?"#0d9488":kind==="exit"?"#e65b50":kind==="both"?"#6366f1":"#64748b";
function featuresFor(
  areas:FloorArea[],portals:FloorPortal[],staircases:Staircase[],floorId:string,
  navigationSelection:{start:PixelPoint;end:PixelPoint;checkpoints:PixelPoint[];path:PixelPoint[];estimated:boolean}|null,drawing:PixelPoint[],drawingClosed:boolean,
  portalDraft:PixelPoint[],portalDepth:number,gripClearancePx:number,mode:EditorMode, selected:PixelPoint|null,hover:PixelPoint|null,
  snapped:boolean,w:number,h:number,devices:LocationDevice[],
): Geojson {
  const features:Feature<Geometry>[]=[];
  const addLine=(category:string,points:PixelPoint[],props:Record<string,string>={})=>{
    if(points.length<2)return;
    features.push({type:"Feature",properties:{category,...props},geometry:{
      type:"LineString",coordinates:points.map(p=>place(p,w,h)),
    }});
  };
  const addDoorRect=(category:string,start:PixelPoint,end:PixelPoint,depth:number,usage:DoorUsage)=>{
    const corners=doorwayRectangle(start,end,depth);
    if(corners.length!==4)return;
    features.push({type:"Feature",properties:{category,usage},geometry:{
      type:"Polygon",coordinates:[[...corners,corners[0]].map(p=>place(p,w,h))],
    }});
  };
  const addPoint=(category:string,p:PixelPoint)=>{
    features.push({type:"Feature",properties:{category},geometry:{type:"Point",coordinates:place(p,w,h)}});
  };
  for(const device of devices){
    if(!device.point||!device.camera)continue;
    const polygon=cameraCoveragePolygon(device.point,device.camera);
    if(polygon.length<3)continue;
    features.push({type:"Feature",properties:{category:"camera-fov",id:device.uuid,shape:device.camera.shape},
      geometry:{type:"Polygon",coordinates:[[...polygon,polygon[0]].map(p=>place(p,w,h))]}});
  }
  for(const area of areas) {
    features.push({type:"Feature",properties:{category:area.kind,name:area.name,id:area.id},geometry:{
      type:"Polygon",coordinates:[[...area.points,area.points[0]].map(p=>place(p,w,h))],
    }});
  }
  if(navigationSelection){
    if(navigationSelection.path.length>=2){
      addLine(navigationSelection.estimated?"navigation-estimated-line":"navigation-guided-line",navigationSelection.path);
    }
    for(const point of navigationSelection.checkpoints)addPoint("navigation-door-checkpoint",point);
  }
  for(const door of portals) {
    addDoorRect("portal-shape",door.start,door.end,door.displayDepthPx??14,door.usage);
    addPoint("portal-end",door.start);
    addPoint("portal-end",door.end);
  }
  for(const stair of staircases) {
    const landing=landingOnFloor(stair,floorId);
    if(!landing)continue;
    features.push({type:"Feature",properties:{category:"staircase-area",name:stair.name,id:stair.id},
      geometry:{type:"Polygon",coordinates:[[...landing.outline,landing.outline[0]].map(p=>place(p,w,h))]}});
    // Older saved manual entry points are ignored; stairs/elevators need only a floor outline.
  }
  if (drawing.length>0 && (mode==="room"||mode==="walkable"||mode==="staircase")) {
    const path=drawingClosed?[...drawing,drawing[0]]:hover?[...drawing,hover]:drawing;
    addLine("draft-line",path);
    if(path.length>=3) features.push({type:"Feature",properties:{category:"draft-fill"},
      geometry:{type:"Polygon",coordinates:[[...path,path[0]].map(p=>place(p,w,h))]}});
    for(const p of drawing)addPoint("draft-point",p);
    if(drawing.length>=3 && !drawingClosed)addPoint("start-point",drawing[0]);
  }
  if(portalDraft.length>0 && mode==="door") {
    if(portalDraft.length>=2){
      addDoorRect("portal-preview-shape",portalDraft[0],portalDraft[1],portalDepth,"both");
      for(const p of portalDraft)addPoint("door-handle",p);
      const near=doorwayThicknessHandle(portalDraft[0],portalDraft[1],portalDepth,0);
      const grip=doorwayThicknessHandle(portalDraft[0],portalDraft[1],portalDepth,gripClearancePx);
      if(near&&grip){
        addLine("door-depth-guide",[near,grip]);
        addPoint("door-depth-handle",grip);
      }
    }else if(hover) addLine("portal-preview",[portalDraft[0],hover]);
    if(portalDraft.length===1)addPoint("draft-point",portalDraft[0]);
  }
  if(hover && mode!=="move"&&!drawingClosed&&!(mode==="door"&&portalDraft.length===2))
    addPoint(snapped?"snap-point":"hover-point",hover);
  if(selected)addPoint("selected-point",selected);
  return {type:"FeatureCollection",features};
}
function staircaseNameElement(name:string):HTMLElement {
  const el=document.createElement("div");
  el.textContent="↕ "+name;
  el.title=name;
  Object.assign(el.style,{
    pointerEvents:"none",userSelect:"none",fontWeight:"700",fontSize:"11px",
    lineHeight:"1.3",color:"#78350f",background:"rgba(255,251,235,.96)",
    border:"1px solid #d97706",borderRadius:"6px",padding:"3px 6px",
    maxWidth:"135px",overflowWrap:"anywhere",textAlign:"center",
  });
  return el;
}
function areaNameElement(area:FloorArea):HTMLElement {
  const el=document.createElement("div");
  // Plain text prevents markup injection from user-defined room names.
  el.textContent=area.name;
  el.title=area.name;
  el.setAttribute("aria-label",area.name);
  Object.assign(el.style,{
    pointerEvents:"none",userSelect:"none",whiteSpace:"normal",overflowWrap:"anywhere",
    textAlign:"center",fontWeight:"700",fontSize:"12px",lineHeight:"1.25",
    color:area.kind==="room"?"#1e3a8a":"#065f46",backgroundColor:"rgba(255,255,255,.92)",
    border:area.kind==="room"?"1px solid rgba(37,99,235,.55)":"1px solid rgba(21,128,93,.55)",
    borderRadius:"6px",boxShadow:"0 1px 5px #0002",
    padding:"3px 7px",maxWidth:"130px",minWidth:"24px",
  });
  return el;
}
function cameraElement(marker:FloorMarker):HTMLElement {
  const el=document.createElement("div");
  const fill=marker.kind==="camera"?"#7c3aed":marker.kind==="device"?"#ea580c":
    marker.kind==="entrance"?"#0d9488":"#e65b50";
  Object.assign(el.style,{
    width:"32px",height:"32px",borderRadius:"50%",display:"grid",placeItems:"center",
    background:fill,color:"white",border:"2px solid #ffffff",boxShadow:"0 2px 8px #0004",cursor:"default",
  });
  el.title=marker.name;
  el.setAttribute("aria-label",marker.name);
  el.innerHTML=marker.kind==="camera"
    ?'<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7.4 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3.4z"/><circle cx="12" cy="13" r="3"/></svg>'
    :marker.kind==="device"
      ?'<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M10 17h4"/></svg>'
      :'<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21V3h16v18M8 21V7l8-2v16M12 14h1"/></svg>';
  return el;
}
function doorElement(portal:FloorPortal):HTMLElement {
  const el=document.createElement("div");
  const fill=colorForDoor(portal.usage);
  Object.assign(el.style,{
    width:"25px",height:"25px",display:"grid",placeItems:"center",borderRadius:"50%",
    background:fill,color:"white",border:"2px solid #fff",boxShadow:"0 1px 6px #0004",cursor:"default",
  });
  el.title=`${portal.name} (${portal.usage})`;
  el.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h14v16H5zM9 4v16M12 13h1"/></svg>';
  return el;
}
function nearestPointOnSegment(p:PixelPoint,a:PixelPoint,b:PixelPoint):PixelPoint {
  const dx=b.x-a.x,dy=b.y-a.y;
  const denominator=dx*dx+dy*dy;
  const t=denominator===0?0:Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/denominator));
  return {x:a.x+t*dx,y:a.y+t*dy};
}
export function FloorPlanCanvas({
  imageUrl,width,height,areas,markers,placedDevices,deviceResetKey,selectedDeviceId,onDeviceSelect,onDeviceResize,onDeviceDrop,onDeviceMove,portals,staircases,floorId,navigationSelection,navigationFocusRequest,displaySettings,drawing,drawingClosed,portalDraft,portalDepth,onDoorPlace,onDoorDepthChange,mode,selectedPoint,
  fitRequest,onPointClick,onCloseDrawing,onStatusChange,
  editing,onVertexDragStart,onVertexDragMove,onVertexDragEnd,
}:Props) {
  const container=useRef<HTMLDivElement>(null);
  const mapRef=useRef<MapLibreMap|null>(null);
  const domMarkers=useRef<MapMarker[]>([]);
  const deviceMarkers=useRef<MapMarker[]>([]);
  // MapLibre marker drags update this preview without re-rendering React or
  // replacing the marker before the pointer is released.
  const deviceDragPreviewRef=useRef<{deviceId:string;point:PixelPoint}|null>(null);
  const lastResetKey=useRef(deviceResetKey);
  const deviceInteractionGenerationRef=useRef(0);
  const activeResizeCleanupRef=useRef<(()=>void)|null>(null);
  const refreshRef=useRef<()=>void>(()=>{});
  const devicesRef=useRef(placedDevices);
  const deviceDropRef=useRef(onDeviceDrop);
  const deviceMoveRef=useRef(onDeviceMove);
  const deviceSelectRef=useRef(onDeviceSelect);
  const deviceResizeRef=useRef(onDeviceResize);
  const selectedDeviceIdRef=useRef(selectedDeviceId);
  const routePins=useRef<MapMarker[]>([]);
  const hoverRef=useRef<PixelPoint|null>(null);
  const snappedRef=useRef(false);
  const onClickRef=useRef(onPointClick);
  const onDoorPlaceRef=useRef(onDoorPlace);
  const onDepthChangeRef=useRef(onDoorDepthChange);
  const onCloseRef=useRef(onCloseDrawing);
  const statusRef=useRef(onStatusChange);
  const modeRef=useRef(mode);
  const editingRef=useRef(editing);
  const dragIndexRef=useRef<number|null>(null);
  const dragMovedRef=useRef(false);
  const dragBodyOriginRef=useRef<{pointer:PixelPoint;start:PixelPoint;end:PixelPoint}|null>(null);
  const swallowClickRef=useRef(false);
  const dragHandlersRef=useRef({onVertexDragStart,onVertexDragMove,onVertexDragEnd});
  const latest=useRef({areas,markers,portals,staircases,floorId,navigationSelection,drawing,drawingClosed,portalDraft,portalDepth,selectedPoint,mode,placedDevices});
  const settingsRef=useRef(displaySettings);
  useEffect(()=>{
    devicesRef.current=placedDevices;
    deviceDropRef.current=onDeviceDrop;
    deviceMoveRef.current=onDeviceMove;
    deviceSelectRef.current=onDeviceSelect;
    deviceResizeRef.current=onDeviceResize;
    selectedDeviceIdRef.current=selectedDeviceId;
  },[placedDevices,onDeviceDrop,onDeviceMove,onDeviceSelect,onDeviceResize,selectedDeviceId]);
  const syncDeviceMarkerDimensions=useCallback((map:MapLibreMap)=>{
    const screenPixelsPerFloorPixel=1/imagePixelsPerScreenPixel(map,width,height);
    for(const marker of deviceMarkers.current){
      const el=marker.getElement();
      const device=devicesRef.current.find(item=>item.uuid===el.dataset.deviceUuid);
      if(device&&el.dataset.deviceResizing!=="true")
        applyDeviceIconDimensions(el,device.type,device.sizePx,screenPixelsPerFloorPixel);
    }
  },[width,height]);
  const updateDeviceMarkers=useCallback((
    map:MapLibreMap,lib:Awaited<ReturnType<typeof loadMapLibre>>,items:LocationDevice[],
  )=>{
    deviceMarkers.current.forEach(marker=>marker.remove());
    deviceMarkers.current=[];
    if(!settingsRef.current.deviceMarkers)return;
    for(const device of items){
      if(!device.point)continue;
      const model=DEVICE_MODELS.find(candidate=>candidate.type===device.type);
      if(!model)continue;
      const element=createDeviceIconElement(device.type,model.icon,device.name);
      element.title=device.name+" · "+device.uuid+" · Drag to move or use the bottom grip to resize";
      element.dataset.deviceUuid=device.uuid;
      element.style.cursor="grab";
      applyDeviceIconDimensions(element,device.type,device.sizePx,
        1/imagePixelsPerScreenPixel(map,width,height));
      if(selectedDeviceIdRef.current===device.uuid){
        element.style.filter="drop-shadow(0 0 2px #6d28d9)";
        const grip=document.createElement("button");
        grip.type="button";
        grip.title="Drag to resize device proportionally (floor-image units)";
        grip.setAttribute("aria-label","Resize "+device.name);
        Object.assign(grip.style,{
          position:"absolute",left:"50%",bottom:"-7px",width:"12px",height:"12px",
          transform:"translateX(-50%)",
          border:"1px solid white",borderRadius:"50%",background:"#7c3aed",
          boxShadow:"none",cursor:"ns-resize",touchAction:"none",
        });
        // Prevent the marker's own mousedown drag handler from also grabbing
        // the icon when the dedicated resize grip is used.
        grip.addEventListener("mousedown",event=>{event.preventDefault();event.stopPropagation();});
        grip.addEventListener("pointerdown",event=>{
          event.preventDefault();
          event.stopPropagation();
          const generation=deviceInteractionGenerationRef.current;
          const startX=event.clientX,startY=event.clientY,initial=device.sizePx;
          const panEnabled=map.dragPan.isEnabled();
          if(panEnabled)map.dragPan.disable();
          element.dataset.deviceResizing="true";
          let size=initial;
          const move=(pointer:PointerEvent)=>{
            if(generation!==deviceInteractionGenerationRef.current)return;
            const scale=1/imagePixelsPerScreenPixel(map,width,height);
            // Pointer deltas are in screen pixels; convert to floor-image units.
            size=Math.round(Math.max(16,Math.min(160,
              initial+Math.max(pointer.clientX-startX,pointer.clientY-startY)/scale)));
            applyDeviceIconDimensions(element,device.type,size,scale);
          };
          const end=(commit:boolean)=>{
            window.removeEventListener("pointermove",move);
            window.removeEventListener("pointerup",commitEnd);
            window.removeEventListener("pointercancel",cancelEnd);
            activeResizeCleanupRef.current=null;
            delete element.dataset.deviceResizing;
            if(panEnabled)map.dragPan.enable();
            if(commit&&generation===deviceInteractionGenerationRef.current&&
              validDeviceSize(size)&&size!==initial)deviceResizeRef.current(device.uuid,size);
            else applyDeviceIconDimensions(element,device.type,initial,
              1/imagePixelsPerScreenPixel(map,width,height));
          };
          const commitEnd=()=>end(true);
          const cancelEnd=()=>end(false);
          activeResizeCleanupRef.current=cancelEnd;
          window.addEventListener("pointermove",move);
          window.addEventListener("pointerup",commitEnd);
          window.addEventListener("pointercancel",cancelEnd);
        });
        element.appendChild(grip);
      }
      element.addEventListener("click",event=>{
        event.stopPropagation();
        deviceSelectRef.current(device.uuid);
      });
      const interactionGeneration=deviceInteractionGenerationRef.current;
      const marker=new lib.Marker({element,anchor:"center",draggable:true})
        .setLngLat(place(device.point,width,height)).addTo(map);
      // Explicitly layer the device over the raster and all mapped geometry,
      // but keep navigation start/end pins above it.
      marker.getElement().style.zIndex=String(NAVIGATION_PIN_Z_INDEX-1);
      marker.on("drag",()=>{
        if(interactionGeneration!==deviceInteractionGenerationRef.current)return;
        const point=planeToPixels(marker.getLngLat(),width,height);
        if(!point)return;
        deviceDragPreviewRef.current={deviceId:device.uuid,point};
        refreshRef.current(); // Live FOV translation while the SVG moves.
      });
      marker.on("dragend",()=>{
        if(interactionGeneration!==deviceInteractionGenerationRef.current)return;
        const point=planeToPixels(marker.getLngLat(),width,height);
        if(point){
          // The inventory position is persisted only on release. Leave the
          // preview active until React receives that updated position.
          deviceDragPreviewRef.current={deviceId:device.uuid,point};
          deviceMoveRef.current(device.uuid,point);
        }else{
          deviceDragPreviewRef.current=null;
          marker.setLngLat(place(device.point!,width,height));
          refreshRef.current();
        }
      });
      deviceMarkers.current.push(marker);
    }
  },[width,height]);

  useEffect(()=>{
    onClickRef.current=onPointClick;
    onDoorPlaceRef.current=onDoorPlace;
    onDepthChangeRef.current=onDoorDepthChange;
    onCloseRef.current=onCloseDrawing;
    statusRef.current=onStatusChange;
    dragHandlersRef.current={onVertexDragStart,onVertexDragMove,onVertexDragEnd};
    editingRef.current=editing;
  },[onPointClick,onDoorPlace,onDoorDepthChange,onCloseDrawing,onStatusChange,onVertexDragStart,onVertexDragMove,onVertexDragEnd,editing]);
  const refresh=useCallback(()=>{
    const map=mapRef.current;
    if(!map)return;
    const src=map.getSource("annotations") as import("maplibre-gl").GeoJSONSource|undefined;
    if(!src)return;
    const d=latest.current;
    const preview=deviceDragPreviewRef.current;
    const liveDevices=preview
      ? previewDevicePosition(d.placedDevices,preview.deviceId,preview.point)
      : d.placedDevices;
    src.setData(featuresFor(d.areas,d.portals,d.staircases,d.floorId,settingsRef.current.guideLine?d.navigationSelection:null,d.drawing,d.drawingClosed,d.portalDraft,d.portalDepth,
      24*imagePixelsPerScreenPixel(map,width,height),d.mode,
      d.selectedPoint,hoverRef.current,snappedRef.current,width,height,liveDevices));
  },[width,height]);
  useEffect(()=>{refreshRef.current=refresh;},[refresh]);
  const updateLayers=useCallback((map:MapLibreMap,settings:MapDisplaySettings)=>{
    const toggle=(id:string,enabled:boolean)=>{
      if(map.getLayer(id))map.setLayoutProperty(id,"visibility",enabled?"visible":"none");
    };
    toggle("room-fill",settings.roomColors);
    toggle("room-outline",settings.roomColors);
    toggle("walking-fill",settings.walkingColors);
    toggle("walking-outline",settings.walkingColors);
    toggle("door-overlay",settings.doorwayShapes);
    toggle("door-border",settings.doorwayShapes);
    toggle("door-ends",settings.doorwayShapes);
    toggle("camera-fov-fill",settings.deviceMarkers);
    toggle("camera-fov-outline",settings.deviceMarkers);
    for(const id of ["navigation-walking-line","navigation-walking-halo",
      "navigation-selected-doorways"])
      toggle(id,settings.guideLine);
  },[]);
  useEffect(()=>{
    settingsRef.current=displaySettings;
    const map=mapRef.current;
    if(map&&map.isStyleLoaded())updateLayers(map,displaySettings);
    refresh();
  },[displaySettings,refresh,updateLayers]);
  useEffect(()=>{
    modeRef.current=mode;
    const map=mapRef.current;
    if(map) {
      map.getCanvas().style.cursor=mode==="move"?"grab":"crosshair";
      map.dragPan[mode==="move"?"enable":"disable"]();
      map.doubleClickZoom[mode==="move"?"enable":"disable"]();
    }
    hoverRef.current=null;snappedRef.current=false;
    swallowClickRef.current=false;
    refresh();
  },[mode,refresh]); // Annotation values refresh below.
  useEffect(()=>{
    const preview=deviceDragPreviewRef.current;
    if(preview&&placedDevices.some(device=>device.uuid===preview.deviceId&&device.point&&
      device.point.x===preview.point.x&&device.point.y===preview.point.y)){
      deviceDragPreviewRef.current=null;
    }
    latest.current={areas,markers,portals,staircases,floorId,navigationSelection,drawing,drawingClosed,portalDraft,portalDepth,selectedPoint,mode,placedDevices};
    refresh();
  },[areas,markers,portals,staircases,floorId,navigationSelection,drawing,drawingClosed,portalDraft,portalDepth,selectedPoint,mode,placedDevices,refresh]);
  useEffect(()=>{
    if(lastResetKey.current===deviceResetKey)return;
    lastResetKey.current=deviceResetKey;
    // Cancel MUST clear transient MapLibre drag/resize state as well as React
    // inventory state. Otherwise an abandoned drag preview keeps drawing FOV.
    deviceInteractionGenerationRef.current++;
    activeResizeCleanupRef.current?.();
    activeResizeCleanupRef.current=null;
    deviceDragPreviewRef.current=null;
    const map=mapRef.current;
    if(!map)return;
    refresh();
    let disposed=false;
    void loadMapLibre().then(lib=>{
      if(!disposed&&mapRef.current===map)
        updateDeviceMarkers(map,lib,devicesRef.current);
    });
    return ()=>{disposed=true;};
  },[deviceResetKey,refresh,updateDeviceMarkers]);

  // Changing the cone angle, radius, or other FOV settings should redraw
  // coverage only. Recreating the SVG marker during these edits causes visible
  // jitter and can interfere with dragging/zooming the indoor floor.
  const deviceMarkerPositionsKey=placedDevices.map(device=>
    [device.uuid,device.type,device.point?.x,device.point?.y,device.sizePx].join(":")
  ).join("|");
  useEffect(()=>{
    const map=mapRef.current;
    // DOM markers are independent of GeoJSON tile loading. Reconcile only
    // when placement, icon dimensions, selection or visibility truly changes.
    if(!map)return;
    let disposed=false;
    void loadMapLibre().then(lib=>{
      if(!disposed&&mapRef.current===map)
        updateDeviceMarkers(map,lib,devicesRef.current);
    });
    return ()=>{disposed=true;};
  },[deviceMarkerPositionsKey,selectedDeviceId,displaySettings.deviceMarkers,updateDeviceMarkers]);
  const updateRoutePins=useCallback((
    map:MapLibreMap,lib:Awaited<ReturnType<typeof loadMapLibre>>,
    selection:Props["navigationSelection"],show:boolean,
  )=>{
    routePins.current.forEach(marker=>marker.remove());
    routePins.current=[];
    if(!selection||!show)return;
    for(const kind of ["start","end"] as const){
      const point=kind==="start"?selection.start:selection.end;
      const element=createNavigationPinElement(kind);
      const marker=new lib.Marker({element,anchor:"center"})
        .setLngLat(place(point,width,height))
        .addTo(map);
      // Both route markers are DOM overlays, so unlike a MapLibre style layer
      // they can sit over doorway icons. Set z-index on the actual marker root
      // (not an inner SVG) and append the markers after ordinary map markers.
      marker.getElement().style.zIndex=String(NAVIGATION_PIN_Z_INDEX);
      routePins.current.push(marker);
    }
  },[width,height]);

  useEffect(()=>{
    const map=mapRef.current;
    if(!map)return;
    let disposed=false;
    void loadMapLibre().then(lib=>{
      if(disposed||mapRef.current!==map)return;
      updateRoutePins(map,lib,navigationSelection,displaySettings.guideLine);
    });
    return ()=>{disposed=true;};
  },[navigationSelection,displaySettings.guideLine,updateRoutePins]);

  useEffect(()=>{
    const map=mapRef.current;
    if(!map)return;
    let disposed=false;
    void loadMapLibre().then(lib=>{
      if(disposed||mapRef.current!==map)return;
      domMarkers.current.forEach(m=>m.remove());
      domMarkers.current=[];
      for(const area of areas) {
        if(!displaySettings.roomLabels||!area.points.length||!area.name.trim())continue;
        const anchor=areaLabelPoint(area.points);
        domMarkers.current.push(new lib.Marker({element:areaNameElement(area),anchor:"center"})
          .setLngLat(place(anchor,width,height)).addTo(map));
      }
      for(const stair of staircases) {
        if(!displaySettings.stairLabels)continue;
        const landing=landingOnFloor(stair,floorId);
        if(!landing)continue;
        domMarkers.current.push(new lib.Marker({element:staircaseNameElement(`${verticalKind(stair)==="elevator"?"🛗 ":"↕ "}${stair.name}`),anchor:"center"})
          .setLngLat(place(areaLabelPoint(landing.outline),width,height)).addTo(map));
      }
      for(const marker of markers) {
        if(["entrance","exit"].includes(marker.kind)?!displaySettings.entranceExitMarkers:!displaySettings.deviceMarkers)continue;
        domMarkers.current.push(new lib.Marker({element:cameraElement(marker),anchor:"center"})
          .setLngLat(place(marker.point,width,height)).addTo(map));
      }
      for(const portal of portals) {
        if(!displaySettings.doorwayIcons)continue;
        domMarkers.current.push(new lib.Marker({element:doorElement(portal),anchor:"center"})
          .setLngLat(place(portalMidpoint(portal),width,height)).addTo(map));
      }
    });
    return ()=>{disposed=true};
  },[areas,markers,portals,staircases,floorId,width,height,displaySettings]);
  useEffect(()=>{
    let cancelled=false;
    let observer:ResizeObserver|undefined;
    let instance:MapLibreMap|null=null;
    let cleanupPointerListeners:()=>void=()=>{};
    void (async()=>{
      try {
        const lib=await loadMapLibre();
        if(cancelled||!container.current)return;
        const {halfWidth,halfHeight}=getPlaneBounds(width,height);
        const map=new lib.Map({
          container:container.current,
          style:{
            version:8,projection:{type:"identity"},
            sources:{
              plan:{type:"image",url:imageUrl,coordinates:[
                [-halfWidth,halfHeight],[halfWidth,halfHeight],[halfWidth,-halfHeight],[-halfWidth,-halfHeight],
              ]},
              annotations:{type:"geojson",data:emptyData()},
            },
            layers:[
              {id:"background",type:"background",paint:{"background-color":"#ffffff"}},
              {id:"image",type:"raster",source:"plan",paint:{"raster-resampling":"linear"}},
              {id:"camera-fov-fill",type:"fill",source:"annotations",
                filter:["==",["get","category"],"camera-fov"],
                paint:{"fill-color":"#7c3aed","fill-opacity":0.15}},
              {id:"camera-fov-outline",type:"line",source:"annotations",
                filter:["==",["get","category"],"camera-fov"],
                paint:{"line-color":"#7c3aed","line-width":2.3,"line-opacity":0.8}},
              {id:"walking-fill",type:"fill",source:"annotations",filter:["==",["get","category"],"walkable"],
                paint:{"fill-color":"#17a878","fill-opacity":.20}},
              {id:"room-fill",type:"fill",source:"annotations",filter:["==",["get","category"],"room"],
                paint:{"fill-color":"#3b82f6","fill-opacity":.15}},
              {id:"room-outline",type:"line",source:"annotations",
                filter:["==",["get","category"],"room"],
                paint:{"line-color":"#2563eb","line-width":2.5}},
              {id:"walking-outline",type:"line",source:"annotations",
                filter:["==",["get","category"],"walkable"],
                paint:{"line-color":"#15825d","line-width":2.5}},
              {id:"staircase-fill",type:"fill",source:"annotations",
                filter:["==",["get","category"],"staircase-area"],
                paint:{"fill-color":"#fbbf24","fill-opacity":.26}},
              {id:"staircase-border",type:"line",source:"annotations",
                filter:["==",["get","category"],"staircase-area"],
                paint:{"line-color":"#b45309","line-width":3,"line-dasharray":[2,1]}},
              {id:"staircase-entry",type:"circle",source:"annotations",
                filter:["==",["get","category"],"staircase-entry"],
                paint:{"circle-radius":7,"circle-color":"#f97316","circle-stroke-color":"#fff","circle-stroke-width":2}},
              {id:"door-overlay",type:"fill",source:"annotations",
                filter:["in",["get","category"],["literal",["portal-shape","portal-preview-shape"]]],
                paint:{"fill-color":["match",["get","category"],"portal-preview-shape","#a5b4fc","#818cf8"],
                  "fill-opacity":0.42}},
              {id:"door-border",type:"line",source:"annotations",
                filter:["in",["get","category"],["literal",["portal-shape","portal-preview-shape"]]],
                paint:{"line-color":["match",["get","usage"],"entrance","#0d9488","exit","#e65b50",
                  "both","#4f46e5","#64748b"],"line-width":2.5}},
              {id:"door-ends",type:"circle",source:"annotations",filter:["==",["get","category"],"portal-end"],
                paint:{"circle-radius":5,"circle-color":"#fff","circle-stroke-color":"#374151","circle-stroke-width":1.5}},
              {id:"draft-fill",type:"fill",source:"annotations",filter:["==",["get","category"],"draft-fill"],
                paint:{"fill-color":"#f59e0b","fill-opacity":.13}},
              {id:"draft-lines",type:"line",source:"annotations",
                filter:["in",["get","category"],["literal",["draft-line","portal-preview"]]],
                paint:{"line-color":"#e29a18","line-width":3,"line-dasharray":[2,1]}},
              {id:"door-depth-guide",type:"line",source:"annotations",
                filter:["==",["get","category"],"door-depth-guide"],
                paint:{"line-color":"#2563eb","line-width":2,"line-dasharray":[2,1]}},
              {id:"door-depth-handle",type:"circle",source:"annotations",
                filter:["==",["get","category"],"door-depth-handle"],
                paint:{"circle-radius":9,"circle-color":"#2563eb",
                  "circle-stroke-color":"#fff","circle-stroke-width":2.5}},
              {id:"door-resize-handles",type:"circle",source:"annotations",
                filter:["==",["get","category"],"door-handle"],
                paint:{"circle-radius":7,"circle-color":"#facc15","circle-stroke-color":"#312e81","circle-stroke-width":2}},
              {id:"draft-vertices",type:"circle",source:"annotations",filter:["==",["get","category"],"draft-point"],
                paint:{"circle-radius":6,"circle-color":"#f59e0b","circle-stroke-color":"#fff","circle-stroke-width":2}},
              {id:"start-vertex",type:"circle",source:"annotations",filter:["==",["get","category"],"start-point"],
                paint:{"circle-radius":9,"circle-color":"#22c55e","circle-stroke-color":"white","circle-stroke-width":2}},
              {id:"hover-vertex",type:"circle",source:"annotations",
                filter:["in",["get","category"],["literal",["hover-point","snap-point","selected-point"]]],
                paint:{"circle-radius":["match",["get","category"],"snap-point",8,5],
                  "circle-color":["match",["get","category"],"snap-point","#16a34a","selected-point","#2563eb","#f59e0b"],
                  "circle-stroke-color":"white","circle-stroke-width":2}},
              {id:"navigation-walking-halo",type:"line",source:"annotations",
                filter:["in",["get","category"],["literal",["navigation-guided-line","navigation-estimated-line"]]],
                layout:{"line-cap":"round","line-join":"round"},
                paint:{"line-color":"#ffffff","line-width":9,"line-opacity":.95}},
              {id:"navigation-walking-line",type:"line",source:"annotations",
                filter:["in",["get","category"],["literal",["navigation-guided-line","navigation-estimated-line"]]],
                layout:{"line-cap":"round","line-join":"round"},
                paint:{"line-color":"#e11d30","line-width":5,"line-opacity":.98}},
              {id:"navigation-selected-doorways",type:"circle",source:"annotations",
                filter:["==",["get","category"],"navigation-door-checkpoint"],
                paint:{"circle-color":"#7c3aed","circle-radius":8,
                  "circle-stroke-color":"#ffffff","circle-stroke-width":3}},
            ],
          },
          center:[0,0],zoom:0,minZoom:-2,maxZoom:19,maxPitch:0,dragRotate:false,
        });
        instance=map;
        mapRef.current=map;
        map.getCanvas().style.cursor=modeRef.current==="move"?"grab":"crosshair";
        if(modeRef.current!=="move"){map.dragPan.disable();map.doubleClickZoom.disable()}
        map.addControl(new lib.NavigationControl({showCompass:false}),"top-right");
        const fitPlan=()=>{
          const available=container.current?.clientWidth??500;
          const padding=Math.min(48,Math.max(12,Math.floor(available*.08)));
          map.fitBounds([[-halfWidth,-halfHeight],[halfWidth,halfHeight]],{padding,duration:0,maxZoom:8});
        };
        map.on("zoom",()=>{
          // The device's size remains constant in original floor-image pixels.
          // Only the projected DOM footprint changes with map zoom.
          syncDeviceMarkerDimensions(map);
          refresh();
        });
        map.on("resize",()=>syncDeviceMarkerDimensions(map));
        map.on("load",()=>{
          if(cancelled)return;
          fitPlan();
          updateLayers(map,settingsRef.current);
          refresh();
          // When switching to another floor during a multi-floor route, focus its
          // already-selected path as soon as MapLibre finishes loading.
          const selectedRoute=latest.current.navigationSelection;
          if(selectedRoute&&selectedRoute.path.length>1){
            const coords=selectedRoute.path.map(p=>place(p,width,height));
            const xs=coords.map(c=>c[0]),ys=coords.map(c=>c[1]);
            map.fitBounds([
              [Math.min(...xs),Math.min(...ys)],
              [Math.max(...xs),Math.max(...ys)],
            ],{padding:90,duration:0,maxZoom:9});
          }
          // DOM icons attach only after the new map is available.
          const data=latest.current;
          domMarkers.current.forEach(m=>m.remove());
          domMarkers.current=[];
          for(const area of data.areas) {
            if(!settingsRef.current.roomLabels||!area.points.length||!area.name.trim())continue;
            domMarkers.current.push(new lib.Marker({element:areaNameElement(area),anchor:"center"})
              .setLngLat(place(areaLabelPoint(area.points),width,height)).addTo(map));
          }
          for(const stair of data.staircases) {
            if(!settingsRef.current.stairLabels)continue;
            const landing=landingOnFloor(stair,data.floorId);
            if(!landing)continue;
            domMarkers.current.push(new lib.Marker({element:staircaseNameElement(stair.name),anchor:"center"})
              .setLngLat(place(areaLabelPoint(landing.outline),width,height)).addTo(map));
          }
          for(const marker of data.markers) {
            if(["entrance","exit"].includes(marker.kind)?!settingsRef.current.entranceExitMarkers:!settingsRef.current.deviceMarkers)continue;
            domMarkers.current.push(new lib.Marker({element:cameraElement(marker),anchor:"center"})
              .setLngLat(place(marker.point,width,height)).addTo(map));
          }
          for(const portal of data.portals) {
            if(!settingsRef.current.doorwayIcons)continue;
            domMarkers.current.push(new lib.Marker({element:doorElement(portal),anchor:"center"})
              .setLngLat(place(portalMidpoint(portal),width,height)).addTo(map));
          }
          // Always mount route pins last, above doorway, camera and area labels.
          updateRoutePins(map,lib,data.navigationSelection,settingsRef.current.guideLine);
          updateDeviceMarkers(map,lib,devicesRef.current);
          statusRef.current("ready");
        });
        const snap=(candidate:PixelPoint,forClick=false)=>{
          let best=candidate, bestDistance=forClick?13:14, snapped=false,closing=false;
          const data=latest.current;
          const candidateScreen=map.project(place(candidate,width,height));
          const test=(p:PixelPoint,closes=false)=>{
            const screen=map.project(place(p,width,height));
            const distance=Math.hypot(candidateScreen.x-screen.x,candidateScreen.y-screen.y);
            if(distance<bestDistance){best=p;bestDistance=distance;snapped=true;closing=closes}
          };
          if((data.mode==="room"||data.mode==="walkable"||data.mode==="staircase")&&data.drawing.length>=3&&!data.drawingClosed) {
            // The closing vertex takes precedence over saved-geometry snapping.
            const first=map.project(place(data.drawing[0],width,height));
            if(Math.hypot(candidateScreen.x-first.x,candidateScreen.y-first.y)<15) {
              return {point:data.drawing[0],snapped:true,closing:true};
            }
          }
          if(data.mode==="room"||data.mode==="walkable"||data.mode==="staircase"||data.mode==="door") {
            for(const area of data.areas) {
              for(const p of area.points)test(p);
              if(data.mode==="door") {
                for(let i=0;i<area.points.length;i++) {
                  test(nearestPointOnSegment(candidate,area.points[i],area.points[(i+1)%area.points.length]));
                }
              }
            }
          }
          if(data.mode==="door"&&data.portalDraft.length>0) {
            // Prevent both door endpoints from occupying the same pixel.
            const start=data.portalDraft[0];
            if(Math.hypot(candidate.x-start.x,candidate.y-start.y)<1) {
              return {point:candidate,snapped:false,closing:false};
            }
          }
          return {point:best,snapped,closing};
        };
        map.on("mousedown", event => {
          if(event.originalEvent.button!==0)return;
          const tool=modeRef.current;
          if(tool!=="room"&&tool!=="walkable"&&tool!=="staircase"&&tool!=="door")return;
          const isDoor=tool==="door"&&latest.current.portalDraft.length===2;
          if(!editingRef.current&&!isDoor)return;
          const vertices=tool==="door"?latest.current.portalDraft:latest.current.drawing;
          const screen=event.point;
          let nearest=-1,nearestDistance=15;
          vertices.forEach((p,i)=>{
            const v=map.project(place(p,width,height));
            const distance=Math.hypot(v.x-screen.x,v.y-screen.y);
            if(distance<nearestDistance){nearestDistance=distance;nearest=i;}
          });
          // Dedicated thickness handle is outside the rectangle: prioritize it over
          // grabbing the body/endpoint handles (especially when zoomed out).
          if(isDoor){
            const grip=doorwayThicknessHandle(
              vertices[0],vertices[1],latest.current.portalDepth,
              24*imagePixelsPerScreenPixel(map,width,height),
            );
            if(grip){
              const screenGrip=map.project(place(grip,width,height));
              if(Math.hypot(screen.x-screenGrip.x,screen.y-screenGrip.y)<16)nearest=-2;
            }
          }
          let bodyOrigin:null|{pointer:PixelPoint;start:PixelPoint;end:PixelPoint}=null;
          if(isDoor&&nearest===-1){
            const start=map.project(place(vertices[0],width,height));
            const end=map.project(place(vertices[1],width,height));
            const projection=nearestPointOnSegment(screen,start,end);
            if(Math.hypot(screen.x-projection.x,screen.y-projection.y)<18) {
              const pointer=planeToPixels(event.lngLat,width,height);
              if(pointer)bodyOrigin={pointer,start:vertices[0],end:vertices[1]};
              nearest=-1; // -1 denotes dragging the entire rectangle
            }
          }
          if(nearest===-1&&!bodyOrigin)return;
          swallowClickRef.current=false;
          dragBodyOriginRef.current=bodyOrigin;
          dragIndexRef.current=nearest;
          dragMovedRef.current=false;
          if(nearest!==-2)dragHandlersRef.current.onVertexDragStart();
          map.getCanvas().style.cursor=nearest===-2?"ns-resize":"grabbing";
          event.preventDefault();
        });
        const finishDrag=()=>{
          if(dragIndexRef.current===null)return;
          const index=dragIndexRef.current;
          dragIndexRef.current=null;
          dragBodyOriginRef.current=null;
          if(index!==-2)dragHandlersRef.current.onVertexDragEnd();
          map.getCanvas().style.cursor="crosshair";
          // A drag may synthesize a click; it must never add another polygon vertex.
          if(dragMovedRef.current)swallowClickRef.current=true;
        };
        window.addEventListener("mouseup",finishDrag);
        map.on("mousemove",event=>{
          const tool=modeRef.current;
          if(tool==="move")return;
          const raw=planeToPixels(event.lngLat,width,height);
          if(dragIndexRef.current!==null) {
            if(!raw)return;
            if(dragIndexRef.current===-2){
              const vertices=latest.current.portalDraft;
              if(vertices.length!==2)return;
              const pxPerScreen=imagePixelsPerScreenPixel(map,width,height);
              const depth=doorwayThicknessFromPointer(
                vertices[0],vertices[1],raw,24*pxPerScreen,
              );
              onDepthChangeRef.current(depth);
              dragMovedRef.current=true;
              hoverRef.current=null;
              return;
            }
            const body=dragBodyOriginRef.current;
            if(body) {
              const minX=Math.min(body.start.x,body.end.x),maxX=Math.max(body.start.x,body.end.x);
              const minY=Math.min(body.start.y,body.end.y),maxY=Math.max(body.start.y,body.end.y);
              const dx=Math.max(-minX,Math.min(width-maxX,raw.x-body.pointer.x));
              const dy=Math.max(-minY,Math.min(height-maxY,raw.y-body.pointer.y));
              dragHandlersRef.current.onVertexDragMove(0,{x:body.start.x+dx,y:body.start.y+dy});
              dragHandlersRef.current.onVertexDragMove(1,{x:body.end.x+dx,y:body.end.y+dy});
            }else{
              const point=snap(raw).point;
              dragHandlersRef.current.onVertexDragMove(dragIndexRef.current,point);
            }
            dragMovedRef.current=true;
            hoverRef.current=null;
            return;
          }
          if(latest.current.drawingClosed)return;
          if(!raw){hoverRef.current=null;snappedRef.current=false;refresh();return;}
          const result=snap(raw);
          hoverRef.current=result.point;snappedRef.current=result.snapped;
          map.getCanvas().style.cursor=result.closing?"pointer":"crosshair";
          refresh();
        });
        map.getCanvas().addEventListener("mouseleave",()=>{
          if(dragIndexRef.current!==null)return;
          hoverRef.current=null;snappedRef.current=false;refresh();
        });
        map.on("click",event=>{
          if(swallowClickRef.current){swallowClickRef.current=false;return;}
          if(dragIndexRef.current!==null||modeRef.current==="move"||latest.current.drawingClosed)return;
          const raw=planeToPixels(event.lngLat,width,height);
          if(!raw)return;
          if(modeRef.current==="door"){
            // A single click places a door. Room outlines determine automatic wall alignment.
            // A second click elsewhere moves it; dragging the rectangle or handles fine-tunes it.
            const origin=map.project(place({x:0,y:0},width,height));
            const next=map.project(place({x:Math.min(width,100),y:0},width,height));
            const imagePixelsPerScreenPixel=Math.min(width,100)/
              Math.max(0.01,Math.hypot(next.x-origin.x,next.y-origin.y));
            const existing=latest.current.portalDraft;
            const currentWidth=existing.length===2?
              Math.hypot(existing[1].x-existing[0].x,existing[1].y-existing[0].y):null;
            const proposed=proposeDoorwayPlacement(
              raw,latest.current.areas,
              currentWidth??Math.max(12,Math.min(85,48*imagePixelsPerScreenPixel)),
              Math.max(8,Math.min(70,28*imagePixelsPerScreenPixel)),
            );
            onDoorPlaceRef.current(proposed.start,proposed.end,proposed.aligned);
            hoverRef.current=null;refresh();return;
          }
          const result=snap(raw,true);
          if(result.closing){onCloseRef.current();hoverRef.current=null;refresh();return;}
          onClickRef.current(result.point);
        });
        cleanupPointerListeners=()=>window.removeEventListener("mouseup",finishDrag);
        map.on("error",event=>{
          console.error("Indoor MapLibre error:",event.error);
          if(!map.isStyleLoaded())statusRef.current("error");
        });
        observer=new ResizeObserver(()=>map.resize());
        observer.observe(container.current);
      } catch(err) {
        console.error("Unable to initialize indoor map:",err);
        if(!cancelled)statusRef.current("error");
      }
    })();
    return ()=>{
      cancelled=true;
      observer?.disconnect();
      cleanupPointerListeners();
      domMarkers.current.forEach(m=>m.remove());
      domMarkers.current=[];
      deviceInteractionGenerationRef.current++;
      activeResizeCleanupRef.current?.();
      activeResizeCleanupRef.current=null;
      deviceDragPreviewRef.current=null;
      deviceMarkers.current.forEach(m=>m.remove());
      deviceMarkers.current=[];
      routePins.current.forEach(m=>m.remove());
      routePins.current=[];
      instance?.remove();
      if(mapRef.current===instance)mapRef.current=null;
    };
  },[imageUrl,width,height,refresh,updateLayers,updateRoutePins,updateDeviceMarkers,syncDeviceMarkerDimensions]);
  useEffect(()=>{
    if(fitRequest===0)return;
    const map=mapRef.current;
    if(!map)return;
    const {halfWidth,halfHeight}=getPlaneBounds(width,height);
    const padding=Math.min(48,Math.max(12,Math.floor((container.current?.clientWidth??500)*.08)));
    map.fitBounds([[-halfWidth,-halfHeight],[halfWidth,halfHeight]],{padding,duration:300,maxZoom:8});
  },[fitRequest,width,height]);
  useEffect(()=>{
    if(navigationFocusRequest===0||!navigationSelection)return;
    const map=mapRef.current;
    if(!map||!map.loaded())return;
    const pts=navigationSelection.path.length>1?navigationSelection.path:
      [navigationSelection.start,navigationSelection.end];
    const x0=Math.max(0,Math.min(...pts.map(p=>p.x))-25);
    const x1=Math.min(width,Math.max(...pts.map(p=>p.x))+25);
    const y0=Math.max(0,Math.min(...pts.map(p=>p.y))-25);
    const y1=Math.min(height,Math.max(...pts.map(p=>p.y))+25);
    const a=place({x:x0,y:y0},width,height),b=place({x:x1,y:y1},width,height);
    map.fitBounds([a,b],{padding:90,duration:350,maxZoom:9});
  },[navigationFocusRequest,navigationSelection,width,height]);
  return <div ref={container} role="application"
    onDragOver={event=>{
      if(Array.from(event.dataTransfer.types).includes(DEVICE_DRAG_TYPE)){
        event.preventDefault();
        event.dataTransfer.dropEffect="move";
      }
    }}
    onDrop={event=>{
      const deviceId=event.dataTransfer.getData(DEVICE_DRAG_TYPE);
      if(!deviceId)return;
      event.preventDefault();
      const map=mapRef.current;
      if(!map)return;
      const rect=map.getCanvas().getBoundingClientRect();
      const coords=map.unproject([event.clientX-rect.left,event.clientY-rect.top]);
      const point=planeToPixels(coords,width,height);
      if(point)deviceDropRef.current(deviceId,point);
    }}
    aria-label="Floor-plan editor: draw room, stairs and elevator outlines; preview routes through mapped corridors and doorways"
    className="absolute inset-0 h-full w-full"/>;
}
