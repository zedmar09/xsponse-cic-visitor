"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  floorImageCorners,floorPlacementError,floorResizeHandlePoints,floorRotationHandle,
  resizeFloorFromHandle,rotateFloorFromHandle,skewFloorFromHandle,
  type OutdoorFloorPlacement,
} from "@/lib/outdoor-floor-placement";
import type { Map as MapLibreMap, Marker as MapLibreMarker, MapMouseEvent, ImageSource, GeoJSONSource, FilterSpecification } from "maplibre-gl";
import type { FloorArea, FloorMarker, FloorPortal } from "@/lib/floor-plan";
import { DEVICE_MODELS, type LocationDevice } from "@/lib/location-devices";
import { createDeviceIconElement, applyDeviceIconDimensions } from "@/lib/device-icon";
import { indoorPointToLngLat } from "@/lib/outdoor-indoor-geometry";
import {
  outdoorIndoorFeatures,inspectOutdoorIndoorFeature,
  type OutdoorFloorLanding,type OutdoorIndoorInspection,
} from "@/lib/outdoor-indoor-geometry";
import { outdoorLocationFromMapPoint, type OutdoorLocation } from "@/lib/outdoor-search";
import type { SavedOutdoorLocation } from "@/lib/saved-outdoor-locations";
import { loadMapLibre } from "@/lib/maplibre-loader";
import type { OutdoorNavigationOverlay } from "@/lib/outdoor-navigation";
import {visitorInitials,type RestrictedRoomCandidate,type VisitorMapSnapshot} from "@/lib/visitor-simulation";

export type MapStatus = "loading" | "ready" | "error";
export type FloorPlacementPreview = {
  floorId:string;
  name:string;
  image:Blob;
  showImage:boolean;
  imageWidth:number;
  imageHeight:number;
  placement:OutdoorFloorPlacement;
  areas:FloorArea[];
  portals:FloorPortal[];
  markers:FloorMarker[];
  devices:LocationDevice[];
  landings:OutdoorFloorLanding[];
};
const floorSourceId=(id:string)=>`placed-floor-image:${id}`;
const floorLayerId=(id:string)=>`placed-floor-layer:${id}`;
const floorGeometrySourceId=(id:string)=>`placed-floor-geometry:${id}`;
const floorGeometryLayerId=(id:string,name:string)=>`floor:${id}:${name}`;
const SELECTION_FRAME_SOURCE="selected-indoor-resize-frame";
const OUTDOOR_ROUTE_SOURCE="outdoor-indoor-navigation-geometry";
const VISITOR_TRAIL_SOURCE="visitor-path-history";
const VISITOR_TRAIL_LAYERS=["visitor-path-history-halo","visitor-path-history-line"] as const;
/** Slightly shorter than the 2 s fix interval so each glide finishes first. */
const VISITOR_GLIDE_MS=1800;
type VisitorAnimation={
  id:string;color:string;floorRecordId:string;fixSequence:number;startedAt:number;
  path:[number,number][];lengths:number[];base:[number,number][];
  history:[number,number][];current:[number,number];
};
const OUTDOOR_ROUTE_LAYERS=[
  "outdoor-route-halo","outdoor-route-line","outdoor-route-markers","outdoor-route-marker-labels",
] as const;
const SELECTION_FRAME_HALO="selected-indoor-resize-frame-halo";
const SELECTION_FRAME_LINE="selected-indoor-resize-frame-line";
const SELECTION_ROTATE_HALO="selected-indoor-rotate-connector-halo";
const SELECTION_ROTATE_LINE="selected-indoor-rotate-connector";
const resizeHandleNames=[
  "top-left corner","top-right corner","bottom-right corner","bottom-left corner",
  "top edge","right edge","bottom edge","left edge",
] as const;
const resizeHandleCursors=[
  "nwse-resize","nesw-resize","nwse-resize","nesw-resize",
  "ns-resize","ew-resize","ns-resize","ew-resize",
] as const;

function floorSelectionBorder(placement:OutdoorFloorPlacement,imageWidth:number,imageHeight:number){
  const corners=floorImageCorners(placement,imageWidth,imageHeight);
  const topCentre=floorResizeHandlePoints(placement,imageWidth,imageHeight)[4];
  const rotationPoint=floorRotationHandle(placement,imageWidth,imageHeight);
  return {type:"FeatureCollection" as const,features:[{
    type:"Feature" as const,properties:{role:"indoor-resize-frame"},
    geometry:{type:"LineString" as const,coordinates:[...corners,corners[0]]},
  },{
    type:"Feature" as const,properties:{role:"rotation-stem"},
    geometry:{type:"LineString" as const,coordinates:[topCentre,rotationPoint]},
  }]};
}

export const INITIAL_CAMERA = {
  center: [120.9842, 14.5995] as [number, number],
  zoom: 11.5,
};

type Props = {
  styleUrl: string;
  recenterKey: number;
  focusTarget: (OutdoorLocation & { requestId: number }) | null;
  savedLocations: SavedOutdoorLocation[];
  selectedSavedLocationId: string | null;
  onSavedLocationSelect: (location: SavedOutdoorLocation) => void;
  pickOnMap: boolean;
  onMapPointPick: (point: OutdoorLocation) => void;
  placementPreviews: FloorPlacementPreview[];
  editableFloorId: string | null;
  placingFloor: boolean;
  onPlacementPointPick: (longitude:number,latitude:number) => void;
  onPlacementTransform: (placement:OutdoorFloorPlacement) => void;
  proportionalResize: boolean;
  transformMode: "resize"|"skew";
  outdoorRouteOverlay: OutdoorNavigationOverlay|null;
  visitorSnapshots: VisitorMapSnapshot[];
  restrictedRoom: (RestrictedRoomCandidate&{active:boolean})|null;
  onNavigationRoomPick: (floorId:string,roomId:string,endpoint:"start"|"end")=>void;
  onStatusChange: (status: MapStatus) => void;
};

