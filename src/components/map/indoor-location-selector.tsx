"use client";

import { useState } from "react";
import { Layers3, Link2, MapPin, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { FloorPlanRecord } from "@/lib/floor-plan";
import type { SavedOutdoorLocation } from "@/lib/saved-outdoor-locations";

type Props={
  locations:SavedOutdoorLocation[];
  selectedLocationId:string|null;
  indoorFloors:FloorPlanRecord[];
  unassignedFloors:FloorPlanRecord[];
  activeFloorId:string|null;
  busy:boolean;
  onChoose:(id:string)=>void;
  onAttach:(id:string)=>Promise<void>;
  onUnassign:(id:string)=>Promise<void>;
  onOpen:(id:string)=>void;
  onCreateFirst:()=>void;
};
const floorName=(f:FloorPlanRecord)=>f.hierarchy?.floor.name??f.name;
export function IndoorLocationSelector({
  locations,selectedLocationId,indoorFloors,unassignedFloors,activeFloorId,
  busy,onChoose,onAttach,onUnassign,onOpen,onCreateFirst,
}:Props){
  const [existing,setExisting]=useState("");
  const [working,setWorking]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const run=async(task:()=>Promise<void>)=>{
    setWorking(true);setError(null);
    try{await task();}
    catch(cause){setError(cause instanceof Error?cause.message:"Unable to update this floor.");}
    finally{setWorking(false);}
  };
  const location=locations.find(l=>l.id===selectedLocationId);
  return <section className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-3" aria-label="Indoor location setup">
    <div className="flex items-center gap-2">
      <MapPin className="size-4 text-indigo-700"/>
      <h2 className="text-sm font-semibold">1. Select the location for indoor setup</h2>
    </div>
    <p className="mt-1 text-xs leading-5 text-muted-foreground">
      Pick a location saved on the outdoor map. All indoor maps and floors below belong directly to it.
    </p>
    <label htmlFor="indoor-location" className="mt-3 block text-xs font-semibold">Outdoor location</label>
    <select id="indoor-location" value={selectedLocationId??""} disabled={busy||working}
      onChange={e=>{setExisting("");setError(null);onChoose(e.target.value);}}
      className="mt-1 h-10 w-full rounded-lg border border-input bg-white px-2 text-sm">
      <option value="">Select a saved location…</option>
      {locations.map(l=><option value={l.id} key={l.id}>{l.name}</option>)}
    </select>
    {!locations.length&&<p className="mt-2 text-xs text-amber-800">
      First open Street map and add a geographic location.
    </p>}
    {location&&<>
      <div className="mt-3 rounded-lg border bg-white p-3">
        <div className="flex items-center gap-2">
          <Layers3 className="size-4 text-indigo-700"/>
          <strong className="text-xs">Indoor maps / floors — {location.name}</strong>
          <span className="ml-auto text-xs text-muted-foreground">{indoorFloors.length}</span>
        </div>
        {!indoorFloors.length&&<p className="mt-2 text-xs text-muted-foreground">
          No indoor maps at this location yet. Create the first floor or attach an existing one.
        </p>}
        <div className="mt-2 space-y-1">
          {indoorFloors.map(f=><div key={f.id} className="flex items-center gap-2 rounded-md border bg-white p-2">
            <button type="button" disabled={busy||working}
              onClick={()=>onOpen(f.id)} aria-current={activeFloorId===f.id?"true":undefined}
              className="min-w-0 flex-1 text-left text-xs">
              <span className={activeFloorId===f.id?"font-bold text-indigo-800":"font-medium"}>
                {floorName(f)}
              </span>
              <span className="ml-1 text-muted-foreground">{f.hierarchy?.floor.level==null?"":`· Level ${f.hierarchy.floor.level}`}</span>
            </button>
            <button type="button" disabled={busy||working}
              aria-label={`Unassign ${floorName(f)} from this location`}
              title="Unassign without deleting the indoor floor"
              className="rounded p-1 text-slate-500 hover:bg-slate-100"
              onClick={()=>{void run(()=>onUnassign(f.id));}}><Unlink className="size-4"/></button>
          </div>)}
        </div>
        {!indoorFloors.length&&<Button size="sm" className="mt-2 w-full" disabled={busy||working}
          onClick={onCreateFirst}><Layers3/> Create first indoor floor</Button>}
      </div>
      {unassignedFloors.length>0&&<div className="mt-3 rounded-lg border bg-white p-3">
        <label htmlFor="attach-indoor-floor" className="text-xs font-semibold">
          Assign an existing unassigned indoor map/floor
        </label>
        <select id="attach-indoor-floor" value={existing} disabled={busy||working}
          onChange={e=>setExisting(e.target.value)}
          className="mt-2 h-9 w-full rounded-md border border-input bg-white px-2 text-xs">
          <option value="">Choose existing floor…</option>
          {unassignedFloors.map(f=><option key={f.id} value={f.id}>{floorName(f)} · {f.name}</option>)}
        </select>
        <Button size="sm" variant="outline" className="mt-2 w-full" disabled={!existing||busy||working}
          onClick={()=>{void run(async()=>{await onAttach(existing);setExisting("");});}}>
          <Link2/> Assign to {location.name}
        </Button>
      </div>}
    </>}
    {error&&<p className="mt-2 text-xs text-red-700" role="alert">{error}</p>}
    <p className="mt-3 text-[11px] leading-4 text-muted-foreground">
      Assigning a location changes only floor ownership, not its room, walkway, door or route geometry.
      After setting up each indoor floor, return to Street map, select its location, and place each floor image individually.
    </p>
  </section>;
}
