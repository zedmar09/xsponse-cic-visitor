"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Camera, CheckCircle2, ChevronRight, Download, DoorOpen, FileImage,
  Footprints, Layers3, LocateFixed, Map as MapIcon, MapPinned,
  MousePointer2, PanelLeftClose, PanelLeftOpen, Pencil, Save,
  Settings2, Trash2, Undo2, Redo2, Upload, X, Route,
} from "lucide-react";
import { MapCanvas, type FloorPlacementPreview, type MapStatus } from "@/components/map/map-canvas";
import { defaultFloorPlacement, floorImageCorners, floorPlacementError, floorPlacementHeight, resizeFloorHeight, resizeFloorWidth, scaleFloorProportionally, type OutdoorFloorPlacement } from "@/lib/outdoor-floor-placement";
import { OutdoorLocationSearch } from "@/components/map/outdoor-location-search";
import { OutdoorLocationManager } from "@/components/map/outdoor-location-manager";
import { IndoorLocationSelector } from "@/components/map/indoor-location-selector";
import { DeviceInventory } from "@/components/map/device-inventory";
import { identifyDeviceSpaces, type CameraCoverage, type DeviceSpatialMatch, type DeviceLanding } from "@/lib/device-spatial";
import {
  ensureLocationDevices,deleteLocationDevices,stageDevicePlacement,stageDeviceConfiguration,
  stageDeviceUnplacement,saveDevicePlacement,deviceChangesPending,type LocationDevice,
} from "@/lib/location-devices";
import { assignFloorLocation, locationFloors as floorsForLocation, unassignedLocationFloors, unassignFloorLocation } from "@/lib/indoor-location-links";
import type { OutdoorLocation } from "@/lib/outdoor-search";
import { asOutdoorSearchTarget, createSavedLocation, renameSavedLocation, type SavedOutdoorLocation } from "@/lib/saved-outdoor-locations";
import { addOutdoorLocation, updateOutdoorLocation, deleteOutdoorLocation, listOutdoorLocations } from "@/lib/outdoor-location-storage";
import { FloorPlanCanvas, type EditorMode } from "@/components/map/floor-plan-canvas";
import { FloorManager } from "@/components/map/floor-manager";
import { NavigationAuditPanel } from "@/components/map/navigation-audit-panel";
import { StaircaseDestinationPicker } from "@/components/map/staircase-destination-picker";
import { Button } from "@/components/ui/button";
import {
  defaultSpatialHierarchy, displayDoorPurpose, doorwayReviewIssues, doorwaySetupError, ensureSpatialFoundation, exportFloorPlanMetadata, normalizedPoint, polygonError, segmentImageLength, suggestDoorwaySides, DOOR_DEPTH_DEFAULT,
  type AreaKind, type DoorUsage, type FloorArea, type FloorMarker, type FloorPlanRecord,
  type DoorPurpose, type FloorPortal, type PixelPoint,
} from "@/lib/floor-plan";
import { addFloorPlan, listFloorPlans, listStaircases, loadFloorPlan, removeFloorPlan, replaceFloorPlanImage, saveFloorPlan, saveStaircase, selectFloorPlan } from "@/lib/floor-plan-storage";
import { landingOnFloor, stairConnectionLabel, type Staircase, type StairDirection } from "@/lib/staircases";
import { DoorwayEditor } from "@/components/map/doorway-editor";
import { useDrawingHistory } from "@/lib/use-drawing-history";
import { cn } from "@/lib/utils";
import { buildNavigationAudit, findValidatedRoute, walkwayPairId, type WalkwayCandidate } from "@/lib/navigation-graph";
import { findShortestMappedRoute } from "@/lib/navigation-shortest-route";
import { buildFloorRouteSteps } from "@/lib/navigation-multifloor";
import { buildOutdoorNavigationOverlay,outdoorNavigationSummary } from "@/lib/outdoor-navigation";
import { outdoorNavigationScope,outdoorNavigationProblems } from "@/lib/outdoor-navigation-connectivity";
import { verticalKind, matchVerticalFloors } from "@/lib/vertical-connections";
import { DEFAULT_DISPLAY_SETTINGS, DISPLAY_SETTINGS_KEY, parseDisplaySettings, type MapDisplaySettings } from "@/lib/map-display-settings";

const MAX_BYTES = 20 * 1024 * 1024;
const ACCEPTED = ["image/png", "image/jpeg", "image/webp"];
const STREETS = process.env.NEXT_PUBLIC_MAP_STYLE_URL || "https://tiles.openfreemap.org/styles/liberty";
const LIGHT = "https://tiles.openfreemap.org/styles/positron";
type Mode = "floor" | "street";
type ActivePlan = { record: FloorPlanRecord; url: string };
type Feedback = { type: "success" | "error"; message: string } | null;
const LABELS: Record<Exclude<EditorMode,"move"|"inspect">,string> = {
  room:"Room",walkable:"Walking area",door:"Doorway",camera:"Camera",device:"Device",
  staircase:"Staircase", "stair-landing":"Staircase entry point",
};
const USAGE: Record<DoorUsage,string> = {
  entrance:"Entrance only (A → B)", exit:"Exit only (B → A)", both:"Entrance & exit", internal:"Internal (legacy)",
};
const isArea = (tool:EditorMode):tool is AreaKind => tool==="room" || tool==="walkable";
const isMarker = (tool:EditorMode):tool is "camera"|"device" => tool==="camera" || tool==="device";