export function MapCanvas({
  styleUrl,recenterKey,focusTarget,savedLocations,selectedSavedLocationId,
  onSavedLocationSelect,pickOnMap,onMapPointPick,onStatusChange,
  placementPreviews,editableFloorId,placingFloor,onPlacementPointPick,
  onPlacementTransform,proportionalResize,transformMode,
  outdoorRouteOverlay,visitorSnapshots,restrictedRoom,onNavigationRoomPick,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [styleReadyKey,setStyleReadyKey] = useState(0);
  const [inspectedFeature,setInspectedFeature]=useState<OutdoorIndoorInspection|null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const latestStyleRef = useRef(styleUrl);
  const appliedStyleRef = useRef<string | null>(null);
  const statusCallbackRef = useRef(onStatusChange);
  const focusTargetRef = useRef(focusTarget);
  const appliedFocusRequestRef = useRef<number | null>(null);
  const locationMarkerRef = useRef<MapLibreMarker | null>(null);
  const savedMarkersRef = useRef<MapLibreMarker[]>([]);
  const deviceMarkersRef = useRef<MapLibreMarker[]>([]);
  const visitorMarkersRef=useRef<Map<string,MapLibreMarker>>(new Map());
  const visitorAnimationsRef=useRef<Map<string,VisitorAnimation>>(new Map());
  const visitorFrameRef=useRef(0);
  const floorHandleRef = useRef<MapLibreMarker | null>(null);
  const transformHandlesRef=useRef<MapLibreMarker[]>([]);
  // Active marker must not be re-anchored by React while MapLibre drags it.
  const activeHandleRef=useRef<{kind:"centre"|"corner"|"rotation";index?:number}|null>(null);
  const latestSavedLocationsRef=useRef(savedLocations);
  const latestSelectedSavedIdRef=useRef(selectedSavedLocationId);
  const onSavedLocationSelectRef=useRef(onSavedLocationSelect);
  const pickOnMapRef=useRef(pickOnMap);
  const onMapPointPickRef=useRef(onMapPointPick);
  const placingFloorRef=useRef(placingFloor);
  const onPlacementPointPickRef=useRef(onPlacementPointPick);
  const onPlacementTransformRef=useRef(onPlacementTransform);
  const proportionalResizeRef=useRef(proportionalResize);
  const activeFloorRef=useRef<FloorPlacementPreview|null>(null);
  const editableFloorIdRef=useRef(editableFloorId);
  const latestPreviewsRef=useRef(placementPreviews);
  const latestRouteRef=useRef(outdoorRouteOverlay);
  const latestVisitorsRef=useRef(visitorSnapshots);
  // Stable across mousemove transform updates; changes only when floor
  // visibility or the selected floor changes.
  const overlaySetKey=placementPreviews.map(p=>`${p.floorId}:${p.showImage}`).join("|");
  const hasOutdoorRoute=Boolean(outdoorRouteOverlay?.features.length);
  const restrictedFloorRecordId=restrictedRoom?.floorRecordId??null;
  const restrictedRoomId=restrictedRoom?.roomId??null;
  const restrictedActive=restrictedRoom?.active??false;

  useEffect(() => {
    statusCallbackRef.current = onStatusChange;
  }, [onStatusChange]);

  useEffect(()=>{
    latestSavedLocationsRef.current=savedLocations;
    latestSelectedSavedIdRef.current=selectedSavedLocationId;
    onSavedLocationSelectRef.current=onSavedLocationSelect;
  },[savedLocations,selectedSavedLocationId,onSavedLocationSelect]);

  useEffect(()=>{
    pickOnMapRef.current=pickOnMap;
    onMapPointPickRef.current=onMapPointPick;
    placingFloorRef.current=placingFloor;
    onPlacementPointPickRef.current=onPlacementPointPick;
    onPlacementTransformRef.current=onPlacementTransform;
    proportionalResizeRef.current=proportionalResize;
    const map=mapRef.current;
    if(map)map.getCanvas().style.cursor=(pickOnMap||placingFloor)?"crosshair":"";
  },[pickOnMap,onMapPointPick,placingFloor,onPlacementPointPick,onPlacementTransform,proportionalResize]);


  useEffect(()=>{
    activeFloorRef.current=placementPreviews.find(p=>p.floorId===editableFloorId)??null;
    latestPreviewsRef.current=placementPreviews;
    editableFloorIdRef.current=editableFloorId;
  },[placementPreviews,editableFloorId]);

  // Drag any filled room, walkway, doorway or stair/elevator area to move
  // the entire floor group. The blue centre handle is always available too.
  // This listener is independent of the draft transform to prevent restarting
  // a pointer gesture when React re-renders its geometry during movement.
  useEffect(()=>{
    const map=mapRef.current;
    if(!map)return;
    let drag:null|{
      center:{x:number;y:number};mouse:{x:number;y:number};
      placement:OutdoorFloorPlacement;restorePan:boolean;
    }=null;
    const onDown=(event:MapMouseEvent)=>{
      if(pickOnMapRef.current||placingFloorRef.current)return;
      const floor=activeFloorRef.current;
      if(!floor)return;
      const ids=["room-fill","walkable-fill","doorway-fill","stairs-fill"].map(
        kind=>floorGeometryLayerId(floor.floorId,kind),
      ).filter(id=>Boolean(map.getLayer(id)));
      if(!ids.length||!map.queryRenderedFeatures(event.point,{layers:ids}).length)return;
      const projected=map.project([floor.placement.longitude,floor.placement.latitude]);
      drag={center:{x:projected.x,y:projected.y},
        mouse:{x:event.point.x,y:event.point.y},
        placement:floor.placement,restorePan:map.dragPan.isEnabled()};
      if(drag.restorePan)map.dragPan.disable();
      map.getCanvas().style.cursor="grabbing";
      event.preventDefault();
    };
    const onMove=(event:MapMouseEvent)=>{
      if(!drag)return;
      const centre=map.unproject([
        drag.center.x+event.point.x-drag.mouse.x,
        drag.center.y+event.point.y-drag.mouse.y,
      ]);
      if(!Number.isFinite(centre.lng)||!Number.isFinite(centre.lat)||
        centre.lat < -80||centre.lat > 80)return;
      onPlacementTransformRef.current({...drag.placement,
        longitude:centre.lng,latitude:centre.lat});
    };
    const finish=()=>{
      if(!drag)return;
      if(drag.restorePan)map.dragPan.enable();
      drag=null;
      map.getCanvas().style.cursor=(pickOnMapRef.current||placingFloorRef.current)?"crosshair":"";
    };
    map.on("mousedown",onDown);
    map.on("mousemove",onMove);
    map.on("mouseup",finish);
    window.addEventListener("mouseup",finish);
    return ()=>{
      finish();
      window.removeEventListener("mouseup",finish);
      map.off("mousedown",onDown);
      map.off("mousemove",onMove);
      map.off("mouseup",finish);
    };
  },[styleReadyKey]);

  // The vector indoor data is the PRIMARY layer. The raster image is only
  // mounted when Show floor plan is checked. Each floor uses the same geographic
  // transform for its image corners, saved vectors and draggable edit handles.
  useEffect(()=>{
    const map=mapRef.current;
    // Source loading makes isStyleLoaded() false even after style initialization;
    // adding a floor must not be skipped while other floor data is processing.
    if(!map||!map.getStyle())return;
    const urls:string[]=[];
    const sourceIds:string[]=[];
    const layerIds:string[]=[];
    const shown=[...latestPreviewsRef.current].sort((a,b)=>
      Number(a.floorId===editableFloorId)-Number(b.floorId===editableFloorId));
    const track=(id:string)=>{layerIds.push(id);return id;};
    try{
      for(const preview of shown){
        const imageSource=floorSourceId(preview.floorId);
        const imageLayer=floorLayerId(preview.floorId);
        if(preview.showImage){
          const url=URL.createObjectURL(preview.image);
          urls.push(url);
          map.addSource(imageSource,{
            type:"image",url,
            coordinates:floorImageCorners(preview.placement,preview.imageWidth,preview.imageHeight),
          });
          sourceIds.push(imageSource);
          // MapLibre 6 defaults to perspective/auto for skewed image corners.
          // Force flat bilinear warp so the image's interior pixels match
          // indoorPointToLngLat's Web-Mercator bilinear vector projection.
          (map.getSource(imageSource) as ImageSource).setWarp("flat");
          map.addLayer({id:track(imageLayer),type:"raster",source:imageSource,
            paint:{"raster-opacity":preview.placement.opacity,"raster-fade-duration":0}});
        }
        const source=floorGeometrySourceId(preview.floorId);
        map.addSource(source,{type:"geojson",data:outdoorIndoorFeatures(preview)});
        sourceIds.push(source);
        const id=(suffix:string)=>track(floorGeometryLayerId(preview.floorId,suffix));
        const category=(value:string):FilterSpecification=>["==",["get","category"],value];
        map.addLayer({id:id("camera-fov-fill"),type:"fill",source,filter:category("camera-fov"),
          paint:{"fill-color":"#7c3aed","fill-opacity":0.15}});
        map.addLayer({id:id("camera-fov-outline"),type:"line",source,filter:category("camera-fov"),
          paint:{"line-color":"#6d28d9","line-width":2.2,"line-opacity":0.85}});
        map.addLayer({id:id("walkable-fill"),type:"fill",source,filter:category("walkable"),
          paint:{"fill-color":"#10b981","fill-opacity":0.32}});
        map.addLayer({id:id("room-fill"),type:"fill",source,filter:category("room"),
          paint:{"fill-color":"#3b82f6","fill-opacity":0.23}});
        map.addLayer({id:id("room-outline"),type:"line",source,filter:category("room"),
          paint:{"line-color":"#1d4ed8","line-width":2.4}});
        const restrictedFilter:FilterSpecification=["all",
          ["==",["get","category"],"room"],
          ["==",["get","id"],"__no-restricted-room__"]];
        map.addLayer({id:id("restricted-room-fill"),type:"fill",source,
          filter:restrictedFilter,paint:{"fill-color":"#ef4444","fill-opacity":0.16}});
        map.addLayer({id:id("restricted-room-outline"),type:"line",source,
          filter:restrictedFilter,paint:{"line-color":"#b91c1c","line-width":3,
            "line-opacity":0.9,"line-dasharray":[2,1]}});
        map.addLayer({id:id("walkable-outline"),type:"line",source,filter:category("walkable"),
          paint:{"line-color":"#047857","line-width":2.4}});
        map.addLayer({id:id("doorway-fill"),type:"fill",source,filter:category("doorway"),
          paint:{"fill-color":"#818cf8","fill-opacity":0.7}});
        map.addLayer({id:id("doorway-border"),type:"line",source,filter:category("doorway"),
          paint:{"line-color":["match",["get","usage"],"entrance","#0d9488",
            "exit","#e65b50","both","#4f46e5","#64748b"],"line-width":2.5}});
        map.addLayer({id:id("stairs-fill"),type:"fill",source,
          filter:["in",["get","category"],["literal",["staircase","elevator"]]],
          paint:{"fill-color":"#f59e0b","fill-opacity":0.45}});
        map.addLayer({id:id("stairs-outline"),type:"line",source,
          filter:["in",["get","category"],["literal",["staircase","elevator"]]],
          paint:{"line-color":"#b45309","line-width":2.4,"line-dasharray":[2,1]}});
        map.addLayer({id:id("devices"),type:"circle",source,
          filter:["in",["get","category"],["literal",["camera","device","entrance","exit"]]],
          paint:{"circle-radius":6,"circle-color":["match",["get","category"],
            "camera","#7c3aed","device","#ea580c","entrance","#0d9488","#e65b50"],
            "circle-stroke-color":"#ffffff","circle-stroke-width":2}});
        map.addLayer({id:id("door-symbol"),type:"circle",source,
          filter:category("doorway-label"),
          paint:{"circle-radius":3,"circle-color":"#ffffff",
            "circle-stroke-color":"#4f46e5","circle-stroke-width":1.5}});
        map.addLayer({id:id("names"),type:"symbol",source,
          filter:["in",["get","category"],["literal",["area-label","vertical-label"]]],
          layout:{"text-field":["get","name"],"text-size":12,
            "text-max-width":12,"text-allow-overlap":false,
            "text-anchor":"center"},
          paint:{"text-color":"#111827","text-halo-color":"#ffffff",
            "text-halo-width":2}});
      }
      // All optional images must stay beneath ALL indoor details, even when
      // several saved floors are visible at the same time.
      for(const preview of shown){
        for(const suffix of ["camera-fov-fill","camera-fov-outline","walkable-fill","room-fill","room-outline",
          "restricted-room-fill","restricted-room-outline","walkable-outline","doorway-fill","doorway-border","stairs-fill",
          "stairs-outline","devices","door-symbol","names"]){
          const layer=floorGeometryLayerId(preview.floorId,suffix);
          if(map.getLayer(layer))map.moveLayer(layer);
        }
      }
      const selected=shown.find(preview=>preview.floorId===editableFloorId);
      if(selected){
        // Bounding quadrilateral is present even with the optional image hidden.
        // One selection frame always follows the entire saved indoor group.
        map.addSource(SELECTION_FRAME_SOURCE,{type:"geojson",data:floorSelectionBorder(
          selected.placement,selected.imageWidth,selected.imageHeight,
        )});
        sourceIds.push(SELECTION_FRAME_SOURCE);
        const roleFilter=(role:string):FilterSpecification=>["==",["get","role"],role];
        map.addLayer({id:track(SELECTION_FRAME_HALO),type:"line",source:SELECTION_FRAME_SOURCE,
          filter:roleFilter("indoor-resize-frame"),layout:{"line-join":"round"},
          paint:{"line-color":"#ffffff","line-width":5,"line-opacity":0.95}});
        map.addLayer({id:track(SELECTION_FRAME_LINE),type:"line",source:SELECTION_FRAME_SOURCE,
          filter:roleFilter("indoor-resize-frame"),layout:{"line-join":"round"},
          paint:{"line-color":"#2563eb","line-width":2.5,"line-dasharray":[3,1.5]}});
        // A visible stalk links the larger ROTATE marker to the top-centre grip,
        // so the control is unmistakably part of the selected floor.
        map.addLayer({id:track(SELECTION_ROTATE_HALO),type:"line",source:SELECTION_FRAME_SOURCE,
          filter:roleFilter("rotation-stem"),
          paint:{"line-color":"#ffffff","line-width":8}});
        map.addLayer({id:track(SELECTION_ROTATE_LINE),type:"line",source:SELECTION_FRAME_SOURCE,
          filter:roleFilter("rotation-stem"),
          paint:{"line-color":"#047857","line-width":4,"line-dasharray":[2,1]}});
      }
    }catch(error){
      console.error("Could not display outdoor indoor geometry:",error);
    }
    return ()=>{
      for(const id of layerIds.reverse())if(map.getLayer(id))map.removeLayer(id);
      for(const id of sourceIds.reverse())if(map.getSource(id))map.removeSource(id);
      urls.forEach(url=>URL.revokeObjectURL(url));
    };
  },[overlaySetKey,editableFloorId,styleReadyKey]);

  // Update coordinates in existing image and GeoJSON sources in-place while
  // moving, rotating, resizing or skewing. Do not re-add eleven layers per frame.
  useEffect(()=>{
    const map=mapRef.current;
    if(!map)return;
    for(const preview of placementPreviews){
      const source=map.getSource(floorGeometrySourceId(preview.floorId)) as GeoJSONSource|undefined;
      if(source)void source.setData(outdoorIndoorFeatures(preview));
      const image=map.getSource(floorSourceId(preview.floorId)) as ImageSource|undefined;
      if(image){
        image.setCoordinates(floorImageCorners(preview.placement,
          preview.imageWidth,preview.imageHeight));
        if(map.getLayer(floorLayerId(preview.floorId)))
          map.setPaintProperty(floorLayerId(preview.floorId),
            "raster-opacity",preview.placement.opacity);
      }
      if(preview.floorId===editableFloorId){
        const border=map.getSource(SELECTION_FRAME_SOURCE) as GeoJSONSource|undefined;
        if(border)void border.setData(floorSelectionBorder(
          preview.placement,preview.imageWidth,preview.imageHeight,
        ));
      }
    }
  },[placementPreviews,overlaySetKey,editableFloorId,styleReadyKey]);

  // A dedicated overlay identifies the room selected for this demo session.
  // Its filter always targets category=room, so corridors and connectors can
  // never become restricted because of a coincident feature identifier.
  useEffect(()=>{
    const map=mapRef.current;
    if(!map)return;
    const applyOpacity=(bright:boolean)=>{
      for(const preview of placementPreviews){
        const fill=floorGeometryLayerId(preview.floorId,"restricted-room-fill");
        const outline=floorGeometryLayerId(preview.floorId,"restricted-room-outline");
        const selected=preview.floorId===restrictedFloorRecordId&&Boolean(restrictedRoomId);
        const filter:FilterSpecification=["all",
          ["==",["get","category"],"room"],
          ["==",["get","id"],selected?restrictedRoomId!:"__no-restricted-room__"],
        ];
        if(map.getLayer(fill)){
          map.setFilter(fill,filter);
          map.setPaintProperty(fill,"fill-opacity",selected?
            restrictedActive?(bright?0.62:0.25):0.16:0);
        }
        if(map.getLayer(outline)){
          map.setFilter(outline,filter);
          map.setPaintProperty(outline,"line-width",selected&&restrictedActive&&bright?5:3);
          map.setPaintProperty(outline,"line-opacity",selected?1:0);
        }
      }
    };
    let bright=true;
    applyOpacity(bright);
    if(!restrictedActive)return;
    const timer=window.setInterval(()=>{bright=!bright;applyOpacity(bright);},420);
    return ()=>window.clearInterval(timer);
  },[placementPreviews,overlaySetKey,styleReadyKey,restrictedFloorRecordId,
    restrictedRoomId,restrictedActive]);

  // Validated indoor routes render as independent geographic floor segments.
  // Never draw an arbitrary street-level straight line between different floors.
  useEffect(()=>{
    latestRouteRef.current=outdoorRouteOverlay;
  },[outdoorRouteOverlay]);
  useEffect(()=>{
    const map=mapRef.current;
    const initial=latestRouteRef.current;
    if(!map||!map.getStyle()||!initial?.features.length)return;
    const markerKinds=["route-start","route-end","floor-transition","floor-entry"];
    const lines:FilterSpecification=["==",["get","kind"],"route-segment"];
    const markers:FilterSpecification=["in",["get","kind"],["literal",markerKinds]];
    try{
      map.addSource(OUTDOOR_ROUTE_SOURCE,{type:"geojson",data:initial});
      map.addLayer({
        id:OUTDOOR_ROUTE_LAYERS[0],source:OUTDOOR_ROUTE_SOURCE,
        type:"line",filter:lines,layout:{"line-join":"round","line-cap":"round"},
        paint:{"line-color":"#ffffff","line-width":8,"line-opacity":0.96},
      });
      map.addLayer({
        id:OUTDOOR_ROUTE_LAYERS[1],source:OUTDOOR_ROUTE_SOURCE,
        type:"line",filter:lines,layout:{"line-join":"round","line-cap":"round"},
        paint:{"line-color":"#dc2626","line-width":4.5},
      });
      map.addLayer({
        id:OUTDOOR_ROUTE_LAYERS[2],source:OUTDOOR_ROUTE_SOURCE,
        type:"circle",filter:markers,
        paint:{"circle-radius":11,
          "circle-color":["match",["get","kind"],
            "route-start","#059669","route-end","#dc2626","#d97706"],
          "circle-stroke-width":3,"circle-stroke-color":"#ffffff"},
      });
      map.addLayer({
        id:OUTDOOR_ROUTE_LAYERS[3],source:OUTDOOR_ROUTE_SOURCE,
        type:"symbol",filter:markers,
        layout:{"text-field":["match",["get","kind"],"route-start","S",
          "route-end","E","↕"],"text-size":12,"text-allow-overlap":true},
        paint:{"text-color":"#ffffff","text-halo-color":"#1f2937","text-halo-width":0.5},
      });
    }catch(error){
      console.error("Could not display outdoor indoor route:",error);
    }
    return ()=>{
      for(const id of [...OUTDOOR_ROUTE_LAYERS].reverse())
        if(map.getLayer(id))map.removeLayer(id);
      if(map.getSource(OUTDOOR_ROUTE_SOURCE))map.removeSource(OUTDOOR_ROUTE_SOURCE);
    };
  },[styleReadyKey,hasOutdoorRoute]);

  // Route start/end changes only update GeoJSON in-place, without rebuilding
  // the map style, indoor geometry, or optional floor-plan images.
  useEffect(()=>{
    const source=mapRef.current?.getSource(OUTDOOR_ROUTE_SOURCE) as GeoJSONSource|undefined;
    if(source&&outdoorRouteOverlay)void source.setData(outdoorRouteOverlay);
  },[outdoorRouteOverlay,styleReadyKey,hasOutdoorRoute]);

  // Floor centre, corner and rotation markers show the WHOLE indoor group
  // changing in real time. A MapLibre marker's "dragend" alone fires too late;
  // "drag" is coalesced to one render per animation frame. Preview updates go
  // straight to existing MapLibre sources (avoiding heavy React workspace
  // re-renders), and only the final position is committed to the saved draft.
  useEffect(()=>{
    const map=mapRef.current;
    const current=activeFloorRef.current;
    if(!map||!current)return;
    let cancelled=false;
    let frame:number|null=null;
    let pending:OutdoorFloorPlacement|null=null;

    const syncHandles=(next:OutdoorFloorPlacement)=>{
      const dragging=activeHandleRef.current;
      if(dragging?.kind!=="centre")floorHandleRef.current?.setLngLat([
        next.longitude,next.latitude,
      ]);
      const handles=floorResizeHandlePoints(next,current.imageWidth,current.imageHeight);
      handles.forEach((position,index)=>{
        if(dragging?.kind==="corner"&&dragging.index===index)return;
        transformHandlesRef.current[index]?.setLngLat(position);
      });
      if(dragging?.kind!=="rotation")transformHandlesRef.current[8]?.setLngLat(
        floorRotationHandle(next,current.imageWidth,current.imageHeight),
      );
    };
    const drawLive=(next:OutdoorFloorPlacement)=>{
      if(cancelled||mapRef.current!==map||floorPlacementError(next))return;
      const vectorSource=map.getSource(floorGeometrySourceId(current.floorId)) as GeoJSONSource|undefined;
      if(vectorSource)void vectorSource.setData(outdoorIndoorFeatures({...current,placement:next}));
      const selection=map.getSource(SELECTION_FRAME_SOURCE) as GeoJSONSource|undefined;
      if(selection)void selection.setData(floorSelectionBorder(
        next,current.imageWidth,current.imageHeight,
      ));
      const imageSource=map.getSource(floorSourceId(current.floorId)) as ImageSource|undefined;
      if(imageSource)imageSource.setCoordinates(
        floorImageCorners(next,current.imageWidth,current.imageHeight),
      );
      syncHandles(next);
    };
    const preview=(next:OutdoorFloorPlacement)=>{
      pending=next;
      if(frame!==null)return;
      frame=requestAnimationFrame(()=>{
        frame=null;
        const value=pending;
        pending=null;
        if(value)drawLive(value);
      });
    };
    const finish=(next:OutdoorFloorPlacement)=>{
      if(frame!==null)cancelAnimationFrame(frame);
      frame=null;pending=null;
      activeHandleRef.current=null;
      drawLive(next);
      // React and IndexedDB draft only receive the final transform. The image
      // and every vector feature were already updated throughout the gesture.
      onPlacementTransformRef.current(next);
    };

    void loadMapLibre().then(lib=>{
      if(cancelled||mapRef.current!==map)return;
      const element=document.createElement("div");
      element.setAttribute("role","button");
      element.setAttribute("tabindex","0");
      element.setAttribute("aria-label","Drag to reposition selected indoor floor");
      element.title="Drag to move this entire indoor floor group";
      element.style.cssText="width:22px;height:22px;border-radius:50%;background:#2563eb;border:3px solid #fff;box-shadow:0 1px 9px #0008;cursor:move;z-index:20;";
      element.addEventListener("click",event=>event.stopPropagation());
      const centre=new lib.Marker({element,anchor:"center",draggable:true})
        .setLngLat([current.placement.longitude,current.placement.latitude]).addTo(map);
      let centreStart:OutdoorFloorPlacement|null=null;
      centre.on("dragstart",()=>{
        centreStart=activeFloorRef.current?.placement??current.placement;
        activeHandleRef.current={kind:"centre"};
      });
      centre.on("drag",()=>{
        if(!centreStart)return;
        const point=centre.getLngLat();
        preview({...centreStart,longitude:point.lng,latitude:point.lat});
      });
      centre.on("dragend",()=>{
        const point=centre.getLngLat();
        const base=centreStart??activeFloorRef.current?.placement??current.placement;
        centreStart=null;
        const next={...base,longitude:point.lng,latitude:point.lat};
        // Keep the point-picking semantics that also exit map-centre pick mode.
        if(floorPlacementError(next)){
          activeHandleRef.current=null;
          syncHandles(base);
          return;
        }
        finish(next);
        onPlacementPointPickRef.current(point.lng,point.lat);
      });
      floorHandleRef.current=centre;

      const handles=floorResizeHandlePoints(current.placement,current.imageWidth,current.imageHeight);
      handles.forEach((point,index)=>{
        const grip=document.createElement("div");
        grip.setAttribute("role","button");
        const skewing=transformMode==="skew";
        grip.setAttribute("aria-label",`${skewing?"Skew":"Resize"} floor from ${resizeHandleNames[index]}`);
        grip.title=skewing?
          (index<4?`Drag to skew ONLY the ${resizeHandleNames[index]}`:
            `Drag to skew the ${resizeHandleNames[index]} (moves that edge's two corners)`):
          `Drag ${resizeHandleNames[index]} to resize all indoor details in real time`;
        grip.style.cssText=`width:${index<4?17:15}px;height:${index<4?17:15}px;border-radius:2px;background:${skewing?"#f5f3ff":"#fff"};border:2px solid ${skewing?"#7c3aed":"#2563eb"};box-shadow:0 1px 5px #0007;cursor:${skewing?"move":resizeHandleCursors[index]};z-index:21;`;
        grip.addEventListener("click",event=>event.stopPropagation());
        const corner=new lib.Marker({element:grip,anchor:"center",draggable:true})
          .setLngLat(point).addTo(map);
        let baseline:OutdoorFloorPlacement|null=null;
        const resized=()=>{
          const base=baseline??activeFloorRef.current?.placement??current.placement;
          const pos=corner.getLngLat();
          return transformMode==="skew"?
            skewFloorFromHandle(base,current.imageWidth,current.imageHeight,
              index,[pos.lng,pos.lat]):
            resizeFloorFromHandle(base,current.imageWidth,current.imageHeight,
              index,[pos.lng,pos.lat],proportionalResizeRef.current);
        };
        corner.on("dragstart",()=>{
          baseline=activeFloorRef.current?.placement??current.placement;
          activeHandleRef.current={kind:"corner",index};
        });
        corner.on("drag",()=>{
          if(!baseline)return;
          preview(resized());
        });
        corner.on("dragend",()=>{
          const next=resized();
          baseline=null;
          finish(next);
        });
        transformHandlesRef.current.push(corner);
      });

      const rotElement=document.createElement("div");
      rotElement.setAttribute("role","button");
      rotElement.setAttribute("aria-label","Drag to rotate selected floor");
      rotElement.title="ROTATE: drag to turn the entire indoor floor";
      rotElement.style.cssText="width:46px;height:46px;border-radius:50%;background:#047857;border:3px solid #fff;box-shadow:0 2px 11px #0009;cursor:grab;z-index:22;display:flex;align-items:center;justify-content:center;position:relative;";
      // Two large curved arrows + text label are visually distinct from resize
      // grips. The stalk from the floor top-centre shows its attachment.
      rotElement.innerHTML='<svg aria-hidden="true" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20.3 8A9 9 0 0 0 4 8"/><path d="M4 3v5h5"/><path d="M3.7 16A9 9 0 0 0 20 16"/><path d="M20 21v-5h-5"/></svg><span aria-hidden="true" style="position:absolute;top:49px;left:50%;transform:translateX(-50%);font:bold 10px/1.2 sans-serif;background:#047857;color:#fff;padding:3px 6px;border-radius:4px;white-space:nowrap;pointer-events:none">ROTATE</span>';
      rotElement.addEventListener("click",event=>event.stopPropagation());
      const initialHandle=floorRotationHandle(
        current.placement,current.imageWidth,current.imageHeight);
      const rotate=new lib.Marker({element:rotElement,anchor:"center",draggable:true})
        .setLngLat(initialHandle).addTo(map);
      let rotationStart:OutdoorFloorPlacement|null=null;
      let rotationHandleStart:[number,number]|null=null;
      const rotated=()=>{
        const base=rotationStart??activeFloorRef.current?.placement??current.placement;
        const from=rotationHandleStart??floorRotationHandle(
          base,current.imageWidth,current.imageHeight,
        );
        const point=rotate.getLngLat();
        return rotateFloorFromHandle(base,from,[point.lng,point.lat]);
      };
      rotate.on("dragstart",()=>{
        rotationStart=activeFloorRef.current?.placement??current.placement;
        rotationHandleStart=floorRotationHandle(
          rotationStart,current.imageWidth,current.imageHeight,
        );
        activeHandleRef.current={kind:"rotation"};
      });
      rotate.on("drag",()=>{
        if(!rotationStart)return;
        preview(rotated());
      });
      rotate.on("dragend",()=>{
        const next=rotated();
        rotationStart=null;
        rotationHandleStart=null;
        finish(next);
      });
      transformHandlesRef.current.push(rotate);
    }).catch(error=>console.error("Floor transform handles failed:",error));
    return ()=>{
      cancelled=true;
      if(frame!==null)cancelAnimationFrame(frame);
      frame=null;pending=null;
      activeHandleRef.current=null;
      floorHandleRef.current?.remove();
      floorHandleRef.current=null;
      transformHandlesRef.current.forEach(handle=>handle.remove());
      transformHandlesRef.current=[];
    };
  },[overlaySetKey,editableFloorId,styleReadyKey,transformMode]);

  // Move existing DOM handles with the same placement transform (no marker
  // teardown/recreation per frame while a room or hallway is being dragged).
  useEffect(()=>{
    const current=placementPreviews.find(p=>p.floorId===editableFloorId);
    if(!current)return;
    const dragging=activeHandleRef.current;
    if(dragging?.kind!=="centre")floorHandleRef.current?.setLngLat([
      current.placement.longitude,current.placement.latitude,
    ]);
    const handles=floorResizeHandlePoints(current.placement,current.imageWidth,current.imageHeight);
    for(let i=0;i<8;i++){
      if(dragging?.kind==="corner"&&dragging.index===i)continue;
      transformHandlesRef.current[i]?.setLngLat(handles[i]);
    }
    if(dragging?.kind!=="rotation")transformHandlesRef.current[8]?.setLngLat(
      floorRotationHandle(current.placement,current.imageWidth,current.imageHeight),
    );
  },[placementPreviews,editableFloorId,overlaySetKey,styleReadyKey]);

  const renderPlacedDevices=useCallback((
    map:MapLibreMap,lib:Awaited<ReturnType<typeof loadMapLibre>>,
    previews:FloorPlacementPreview[],
  )=>{
    deviceMarkersRef.current.forEach(marker=>marker.remove());
    deviceMarkersRef.current=[];
    for(const preview of previews){
      for(const device of preview.devices){
        if(!device.point)continue;
        const model=DEVICE_MODELS.find(item=>item.type===device.type);
        if(!model)continue;
        const el=createDeviceIconElement(device.type,model.icon,
          device.name+" on "+preview.name);
        el.title=device.name+" · "+preview.name+" · "+device.uuid;
        // Outdoor icons retain a readable screen size. The original SVG shape
        // and white alpha backing are shared with the indoor device renderer.
        applyDeviceIconDimensions(el,device.type,device.sizePx);
        try{
          const coords=indoorPointToLngLat(device.point,preview.placement,
            preview.imageWidth,preview.imageHeight);
          const marker=new lib.Marker({element:el,anchor:"center"}).setLngLat(coords).addTo(map);
          marker.getElement().style.zIndex="7";
          deviceMarkersRef.current.push(marker);
        }catch{/* Ignore malformed preview geometry without hiding other floors. */}
      }
    }
  },[]);
  useEffect(()=>{
    const map=mapRef.current;
    if(!map||!map.getStyle())return;
    let cancelled=false;
    void loadMapLibre().then(lib=>{
      if(!cancelled&&mapRef.current===map)renderPlacedDevices(map,lib,placementPreviews);
    });
    return ()=>{cancelled=true;};
  },[placementPreviews,styleReadyKey,renderPlacedDevices]);

  // Visitors are projected with the SAME placement used to draw their floor,
  // so the dot always lands on that floor's drawn polygons. A visitor whose
  // floor is not rendered on the map is not shown at all.
  const projectVisitorPath=useCallback((
    snapshot:VisitorMapSnapshot,points:ReadonlyArray<{x:number;y:number}>,
  ):[number,number][]|null=>{
    const preview=latestPreviewsRef.current.find(p=>p.floorId===snapshot.floorRecordId);
    if(!preview)return null;
    try{
      return points.map(point=>indoorPointToLngLat(point,preview.placement,
        preview.imageWidth,preview.imageHeight));
    }catch{return null;}
  },[]);

  const renderVisitorTrails=useCallback((map:MapLibreMap)=>{
    const source=map.getSource(VISITOR_TRAIL_SOURCE) as GeoJSONSource|undefined;
    if(!source)return;
    const features=[...visitorAnimationsRef.current.values()].flatMap(animation=>{
      const coordinates=[...animation.history,animation.current];
      return coordinates.length>=2?[{type:"Feature" as const,
        properties:{id:animation.id,color:animation.color},
        geometry:{type:"LineString" as const,coordinates}}]:[];
    });
    void source.setData({type:"FeatureCollection",features});
  },[]);

  /** Glide every marker along the walked path between two GPS fixes. The
   * marker follows the path's corners, so it never cuts across a wall. */
  const runVisitorAnimation=useCallback((map:MapLibreMap)=>{
    if(visitorFrameRef.current)return;
    let lastTrailUpdate=0;
    const step=(time:number)=>{
      visitorFrameRef.current=0;
      let active=false;
      for(const animation of visitorAnimationsRef.current.values()){
        const marker=visitorMarkersRef.current.get(animation.id);
        if(!marker)continue;
        const progress=Math.min(1,(time-animation.startedAt)/VISITOR_GLIDE_MS);
        const total=animation.lengths.at(-1)??0;
        const target=total*progress;
        let index=1;
        while(index<animation.lengths.length-1&&animation.lengths[index]<target)index++;
        const a=animation.path[index-1]??animation.path[0];
        const b=animation.path[index]??a;
        const span=(animation.lengths[index]??0)-(animation.lengths[index-1]??0);
        const ratio=span>0?(target-(animation.lengths[index-1]??0))/span:1;
        animation.current=[a[0]+(b[0]-a[0])*ratio,a[1]+(b[1]-a[1])*ratio];
        animation.history=animation.base.concat(animation.path.slice(0,index));
        marker.setLngLat(animation.current);
        if(progress<1)active=true;
      }
      if(time-lastTrailUpdate>120||!active){renderVisitorTrails(map);lastTrailUpdate=time;}
      if(active)visitorFrameRef.current=requestAnimationFrame(step);
    };
    visitorFrameRef.current=requestAnimationFrame(step);
  },[renderVisitorTrails]);

  const renderVisitorMarkers=useCallback((
    map:MapLibreMap,lib:Awaited<ReturnType<typeof loadMapLibre>>,
    snapshots:VisitorMapSnapshot[],
  )=>{
    const projected=snapshots.flatMap(visitor=>{
      const segment=projectVisitorPath(visitor,visitor.segment.length?visitor.segment:[visitor.point]);
      const trail=projectVisitorPath(visitor,visitor.trail);
      return segment&&trail&&segment.length?[{visitor,segment,trail}]:[];
    });
    const activeIds=new Set(projected.map(item=>item.visitor.id));
    for(const [id,marker] of visitorMarkersRef.current){
      if(activeIds.has(id))continue;
      marker.remove();
      visitorMarkersRef.current.delete(id);
      visitorAnimationsRef.current.delete(id);
    }
    for(const {visitor,segment,trail} of projected){
      let marker=visitorMarkersRef.current.get(visitor.id);
      const end=segment.at(-1)!;
      if(!marker){
        const element=document.createElement("div");
        element.className="visitor-map-marker";
        element.dataset.visitorId=visitor.id;
        element.setAttribute("role","img");
        const pulse=document.createElement("span");
        pulse.className="visitor-map-marker__pulse";
        const dot=document.createElement("span");
        dot.className="visitor-map-marker__dot";
        const card=document.createElement("span");
        card.className="visitor-map-marker__card";
        const fallback=document.createElement("span");
        fallback.className="visitor-map-marker__fallback";
        fallback.textContent=visitorInitials(visitor.fullName);
        const image=document.createElement("img");
        image.className="visitor-map-marker__avatar";
        image.src=visitor.avatarUrl;
        image.alt="";
        image.draggable=false;
        image.addEventListener("error",()=>{
          image.hidden=true;
          fallback.hidden=false;
        },{once:true});
        fallback.hidden=true;
        const text=document.createElement("span");
        text.className="visitor-map-marker__text";
        const name=document.createElement("span");
        name.className="visitor-map-marker__name";
        name.textContent=visitor.fullName;
        const location=document.createElement("span");
        location.className="visitor-map-marker__location";
        text.append(name,location);
        card.append(fallback,image,text);
        element.append(pulse,dot,card);
        // The 14px dot is the marker box, so its centre is the exact fix.
        marker=new lib.Marker({element,anchor:"center"}).setLngLat(end).addTo(map);
        element.style.zIndex="12";
        visitorMarkersRef.current.set(visitor.id,marker);
      }
      const element=marker.getElement();
      element.style.setProperty("--visitor-color",visitor.color);
      element.classList.toggle("visitor-map-marker--alert",visitor.alerting);
      const location=element.querySelector<HTMLElement>(".visitor-map-marker__location");
      if(location)location.textContent=`${visitor.locationName} · ${visitor.floorName}`;
      element.setAttribute("aria-label",`${visitor.fullName} in ${visitor.locationName}, ${visitor.floorName}${
        visitor.alerting?" (restricted room)":""}`);
      element.title=`${visitor.fullName} — ${visitor.locationName} · ${visitor.floorName}`;

      const previous=visitorAnimationsRef.current.get(visitor.id);
      if(previous&&previous.fixSequence===visitor.fixSequence)continue;
      // The glide covers only this fix's walked path; the trail before it is
      // static. A floor change (new trail) or first fix jumps straight there.
      const path=previous&&previous.floorRecordId===visitor.floorRecordId&&segment.length>1?
        segment:[end];
      const lengths=[0];
      for(let index=1;index<path.length;index++){
        const [ax,ay]=path[index-1],[bx,by]=path[index];
        lengths.push(lengths[index-1]+Math.hypot(bx-ax,by-ay));
      }
      const base=trail.slice(0,Math.max(0,trail.length-path.length));
      visitorAnimationsRef.current.set(visitor.id,{
        id:visitor.id,color:visitor.color,floorRecordId:visitor.floorRecordId,
        fixSequence:visitor.fixSequence,startedAt:performance.now(),
        path,lengths,base,history:base,current:path[0],
      });
      if(path.length===1)marker.setLngLat(end);
    }
    runVisitorAnimation(map);
  },[projectVisitorPath,runVisitorAnimation]);
  useEffect(()=>{latestVisitorsRef.current=visitorSnapshots;},[visitorSnapshots]);
  useEffect(()=>{
    const map=mapRef.current;
    if(!map)return;
    let cancelled=false;
    void loadMapLibre().then(lib=>{
      if(!cancelled&&mapRef.current===map)
        renderVisitorMarkers(map,lib,visitorSnapshots);
    });
    return ()=>{cancelled=true;};
  },[visitorSnapshots,styleReadyKey,renderVisitorMarkers]);

  // Path history: a thin line per visitor, kept above the indoor floor layers.
  useEffect(()=>{
    const map=mapRef.current;
    if(!map||!map.getStyle())return;
    try{
      if(!map.getSource(VISITOR_TRAIL_SOURCE))map.addSource(VISITOR_TRAIL_SOURCE,
        {type:"geojson",data:{type:"FeatureCollection",features:[]}});
      if(!map.getLayer(VISITOR_TRAIL_LAYERS[0]))map.addLayer({id:VISITOR_TRAIL_LAYERS[0],
        type:"line",source:VISITOR_TRAIL_SOURCE,layout:{"line-join":"round","line-cap":"round"},
        paint:{"line-color":"#ffffff","line-width":5,"line-opacity":0.85}});
      if(!map.getLayer(VISITOR_TRAIL_LAYERS[1]))map.addLayer({id:VISITOR_TRAIL_LAYERS[1],
        type:"line",source:VISITOR_TRAIL_SOURCE,layout:{"line-join":"round","line-cap":"round"},
        paint:{"line-color":["get","color"],"line-width":2.5,"line-opacity":0.9,
          "line-dasharray":[1.5,1]}});
      for(const id of VISITOR_TRAIL_LAYERS)map.moveLayer(id);
      renderVisitorTrails(map);
    }catch(error){
      console.error("Could not display visitor path history:",error);
    }
  },[styleReadyKey,overlaySetKey,editableFloorId,renderVisitorTrails]);
  useEffect(()=>()=>{
    if(visitorFrameRef.current)cancelAnimationFrame(visitorFrameRef.current);
    visitorFrameRef.current=0;
  },[]);

  // Unselected pins remain available for switching locations. The active pin is
  // hidden so it cannot cover that location's indoor overlays.
  const renderSavedMarkers=useCallback((
    map:MapLibreMap,lib:Awaited<ReturnType<typeof loadMapLibre>>,
    places:SavedOutdoorLocation[],selectedId:string|null,
  )=>{
    savedMarkersRef.current.forEach(marker=>marker.remove());
    savedMarkersRef.current=[];
    for(const place of places){
      if(place.id===selectedId)continue;
      const marker=new lib.Marker({color:"#4f46e5"})
        .setLngLat([place.longitude,place.latitude]).addTo(map);
      const element=marker.getElement();
      element.setAttribute("role","button");
      element.setAttribute("tabindex","0");
      element.setAttribute("aria-label",`Open saved location ${place.name}`);
      element.title=`Fly to ${place.name}`;
      element.style.cursor="pointer";
      element.style.zIndex="5";
      const select=()=>onSavedLocationSelectRef.current(place);
      element.addEventListener("click",event=>{event.stopPropagation();select();});
      element.addEventListener("keydown",event=>{
        if(event.key==="Enter"||event.key===" "){
          event.preventDefault();event.stopPropagation();select();
        }
      });
      savedMarkersRef.current.push(marker);
    }
  },[]);

  useEffect(()=>{
    const map=mapRef.current;
    if(!map)return;
    let cancelled=false;
    void loadMapLibre().then(lib=>{
      if(cancelled||mapRef.current!==map)return;
      renderSavedMarkers(map,lib,savedLocations,selectedSavedLocationId);
    });
    return ()=>{cancelled=true;};
  },[savedLocations,selectedSavedLocationId,renderSavedMarkers]);

  // Storing the selected result outside MapLibre lets users switch between
  // indoor and outdoor tabs without losing the search destination.
  useEffect(() => {
    focusTargetRef.current = focusTarget;
    if (focusTarget) return;
    locationMarkerRef.current?.remove();
    locationMarkerRef.current = null;
    appliedFocusRequestRef.current = null;
  }, [focusTarget]);

  useEffect(() => {
    const map=mapRef.current;
    if (!map || !focusTarget || appliedFocusRequestRef.current===focusTarget.requestId) return;
    let cancelled=false;
    void loadMapLibre().then(lib=>{
      if(cancelled || mapRef.current!==map)return;
      locationMarkerRef.current?.remove();
      locationMarkerRef.current=null;
      renderSavedMarkers(map,lib,latestSavedLocationsRef.current,
        latestSelectedSavedIdRef.current);
      // A saved location already has its own clickable pin. Do not stack a
      // second (search-result) marker on top of it.
      if(!latestSavedLocationsRef.current.some(place=>place.id===focusTarget.id)){
        const marker=new lib.Marker({color:"#e11d48"})
          .setLngLat([focusTarget.longitude,focusTarget.latitude]).addTo(map);
        marker.getElement().setAttribute("aria-label",`Searched location: ${focusTarget.label}`);
        locationMarkerRef.current=marker;
      }
      appliedFocusRequestRef.current=focusTarget.requestId;
      map.flyTo({
        center:[focusTarget.longitude,focusTarget.latitude],
        zoom:focusTarget.zoom,
        duration:1800,
        essential:true,
      });
    });
    return ()=>{cancelled=true;};
  },[focusTarget,renderSavedMarkers]);

  useEffect(() => {
    let cancelled = false;
    const visitorMarkers=visitorMarkersRef.current;
    const visitorAnimations=visitorAnimationsRef.current;

    async function initialize() {
      try {
        const maplibregl = await loadMapLibre();
        if (cancelled || !containerRef.current) return;
        const map = new maplibregl.Map({
          container: containerRef.current,
          style: latestStyleRef.current,
          center: INITIAL_CAMERA.center,
          zoom: INITIAL_CAMERA.zoom,
        });
        mapRef.current = map;
        appliedStyleRef.current = latestStyleRef.current;
        map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "top-right");
        map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");
        map.getCanvas().style.cursor=(pickOnMapRef.current||placingFloorRef.current)?"crosshair":"";
        map.on("click",event=>{
          // Explicit placement/location pick modes take priority over inspection.
          if(placingFloorRef.current){
            onPlacementPointPickRef.current(event.lngLat.lng,event.lngLat.lat);
            return;
          }
          if(pickOnMapRef.current){
            const point=outdoorLocationFromMapPoint(
              event.lngLat.lng,event.lngLat.lat,map.getZoom());
            if(point)onMapPointPickRef.current(point);
            return;
          }
          // Applied floors are view-only: clicking their actual mapped polygon
          // surfaces inspects the location without moving any indoor geometry.
          if(editableFloorIdRef.current!==null)return;
          const visibleFloors=latestPreviewsRef.current.map(floor=>floor.floorId);
          const layers=visibleFloors.flatMap(floorId=>
            ["doorway-fill","stairs-fill","room-fill","walkable-fill"].map(name=>
              floorGeometryLayerId(floorId,name),
            )).filter(id=>Boolean(map.getLayer(id)));
          if(!layers.length){
            setInspectedFeature(null);
            return;
          }
          const features=map.queryRenderedFeatures(event.point,{layers});
          setInspectedFeature(inspectOutdoorIndoorFeature(
            features,visibleFloors,event.lngLat.lng,event.lngLat.lat,
          ));
        });
        const applyInitialSearch=()=>{
          const target=focusTargetRef.current;
          if(!target || appliedFocusRequestRef.current===target.requestId)return;
          locationMarkerRef.current?.remove();
          locationMarkerRef.current=null;
          if(!latestSavedLocationsRef.current.some(place=>place.id===target.id)){
            const marker=new maplibregl.Marker({color:"#e11d48"})
              .setLngLat([target.longitude,target.latitude]).addTo(map);
            marker.getElement().setAttribute("aria-label",`Searched location: ${target.label}`);
            locationMarkerRef.current=marker;
          }
          appliedFocusRequestRef.current=target.requestId;
          map.flyTo({center:[target.longitude,target.latitude],zoom:target.zoom,
            duration:1800,essential:true});
        };
        map.on("style.load", () => {
          statusCallbackRef.current("ready");
          setStyleReadyKey(k=>k+1);
        });
        map.on("load", ()=>{
          renderPlacedDevices(map,maplibregl,latestPreviewsRef.current);
          renderVisitorMarkers(map,maplibregl,latestVisitorsRef.current);
          renderSavedMarkers(map,maplibregl,latestSavedLocationsRef.current,
            latestSelectedSavedIdRef.current);
          applyInitialSearch();
        });
        map.on("error", (event) => {
          console.error("MapLibre error:", event.error);
          if (!map.isStyleLoaded()) statusCallbackRef.current("error");
        });
      } catch (error) {
        console.error("MapLibre initialization failed:", error);
        if (!cancelled) statusCallbackRef.current("error");
      }
    }

    void initialize();
    return () => {
      cancelled = true;
      locationMarkerRef.current?.remove();
      locationMarkerRef.current=null;
      savedMarkersRef.current.forEach(marker=>marker.remove());
      savedMarkersRef.current=[];
      deviceMarkersRef.current.forEach(marker=>marker.remove());
      deviceMarkersRef.current=[];
      visitorMarkers.forEach(marker=>marker.remove());
      visitorMarkers.clear();
      visitorAnimations.clear();
      floorHandleRef.current?.remove();
      floorHandleRef.current=null;
      transformHandlesRef.current.forEach(handle=>handle.remove());
      transformHandlesRef.current=[];
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [renderSavedMarkers,renderPlacedDevices,renderVisitorMarkers]);

  useEffect(() => {
    latestStyleRef.current = styleUrl;
    const map = mapRef.current;
    if (!map || appliedStyleRef.current === styleUrl) return;
    appliedStyleRef.current = styleUrl;
    map.setStyle(styleUrl);
  }, [styleUrl]);

  useEffect(() => {
    if (recenterKey === 0) return;
    mapRef.current?.flyTo({
      center: INITIAL_CAMERA.center,
      zoom: INITIAL_CAMERA.zoom,
      essential: true,
    });
  }, [recenterKey]);

  return (
    <>
      <div
        ref={containerRef}
        className="absolute inset-0 h-full w-full"
        aria-label="Interactive map viewer"
        role="application"
      />
      {inspectedFeature&&editableFloorId===null&&
        placementPreviews.some(floor=>floor.floorId===inspectedFeature.floorId)&&
        <div role="status" aria-label="Selected indoor feature"
          className="pointer-events-auto absolute bottom-14 right-4 z-20 w-72 max-w-[calc(100%-2rem)] rounded-xl border border-slate-200 bg-white/95 p-3 text-sm shadow-xl backdrop-blur-sm">
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
              Indoor feature · {inspectedFeature.category==="walkable"?"Walking area":inspectedFeature.category}
            </p>
            <button type="button" aria-label="Close indoor inspection"
              className="rounded-md px-2 py-0.5 font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              onClick={()=>setInspectedFeature(null)}>×</button>
          </div>
          <p className="mt-2 break-words leading-6 text-slate-800">
            You are clicking <strong>&ldquo;{inspectedFeature.name}&rdquo;</strong> at
            <span className="font-semibold"> {inspectedFeature.longitude.toFixed(6)},
            {" "}{inspectedFeature.latitude.toFixed(6)}</span> coordinates.
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            Longitude, latitude · WGS84 geographic coordinates
          </p>
          {inspectedFeature.category==="room"&&
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button type="button"
                className="rounded-md border border-emerald-600 bg-emerald-50 p-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
                onClick={()=>onNavigationRoomPick(inspectedFeature.floorId,inspectedFeature.featureId,"start")}>
                Start route here
              </button>
              <button type="button"
                className="rounded-md border border-red-600 bg-red-50 p-2 text-xs font-semibold text-red-800 hover:bg-red-100"
                onClick={()=>onNavigationRoomPick(inspectedFeature.floorId,inspectedFeature.featureId,"end")}>
                Navigate here
              </button>
            </div>}
        </div>}
    </>
  );
}