async function dimensions(file: File) {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<{width:number;height:number}>((resolve,reject)=>{
      const image=new Image();
      image.onload=()=>image.naturalWidth&&image.naturalHeight
        ?resolve({width:image.naturalWidth,height:image.naturalHeight})
        :reject(new Error("Invalid image dimensions."));
      image.onerror=()=>reject(new Error("The image could not be opened."));
      image.src=url;
    });
  } finally { URL.revokeObjectURL(url); }
}
function pointInRoom(p:PixelPoint,points:PixelPoint[]) {
  let inside=false;
  for(let i=0,j=points.length-1;i<points.length;j=i++) {
    const a=points[i],b=points[j];
    if((a.y>p.y)!==(b.y>p.y) && p.x < (b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x) inside=!inside;
  }
  return inside;
}
function Dot({color}:{color:string}) {
  return <span className={cn("inline-block size-2.5 shrink-0 rounded-full",color)}/>;
}
function ToolButton({name,active,disabled,onClick,icon}:{
  name:string;active:boolean;disabled:boolean;onClick:()=>void;icon:React.ReactNode;
}) {
  return <button type="button" onClick={onClick} disabled={disabled} aria-pressed={active}
    className={cn("flex min-h-11 items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-xs font-semibold transition-colors disabled:opacity-40",
      active?"border-blue-500 bg-blue-50 text-blue-800":"border-border bg-white hover:border-blue-300 hover:bg-blue-50/40")}>
    {icon} {name}
  </button>;
}
export function MapWorkspace() {
  const fileInput=useRef<HTMLInputElement>(null);
  const nextFloorRef=useRef<{name:string;level:number|null}|null>(null);
  const roomSectionRef=useRef<HTMLDetailsElement>(null);
  const doorSectionRef=useRef<HTMLDetailsElement>(null);
  const stairSectionRef=useRef<HTMLDetailsElement>(null);
  const [view,setView]=useState<Mode>("floor");
  const [streetStyle,setStreetStyle]=useState(STREETS);
  const [status,setStatus]=useState<MapStatus>("loading");
  const [panelOpen,setPanelOpen]=useState(true);
  const [resetStreet,setResetStreet]=useState(0);
  const [streetTarget,setStreetTarget]=useState<(OutdoorLocation&{requestId:number})|null>(null);
  const [searchChoice,setSearchChoice]=useState<OutdoorLocation|null>(null);
  const [pickOnMap,setPickOnMap]=useState(false);
  const [savedLocations,setSavedLocations]=useState<SavedOutdoorLocation[]>([]);
  const [selectedSavedLocationId,setSelectedSavedLocationId]=useState<string|null>(null);
  const [selectedIndoorLocationId,setSelectedIndoorLocationId]=useState<string|null>(null);
  const [placementFloorId,setPlacementFloorId]=useState<string|null>(null);
  const [placementDraft,setPlacementDraft]=useState<OutdoorFloorPlacement|null>(null);
  // Saved floor placements are locked by default. Unsaved floors are editable.
  const [editingPlacedFloorId,setEditingPlacedFloorId]=useState<string|null>(null);
  const [placingFloor,setPlacingFloor]=useState(false);
  // Session-only visibility; never reveal floor imagery merely by selecting a location.
  const [visibleFloorIds,setVisibleFloorIds]=useState<string[]>([]);
  const [showAllIndoorFloors,setShowAllIndoorFloors]=useState(false);
  const [outdoorNavigationEnabled,setOutdoorNavigationEnabled]=useState(false);
  const [outdoorNavigationStartId,setOutdoorNavigationStartId]=useState<string|null>(null);
  const [outdoorNavigationEndId,setOutdoorNavigationEndId]=useState<string|null>(null);
  const [outdoorConnectionSnapshot,setOutdoorConnectionSnapshot]=useState<{
    key:string;stairs:Staircase[];error:string|null;
  }|null>(null);
  const [lockProportions,setLockProportions]=useState(true);
  const [placementEditMode,setPlacementEditMode]=useState<"resize"|"skew">("resize");
  const [outdoorStorageError,setOutdoorStorageError]=useState<string|null>(null);
  const [fit,setFit]=useState(0);
  const [plan,setPlan]=useState<ActivePlan|null>(null);
  const [floors,setFloors]=useState<FloorPlanRecord[]>([]);
  const [locationDevices,setLocationDevices]=useState<LocationDevice[]>([]);
  const [savedDeviceBaseline,setSavedDeviceBaseline]=useState<LocationDevice[]>([]);
  const [deviceSaveRevision,setDeviceSaveRevision]=useState(0);
  const [deviceResetKey,setDeviceResetKey]=useState(0);
  const [outdoorDevices,setOutdoorDevices]=useState<LocationDevice[]>([]);
  const [selectedDeviceId,setSelectedDeviceId]=useState<string|null>(null);
  const [inventoryStairs,setInventoryStairs]=useState<Staircase[]>([]);
  const [staircases,setStaircases]=useState<Staircase[]>([]);
  const [navigationVisible,setNavigationVisible]=useState(false);
  const [navigationStartId,setNavigationStartId]=useState<string|null>(null);
  const [navigationDestinationId,setNavigationDestinationId]=useState<string|null>(null);
  const [editingStairId,setEditingStairId]=useState<string|null>(null);
  const [stairDirection,setStairDirection]=useState<StairDirection>("both");
  const [stairKind,setStairKind]=useState<"staircase"|"elevator">("staircase");
  const [focusRoute,setFocusRoute]=useState(0);
  const [displaySettings,setDisplaySettings]=useState<MapDisplaySettings>(DEFAULT_DISPLAY_SETTINGS);
  const [stairTargetIds,setStairTargetIds]=useState<string[]>([]);
  const [configuringStairId,setConfiguringStairId]=useState<string|null>(null);
  const [loading,setLoading]=useState(true);
  useEffect(()=>{
    let cancelled=false;
    void listOutdoorLocations().then(locations=>{
      if(!cancelled)setSavedLocations(locations);
    }).catch(reason=>{
      if(!cancelled)setOutdoorStorageError(reason instanceof Error?reason.message:
        "Could not read saved outdoor locations.");
    });
    return ()=>{cancelled=true;};
  },[]);
  const pickSavedLocation=(location:SavedOutdoorLocation)=>{
    setPickOnMap(false);
    setVisibleFloorIds([]);
    setShowAllIndoorFloors(false);
    setOutdoorNavigationEnabled(false);
    setOutdoorNavigationStartId(null);
    setOutdoorNavigationEndId(null);
    setLockProportions(true);
    setPlacementEditMode("resize");
    setEditingPlacedFloorId(null);
    setSelectedSavedLocationId(location.id);
    const first=floors.find(f=>f.locationId===location.id&&f.outdoorPlacement)
      ??floors.find(f=>f.locationId===location.id);
    setPlacementFloorId(first?.id??null);
    setPlacementDraft(first?.outdoorPlacement??
      (first?defaultFloorPlacement(location.longitude,location.latitude):null));
    setPlacingFloor(false);
    setSearchChoice(null);
    const centre=first?.outdoorPlacement;
    setStreetTarget(previous=>({
      ...asOutdoorSearchTarget(location),
      longitude:centre?.longitude??location.longitude,
      latitude:centre?.latitude??location.latitude,
      zoom:Math.max(19,location.zoom),
      requestId:(previous?.requestId??0)+1,
    }));
  };
  const pickOutdoorMapPoint=(point:OutdoorLocation)=>{
    setPickOnMap(false);
    setSearchChoice(point);
    setSelectedSavedLocationId(null);
    setPlacementFloorId(null);setPlacementDraft(null);setPlacingFloor(false);
    setEditingPlacedFloorId(null);
    setVisibleFloorIds([]);
    setShowAllIndoorFloors(false);
    setOutdoorNavigationEnabled(false);
    setOutdoorNavigationStartId(null);
    setOutdoorNavigationEndId(null);
    setStreetTarget(old=>({...point,requestId:(old?.requestId??0)+1}));
  };
  const addSearchedLocation=async(name:string)=>{
    if(!searchChoice)throw new Error("Search for a location and select its result first.");
    const record=createSavedLocation(searchChoice,name,crypto.randomUUID(),new Date().toISOString());
    if(savedLocations.some(place=>place.name.toLowerCase()===record.name.toLowerCase()&&
      Math.abs(place.longitude-record.longitude)<.00001&&
      Math.abs(place.latitude-record.latitude)<.00001))
      throw new Error("This location is already saved. Select it below.");
    await addOutdoorLocation(record);
    ensureLocationDevices(record.id);
    setSavedLocations(await listOutdoorLocations());
    pickSavedLocation(record);
  };
  const renameOutdoorPlace=async(id:string,name:string)=>{
    const previous=savedLocations.find(place=>place.id===id);
    if(!previous)throw new Error("This location could not be found.");
    const updated=renameSavedLocation(previous,name,new Date().toISOString());
    await updateOutdoorLocation(updated);
    setSavedLocations(await listOutdoorLocations());
    if(selectedSavedLocationId===id){
      setStreetTarget(previousTarget=>previousTarget?.id===id?
        {...previousTarget,label:updated.name}:previousTarget);
    }
  };
  const removeOutdoorPlace=async(id:string)=>{
    await deleteOutdoorLocation(id);
    try { deleteLocationDevices(id); } catch { /* Location deletion remains authoritative. */ }
    setSavedLocations(await listOutdoorLocations());
    if(selectedSavedLocationId===id){
      setSelectedSavedLocationId(null);
      setPlacementFloorId(null);setPlacementDraft(null);setPlacingFloor(false);
      setEditingPlacedFloorId(null);
      setVisibleFloorIds([]);
      setShowAllIndoorFloors(false);
      setOutdoorNavigationEnabled(false);
      setOutdoorNavigationStartId(null);
      setOutdoorNavigationEndId(null);
      setStreetTarget(null);
    }
  };

  useEffect(()=>{
    try{
      const saved=window.localStorage.getItem(DISPLAY_SETTINGS_KEY);
      if(saved)Promise.resolve().then(()=>setDisplaySettings(parseDisplaySettings(JSON.parse(saved))));
    }catch{/* Browser may disable storage; defaults still work. */}
  },[]);
  const changeDisplay=(key:keyof MapDisplaySettings,checked:boolean)=>{
    const next={...displaySettings,[key]:checked};
    setDisplaySettings(next);
    try{window.localStorage.setItem(DISPLAY_SETTINGS_KEY,JSON.stringify(next));}catch{/* session only */}
  };
  const [saving,setSaving]=useState(false);
  const [planName,setPlanName]=useState("");
  const [floorName,setFloorName]=useState("");
  const [floorLevel,setFloorLevel]=useState("");
  const setHierarchyFields=useCallback((data:FloorPlanRecord)=>{
    const h=data.hierarchy;
    if(!h)return;
    setFloorName(h.floor.name);setFloorLevel(h.floor.level===null?"":String(h.floor.level));
  },[]);
  const [tool,setTool]=useState<EditorMode>("move");
  const drawing=useDrawingHistory();
  const addDraftPoint=drawing.add;
  const undoDraft=drawing.undo;
  const redoDraft=drawing.redo;
  const resetDraft=drawing.reset;
  const closeDraft=drawing.close;
  const canUndoDraft=drawing.undoAvailable;
  const canRedoDraft=drawing.redoAvailable;
  const draft=drawing.points;
  const doorPoints=drawing.points;
  const draftClosed=drawing.closed;
  const [doorUsage,setDoorUsage]=useState<DoorUsage>("both");
  const [doorPurpose,setDoorPurpose]=useState<DoorPurpose>("interior");
  const [doorDepth,setDoorDepth]=useState(DOOR_DEPTH_DEFAULT);
  const [spaceAId,setSpaceAId]=useState("");
  const [spaceBId,setSpaceBId]=useState("");
  const [draftPoint,setDraftPoint]=useState<PixelPoint|null>(null);
  const [draftName,setDraftName]=useState("");
  const [editingAreaId,setEditingAreaId]=useState<string|null>(null);
  const [editingDoorId,setEditingDoorId]=useState<string|null>(null);
  const [inspected,setInspected]=useState<PixelPoint|null>(null);
  const [feedback,setFeedback]=useState<Feedback>(null);
  useEffect(()=>{
    let cancelled=false;
    // Defer the IndexedDB-adjacent browser inventory read to avoid synchronous
    // state updates inside a React effect.
    void Promise.resolve().then(()=>{
      if(cancelled)return;
      if(!selectedIndoorLocationId){
        setLocationDevices([]);setSavedDeviceBaseline([]);setSelectedDeviceId(null);return;
      }
      try {
        const inventory=ensureLocationDevices(selectedIndoorLocationId);
        setLocationDevices(inventory);
        setSavedDeviceBaseline(inventory);
        setSelectedDeviceId(null);
      }catch(error){
        setLocationDevices([]);setSavedDeviceBaseline([]);
        setFeedback({type:"error",message:error instanceof Error?error.message:"Unable to load device inventory."});
      }
    });
    return ()=>{cancelled=true;};
  },[selectedIndoorLocationId]);
  useEffect(()=>{
    let cancelled=false;
    void Promise.resolve().then(()=>{
      if(cancelled)return;
      try {setOutdoorDevices(selectedSavedLocationId?ensureLocationDevices(selectedSavedLocationId):[]);}
      catch {setOutdoorDevices([]);}
    });
    return ()=>{cancelled=true;};
  },[selectedSavedLocationId,deviceSaveRevision]);
  useEffect(()=>{
    let cancelled=false;
    const buildingIds=[...new Set(floors
      .filter(f=>f.locationId===selectedIndoorLocationId&&f.hierarchy?.building.id)
      .map(f=>f.hierarchy!.building.id))];
    void Promise.all(buildingIds.map(id=>listStaircases(id))).then(groups=>{
      if(!cancelled)setInventoryStairs(groups.flat());
    }).catch(()=>{if(!cancelled)setInventoryStairs([]);});
    return ()=>{cancelled=true;};
  },[floors,selectedIndoorLocationId,staircases]);
  const record=plan?.record??null;
  const hierarchy=record?.hierarchy;
  const locationFloors=floorsForLocation(floors,selectedIndoorLocationId);
  const unassignedFloors=unassignedLocationFloors(floors,savedLocations.map(l=>l.id));
  const pendingDeviceChanges=deviceChangesPending(locationDevices,savedDeviceBaseline);
  const deviceAssignments=useMemo<Record<string,DeviceSpatialMatch[]>>(()=>{
    const result:Record<string,DeviceSpatialMatch[]>={};
    for(const device of locationDevices){
      if(!device.point||!device.floorId)continue;
      const floor=floors.find(f=>f.id===device.floorId&&f.locationId===device.locationId);
      if(!floor)continue;
      const floorId=floor.hierarchy?.floor.id??floor.planId;
      const landings:DeviceLanding[]=inventoryStairs.flatMap(stair=>{
        const landing=landingOnFloor(stair,floorId);
        return landing?[{id:stair.id,name:stair.name,kind:verticalKind(stair),outline:landing.outline}]:[];
      });
      result[device.uuid]=identifyDeviceSpaces(device.point,floor.areas??[],floor.portals??[],landings);
    }
    return result;
  },[locationDevices,floors,inventoryStairs]);
  const placementLocation=savedLocations.find(loc=>loc.id===selectedSavedLocationId)??null;
  const placementFloor=floors.find(f=>f.id===placementFloorId&&f.locationId===selectedSavedLocationId)??null;
  const placementUnlocked=Boolean(placementFloor&&
    (!placementFloor.outdoorPlacement||editingPlacedFloorId===placementFloor.id));
  const startEditingPlacement=()=>{
    if(!placementFloor?.outdoorPlacement)return;
    // Never display a route using the saved transform while its floor is
    // moving in an unsaved draft; re-enable navigation after applying.
    setOutdoorNavigationEnabled(false);
    setPlacementDraft(placementFloor.outdoorPlacement);
    setPlacementEditMode("resize");
    setPlacingFloor(false);
    setFeedback(null);
    setEditingPlacedFloorId(placementFloor.id);
  };
  const cancelEditingPlacement=()=>{
    if(!placementFloor?.outdoorPlacement)return;
    setPlacementDraft(placementFloor.outdoorPlacement);
    setEditingPlacedFloorId(null);
    setPlacingFloor(false);
    setFeedback(null);
  };
  // Geometry is the primary outdoor layer. Only the image is optional.
  const placementPreviews=useMemo<FloorPlacementPreview[]>(()=>
    floors.filter(f=>f.locationId===selectedSavedLocationId&&
      (f.id===placementFloorId||visibleFloorIds.includes(f.id)||
        ((showAllIndoorFloors||outdoorNavigationEnabled)&&Boolean(f.outdoorPlacement))))
      .flatMap(f=>{
        const alignment=f.id===placementFloorId?placementDraft:f.outdoorPlacement;
        if(!alignment||floorPlacementError(alignment))return [];
        // A saved or edited warp must remain a valid convex floor polygon.
        // Never let one malformed plan prevent the other floors from rendering.
        try{floorImageCorners(alignment,f.width,f.height);}
        catch{return [];}
        const id=f.hierarchy?.floor.id??f.planId;
        return [{
          floorId:f.id,name:f.hierarchy?.floor.name??f.name,
          image:f.originalImage??f.image,showImage:visibleFloorIds.includes(f.id),
          imageWidth:f.width,imageHeight:f.height,placement:alignment,
          areas:f.areas??[],portals:f.portals??[],markers:f.markers??[],
          devices:outdoorDevices.filter(device=>device.floorId===f.id),
          landings:staircases.flatMap(stair=>{
            const landing=landingOnFloor(stair,id);
            return landing?[{id:stair.id,name:stair.name,
              kind:verticalKind(stair),outline:landing.outline}]:[];
          }),
        }];
      }),[floors,staircases,selectedSavedLocationId,visibleFloorIds,
        placementFloorId,placementDraft,showAllIndoorFloors,outdoorNavigationEnabled,outdoorDevices]);
  // The INDOOR graph is not limited to floors with a saved outdoor position.
  // Otherwise a valid journey via an intermediate (as-yet unplaced) floor
  // falsely reports "No validated route" on Street map.
  const outdoorScope=useMemo(()=>outdoorNavigationScope(
    floors,selectedSavedLocationId),[floors,selectedSavedLocationId]);
  const outdoorNavFloors=outdoorScope.placedFloors;
  const outdoorGraphFloors=outdoorScope.graphFloors;
  const outdoorConnectionKey=`${selectedSavedLocationId??""}:${outdoorScope.buildingIds.join("|")}`;
  // Stairs are stored in a separate IndexedDB store. The old implementation
  // reused the active Indoor plan's stair list, which is empty or for the
  // WRONG group when arriving directly on Street map after a page reload.
  useEffect(()=>{
    if(!outdoorNavigationEnabled||!selectedSavedLocationId)return;
    let cancelled=false;
    const {buildingIds}=outdoorNavigationScope(floors,selectedSavedLocationId);
    const key=`${selectedSavedLocationId}:${buildingIds.join("|")}`;
    void Promise.all(buildingIds.map(id=>listStaircases(id)))
      .then(groups=>{
        if(!cancelled)setOutdoorConnectionSnapshot({
          key,stairs:groups.flat(),error:null,
        });
      }).catch(reason=>{
        if(!cancelled)setOutdoorConnectionSnapshot({key,stairs:[],error:
          reason instanceof Error?reason.message:"Saved stair/elevator links could not be loaded.",
        });
      });
    return ()=>{cancelled=true;};
  },[outdoorNavigationEnabled,selectedSavedLocationId,floors]);
  const outdoorConnectionsLoaded=outdoorConnectionSnapshot?.key===outdoorConnectionKey;
  const outdoorStairs=outdoorConnectionsLoaded?outdoorConnectionSnapshot!.stairs:[];
  const outdoorNavReady=outdoorNavigationEnabled&&outdoorConnectionsLoaded&&
    !outdoorConnectionSnapshot?.error;
  const outdoorNavAudit=useMemo(()=>buildNavigationAudit(
    outdoorNavReady?outdoorGraphFloors:[],
    outdoorNavReady?outdoorStairs:[],
  ),[outdoorNavReady,outdoorGraphFloors,outdoorStairs]);
  // Only *placed* rooms appear as outdoor route choices, but routes can
  // traverse other floors in the same saved location through verified links.
  const outdoorNavRooms=useMemo(()=>{
    const placed=new Set(outdoorNavFloors.map(f=>f.hierarchy?.floor.id??f.planId));
    return outdoorNavAudit.nodes.filter(node=>node.kind==="room"&&placed.has(node.floorId))
      .sort((a,b)=>a.floorId.localeCompare(b.floorId)||a.label.localeCompare(b.label));
  },[outdoorNavAudit,outdoorNavFloors]);
  const outdoorStart=outdoorNavRooms.find(node=>node.id===outdoorNavigationStartId)??null;
  const outdoorEnd=outdoorNavRooms.find(node=>node.id===outdoorNavigationEndId)??null;
  const outdoorRoute=useMemo(()=>{
    const shortest=findShortestMappedRoute(outdoorNavAudit,outdoorGraphFloors,
      outdoorStairs,outdoorStart?.id??null,outdoorEnd?.id??null);
    if(shortest.status!=="unreachable")return shortest;
    const checked=findValidatedRoute(outdoorNavAudit,outdoorStart?.id??null,outdoorEnd?.id??null);
    return checked.status==="ready"?{...checked,routeSource:"topology" as const}:shortest;
  },[outdoorNavAudit,outdoorGraphFloors,outdoorStairs,outdoorStart?.id,outdoorEnd?.id]);
  const outdoorRouteProblems=useMemo(()=>outdoorNavigationProblems(
    outdoorNavAudit,outdoorRoute,outdoorStart,outdoorEnd),
    [outdoorNavAudit,outdoorRoute,outdoorStart,outdoorEnd]);
  const outdoorRouteSteps=useMemo(()=>buildFloorRouteSteps(
    outdoorGraphFloors,outdoorStairs,outdoorRoute),
    [outdoorGraphFloors,outdoorStairs,outdoorRoute]);
  const outdoorRouteOverlay=useMemo(()=>buildOutdoorNavigationOverlay(
    outdoorRoute,outdoorRouteSteps,outdoorNavFloors),
    [outdoorRoute,outdoorRouteSteps,outdoorNavFloors]);
  const outdoorRouteSummary=useMemo(()=>outdoorNavigationSummary(
    outdoorRoute,outdoorRouteSteps,new Set(outdoorNavFloors.map(f=>
      f.hierarchy?.floor.id??f.planId))),
    [outdoorRoute,outdoorRouteSteps,outdoorNavFloors]);
  const outdoorFloorName=(floorId:string)=>{
    const found=outdoorNavFloors.find(f=>(f.hierarchy?.floor.id??f.planId)===floorId);
    return found?.hierarchy?.floor.name??found?.name??"Floor";
  };
  const setRouteRoomFromMap=(floorId:string,featureId:string,endpoint:"start"|"end")=>{
    if(!outdoorNavFloors.some(f=>(f.hierarchy?.floor.id??f.planId)===floorId&&
      (f.areas??[]).some(area=>area.id===featureId&&area.kind==="room")))return;
    const nodeId=`${floorId}:area:${featureId}`;
    setOutdoorNavigationEnabled(true);
    if(endpoint==="start"){
      setOutdoorNavigationStartId(nodeId);
      if(outdoorNavigationEndId===nodeId)setOutdoorNavigationEndId(null);
    }else{
      setOutdoorNavigationEndId(nodeId);
      if(outdoorNavigationStartId===nodeId)setOutdoorNavigationStartId(null);
    }
  };
  const toggleFloorVisibility=(id:string,visible:boolean)=>{
    const floor=floors.find(f=>f.id===id&&f.locationId===selectedSavedLocationId);
    if(!floor)return;
    // If a floor has not been saved to the outdoor map, select it first to
    // offer its initial placement preview rather than displaying nothing.
    if(visible&&id!==placementFloorId)choosePlacementFloor(id);
    setVisibleFloorIds(ids=>visible?[...new Set([...ids,id])]:ids.filter(item=>item!==id));
  };
  const choosePlacementFloor=(id:string)=>{
    setLockProportions(true);
    setPlacementEditMode("resize");
    setEditingPlacedFloorId(null);
    const floor=floors.find(f=>f.id===id&&f.locationId===selectedSavedLocationId);
    setPlacingFloor(false);
    setPlacementFloorId(floor?.id??null);
    const alignment=floor&&placementLocation?
      floor.outdoorPlacement??defaultFloorPlacement(placementLocation.longitude,placementLocation.latitude):null;
    setPlacementDraft(alignment);
    if(alignment&&placementLocation)setStreetTarget(previous=>({
      ...asOutdoorSearchTarget(placementLocation),
      longitude:alignment.longitude,latitude:alignment.latitude,zoom:19,
      requestId:(previous?.requestId??0)+1,
    }));
    setFeedback(null);
  };
  const saveOutdoorPlacement=async()=>{
    if(!placementUnlocked||!placementFloor||!placementDraft||!placementLocation)return;
    const error=floorPlacementError(placementDraft);
    if(error){setFeedback({type:"error",message:error});return;}
    try{floorImageCorners(placementDraft,placementFloor.width,placementFloor.height);}
    catch(reason){
      setFeedback({type:"error",message:reason instanceof Error?reason.message:
        "The floor warp is invalid. Adjust the skew corners before applying."});
      return;
    }
    setSaving(true);setFeedback(null);
    try{
      const current=await loadFloorPlan(placementFloor.id);
      if(!current||current.locationId!==placementLocation.id)
        throw new Error("This floor is no longer assigned to the selected location.");
      const updated={...current,outdoorPlacement:placementDraft,updatedAt:new Date().toISOString()};
      await saveFloorPlan(updated);
      setFloors(await listFloorPlans());
      setPlan(previous=>previous?.record.id===updated.id?{...previous,record:updated}:previous);
      setPlacingFloor(false);
      setEditingPlacedFloorId(null);
      setFeedback({type:"success",message:`Applied and locked ${updated.hierarchy?.floor.name??updated.name}. Use Edit placement to reposition it.`});
    }catch(reason){
      setFeedback({type:"error",message:reason instanceof Error?reason.message:"Unable to save floor placement."});
    }finally{setSaving(false);}
  };
  const clearOutdoorPlacement=async()=>{
    if(!placementFloor||!placementLocation)return;
    setSaving(true);setFeedback(null);
    try{
      const current=await loadFloorPlan(placementFloor.id);
      if(!current||current.locationId!==placementLocation.id)
        throw new Error("This floor is no longer at this location.");
      const updated={...current,outdoorPlacement:null,updatedAt:new Date().toISOString()};
      await saveFloorPlan(updated);
      setFloors(await listFloorPlans());
      setPlan(previous=>previous?.record.id===updated.id?{...previous,record:updated}:previous);
      setPlacementDraft(defaultFloorPlacement(placementLocation.longitude,placementLocation.latitude));
      setEditingPlacedFloorId(null);
      setPlacingFloor(false);
      setVisibleFloorIds(ids=>ids.filter(id=>id!==updated.id));
      setFeedback({type:"success",message:"Saved placement removed; indoor geometry is unchanged."});
    }catch(reason){
      setFeedback({type:"error",message:reason instanceof Error?reason.message:"Unable to remove placement."});
    }finally{setSaving(false);}
  };
  const areas=record?.areas??[];
  const markers=record?.markers??[];
  const portals=record?.portals??[];
  const auditBuildingId=hierarchy?.building.id;
  const navigationReport=useMemo(()=>buildNavigationAudit(
    navigationVisible?floors.filter(f=>f.hierarchy?.building.id===auditBuildingId):[],
    navigationVisible?staircases:[],
  ),[navigationVisible,floors,staircases,auditBuildingId]);
  const buildingFloors=useMemo(()=>
    floors.filter(f=>f.hierarchy?.building.id===auditBuildingId),
    [floors,auditBuildingId]);
  const verticalMatches=matchVerticalFloors(buildingFloors,staircases);
  const navRooms=navigationReport.nodes.filter(n=>n.kind==="room")
    .sort((a,b)=>a.label.localeCompare(b.label));
  const navStart=navRooms.find(n=>n.id===navigationStartId)??navRooms.find(n=>n.floorId===hierarchy?.floor.id)??navRooms[0]??null;
  const navDestination=navRooms.find(n=>n.id===navigationDestinationId&&n.id!==navStart?.id)??null;
  const originNodeId=navStart?.id??null;
  const destinationNodeId=navDestination?.id??null;
  const navRoute=useMemo(()=>{
    const shortest=findShortestMappedRoute(
      navigationReport,buildingFloors,staircases,originNodeId,destinationNodeId);
    // Network connectivity and drawable geometry are different questions.
    // Do not report "No valid route" when every saved doorway/stair link
    // is approved but the stricter shortest-path sampling is inconclusive.
    if(shortest.status!=="unreachable")return shortest;
    const topology=findValidatedRoute(navigationReport,originNodeId,destinationNodeId);
    return topology.status==="ready"?{...topology,routeSource:"topology" as const}:shortest;
  },[navigationReport,buildingFloors,staircases,originNodeId,destinationNodeId]);
  const routeSteps=useMemo(()=>buildFloorRouteSteps(
    buildingFloors,staircases,navRoute),[buildingFloors,staircases,navRoute]);
  const activeRouteStep=routeSteps.find(step=>step.floorId===hierarchy?.floor.id);
  const navGuidance=activeRouteStep?.guidance??null;
  // A connected graph is not proof of a safe, drawable line. Do not place
  // misleading room-center endpoints when the clearance path is unavailable.
  const navSelection=navigationVisible&&activeRouteStep&&navGuidance?.status==="guided"?
    {start:navGuidance.points[0],end:navGuidance.points[navGuidance.points.length-1],
      checkpoints:[],path:navGuidance.points,estimated:false}:null;
  const onStatus=useCallback((next:MapStatus)=>setStatus(next),[]);

  // No image blob/shape conversion: the original legacy floor stays in IndexedDB.
  const showFloor=useCallback((saved:FloorPlanRecord)=>{
    const original=saved.originalImage??saved.image;
    setPlan({record:{...saved,image:original,mimeType:original.type||saved.mimeType,
      imageOptions:{cleanup:"off",enhance:false}},url:URL.createObjectURL(original)});
    setPlanName(saved.name);
    setHierarchyFields(saved);
    setStatus("loading");
    setView("floor");
  },[setHierarchyFields]);

  useEffect(()=>{
    let cancelled=false;
    void Promise.all([listFloorPlans(),loadFloorPlan()]).then(([savedFloors,saved])=>{
      if(cancelled)return;
      setFloors(savedFloors);
      // Don't silently edit a floor belonging to another location. Previous
      // indoor floors without a location remain saved and can be assigned.
      if(saved?.locationId){
        setSelectedIndoorLocationId(saved.locationId);
        showFloor(saved);
      }
    }).catch(error=>{
      if(!cancelled)setFeedback({type:"error",message:error instanceof Error?error.message:"Unable to open saved floors."});
    }).finally(()=>{if(!cancelled)setLoading(false)});
    return ()=>{cancelled=true};
  },[showFloor]);
  const selectIndoorLocation=(id:string)=>{
    const nextId=id||null;
    if(nextId===selectedIndoorLocationId)return;
    if((tool!=="move"&&draft.length>0)&&
      !window.confirm("Switch locations? Unsaved drawing changes will be discarded."))return;
    if(pendingDeviceChanges&&
      !window.confirm("Switch locations? Unsaved device placement and camera settings will be discarded."))return;
    setSelectedIndoorLocationId(nextId);
    setNavigationVisible(false);
    setTool("move");drawing.reset();
    setPlan(null);
    if(!nextId)return;
    const first=floors.find(f=>f.locationId===nextId);
    if(first)showFloor(first);
  };
  const attachExistingIndoorFloor=async(id:string)=>{
    if(!selectedIndoorLocationId||!savedLocations.some(loc=>loc.id===selectedIndoorLocationId))
      throw new Error("Select an existing outdoor location first.");
    const existing=floors.find(f=>f.id===id);
    if(!existing)throw new Error("This indoor floor is no longer available.");
    const updated=assignFloorLocation(existing,selectedIndoorLocationId,
      floors,savedLocations.map(l=>l.id),new Date().toISOString());
    await saveFloorPlan(updated);
    setFloors(await listFloorPlans());
    showFloor(updated);
  };
  const unassignIndoorFloor=async(id:string)=>{
    const existing=floors.find(f=>f.id===id);
    if(!existing||existing.locationId!==selectedIndoorLocationId)
      throw new Error("This floor is not assigned to the selected location.");
    const updated=unassignFloorLocation(existing,selectedIndoorLocationId!,
      new Date().toISOString());
    await saveFloorPlan(updated);
    setFloors(await listFloorPlans());
    if(record?.id===id){
      setPlan(null);
      const next=floors.find(f=>f.id!==id&&f.locationId===selectedIndoorLocationId);
      if(next)showFloor(next);
    }
  };

  useEffect(()=>{
    const buildingId=plan?.record.hierarchy?.building.id;
    if(!buildingId){return;}
    let cancelled=false;
    void listStaircases(buildingId).then(items=>{if(!cancelled)setStaircases(items);})
      .catch(error=>{if(!cancelled)setFeedback({type:"error",message:error instanceof Error?error.message:"Unable to load staircases."});});
    return ()=>{cancelled=true;};
  },[plan?.record.hierarchy?.building.id]);

  useEffect(()=>{
    const url=plan?.url;
    return ()=>{if(url) URL.revokeObjectURL(url)};
  },[plan?.url]);

  const chooseTool=(next:EditorMode,name="",clearFeedback=true)=>{
    setTool(next);
    drawing.reset();
    setSpaceAId("");
    setSpaceBId("");
    setDoorUsage("both");
    setDoorPurpose("interior");
    setDoorDepth(DOOR_DEPTH_DEFAULT);
    setDraftPoint(null);
    setInspected(null);
    setEditingAreaId(null);
    setEditingDoorId(null);
    setEditingStairId(null);
    setStairDirection("both");
    setStairKind("staircase");
    setStairTargetIds([]);
    if(next==="room"||next==="walkable")if(roomSectionRef.current)roomSectionRef.current.open=true;
    if(next==="door"||next==="camera"||next==="device")if(doorSectionRef.current)doorSectionRef.current.open=true;
    if(next==="staircase")if(stairSectionRef.current)stairSectionRef.current.open=true;
    setConfiguringStairId(null);
    setDraftName(name || (isArea(next)?`${LABELS[next]} ${areas.filter(a=>a.kind===next).length+1}`
      :isMarker(next)?`${LABELS[next]} ${markers.filter(m=>m.kind===next).length+1}`
      :next==="door"?`Doorway ${portals.length+1}`:""));
    if(clearFeedback)setFeedback(null);
  };
  const startDoor=(area?:FloorArea)=>{
    chooseTool("door",area?`${area.name} doorway`:`Doorway ${portals.length+1}`);
    setDoorPurpose("interior");
    setDoorUsage("both");setSpaceAId("");setSpaceBId(area?.id??"");
    doorSectionRef.current?.scrollIntoView({behavior:"smooth",block:"start"});
  };
  const applyDoorwaySuggestion=(suggestedA:string|null,suggestedB:string|null)=>{
    if(doorPurpose==="interior"){
      if(suggestedA&&suggestedB){
        // Preserve an explicitly preselected destination from the room shortcut.
        if(spaceBId===suggestedA){setSpaceAId(suggestedB);setSpaceBId(suggestedA);}
        else {setSpaceAId(suggestedA);setSpaceBId(spaceBId===suggestedB?spaceBId:suggestedB);}
      }else if(suggestedB) setSpaceBId(suggestedB);
    }else{
      setSpaceAId("");
      // Exterior door: the lone polygon is usually inside; the user verifies it.
      if(spaceBId!==suggestedA&&spaceBId!==suggestedB)setSpaceBId(suggestedB??suggestedA??"");
    }
  };
  const selectPoint=useCallback((point:PixelPoint)=>{
    if(isArea(tool)||tool==="staircase") addDraftPoint(point,60);
    else if(isMarker(tool)||tool==="stair-landing") setDraftPoint(point);
    else if(tool==="inspect") setInspected(point);
  },[tool,addDraftPoint]);

  const startStaircase=(existing?:Staircase,kind:"staircase"|"elevator"="staircase")=>{
    chooseTool("staircase",existing?.name??`${kind==="elevator"?"Elevator":"Staircase"} ${staircases.filter(s=>verticalKind(s)===kind).length+1}`);
    setStairKind(existing?verticalKind(existing):kind);
    if(existing){
      setEditingStairId(existing.id);
      setStairDirection(existing.direction);
      setStairKind(verticalKind(existing));
      const landing=landingOnFloor(existing,hierarchy?.floor.id??"");
      setStairTargetIds((existing.servedFloorIds??existing.landings.map(l=>l.floorId))
        .filter(id=>id!==hierarchy?.floor.id));
      if(landing)drawing.reset(landing.outline,true);
    }
  };
  const startEditStairDestinations=(existing:Staircase)=>{
    chooseTool("move");
    setConfiguringStairId(existing.id);
    setStairTargetIds(existing.servedFloorIds??existing.landings.map(l=>l.floorId));
  };
  const saveStairDestinations=async()=>{
    if(!hierarchy||!configuringStairId)return;
    const prior=staircases.find(s=>s.id===configuringStairId);
    if(!prior){setFeedback({type:"error",message:"This staircase no longer exists."});return;}
    const targets=[...new Set([...prior.landings.map(l=>l.floorId),...stairTargetIds])];
    setSaving(true);
    try{
      await saveStaircase({...prior,servedFloorIds:targets,updatedAt:new Date().toISOString()});
      setStaircases(await listStaircases(hierarchy.building.id));
      setConfiguringStairId(null);setStairTargetIds([]);
      setFeedback({type:"success",message:"Destination floors saved. If stairs or an elevator are already drawn on the other floor, select this floor on that record to link them."});
    }catch(err){
      setFeedback({type:"error",message:err instanceof Error?err.message:"Could not update destinations."});
    }finally{setSaving(false);}
  };
  const saveStairOutline=async()=>{
    if(!record||!hierarchy||tool!=="staircase"||!draftClosed)return;
    const error=polygonError(draft);
    if(error){setFeedback({type:"error",message:error});return;}
    const cleanName=draftName.trim();
    if(!cleanName){setFeedback({type:"error",message:"Give the staircase a name."});return;}
    if(staircases.some(x=>x.id!==editingStairId&&x.name.trim().toLowerCase()===cleanName.toLowerCase()
      &&x.landings.some(l=>l.floorId===hierarchy.floor.id))){
      setFeedback({type:"error",message:"A vertical zone with that name is already drawn on this floor."});return;
    }
    const prior=editingStairId?staircases.find(x=>x.id===editingStairId):undefined;
    if(editingStairId&&!prior){
      setFeedback({type:"error",message:"The saved staircase was not found."});return;
    }
    const existing=prior?landingOnFloor(prior,hierarchy.floor.id):null;
    const landing={
      floorId:hierarchy.floor.id,outline:[...draft],
      entryPoint:existing?.entryPoint??null,
      walkableAreaId:existing?.walkableAreaId??null,
    };
    const now=new Date().toISOString();
    const landings=prior?
      (existing?prior.landings.map(l=>l.floorId===landing.floorId?landing:l):
        [...prior.landings,landing]):[landing];
    const servedFloorIds=[...new Set([
      ...landings.map(l=>l.floorId),...stairTargetIds,
    ])];
    const stair:Staircase=prior?
      {...prior,name:cleanName,direction:stairDirection,kind:stairKind,landings,
        servedFloorIds,updatedAt:now}:
      {id:crypto.randomUUID(),buildingId:hierarchy.building.id,name:cleanName,
        kind:stairKind,direction:stairDirection,landings,servedFloorIds,createdAt:now,updatedAt:now};
    setSaving(true);
    try {
      await saveStaircase(stair);
      setStaircases(await listStaircases(hierarchy.building.id));
      chooseTool("move","",false);
      setFeedback({type:"success",message:stair.landings.length===1?
        (stair.servedFloorIds!.length>1?
          `${stair.name} saved. Destination selected; mark its landing on the destination floor when ready.`:
          `${stair.name} saved. Choose a destination floor whenever you're ready.`):
        `${stair.name} now has ${stair.landings.length} mapped floors. Navigation is not configured yet.`});
    }catch(err){
      setFeedback({type:"error",message:err instanceof Error?err.message:"Could not save staircase."});
    }finally{setSaving(false);}
  };
  const placeDoorway=(start:PixelPoint,end:PixelPoint,aligned:boolean)=>{
    drawing.reset([start,end],false);
    const suggestion=suggestDoorwaySides(start,end,areas);
    if(suggestion.status==="two-spaces"){
      if(spaceBId===suggestion.sideAId) {
        setSpaceAId(suggestion.sideBId??"");
      }else{
        setSpaceAId(suggestion.sideAId??"");
        if(!spaceBId||spaceBId===suggestion.sideBId) setSpaceBId(suggestion.sideBId??"");
      }
    }else if(suggestion.status==="one-space"&&!spaceBId){
      setSpaceBId(suggestion.sideBId??"");
    }
    setFeedback({type:"success",message:aligned?
      "Doorway placed along a mapped room boundary. Drag the purple rectangle to move, or yellow ends to resize.":
      "Doorway placed. No wall was close enough to align automatically; drag or resize it to match the opening."});
  };
  const openAddFloor=(name:string,level:number|null)=>{
    if(tool!=="move"&&(draft.length>0||draftPoint||editingAreaId||editingDoorId)&&
      !window.confirm("Add another floor? Unsaved drawings on this floor will be discarded."))return;
    nextFloorRef.current={name,level};
    fileInput.current?.click();
  };
  const openReplaceFloor=()=>{
    nextFloorRef.current=null;
    fileInput.current?.click();
  };
  const switchFloor=async(id:string):Promise<boolean>=>{
    if(id===record?.id){setView("floor");return true;}
    if(saving)return false;
    const target=floors.find(f=>f.id===id);
    if(!target||target.locationId!==selectedIndoorLocationId)return false;
    if((tool!=="move"&&(draft.length>0||draftPoint||editingAreaId||editingDoorId||editingStairId)||configuringStairId) &&
      !window.confirm("Leave this floor? Changes that you have not saved in the editor will be discarded."))return false;
    setSaving(true);
    try {
      const next=await loadFloorPlan(id);
      if(!next)throw new Error("The selected floor was not found.");
      await selectFloorPlan(id);
      showFloor(next);
      setTool("move");drawing.reset();
      setDraftPoint(null);setInspected(null);setEditingAreaId(null);setEditingDoorId(null);setEditingStairId(null);
      setFeedback({type:"success",message:`Opened ${next.hierarchy?.floor.name??next.name}. Your other floors remain saved.`});
      return true;
    }catch(error){
      setFeedback({type:"error",message:error instanceof Error?error.message:"Unable to switch floors."});
      return false;
    }finally{setSaving(false);}
  };
  const goToStairLanding=async(stair:Staircase,floorId:string)=>{
    const target=floors.find(f=>f.hierarchy?.floor.id===floorId);
    if(!target){
      setFeedback({type:"error",message:"The destination floor is missing. Add the floor first."});
      return;
    }
    const switched=await switchFloor(target.id);
    if(!switched)return;
    // Start a fresh outline on the destination. Do not copy the origin-floor geometry.
    drawing.reset();
    setTool("staircase");setDraftPoint(null);
    setEditingStairId(stair.id);setDraftName(stair.name);
    setStairDirection(stair.direction);
    setStairKind(verticalKind(stair));
    setStairTargetIds((stair.servedFloorIds??stair.landings.map(l=>l.floorId))
      .filter(id=>id!==floorId));
    setFeedback({type:"success",message:`Now on ${target.hierarchy?.floor.name??target.name}. Draw the landing outline for ${stair.name}, then Save staircase. Next mark hallway access in the green walking area.`});
    if(stairSectionRef.current)stairSectionRef.current.open=true;
    stairSectionRef.current?.scrollIntoView({behavior:"smooth",block:"start"});
  };

  const persist=async(updated:FloorPlanRecord,message:string) => {
    setSaving(true);
    setFeedback(null);
    try {
      await saveFloorPlan(updated);
      setFloors(await listFloorPlans());
      setPlan(prev=>prev?{...prev,record:updated}:prev);
      setPlanName(updated.name);
      setFeedback({type:"success",message});
      return true;
    } catch(error) {
      setFeedback({type:"error",message:error instanceof Error?error.message:"Could not save your changes."});
      return false;
    } finally { setSaving(false); }
  };
  const dropLocationDevice=(deviceId:string,point:PixelPoint)=>{
    if(!record||!selectedIndoorLocationId||record.locationId!==selectedIndoorLocationId)return;
    try {
      setLocationDevices(stageDevicePlacement(locationDevices,selectedIndoorLocationId,deviceId,record.id,point));
      setSelectedDeviceId(deviceId);
      const floorId=hierarchy?.floor.id??record.planId;
      const landings:DeviceLanding[]=inventoryStairs.flatMap(stair=>{
        const landing=landingOnFloor(stair,floorId);
        return landing?[{id:stair.id,name:stair.name,kind:verticalKind(stair),outline:landing.outline}]:[];
      });
      const matches=identifyDeviceSpaces(point,areas,portals,landings);
      setFeedback({type:"success",message:"Device staged (not yet saved) on "+(hierarchy?.floor.name??record.name)+
        (matches.length?" · Identified: "+matches.map(m=>m.category+" "+m.name).join(", "):" · No mapped space at this point.")});
    } catch(error) {
      setFeedback({type:"error",message:error instanceof Error?error.message:"Unable to place device."});
    }
  };
  const configureDevice=(deviceId:string,patch:{sizePx?:number;camera?:CameraCoverage})=>{
    if(!selectedIndoorLocationId)return;
    try {
      setLocationDevices(stageDeviceConfiguration(locationDevices,selectedIndoorLocationId,deviceId,patch));
    } catch(error) {
      setFeedback({type:"error",message:error instanceof Error?error.message:"Unable to update device configuration."});
    }
  };
  const unplaceDevice=(deviceId:string)=>{
    if(!selectedIndoorLocationId)return;
    try {
      setLocationDevices(stageDeviceUnplacement(locationDevices,selectedIndoorLocationId,deviceId));
      setFeedback({type:"success",message:"Device unplacement staged. Save changes to apply."});
    } catch(error) {
      setFeedback({type:"error",message:error instanceof Error?error.message:"Unable to unplace device."});
    }
  };
  const saveDeviceChanges=()=>{
    if(!selectedIndoorLocationId||!pendingDeviceChanges)return;
    try{
      const saved=saveDevicePlacement(selectedIndoorLocationId,locationDevices);
      setLocationDevices(saved);
      setSavedDeviceBaseline(saved);
      setDeviceResetKey(current=>current+1);
      setDeviceSaveRevision(current=>current+1);
      setFeedback({type:"success",message:"Device placement and camera settings saved. They now appear on the outdoor map wherever this indoor floor is positioned."});
    }catch(error){
      setFeedback({type:"error",message:error instanceof Error?error.message:"Unable to save device placement."});
    }
  };
  const cancelDeviceChanges=()=>{
    // Restore every staged device property and explicitly invalidate the canvas'
    // transient drag/FOV/resize state. Restoring React data alone left stale
    // MapLibre coverage previews visible after Cancel.
    setLocationDevices(savedDeviceBaseline.map(device=>({
      ...device,point:device.point?{...device.point}:null,
      camera:device.camera?{...device.camera}:null,
    })));
    setSelectedDeviceId(null);
    setDeviceResetKey(current=>current+1);
    setFeedback({type:"success",message:"All unsaved device placements, sizes and camera edits canceled. Saved map restored."});
  };
  const approveWalkway=async(item:WalkwayCandidate)=>{
    if(!record||item.floorId!==hierarchy?.floor.id)return;
    if(!window.confirm(
      `Confirm that ${item.label} has an unobstructed opening. The map image is not machine-verified; do not approve a wall or restricted passage.`
    ))return;
    const approvals=(record.walkwayApprovals??[]).filter(a=>
      walkwayPairId(a.areaAId,a.areaBId)!==item.id);
    approvals.push({areaAId:item.areaAId,areaBId:item.areaBId,geometryKey:item.geometryKey});
    await persist({...record,walkwayApprovals:approvals,updatedAt:new Date().toISOString()},
      "Open walking-area passage saved. The graph has been refreshed.");
  };
  const revokeWalkway=async(item:WalkwayCandidate)=>{
    if(!record||item.floorId!==hierarchy?.floor.id)return;
    const approvals=(record.walkwayApprovals??[]).filter(a=>
      walkwayPairId(a.areaAId,a.areaBId)!==item.id);
    await persist({...record,walkwayApprovals:approvals,updatedAt:new Date().toISOString()},
      "Passage approval revoked. The graph has been refreshed.");
  };
  const saveHierarchy=async()=>{
    if(!record?.hierarchy)return;
    const floor=floorName.trim();
    if(!floor){
      setFeedback({type:"error",message:"Floor name is required."});return;
    }
    const value=floorLevel.trim();
    const level=value===""?null:Number(value);
    if(level!==null&&(!Number.isSafeInteger(level)||Math.abs(level)>1000)){
      setFeedback({type:"error",message:"Floor level must be a whole number from -1000 to 1000."});return;
    }
    if(level!==null&&floors.some(f=>f.id!==record.id&&f.locationId===record.locationId&&f.hierarchy?.floor.level===level)){
      setFeedback({type:"error",message:"Another floor already uses that level number."});return;
    }
    const h=record.hierarchy;
    const updated:FloorPlanRecord={...record,hierarchy:{
      site:h.site,
      building:h.building,
      floor:{...h.floor,name:floor,level},
    },updatedAt:new Date().toISOString()};
    setSaving(true);setFeedback(null);
    try{
      await saveFloorPlan(updated);
      setFloors(await listFloorPlans());
      setPlan(prev=>prev?{...prev,record:updated}:prev);
      setHierarchyFields(updated);
      setFeedback({type:"success",message:"Indoor floor details saved."});
    }catch(error){
      setFeedback({type:"error",message:error instanceof Error?error.message:"Unable to update location details."});
    }finally{setSaving(false);}
  };
  const upload=async(e:React.ChangeEvent<HTMLInputElement>)=>{
    const file=e.currentTarget.files?.[0];
    e.currentTarget.value="";
    if(!file)return;
    if(!selectedIndoorLocationId||!savedLocations.some(l=>l.id===selectedIndoorLocationId)){
      setFeedback({type:"error",message:"Select a saved outdoor location before creating indoor floors."});return;
    }
    const addNewFloor=Boolean(nextFloorRef.current)||!record;
    const pending=nextFloorRef.current;
    nextFloorRef.current=null;
    if(!ACCEPTED.includes(file.type)){
      setFeedback({type:"error",message:"Choose a PNG, JPG or WebP picture."});return;
    }
    if(file.size<=0||file.size>MAX_BYTES){
      setFeedback({type:"error",message:"Choose an image smaller than 20 MB."});return;
    }
    // Replacement is allowed only from More options; it changes this floor only.
    if(!addNewFloor&&record&&
      !window.confirm(`Replace the picture for "${record.hierarchy?.floor.name??record.name}"?
This clears rooms, walkable areas, doors, markers and staircase landings on THIS floor only.
Other floors will not be changed. This cannot be undone.`))return;
    setSaving(true);
    try {
      const size=await dimensions(file);
      if(size.width>12000||size.height>12000)
        throw new Error("Image dimensions must not exceed 12,000 by 12,000 pixels.");
      const now=new Date().toISOString();
      const planId=addNewFloor?crypto.randomUUID():record!.planId;
      const defaultHierarchy=defaultSpatialHierarchy(planId);
      const currentHierarchy=record?.locationId===selectedIndoorLocationId?record.hierarchy:null;
      const h=addNewFloor?{
        site:currentHierarchy?.site??defaultHierarchy.site,
        building:currentHierarchy?.building??defaultHierarchy.building,
        floor:{id:planId,buildingId:currentHierarchy?.building.id??defaultHierarchy.building.id,
          name:pending?.name??(file.name.replace(/\.[^.]+$/,"")||"Floor 1"),
          level:pending?.level??null},
      }:record!.hierarchy;
      const next:FloorPlanRecord={
        id:addNewFloor?`floor-${planId}`:record!.id,
        planId,
        locationId:addNewFloor?selectedIndoorLocationId:record!.locationId,
        name:addNewFloor?(file.name.replace(/\.[^.]+$/,"")||"My floor plan"):record!.name,
        hierarchy:h,
        ...size,mimeType:file.type,image:file,originalImage:file,
        imageOptions:{cleanup:"off",enhance:false},
        calibration:null,areas:[],markers:[],portals:[],
        createdAt:addNewFloor?now:record!.createdAt,updatedAt:now,
      };
      const prepared=ensureSpatialFoundation(next);
      if(addNewFloor)await addFloorPlan(prepared);
      else await replaceFloorPlanImage(prepared);
      setStaircases(await listStaircases(prepared.hierarchy!.building.id));
      await selectFloorPlan(prepared.id);
      setFloors(await listFloorPlans());
      showFloor(prepared);
      setTool("move");drawing.reset();setDraftPoint(null);
      setEditingAreaId(null);setEditingDoorId(null);setEditingStairId(null);setInspected(null);
      setFeedback({type:"success",message:addNewFloor?
        `Added ${prepared.hierarchy?.floor.name??"new floor"}. Existing floors and annotations were preserved.`:
        "Replaced this floor's picture. Other floors were not changed."});
    }catch(error){
      setFeedback({type:"error",message:error instanceof Error?error.message:"Unable to save the floor image."});
    }finally{setSaving(false);}
  };
  const saveArea=async()=>{
    if(!record || !isArea(tool))return;
    if(!draftClosed){setFeedback({type:"error",message:"Finish the outline by clicking its green starting point or selecting Finish outline."});return;}
    const validation=polygonError(draft);
    if(validation){setFeedback({type:"error",message:validation});return;}
    const cleanName=draftName.trim();
    if(!cleanName){setFeedback({type:"error",message:"Please name this space."});return;}
    const updatedArea:FloorArea={id:editingAreaId??crypto.randomUUID(),floorId:record.hierarchy?.floor.id??record.planId,kind:tool,name:cleanName,points:draft};
    const nextAreas=editingAreaId
      ?areas.map(a=>a.id===editingAreaId?updatedArea:a)
      :[...areas,updatedArea];
    // Changing a room or corridor boundary invalidates review of linked doorways.
    const nextPortals=editingAreaId
      ?portals.map(p=>(p.spaceAId===editingAreaId||p.spaceBId===editingAreaId)?{...p,reviewed:false}:p)
      :portals;
    const success=await persist({...record,areas:nextAreas,portals:nextPortals,
      walkwayApprovals:editingAreaId?(record.walkwayApprovals??[]).filter(a=>
        a.areaAId!==editingAreaId&&a.areaBId!==editingAreaId):record.walkwayApprovals,
      updatedAt:new Date().toISOString()},
      `Saved ${cleanName} with ${draft.length} corners.`);
    if(success)chooseTool("move","",false);
  };
  const saveDoor=async(confirmed=false)=>{
    if(!record || tool!=="door" || doorPoints.length!==2)return;
    if(segmentImageLength(doorPoints[0],doorPoints[1])<3) {
      setFeedback({type:"error",message:"The two ends of the opening are too close. Choose its actual width on the image."});
      return;
    }
    const cleanName=draftName.trim();
    if(!cleanName){setFeedback({type:"error",message:"Enter a name for the doorway."});return;}
    const portal:FloorPortal={
      id:editingDoorId??crypto.randomUUID(),floorId:record.hierarchy?.floor.id??record.planId,name:cleanName,
      usage:doorUsage,purpose:doorPurpose,displayDepthPx:doorDepth,
      reviewed:confirmed && Boolean(spaceBId) && (doorPurpose!=="interior" || Boolean(spaceAId)),
      start:doorPoints[0],end:doorPoints[1],
      spaceAId:doorPurpose==="interior"?spaceAId||null:null,spaceBId:spaceBId||null,
    };
    const error=doorwaySetupError(portal,areas);
    if(error){setFeedback({type:"error",message:error});return;}
    const nextPortals=editingDoorId
      ?portals.map(p=>p.id===editingDoorId?portal:p)
      :[...portals,portal];
    const success=await persist({...record,portals:nextPortals,updatedAt:new Date().toISOString()},
      `Saved ${cleanName}. ${doorwayReviewIssues(portal,areas).length?"Draft — needs review.":"Configuration reviewed."}`);
    if(success)chooseTool("move","",false);
  };
  const deleteDoor=async(id:string)=>{
    if(!record || !window.confirm("Remove this doorway?"))return;
    const success=await persist({...record,portals:portals.filter(p=>p.id!==id),
      updatedAt:new Date().toISOString()},"Doorway removed.");
    if(success)chooseTool("move");
  };
  const saveMarker=async()=>{
    if(!record || !isMarker(tool) || !draftPoint)return;
    const cleanName=draftName.trim();
    if(!cleanName){setFeedback({type:"error",message:"Please enter a name for this marker."});return;}
    const marker:FloorMarker={id:crypto.randomUUID(),floorId:record.hierarchy?.floor.id??record.planId,kind:tool,name:cleanName,point:draftPoint};
    const success=await persist({...record,markers:[...markers,marker],updatedAt:new Date().toISOString()},
      `Saved ${cleanName} in its floor-plan position.`);
    if(success)chooseTool("move","",false);
  };
  const deleteArea=async(id:string)=>{
    if(!record || !window.confirm("Remove this outlined area?"))return;
    await persist({...record,
      areas:areas.filter(a=>a.id!==id),
      walkwayApprovals:(record.walkwayApprovals??[]).filter(a=>
        a.areaAId!==id&&a.areaBId!==id),
      portals:portals.map(p=>({...p,spaceAId:p.spaceAId===id?null:p.spaceAId,
        spaceBId:p.spaceBId===id?null:p.spaceBId})),
      updatedAt:new Date().toISOString()},"Area removed and affected doorway links cleared.");
    chooseTool("move");
  };
  const deleteMarker=async(id:string)=>{
    if(!record || !window.confirm("Remove this marker?"))return;
    await persist({...record,markers:markers.filter(m=>m.id!==id),updatedAt:new Date().toISOString()},"Marker removed.");
    chooseTool("move");
  };
  const editArea=(area:FloorArea)=>{
    chooseTool(area.kind,area.name);
    drawing.reset(area.points,true);
    setEditingAreaId(area.id);
    setFeedback({type:"success",message:`Drag the yellow corners to adjust ${area.name}, then Save. Cancel keeps the saved shape unchanged.`});
  };
  const editDoor=(portal:FloorPortal)=>{
    chooseTool("door",portal.name);
    drawing.reset([portal.start,portal.end],false);
    setEditingDoorId(portal.id);
    setDoorUsage(portal.usage);
    setDoorPurpose(displayDoorPurpose(portal)??"interior");
    setDoorDepth(portal.displayDepthPx??DOOR_DEPTH_DEFAULT);
    // Edits are treated as unreviewed until the admin explicitly confirms and saves.
    doorSectionRef.current?.scrollIntoView({behavior:"smooth",block:"start"});
    setSpaceAId(portal.spaceAId??"");
    setSpaceBId(portal.spaceBId??"");
    setFeedback({type:"success",message:`Drag the yellow doorway endpoints to adjust ${portal.name}, then Save.`});
  };
  const rename=async()=>{
    if(!record)return;
    if(!planName.trim()){setFeedback({type:"error",message:"Enter a floor-plan name."});return;}
    await persist({...record,name:planName.trim(),updatedAt:new Date().toISOString()},"Floor-plan name saved.");
  };
  const removePlan=async()=>{
    if(!record)return;
    const currentName=record.hierarchy?.floor.name??record.name;
    const confirmation=window.prompt(`To permanently delete only "${currentName}" and its annotations,
type the exact floor name. Other floors will be preserved.`);
    if(confirmation!==currentName)return;
    setSaving(true);
    try{
      await removeFloorPlan(record.id);
      setStaircases(await listStaircases(hierarchy?.building.id??""));
      const remaining=await listFloorPlans();
      setFloors(remaining);
      const next=await loadFloorPlan();
      if(next)showFloor(next);
      else {
        setPlan(null);setPlanName("");setFloorName("");setFloorLevel("");
      }
      setTool("move");drawing.reset();setDraftPoint(null);setInspected(null);
      setEditingAreaId(null);setEditingDoorId(null);setEditingStairId(null);
      setFeedback({type:"success",message:`Deleted ${currentName}. Other floors are still saved.`});
    }catch(error){
      setFeedback({type:"error",message:error instanceof Error?error.message:"Unable to delete the floor."});
    }finally{setSaving(false);}
  };
  const exportMetadata=()=>{
    if(!record)return;
    const data=new Blob([JSON.stringify(exportFloorPlanMetadata(record),null,2)],{type:"application/json"});
    const url=URL.createObjectURL(data);
    const anchor=document.createElement("a");anchor.href=url;
    anchor.download=`${record.name.replace(/[^a-z0-9_-]/gi,"-")||"floor"}-annotations.json`;
    anchor.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
    setFeedback({type:"success",message:"Downloaded rooms, walkable areas, doorways and devices as JSON. The picture is not included."});
  };

  // Keyboard controls apply only while editing the map, never inside name/setting fields.
  useEffect(()=>{
    const onKey=(event:KeyboardEvent)=>{
      if(view!=="floor"||!record||tool==="move"||tool==="inspect")return;
      const element=event.target;
      if(element instanceof HTMLElement &&
         element.closest("input, textarea, select, [contenteditable='true']"))return;
      const modifier=event.ctrlKey||event.metaKey;
      if(modifier&&event.key.toLowerCase()==="z"){
        if(event.shiftKey){
          if(canRedoDraft){event.preventDefault();redoDraft();}
        }else if(canUndoDraft){event.preventDefault();undoDraft();}
      } else if(modifier&&event.key.toLowerCase()==="y"&&canRedoDraft){
        event.preventDefault();redoDraft();
      } else if(event.key==="Escape"){
        event.preventDefault();
        resetDraft();setTool("move");setEditingAreaId(null);setEditingDoorId(null);setEditingStairId(null);
        setFeedback(null);
      } else if(event.key==="Enter"&&(isArea(tool)||tool==="staircase")&&!draftClosed&&draft.length>=3){
        event.preventDefault();closeDraft();
      }
    };
    window.addEventListener("keydown",onKey);
    return ()=>window.removeEventListener("keydown",onKey);
  },[view,record,tool,draftClosed,draft.length,closeDraft,resetDraft,
    undoDraft,redoDraft,canUndoDraft,canRedoDraft]);

  const activeDrawing=isArea(tool)||isMarker(tool)||tool==="door"||tool==="staircase"||tool==="stair-landing";
  const title=tool==="move"?"Map ready":tool==="inspect"?"Inspecting coordinates":
    isArea(tool)||tool==="staircase"?`Drawing ${LABELS[tool].toLowerCase()}`:
    tool==="door"?"Click once near the opening; drag the rectangle to adjust":`Placing ${LABELS[tool].toLowerCase()}`;
  return <main className="flex h-dvh min-h-[420px] flex-col overflow-hidden bg-background text-foreground">
    <input ref={fileInput} aria-label="Upload floor-plan picture" type="file" className="sr-only" tabIndex={-1}
      accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp" onChange={e=>{void upload(e)}}/>
    <header className="z-20 flex h-16 shrink-0 items-center justify-between border-b border-border bg-white px-4 sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-white">
          <MapPinned className="size-5"/>
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-sm font-bold sm:text-base">Indoor Map Studio</h1>
          <p className="hidden text-xs text-muted-foreground sm:block">Buildings · Floors · Rooms · Doorways</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="hidden rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800 md:inline">
          No building measurements needed
        </span>
        <Button size="sm" variant="outline" aria-label={panelOpen?"Hide editor":"Show editor"}
          onClick={()=>setPanelOpen(v=>!v)}>
          {panelOpen?<PanelLeftClose/>:<PanelLeftOpen/>}<span className="hidden sm:inline">{panelOpen?"Hide":"Show"} editor</span>
        </Button>
      </div>
    </header>

    <div className="relative flex min-h-0 flex-1">
      {panelOpen && <aside className="z-10 w-[340px] shrink-0 overflow-y-auto border-r border-border bg-white px-4 py-5 max-sm:absolute max-sm:inset-y-0 max-sm:left-0 max-sm:shadow-xl"
        aria-label="Indoor map setup tools">
        <div className="mb-4 grid grid-cols-2 gap-2 rounded-lg bg-muted p-1">
          <button type="button" onClick={()=>{setPickOnMap(false);setView("floor");setStatus("loading")}}
            aria-pressed={view==="floor"} className={cn("rounded-md px-3 py-2 text-xs font-semibold",view==="floor"?"bg-white shadow-sm":"text-muted-foreground")}>
            <FileImage className="mr-1 inline size-4"/> Indoor plan
          </button>
          <button type="button" onClick={()=>{setView("street");setStatus("loading")}}
            aria-pressed={view==="street"} className={cn("rounded-md px-3 py-2 text-xs font-semibold",view==="street"?"bg-white shadow-sm":"text-muted-foreground")}>
            <MapIcon className="mr-1 inline size-4"/> Street map
          </button>
        </div>

        {view==="street" ? <div className="space-y-3">
          <h2 className="text-lg font-bold">Outdoor locations</h2>
          <p className="text-sm text-muted-foreground">Save a location here, then select it in Indoor plan to create its maps and floors.</p>
          <OutdoorLocationSearch selected={streetTarget}
            onSelect={location=>{
              setPickOnMap(false);
              setSearchChoice(location);
              setSelectedSavedLocationId(null);
              setPlacementFloorId(null);setPlacementDraft(null);setPlacingFloor(false);
              setVisibleFloorIds([]);
              setStreetTarget(old=>({...location,requestId:(old?.requestId??0)+1}));
            }}/>
          <Button type="button" size="sm" variant={pickOnMap?"default":"outline"}
            className="w-full" aria-pressed={pickOnMap}
            onClick={()=>{setPlacingFloor(false);setPickOnMap(active=>!active);}}>
            <MousePointer2/> {pickOnMap?"Cancel map selection":"Pick location on map"}
          </Button>
          {pickOnMap&&<p role="status" className="rounded-md border border-blue-200 bg-blue-50 p-2 text-xs leading-5 text-blue-800">
            Click the exact location on the outdoor map. Then enter a name and save it under My locations.
          </p>}
          <OutdoorLocationManager key={searchChoice?.id??"no-search-result"} searchResult={searchChoice}
            locations={savedLocations} selectedId={selectedSavedLocationId}
            loadError={outdoorStorageError} onAdd={addSearchedLocation}
            onRename={renameOutdoorPlace} onRemove={removeOutdoorPlace}
            onSelect={pickSavedLocation}/>
          {selectedSavedLocationId&&<div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3">
            <p className="text-xs font-semibold text-indigo-900">
              {savedLocations.find(loc=>loc.id===selectedSavedLocationId)?.name??"Selected location"} · Indoor maps
            </p>
            <p className="mt-1 text-xs text-indigo-800">
              {floors.filter(f=>f.locationId===selectedSavedLocationId).length} indoor map/floor(s) assigned.
              Select a floor to align its entire indoor mapping: rooms, walkable areas, doors, stairs/elevators and device markers.
            </p>
            <Button size="sm" className="mt-2 w-full"
              onClick={()=>{selectIndoorLocation(selectedSavedLocationId);setView("floor");setStatus("loading");}}>
              <Layers3/> Set up indoor maps / floors
            </Button>
          </div>}
          {placementLocation&&<section className="rounded-lg border border-indigo-200 bg-white p-3" aria-label="Outdoor indoor-floor placement">
            <h3 className="text-sm font-semibold">Place indoor maps / floors</h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Select an indoor floor to display its saved details and align the whole group. The original floor-plan picture is an optional reference.
            </p>
            <label htmlFor="outdoor-placement-floor" className="mt-3 block text-xs font-semibold">Indoor map / floor</label>
            <select id="outdoor-placement-floor" className="mt-1 h-9 w-full rounded-md border bg-white px-2 text-xs"
              value={placementFloor?.id??""} disabled={saving} onChange={event=>choosePlacementFloor(event.target.value)}>
              <option value="">Choose floor…</option>
              {floors.filter(f=>f.locationId===placementLocation.id).map(f=>
                <option key={f.id} value={f.id}>{f.hierarchy?.floor.name??f.name}{f.outdoorPlacement?" · Placed":" · Not placed"}</option>)}
            </select>
            <label className="mt-3 flex items-center gap-2 rounded-md border px-2 py-2 text-xs">
              <input type="checkbox" checked={showAllIndoorFloors} disabled={saving}
                onChange={event=>setShowAllIndoorFloors(event.target.checked)} className="size-4"/>
              Show all previously placed indoor floors (saved geometry)
            </label>
            <p className="mt-2 text-xs font-semibold">Floor-plan pictures (optional, hidden by default)</p>
            <div className="mt-2 space-y-2" role="group" aria-label="Floor plan visibility">
              {floors.filter(f=>f.locationId===placementLocation.id).map(f=>
                <label key={f.id} className="flex cursor-pointer items-center gap-2 rounded-md border bg-slate-50 px-2 py-2 text-xs">
                  <input type="checkbox" checked={visibleFloorIds.includes(f.id)} disabled={saving}
                    onChange={event=>toggleFloorVisibility(f.id,event.target.checked)}
                    aria-label={`Show floor plan ${f.hierarchy?.floor.name??f.name}`}
                    className="size-4 shrink-0"/>
                  <span className="min-w-0 flex-1 truncate">Show floor plan: {f.hierarchy?.floor.name??f.name}</span>
                  {f.outdoorPlacement&&<span className="text-[10px] text-emerald-700">Saved</span>}
                </label>)}
            </div>
            {!floors.some(f=>f.locationId===placementLocation.id)&&
              <p className="mt-2 text-xs text-amber-700">Create indoor floors for this location first.</p>}
            {placementFloor&&placementDraft&&<>
              {!placementUnlocked&&placementFloor.outdoorPlacement&&
                <div className="mt-3 space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                  <p className="flex items-center gap-2 text-xs font-semibold text-emerald-800">
                    <CheckCircle2 className="size-4"/> Placement applied · Locked
                  </p>
                  <p className="text-xs leading-5 text-emerald-800">
                    The indoor geometry is fixed on the outdoor map. Click a room, walking area,
                    doorway, stair or elevator to inspect its name and map coordinates.
                  </p>
                  <Button size="sm" variant="outline" className="w-full" disabled={saving}
                    onClick={startEditingPlacement}><Pencil/> Edit placement</Button>
                </div>}
              {placementUnlocked&&<>
              <p className="mt-2 text-xs text-indigo-800">
                {placementFloor.outdoorPlacement?"Editing saved alignment · Apply to lock":"Unsaved indoor group alignment · Apply to save"}
              </p>
              {placementFloor.outdoorPlacement&&
                <Button size="sm" variant="outline" className="mt-2 w-full" disabled={saving}
                  onClick={cancelEditingPlacement}>Cancel editing · Keep saved placement</Button>}
              <Button size="sm" variant={placingFloor?"default":"outline"} className="mt-2 w-full"
                disabled={saving} onClick={()=>{setPickOnMap(false);setPlacingFloor(value=>!value);}}>
                <MapPinned/>{placingFloor?"Cancel centre selection":"Click map to position floor centre"}
              </Button>
              {placingFloor&&<p role="status" className="mt-2 text-xs text-blue-700">
                Click the outdoor map to position the whole indoor group, or drag its blue centre handle. The floor-plan picture can remain hidden.
              </p>}
              <div className="mt-3 space-y-2 rounded-md border border-slate-200 p-2" role="group" aria-label="Floor placement editing mode">
                <p className="text-xs font-semibold">Transform handles</p>
                <div className="grid grid-cols-2 gap-2">
                  <Button size="sm" variant={placementEditMode==="resize"?"default":"outline"}
                    aria-pressed={placementEditMode==="resize"} disabled={saving}
                    onClick={()=>setPlacementEditMode("resize")}>Resize</Button>
                  <Button size="sm" variant={placementEditMode==="skew"?"default":"outline"}
                    aria-pressed={placementEditMode==="skew"} disabled={saving}
                    onClick={()=>setPlacementEditMode("skew")}>Skew corners / edges</Button>
                </div>
                <p className="text-[11px] leading-4 text-muted-foreground">
                  {placementEditMode==="skew"?
                    "Skew: drag a purple corner to move ONLY that corner. Drag a purple edge midpoint to move just that edge’s two corners. Other corners stay fixed. The indoor details and optional floor-plan image follow together.":
                    "Resize: use the eight blue handles to change the entire floor’s size; use the large green ROTATE handle connected above the top-centre grip to turn the floor."}
                </p>
              </div>
              <label className="mt-3 flex items-center gap-2 rounded-md bg-slate-50 px-2 py-2 text-xs">
                <input type="checkbox" checked={lockProportions} disabled={saving||placementEditMode==="skew"}
                  onChange={event=>setLockProportions(event.target.checked)}
                  aria-label="Lock indoor group proportions" className="size-4"/>
                <span>Lock indoor group proportions (Resize mode only)</span>
              </label>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <label className="text-xs">Width (metres)
                  <input type="number" min={2} max={5000} step={1}
                    value={Number(placementDraft.widthMeters.toFixed(2))} disabled={saving}
                    onChange={event=>{
                      const width=Number(event.target.value);
                      setPlacementDraft(p=>p?resizeFloorWidth(p,width,placementFloor.width,placementFloor.height,lockProportions):p);
                    }} className="mt-1 h-9 w-full rounded border px-2 text-sm"/>
                </label>
                <label className="text-xs">Height (metres)
                  <input type="number" min={2} max={5000} step={1}
                    value={Number(floorPlacementHeight(placementDraft,placementFloor.width,placementFloor.height).toFixed(2))}
                    disabled={saving} onChange={event=>{
                      const height=Number(event.target.value);
                      setPlacementDraft(p=>p?resizeFloorHeight(p,height,placementFloor.width,placementFloor.height,lockProportions):p);
                    }} className="mt-1 h-9 w-full rounded border px-2 text-sm"/>
                </label>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Button variant="outline" size="sm" disabled={saving} onClick={()=>
                  setPlacementDraft(p=>p?scaleFloorProportionally(p,0.9,placementFloor.width,placementFloor.height):p)}>
                  Shrink 10%
                </Button>
                <Button variant="outline" size="sm" disabled={saving} onClick={()=>
                  setPlacementDraft(p=>p?scaleFloorProportionally(p,1.1,placementFloor.width,placementFloor.height):p)}>
                  Expand 10%
                </Button>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <label className="text-xs">Rotate (degrees)
                  <input type="number" min={-180} max={180} step={1} value={placementDraft.rotationDegrees}
                    disabled={saving} onChange={event=>{
                      const rotation=Number(event.target.value);
                      if(rotation>=-180&&rotation<=180)setPlacementDraft(p=>p?{...p,rotationDegrees:rotation}:p);
                    }} className="mt-1 h-9 w-full rounded border px-2 text-sm"/>
                </label>
                <label className="text-xs">Horizontal skew (°)
                  <input type="number" min={-35} max={35} step={1} value={placementDraft.skewXDegrees??0}
                    disabled={saving} onChange={event=>{
                      const skew=Number(event.target.value);
                      if(skew>=-35&&skew<=35)setPlacementDraft(p=>p?{...p,skewXDegrees:skew}:p);
                    }} className="mt-1 h-9 w-full rounded border px-2 text-sm"/>
                </label>
                <label className="text-xs">Vertical skew (°)
                  <input type="number" min={-35} max={35} step={1} value={placementDraft.skewYDegrees??0}
                    disabled={saving} onChange={event=>{
                      const skew=Number(event.target.value);
                      if(skew>=-35&&skew<=35)setPlacementDraft(p=>p?{...p,skewYDegrees:skew}:p);
                    }} className="mt-1 h-9 w-full rounded border px-2 text-sm"/>
                </label>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Indoor details transform together. The optional picture receives the same position, rotation, scale and skew. Original indoor coordinates never change.
              </p>
              <label htmlFor="placement-opacity" className="mt-3 block text-xs">
                Picture opacity · {Math.round(placementDraft.opacity*100)}%
              </label>
              <input id="placement-opacity" type="range" min={0.1} max={1} step={0.05}
                value={placementDraft.opacity} disabled={saving}
                onChange={event=>setPlacementDraft(p=>p?{...p,opacity:Number(event.target.value)}:p)}
                className="mt-1 w-full"/>
              <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
                Indoor geometry appears automatically. Drag the blue centre to move, or choose Resize / Skew above for the eight handles. The large ROTATE icon is attached by a green line to the top-center grip. All geometry and the optional floor plan follow live. Apply saves this floor only.
              </p>
              <Button size="sm" className="mt-2 w-full" disabled={saving||placingFloor}
                onClick={()=>{void saveOutdoorPlacement();}}><Save/> Apply indoor group placement</Button>
              {placementFloor.outdoorPlacement&&
                <Button size="sm" variant="ghost" className="mt-1 w-full" disabled={saving}
                  onClick={()=>{void clearOutdoorPlacement();}}>Remove saved placement</Button>}
              </>}
            </>}
          </section>}
          {placementLocation&&<section className="rounded-lg border border-sky-200 bg-white p-3" aria-label="Outdoor indoor navigation">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Route className="size-4 text-sky-700"/> Navigation &amp; connectivity
            </h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Preview the checked indoor routes on geographically placed floors.
              Only reviewed doorways, approved walking-area joins and mapped
              stair/elevator connections count toward a route.
            </p>
            <Button size="sm" className="mt-2 w-full"
              variant={outdoorNavigationEnabled?"outline":"default"}
              onClick={()=>setOutdoorNavigationEnabled(value=>!value)}>
              <Route/> {outdoorNavigationEnabled?"Hide outdoor routes":"Show navigation on map"}
            </Button>
            {outdoorNavigationEnabled&&!outdoorConnectionsLoaded&&
              <p role="status" className="mt-2 text-xs text-sky-800">
                Loading saved doorway, staircase and elevator connections for this location…
              </p>}
            {outdoorNavigationEnabled&&outdoorConnectionsLoaded&&outdoorConnectionSnapshot?.error&&
              <p role="alert" className="mt-2 text-xs text-red-800">
                Could not load indoor stair/elevator connections: {outdoorConnectionSnapshot.error}.
                Reopen Indoor plan and verify your saved connections.
              </p>}
            {outdoorNavigationEnabled&&outdoorNavReady&&<div className="mt-3 space-y-3">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded bg-sky-50 p-2">
                  <strong>{outdoorNavAudit.readyDoorCount}</strong> reviewed doorways
                </div>
                <div className="rounded bg-sky-50 p-2">
                  <strong>{outdoorNavAudit.walkways.filter(w=>w.approved).length}</strong> approved walkway joins
                </div>
                <div className="rounded bg-sky-50 p-2">
                  <strong>{outdoorNavAudit.edges.filter(edge=>edge.kind==="vertical"&&edge.status==="ready").length}</strong> floor connectors
                </div>
                <div className="rounded bg-sky-50 p-2">
                  <strong>{outdoorNavAudit.issues.filter(issue=>issue.severity==="warning").length}</strong> geometry warnings
                </div>
              </div>
              {outdoorNavFloors.length<1&&
                <p className="text-xs text-amber-800">Apply an indoor floor placement first to enable outdoor directions.</p>}
              <label className="block text-xs font-semibold" htmlFor="outdoor-route-from">Start room</label>
              <select id="outdoor-route-from" className="h-9 w-full rounded border bg-white px-2 text-xs"
                value={outdoorStart?.id??""}
                onChange={e=>{
                  const id=e.target.value||null;
                  setOutdoorNavigationStartId(id);
                  if(id&&id===outdoorNavigationEndId)setOutdoorNavigationEndId(null);
                }}>
                <option value="">Choose start…</option>
                {outdoorNavRooms.map(node=><option key={node.id} value={node.id}>
                  {outdoorFloorName(node.floorId)} · {node.label}
                </option>)}
              </select>
              <label className="block text-xs font-semibold" htmlFor="outdoor-route-to">Destination room</label>
              <select id="outdoor-route-to" className="h-9 w-full rounded border bg-white px-2 text-xs"
                value={outdoorEnd?.id??""}
                onChange={e=>setOutdoorNavigationEndId(e.target.value||null)}>
                <option value="">Choose destination…</option>
                {outdoorNavRooms.filter(node=>node.id!==outdoorStart?.id).map(node=>
                  <option key={node.id} value={node.id}>
                    {outdoorFloorName(node.floorId)} · {node.label}
                  </option>)}
              </select>
              {outdoorStart&&outdoorEnd&&<div className="rounded-lg border border-slate-200 p-2 text-xs">
                {outdoorRoute.status==="ready"?<>
                  <p className="font-semibold text-emerald-800">
                    {outdoorRoute.edges.length} verified connection(s) · {outdoorRouteSummary.drawable} drawable floor segment(s)
                  </p>
                  {outdoorRoute.routeSource==="topology"&&
                    <p className="mt-2 text-amber-800">Connections are linked, but the shortest clearance path needs further review.</p>}
                  <div className="mt-2 space-y-2">
                    {outdoorRouteSteps.map((step,index)=><div key={step.floorId} className="rounded border border-slate-100 p-2">
                      <p className="font-semibold">{index+1}. {step.floorName}</p>
                      <p className={step.guidance.status==="guided"?"text-emerald-800":"text-amber-800"}>
                        {step.guidance.status==="guided"?
                          "Solid route follows mapped doorway openings and wall-clear walking areas.":
                          `No verified path line: ${step.guidance.message}`}
                      </p>
                      {step.transitionAfter&&<p className="mt-1 text-amber-900">
                        Use {step.transitionAfter.label} to change floors. Floor changes are marked, not connected by an imaginary outdoor line.
                      </p>}
                    </div>)}
                  </div>
                  {outdoorRouteSummary.unplaced.length>0&&<p className="mt-2 text-amber-900">
                    Unplaced floor(s): {outdoorRouteSummary.unplaced.join(", ")}.
                  </p>}
                </>:<div className="space-y-2 text-amber-900">
                  <p className="font-semibold">
                    {outdoorRoute.status==="same"?"Choose a different destination.":
                      "The selected rooms are not linked by a validated indoor route."}
                  </p>
                  {outdoorRouteProblems.length>0&&<ul className="list-disc space-y-1 pl-4">
                    {outdoorRouteProblems.map(problem=><li key={problem}>{problem}</li>)}
                  </ul>}
                  <p className="text-[11px] leading-5">
                    Placement applied / locked confirms geographic alignment only;
                    indoor navigation additionally requires connected, reviewed doorways,
                    walking-area passages and floor links.
                  </p>
                </div>}
              </div>}
              <Button size="sm" variant="outline" className="w-full"
                onClick={()=>{setOutdoorNavigationStartId(null);setOutdoorNavigationEndId(null);}}>
                Clear route
              </Button>
              <p className="text-[11px] leading-5 text-slate-600">
                Solid red lines show verified indoor walking geometry. Green/red
                circles mark route endpoints and amber markers indicate floor changes.
                This is a saved-map preview, not live GPS navigation or a certified evacuation route.
                Click a locked room on the map to choose it as a route endpoint.
              </p>
            </div>}
          </section>}
          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" variant={streetStyle===STREETS?"default":"outline"} onClick={()=>setStreetStyle(STREETS)}>Streets</Button>
            <Button size="sm" variant={streetStyle===LIGHT?"default":"outline"} onClick={()=>setStreetStyle(LIGHT)}>Light</Button>
          </div>
          <Button size="sm" variant="outline" className="w-full" onClick={()=>{setPickOnMap(false);setPlacingFloor(false);setPlacementFloorId(null);setPlacementDraft(null);setEditingPlacedFloorId(null);setVisibleFloorIds([]);setStreetTarget(null);setSearchChoice(null);setSelectedSavedLocationId(null);setResetStreet(k=>k+1)}}>
            <LocateFixed/> Reset street map
          </Button>
          <Button className="w-full" onClick={()=>{
            setPickOnMap(false);
            if(selectedSavedLocationId)selectIndoorLocation(selectedSavedLocationId);
            setView("floor");setStatus("loading");
          }}>Indoor plan <ChevronRight/></Button>
        </div> : <div className="space-y-5">
          <IndoorLocationSelector locations={savedLocations}
            selectedLocationId={selectedIndoorLocationId}
            indoorFloors={locationFloors} unassignedFloors={unassignedFloors}
            activeFloorId={record?.id??null} busy={saving||loading}
            onChoose={selectIndoorLocation} onAttach={attachExistingIndoorFloor}
            onUnassign={unassignIndoorFloor} onOpen={id=>{void switchFloor(id)}}
            onCreateFirst={openReplaceFloor}/>
          <div className={selectedIndoorLocationId?"contents":"hidden"}>
          {record&&<FloorManager floors={locationFloors}
            activeId={record.id} busy={saving||loading}
            onSelect={id=>{void switchFloor(id)}} onAdd={openAddFloor}/>}

          {selectedIndoorLocationId&&<DeviceInventory
            locationName={savedLocations.find(loc=>loc.id===selectedIndoorLocationId)?.name??"Location"}
            floorName={record?.locationId===selectedIndoorLocationId?(hierarchy?.floor.name??record.name):null}
            devices={locationDevices}
            assignments={deviceAssignments} selectedDeviceId={selectedDeviceId}
            onSelect={setSelectedDeviceId} onConfigure={configureDevice}
            floorNames={Object.fromEntries(locationFloors.map(f=>[f.id,f.hierarchy?.floor.name??f.name]))}
            busy={saving||loading}
            hasPendingChanges={pendingDeviceChanges}
            onSave={saveDeviceChanges} onCancel={cancelDeviceChanges}
            onCloseSetup={()=>setSelectedDeviceId(null)}
            markersVisible={displaySettings.deviceMarkers}
            onEnableMarkers={()=>changeDisplay("deviceMarkers",true)}
            onUnplace={unplaceDevice}/>}
          {record&&hierarchy&&<details className="rounded-xl border border-border p-3">
            <summary className="cursor-pointer text-sm font-semibold">Edit indoor floor name and level</summary>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              Edit the selected floor&apos;s name or level. Its outdoor location is chosen above.
            </p>
            <label htmlFor="floor-name" className="mt-3 block text-xs font-semibold">Floor name</label>
            <input id="floor-name" maxLength={90} value={floorName} onChange={e=>setFloorName(e.target.value)}
              className="mt-1 h-9 w-full rounded-md border border-input bg-white px-2 text-sm"/>
            <label htmlFor="floor-level" className="mt-3 block text-xs font-semibold">Floor level (optional)</label>
            <input id="floor-level" type="number" min={-1000} max={1000} step={1} value={floorLevel}
              placeholder="e.g. 0, 1 or -1" onChange={e=>setFloorLevel(e.target.value)}
              className="mt-1 h-9 w-full rounded-md border border-input bg-white px-2 text-sm"/>
            <Button size="sm" variant="outline" className="mt-3 w-full" disabled={saving||
              !floorName.trim()||
              (floorName.trim()===hierarchy.floor.name&&
               floorLevel.trim()===(hierarchy.floor.level===null?"":String(hierarchy.floor.level)))}
              onClick={()=>{void saveHierarchy()}}><Save/> Save floor details</Button>
          </details>}

          <details ref={roomSectionRef} className={cn("rounded-xl border border-border p-3",!record&&"opacity-50")}>
            <summary className="cursor-pointer text-sm font-semibold">2. Outline rooms and walking spaces</summary>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Click along the room&apos;s corners. A live line connects your last corner to the cursor.
              Click the green starting point to close, then save. Four corners are common, not required.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <ToolButton name="Draw room" active={tool==="room"} disabled={!record||saving}
                icon={<Pencil className="size-4 text-blue-600"/>} onClick={()=>chooseTool("room")}/>
              <ToolButton name="Walking area" active={tool==="walkable"} disabled={!record||saving}
                icon={<Footprints className="size-4 text-emerald-600"/>} onClick={()=>chooseTool("walkable")}/>
            </div>
            {record && isArea(tool) && <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3">
              <p className="text-xs font-semibold text-blue-800">{editingAreaId?"Drag yellow corners to adjust this area":"Click each corner on the floor plan"}</p>
              <p className="mt-1 text-xs text-blue-700">
                {draftClosed?"Outline closed — ready to save":`${draft.length} corners · Click green start point to close`}
              </p>
              <label htmlFor="area-name" className="mt-3 block text-xs font-semibold">Name this space</label>
              <input id="area-name" maxLength={90} value={draftName} onChange={e=>setDraftName(e.target.value)}
                className="mt-1 h-9 w-full rounded-md border border-input bg-white px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"/>
              <div className="mt-3 flex flex-wrap gap-2">
                {!draftClosed&&<Button size="sm" variant="outline" disabled={draft.length<3||saving}
                  onClick={drawing.close}><CheckCircle2/> Finish outline</Button>}
                <Button size="sm" disabled={!draftClosed||draft.length<3||!!polygonError(draft)||saving||!draftName.trim()}
                  onClick={()=>{void saveArea()}}><Save/> Save outline</Button>
                <Button size="sm" variant="outline" disabled={!draft.length||saving}
                  onClick={drawing.removeLast}>
                  <Undo2/> Remove last
                </Button>
                <Button size="sm" variant="outline" disabled={!drawing.undoAvailable||saving}
                  onClick={drawing.undo}><Undo2/> Undo</Button>
                <Button size="sm" variant="outline" disabled={!drawing.redoAvailable||saving}
                  onClick={drawing.redo}><Redo2/> Redo</Button>
                <Button size="sm" variant="ghost" onClick={()=>chooseTool("move")}>Cancel</Button>
              </div>
              {draftClosed&&polygonError(draft)&&
                <p role="alert" className="mt-2 text-xs font-semibold text-red-700">{polygonError(draft)}</p>}
              <p className="mt-2 text-[11px] leading-4 text-blue-800">
                Drag yellow corners when editing. Green marks the closing point.
                Enter closes an outline; Ctrl/Cmd+Z undoes; Ctrl/Cmd+Shift+Z redoes; Esc cancels.
              </p>
            </div>}
          </details>

          <details ref={doorSectionRef} className={cn("rounded-xl border border-border p-3",!record&&"opacity-50")}>
            <summary className="cursor-pointer text-sm font-semibold">3. Configure doorways</summary>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Click <strong>Add doorway</strong>, then click once near the door opening.
              A rectangle appears and aligns with a mapped wall where possible.
              Drag the rectangle to move it or drag either yellow handle to resize it.
              Check the suggested rooms and confirm. Most doors are two-way.
            </p>
            <ToolButton name="Add doorway — click once" active={tool==="door"} disabled={!record||saving}
              icon={<DoorOpen className="size-4 text-indigo-600"/>} onClick={()=>startDoor()}/>
            {record&&tool==="door"&&<DoorwayEditor
              floorId={record.hierarchy?.floor.id??record.planId}
              depth={doorDepth} onDepthChange={setDoorDepth}
              purpose={doorPurpose} onPurposeChange={purpose=>{setDoorPurpose(purpose);
                if(purpose!=="interior")setSpaceAId("");
                if(purpose==="emergency")setDoorUsage("exit");
              }}
              usage={doorUsage} onUsageChange={setDoorUsage}
              name={draftName} onNameChange={setDraftName}
              spaceAId={spaceAId} onSpaceAChange={setSpaceAId}
              spaceBId={spaceBId} onSpaceBChange={setSpaceBId}
              areas={areas} points={doorPoints}
              editing={Boolean(editingDoorId)} saving={saving}
              canUndo={drawing.undoAvailable} canRedo={drawing.redoAvailable}
              onSuggest={applyDoorwaySuggestion}
              onSwap={()=>{setSpaceAId(spaceBId);setSpaceBId(spaceAId);}}
              onConfirmSave={()=>{void saveDoor(true);}} onSaveDraft={()=>{void saveDoor(false);}}
              onRemoveLast={drawing.removeLast}
              onUndo={drawing.undo}
              onRedo={drawing.redo}
              onCancel={()=>chooseTool("move")}/>}
            <h3 className="mt-4 text-sm font-semibold">Device markers</h3>
            <p className="mt-1 text-xs text-muted-foreground">Custom device placement improvements are postponed.</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <ToolButton name="Camera" active={tool==="camera"} disabled={!record||saving}
                icon={<Camera className="size-4 text-purple-600"/>} onClick={()=>chooseTool("camera")}/>
              <ToolButton name="Device" active={tool==="device"} disabled={!record||saving}
                icon={<Layers3 className="size-4 text-orange-600"/>} onClick={()=>chooseTool("device")}/>
            </div>
            {record&&isMarker(tool)&&<div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3">
              <p className="text-xs font-semibold text-blue-800">
                {draftPoint?"Point selected · Name and save it":"Click the correct position on the picture"}
              </p>
              <label htmlFor="marker-name" className="mt-3 block text-xs font-semibold">Marker name</label>
              <input id="marker-name" value={draftName} maxLength={90}
                onChange={e=>setDraftName(e.target.value)}
                className="mt-1 h-9 w-full rounded-md border border-input bg-white px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"/>
              <div className="mt-3 flex gap-2">
                <Button size="sm" disabled={!draftPoint||!draftName.trim()||saving}
                  onClick={()=>{void saveMarker()}}><Save/> Save marker</Button>
                <Button size="sm" variant="ghost" onClick={()=>chooseTool("move")}>Cancel</Button>
              </div>
            </div>}
          </details>

          {record&&hierarchy&&<details ref={stairSectionRef} className="rounded-xl border border-amber-200 bg-amber-50/40 p-3">
            <summary className="cursor-pointer text-sm font-semibold">4. Staircases &amp; floor connections</summary>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Draw a staircase or elevator zone and select its served floors.
              No separate hallway access point is needed. Draw the same zone on each destination floor to enable cross-floor navigation.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button size="sm" variant="outline" disabled={saving||loading}
                onClick={()=>startStaircase(undefined,"staircase")}><Route/> Add stairs</Button>
              <Button size="sm" variant="outline" disabled={saving||loading}
                onClick={()=>startStaircase(undefined,"elevator")}><Layers3/> Add elevator</Button>
            </div>
            <p className="mt-2 text-[11px] leading-4 text-amber-900">
              To connect a floor, draw the same stairs or elevator there using
              <strong> Add on this floor</strong>. Choosing a floor does not draw its location automatically.
            </p>

            {tool==="staircase"&&<div className="mt-3 rounded-lg border border-amber-200 bg-white p-3">
              <h4 className="text-xs font-semibold text-amber-900">
                {editingStairId?"Edit this vertical zone":`Draw ${stairKind==="elevator"?"elevator":"staircase"} zone`}
              </h4>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Click around the stairs or elevator area on this floor, following its corners.
                Finish by clicking the green starting point. You can adjust the corners later.
              </p>
              <p className="mt-2 text-xs text-amber-800">
                {draftClosed?"Outline finished — ready to save":`${draft.length} corners selected`}
              </p>
              <label htmlFor="stair-name" className="mt-3 block text-xs font-semibold">Stairs / elevator name</label>
              <input id="stair-name" maxLength={90} value={draftName}
                onChange={e=>setDraftName(e.target.value)}
                className="mt-1 h-9 w-full rounded-md border border-input bg-white px-2 text-sm"/>
              <StaircaseDestinationPicker
                floors={floors.filter(f=>f.hierarchy?.building.id===hierarchy.building.id)}
                sourceFloorId={hierarchy.floor.id}
                mappedFloorIds={editingStairId?
                  (staircases.find(stair=>stair.id===editingStairId)?.landings.map(l=>l.floorId)??[]):[]}
                selectedFloorIds={stairTargetIds} onChange={setStairTargetIds}
                disabled={saving}/>
              <details className="mt-3 text-xs">
                <summary className="cursor-pointer font-semibold">Direction (optional)</summary>
                <label htmlFor="stair-direction" className="mt-2 block text-xs">Allowed stair movement</label>
                <select id="stair-direction" value={stairDirection}
                  onChange={e=>setStairDirection(e.target.value as StairDirection)}
                  className="mt-1 h-9 w-full rounded-md border border-input bg-white px-2 text-xs">
                  <option value="both">Up and down (default)</option>
                  <option value="up">Up only</option>
                  <option value="down">Down only</option>
                </select>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Stored for future navigation; movement is not enforced yet.
                </p>
              </details>
              {draftClosed&&polygonError(draft)&&
                <p role="alert" className="mt-2 text-xs text-red-700">{polygonError(draft)}</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                {!draftClosed&&<Button size="sm" variant="outline" disabled={draft.length<3||saving}
                  onClick={drawing.close}><CheckCircle2/> Finish outline</Button>}
                <Button size="sm" disabled={!draftClosed||!!polygonError(draft)||!draftName.trim()||saving}
                  onClick={()=>{void saveStairOutline()}}><Save/> Save location</Button>
                <Button size="sm" variant="outline" disabled={!drawing.undoAvailable||saving}
                  onClick={drawing.undo}><Undo2/> Undo</Button>
                <Button size="sm" variant="ghost" onClick={()=>chooseTool("move")}>Cancel</Button>
              </div>
              <p className="mt-2 text-[11px] font-medium text-amber-900">
                You can save now without selecting a destination floor, and edit destinations later.
              </p>
            </div>}

            {staircases.length>0&&<div className="mt-3 space-y-2">
              {staircases.map(stair=>{
                const onFloor=landingOnFloor(stair,hierarchy.floor.id);
                const floorNames=stair.landings.map(l=>floors.find(f=>f.hierarchy?.floor.id===l.floorId)
                  ?.hierarchy?.floor.name??"Unknown floor").join(", ");
                const pairedFloorIds=verticalMatches.links.flatMap(pair=>[
                  ...(pair.first.zone.id===stair.id?[pair.second.landing.floorId]:[]),
                  ...(pair.second.zone.id===stair.id?[pair.first.landing.floorId]:[]),
                ]);
                const pendingDestinations=(stair.servedFloorIds??[])
                  .filter(id=>!stair.landings.some(l=>l.floorId===id)&&!pairedFloorIds.includes(id))
                  .map(id=>floors.find(f=>f.hierarchy?.floor.id===id)?.hierarchy?.floor.name??"Unknown floor");
                return <div key={stair.id} className="rounded-lg border border-amber-200 bg-white p-3">
                  <p className="text-xs font-semibold">{verticalKind(stair)==="elevator"?"🛗 Elevator":"↕ Staircase"} · {stair.name}</p>
                  <p className="mt-1 text-[11px] text-amber-800">
                    {pairedFloorIds.length?`Linked floors: ${pairedFloorIds.map(id=>
                      floors.find(f=>f.hierarchy?.floor.id===id)?.hierarchy?.floor.name??"Unknown floor").join(", ")}`:
                      stairConnectionLabel(stair)}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">Mapped landings: {floorNames}</p>
                  {pendingDestinations.length>0
                    ?<div className="mt-2 space-y-1">
                      <p className="text-[11px] font-medium text-amber-900">
                        Destination planned: {pendingDestinations.join(", ")} — landing not drawn yet.
                      </p>
                      {(stair.servedFloorIds??[]).filter(id=>!stair.landings.some(l=>l.floorId===id)&&!pairedFloorIds.includes(id))
                        .map(id=>{
                          const target=floors.find(f=>f.hierarchy?.floor.id===id);
                          return <Button key={id} size="sm" variant="outline" disabled={saving||!target}
                            className="w-full justify-start"
                            onClick={()=>{void goToStairLanding(stair,id);}}>
                            Go to {target?.hierarchy?.floor.name??"destination"} &amp; draw landing
                          </Button>;
                        })}
                    </div>
                    :stair.landings.length===1&&!pairedFloorIds.length
                      ?<p className="mt-1 text-[11px] text-amber-900">Destination: Not selected yet</p>
                      :null}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" disabled={saving}
                      onClick={()=>startStaircase(stair)}>
                      {onFloor?"Edit this floor":"Add on this floor"}
                    </Button>

                    <Button size="sm" variant="outline" disabled={saving}
                      onClick={()=>{
                        if(configuringStairId===stair.id){
                          setConfiguringStairId(null);setStairTargetIds([]);
                        }else startEditStairDestinations(stair);
                      }}>
                      {configuringStairId===stair.id?"Close destination editor":"Edit destination floors"}
                    </Button>
                  </div>
                  {configuringStairId===stair.id&&<div className="mt-3 border-t border-amber-200 pt-2">
                    <StaircaseDestinationPicker
                      floors={floors.filter(f=>f.hierarchy?.building.id===hierarchy.building.id)}
                      sourceFloorId={onFloor?hierarchy.floor.id:stair.landings[0].floorId}
                      mappedFloorIds={stair.landings.map(l=>l.floorId)}
                      selectedFloorIds={stairTargetIds} onChange={setStairTargetIds} disabled={saving}/>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button size="sm" disabled={saving} onClick={()=>{void saveStairDestinations()}}>
                        <Save/> Save destinations
                      </Button>
                      <Button size="sm" variant="ghost" disabled={saving} onClick={()=>{
                        setConfiguringStairId(null);setStairTargetIds([]);
                      }}>Cancel</Button>
                    </div>
                  </div>}
                  {onFloor&&<p className="mt-2 text-[11px] text-emerald-800">
                    This floor location is mapped. A connection to a green walking area is detected automatically for route previews.
                  </p>}
                  {!onFloor&&<p className="mt-2 text-[11px] text-amber-900">
                    Draw this zone on this floor when ready.
                  </p>}
                </div>;
              })}
            </div>}
            {staircases.length===0&&
              <p className="mt-2 text-[11px] text-muted-foreground">
                No staircases saved yet. Add one on the current floor to get started.
              </p>}
          </details>}

          {record&&hierarchy&&<details className="rounded-xl border border-sky-200 p-3">
            <summary className="cursor-pointer text-sm font-semibold">
              5. Navigation &amp; connectivity
            </summary>
            <NavigationAuditPanel
              active={navigationVisible} onToggle={()=>setNavigationVisible(v=>!v)}
              report={navigationReport} floorId={hierarchy.floor.id} busy={saving||loading}
              startId={navStart?.id??null} destinationId={navDestination?.id??null}
              route={navRoute} guidance={navGuidance} routeSteps={routeSteps}
              floors={floors.filter(f=>f.hierarchy?.building.id===auditBuildingId)}
              staircases={staircases}
              onViewFloor={id=>{
                const target=floors.find(f=>f.hierarchy?.floor.id===id);
                if(target){
                  if(target.id===record.id)setFocusRoute(x=>x+1);
                  else void switchFloor(target.id).then(switched=>{
                    if(switched)setFocusRoute(x=>x+1);
                  });
                }
              }}
              onResolveStair={id=>{
                const stair=staircases.find(x=>x.id===id);
                if(!stair)return;
                startStaircase(stair);
                if(stairSectionRef.current)stairSectionRef.current.open=true;
                stairSectionRef.current?.scrollIntoView({behavior:"smooth",block:"start"});
              }}
              onStartChange={id=>{setNavigationStartId(id);setNavigationDestinationId(null);}}
              onDestinationChange={id=>{setNavigationDestinationId(id);setFocusRoute(x=>x+1);}}
              onApprove={item=>{void approveWalkway(item);}}
              onRevoke={item=>{void revokeWalkway(item);}}/>
          </details>}

          {record && <details className="rounded-xl border border-border p-3">
            <summary className="cursor-pointer text-sm font-semibold">
              Saved on this floor plan · {areas.length+portals.length+markers.length} items
            </summary>
            {areas.length===0&&portals.length===0&&markers.length===0
              ?<p className="mt-2 text-xs text-muted-foreground">Draw your first room to begin.</p>
              :<div className="mt-3 space-y-2">
                {areas.map(a=><div key={a.id} className="flex items-center gap-2 rounded-lg bg-muted/70 p-2">
                  <Dot color={a.kind==="room"?"bg-blue-500":"bg-emerald-500"}/>
                  <div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{a.name}</p>
                    <p className="text-[11px] text-muted-foreground">{a.points.length} corners · {a.kind==="room"?"Room":"Walking space"}</p></div>
                  {a.kind==="room"&&<button type="button"
                    aria-label={`Add doorway for ${a.name}`} title="Add doorway"
                    onClick={()=>startDoor(a)}
                    className="rounded p-1 text-indigo-700 hover:bg-white"><DoorOpen className="size-3.5"/></button>}
                  <button type="button" aria-label={`Edit ${a.name}`} title="Edit corners" onClick={()=>editArea(a)}
                    className="rounded p-1 hover:bg-white"><Pencil className="size-3.5"/></button>
                  <button type="button" aria-label={`Delete ${a.name}`} title="Delete" onClick={()=>{void deleteArea(a.id)}}
                    className="rounded p-1 text-red-600 hover:bg-white"><Trash2 className="size-3.5"/></button>
                </div>)}
                {portals.map(p=><div key={p.id} className="flex items-center gap-2 rounded-lg bg-muted/70 p-2">
                  <Dot color={p.usage==="both"?"bg-indigo-500":p.usage==="entrance"?"bg-teal-500":
                    p.usage==="exit"?"bg-red-500":"bg-slate-500"}/>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold">{p.name}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {p.purpose==="interior"?"Interior door":p.purpose==="building"?"Building access":
                        p.purpose==="emergency"?"Emergency exit":"Legacy / unclassified door"} · {USAGE[p.usage]}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {p.purpose==="building"||p.purpose==="emergency"?"Outside":
                        areas.find(a=>a.id===p.spaceAId)?.name??"Unassigned A"}
                      {p.usage==="entrance"?" → ":p.usage==="exit"?" ← ":" ↔ "}
                      {areas.find(a=>a.id===p.spaceBId)?.name??"Unassigned B"}
                    </p>
                    <p className={cn("text-[11px] font-semibold",doorwayReviewIssues(p,areas).length?"text-amber-700":"text-emerald-700")}>
                      {doorwayReviewIssues(p,areas).length?"Draft · needs review":"Configuration reviewed"}
                    </p>
                  </div>
                  <button type="button" title="Edit doorway endpoints" aria-label={`Edit ${p.name}`}
                    onClick={()=>editDoor(p)}
                    className="rounded p-1 hover:bg-white"><Pencil className="size-3.5"/></button>
                  <button type="button" title="Delete doorway" aria-label={`Delete ${p.name}`}
                    onClick={()=>{void deleteDoor(p.id);}}
                    className="rounded p-1 text-red-600 hover:bg-white"><Trash2 className="size-3.5"/></button>
                </div>)}
                {markers.map(m=>{
                  const parent=areas.find(a=>a.kind==="room"&&pointInRoom(m.point,a.points));
                  return <div key={m.id} className="flex items-center gap-2 rounded-lg bg-muted/70 p-2">
                    <Dot color={m.kind==="entrance"?"bg-teal-500":m.kind==="exit"?"bg-red-600":m.kind==="camera"?"bg-purple-600":"bg-orange-500"}/>
                    <div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{m.name}</p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {m.kind==="entrance"?"Entrance (legacy point)":m.kind==="exit"?"Exit (legacy point)":LABELS[m.kind]} · {parent?`In ${parent.name}`:"No room assigned"}
                      </p></div>
                    <button type="button" title="Delete" aria-label={`Delete ${m.name}`} onClick={()=>{void deleteMarker(m.id)}}
                      className="rounded p-1 text-red-600 hover:bg-white"><Trash2 className="size-3.5"/></button>
                  </div>;
                })}
              </div>}
          </details>}
          {record && <details className="rounded-xl border border-border p-3">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold">
              <Settings2 className="size-4"/> More options <ChevronRight className="ml-auto size-4"/>
            </summary>
            <div className="mt-4 space-y-3">
              <div className="rounded-lg border border-border bg-white p-3">
                <h3 className="text-xs font-semibold">Display settings</h3>
                <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                  Show or hide map decorations. Your rooms, doors and routes are not deleted.
                </p>
                <div className="mt-2 space-y-2">
                  {([
                    ["roomLabels","Room & walking-area labels"],
                    ["roomColors","Room colors"],
                    ["walkingColors","Walking-area colors"],
                    ["doorwayIcons","Doorway icons & labels"],
                    ["doorwayShapes","Doorway colors & outlines"],
                    ["entranceExitMarkers","Entrance / exit icons & colors"],
                    ["stairLabels","Staircase & elevator labels"],
                    ["deviceMarkers","Camera & device icons"],
                    ["guideLine","Navigation guide lines"],
                  ] as const).map(([key,label])=>
                    <label key={key} className="flex items-center justify-between gap-2 text-xs">
                      <span>{label}</span>
                      <input type="checkbox" className="size-4 accent-blue-600"
                        checked={displaySettings[key]} onChange={e=>changeDisplay(key,e.target.checked)}/>
                    </label>)}
                </div>
              </div>
              <label htmlFor="plan-name" className="block text-xs font-medium">Map name</label>
              <input id="plan-name" value={planName} onChange={e=>setPlanName(e.target.value)}
                maxLength={100} className="h-9 w-full rounded-md border border-input px-3 text-sm"/>
              <Button size="sm" variant="outline" className="w-full"
                disabled={!planName.trim()||planName.trim()===record.name||saving} onClick={()=>{void rename()}}>
                <Save/> Save name
              </Button>
              <Button size="sm" variant={tool==="inspect"?"default":"outline"} className="w-full"
                onClick={()=>chooseTool(tool==="inspect"?"move":"inspect")}>
                <MousePointer2/> {tool==="inspect"?"Stop inspecting":"Inspect pixel coordinates"}
              </Button>
              {inspected && <p className="rounded-lg bg-muted p-2 text-xs">
                X {inspected.x.toFixed(1)} · Y {inspected.y.toFixed(1)} | Normalized {
                  JSON.stringify(normalizedPoint(inspected,record.width,record.height))
                }</p>}
              <p className="text-[11px] text-muted-foreground">Image size: {record.width} × {record.height} pixels</p>
              <Button size="sm" variant="outline" className="w-full" onClick={exportMetadata}>
                <Download/> Download coordinates JSON
              </Button>
              <p className="text-[11px] leading-4 text-muted-foreground">
                JSON includes saved rooms, doors, walking areas and pins, but not the picture itself.
              </p>
              <Button size="sm" variant="outline" className="w-full" disabled={saving}
                onClick={openReplaceFloor}>
                <Upload/> Replace this floor&apos;s picture
              </Button>
              <p className="text-[11px] text-amber-700">
                Replacing the image clears annotations and staircase placement on this floor only; other floors stay untouched.
              </p>
              <Button size="sm" variant="ghost" className="w-full text-red-600" disabled={saving} onClick={()=>{void removePlan()}}>
                <Trash2/> Delete this floor only
              </Button>
            </div>
          </details>}
          <p className="text-[11px] leading-5 text-muted-foreground">
            Indoor floors remain saved in this browser. Select a saved location on Street map to position each floor.
          </p>
          </div>
        </div>}
        {feedback && <div role="status" className={cn("my-4 rounded-lg border p-3 text-xs leading-5",
          feedback.type==="error"?"border-red-200 bg-red-50 text-red-700":"border-emerald-200 bg-emerald-50 text-emerald-800")}>
          {feedback.message}
        </div>}
      </aside>}

      <section className="relative min-w-0 flex-1 overflow-hidden bg-[#e8ebf0]" aria-label="Floor plan editor map">
        {view==="street" ?
          <MapCanvas styleUrl={streetStyle} recenterKey={resetStreet} focusTarget={streetTarget}
            savedLocations={savedLocations} selectedSavedLocationId={selectedSavedLocationId}
            onSavedLocationSelect={pickSavedLocation} pickOnMap={pickOnMap}
            onMapPointPick={pickOutdoorMapPoint} onStatusChange={onStatus}
            placementPreviews={placementPreviews} placingFloor={placingFloor}
            outdoorRouteOverlay={outdoorNavigationEnabled?outdoorRouteOverlay:null}
            onNavigationRoomPick={setRouteRoomFromMap}
            editableFloorId={placementUnlocked?placementFloorId:null}
            proportionalResize={lockProportions} transformMode={placementEditMode}
            onPlacementTransform={updated=>setPlacementDraft(updated)}
            onPlacementPointPick={(longitude,latitude)=>{
              setPlacementDraft(previous=>previous?{...previous,longitude,latitude}:previous);
              setPlacingFloor(false);
            }}/> :
          record&&plan ?
          <FloorPlanCanvas key={record.planId} imageUrl={plan.url} width={record.width} height={record.height}
            floorId={hierarchy?.floor.id??record.planId}
            staircases={staircases.filter(stair=>!(stair.id===editingStairId&&tool==="staircase"))}
            navigationSelection={navSelection} navigationFocusRequest={focusRoute} displaySettings={displaySettings}
            areas={areas.filter(a=>a.id!==editingAreaId)} markers={markers}
             placedDevices={locationDevices.filter(device=>device.floorId===record.id)}
             deviceResetKey={deviceResetKey}
             onDeviceDrop={dropLocationDevice} onDeviceMove={dropLocationDevice}
             selectedDeviceId={selectedDeviceId} onDeviceSelect={setSelectedDeviceId}
             onDeviceResize={(deviceId,sizePx)=>configureDevice(deviceId,{sizePx})}
            portals={portals.filter(p=>p.id!==editingDoorId)} drawing={isArea(tool)||tool==="staircase"?draft:[]}
            drawingClosed={draftClosed} portalDraft={tool==="door"?doorPoints:[]}
            portalDepth={doorDepth} onDoorPlace={placeDoorway} onDoorDepthChange={setDoorDepth}
            editing={Boolean(editingAreaId||editingDoorId||(editingStairId&&tool==="staircase"))}
            onVertexDragStart={drawing.beginVertexDrag}
            onVertexDragMove={drawing.moveVertex}
            onVertexDragEnd={drawing.endVertexDrag}
            selectedPoint={tool==="inspect"?inspected:draftPoint}
            mode={tool} fitRequest={fit} onPointClick={selectPoint}
            onCloseDrawing={drawing.close}
            onStatusChange={onStatus}/> :
          <div className="flex h-full items-center justify-center p-5">
            <div className="w-full max-w-md rounded-2xl border border-border bg-white p-8 text-center shadow-lg">
              <FileImage className="mx-auto size-11 text-primary"/>
              <h2 className="mt-4 text-xl font-bold">{loading?"Opening saved floors…":"Select a location to set up indoor maps"}</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Choose an existing outdoor location in the sidebar, then create or open its indoor maps and floors to configure rooms, walking areas, doors and navigation.
              </p>
              <Button className="mt-5 w-full" disabled={saving||loading||!selectedIndoorLocationId} onClick={openReplaceFloor}>
                <Upload/> Choose floor-plan picture
              </Button>
              <p className="mt-2 text-xs text-muted-foreground">PNG, JPG or WebP · Maximum 20 MB</p>
            </div>
          </div>}
        {record && view==="floor" && <>
          <div className="pointer-events-none absolute top-4 left-4 z-10 max-w-[66%] rounded-xl border border-white/70 bg-white/95 px-4 py-3 shadow-lg">
            <p className="truncate text-sm font-semibold text-slate-900">
              {savedLocations.find(loc=>loc.id===selectedIndoorLocationId)?.name??"Location"} · {hierarchy?.floor.name??record.name}
            </p>
            <p className="mt-1 text-xs text-slate-600">{title} · {
              status==="ready"?activeDrawing?tool==="door"?"Click once near opening · Drag to adjust":
                isArea(tool)?draftClosed?"Outline closed — save in sidebar":"Follow the line; click green start to finish":
                "Click picture to mark a position":"Drag to move · Scroll to zoom":
              status==="error"?"Map failed to load":"Loading…"
            }</p>
          </div>
          <div className="absolute right-4 bottom-5 z-10 flex gap-2">
            {tool!=="move"&&<Button variant="outline" size="sm" className="bg-white shadow"
              onClick={()=>chooseTool("move")}><X/> Stop drawing</Button>}
            <Button variant="outline" size="sm" className="bg-white shadow"
              onClick={()=>setFit(k=>k+1)}><LocateFixed/> Show full plan</Button>
          </div>
        </>}
        {view==="street"&&<div className="pointer-events-none absolute top-4 left-4 z-10 rounded-lg bg-white/95 p-3 text-xs shadow">
          {placingFloor?"Floor placement · Click map to choose its centre":
             pickOnMap?"Pick mode · Click a map point to create a location":
             "Outdoor map · Select a floor to position all indoor details (floor-plan image optional)"}
        </div>}
        {status==="error" && (view==="street"||record) &&
          <div className="absolute inset-x-4 bottom-20 z-10 mx-auto max-w-md rounded-lg border border-red-200 bg-white p-4 text-sm text-red-700 shadow">
            Map failed to render. Make sure the app has copied the MapLibre worker files and reload.
          </div>}
      </section>
    </div>
  </main>;
}
