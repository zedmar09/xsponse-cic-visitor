"use client";

import { useState } from "react";
import { Check, MapPin, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { OutdoorLocation } from "@/lib/outdoor-search";
import type { SavedOutdoorLocation } from "@/lib/saved-outdoor-locations";

type Props={
  searchResult:OutdoorLocation|null;
  locations:SavedOutdoorLocation[];
  selectedId:string|null;
  onAdd:(name:string)=>Promise<void>;
  onRename:(id:string,name:string)=>Promise<void>;
  onRemove:(id:string)=>Promise<void>;
  onSelect:(location:SavedOutdoorLocation)=>void;
  loadError:string|null;
};

export function OutdoorLocationManager({
  searchResult,locations,selectedId,onAdd,onRename,onRemove,onSelect,loadError,
}:Props){
  const [name,setName]=useState(searchResult?.source==="map"?"":searchResult?.label.split(",")[0]?.trim().slice(0,90)??"");
  const [editingId,setEditingId]=useState<string|null>(null);
  const [editingName,setEditingName]=useState("");
  const [confirmDeleteId,setConfirmDeleteId]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);

  const execute=async(action:()=>Promise<void>)=>{
    setBusy(true);setError(null);
    try{await action();}
    catch(reason){setError(reason instanceof Error?reason.message:"Unable to save the location.");}
    finally{setBusy(false);}
  };

  return <section className="rounded-xl border border-border bg-white p-3"
    aria-label="Manage outdoor locations">
    <div className="flex items-center gap-2">
      <MapPin className="size-4 text-indigo-700"/>
      <h3 className="text-sm font-semibold">My locations</h3>
      <span className="ml-auto text-xs text-muted-foreground">{locations.length} saved</span>
    </div>
    <p className="mt-1 text-xs leading-5 text-muted-foreground">
      Save outdoor locations now. Buildings and indoor floors will be assigned in the next phases.
    </p>
    {searchResult&&<form className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50/40 p-2"
      onSubmit={event=>{
        event.preventDefault();
        void execute(async()=>{
          await onAdd(name);
          setName("");
        });
      }}>
      <label htmlFor="new-outdoor-location" className="text-xs font-semibold">
        {searchResult.source==="map"?"Name this map location":"Location name"}
      </label>
      <input id="new-outdoor-location" value={name} maxLength={90} minLength={2}
        onChange={event=>setName(event.target.value)}
        className="mt-1 h-9 w-full rounded-md border border-input bg-white px-2 text-sm"
        placeholder="e.g. Main Campus" required/>
      <p className="mt-1 line-clamp-2 break-words text-[11px] text-slate-600">
        {searchResult.source==="map"?
          `Selected map coordinates: ${searchResult.latitude.toFixed(6)}, ${searchResult.longitude.toFixed(6)}`:
          searchResult.label}
      </p>
      <Button type="submit" size="sm" className="mt-2 w-full" disabled={busy||name.trim().length<2}>
        <Plus/> Add this location
      </Button>
    </form>}
    {!searchResult&&<p className="mt-2 text-xs text-muted-foreground">
      Search for a place, or choose Pick location on map and click its position.
    </p>}
    {loadError&&<p role="alert" className="mt-2 text-xs text-red-700">{loadError}</p>}
    {error&&<p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
    <div className="mt-3">
      <p className="text-xs font-semibold text-slate-700">Saved locations</p>
      {!locations.length&&<p className="mt-2 text-xs text-muted-foreground">No locations saved yet.</p>}
      <ul className="mt-2 max-h-72 space-y-2 overflow-y-auto">
        {locations.map(location=><li key={location.id}
          className={`rounded-md border p-2 text-xs ${selectedId===location.id?
            "border-indigo-400 bg-indigo-50":"border-slate-200"}`}>
          {editingId===location.id? <form onSubmit={event=>{
            event.preventDefault();
            void execute(async()=>{
              await onRename(location.id,editingName);
              setEditingId(null);
            });
          }}>
            <label htmlFor={`rename-${location.id}`} className="sr-only">Rename {location.name}</label>
            <input id={`rename-${location.id}`} className="h-9 w-full rounded-md border border-input px-2"
              autoFocus maxLength={90} minLength={2} required
              value={editingName} onChange={event=>setEditingName(event.target.value)}/>
            <div className="mt-2 flex gap-1">
              <Button size="sm" type="submit" disabled={busy}><Check/> Save</Button>
              <Button size="sm" variant="ghost" type="button" disabled={busy}
                onClick={()=>setEditingId(null)}><X/> Cancel</Button>
            </div>
          </form>:<>
            <button type="button" disabled={busy} aria-current={selectedId===location.id?"true":undefined}
              className="flex w-full items-start gap-2 text-left" onClick={()=>onSelect(location)}>
              <MapPin className="mt-0.5 size-4 shrink-0 text-indigo-700"/>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{location.name}</span>
                <span className="mt-0.5 block break-words text-[11px] leading-4 text-muted-foreground">
                  {location.address}
                </span>
              </span>
            </button>
            {confirmDeleteId===location.id?<div className="mt-2 rounded border border-red-200 bg-red-50 p-2">
              <p className="text-[11px] leading-4 text-red-800">
                Remove this saved outdoor location? Indoor floor plans are not affected.
              </p>
              <div className="mt-2 flex gap-1">
                <Button type="button" size="sm" variant="outline" className="border-red-300 text-red-700" disabled={busy}
                  onClick={()=>{void execute(async()=>{
                    await onRemove(location.id);setConfirmDeleteId(null);
                  });}}>Delete</Button>
                <Button type="button" size="sm" variant="outline" disabled={busy}
                  onClick={()=>setConfirmDeleteId(null)}>Cancel</Button>
              </div>
            </div>:<div className="mt-2 flex gap-1">
              <Button size="sm" variant="outline" type="button" disabled={busy}
                onClick={()=>{setEditingId(location.id);setEditingName(location.name);setConfirmDeleteId(null);}}>
                <Pencil/> Rename
              </Button>
              <Button size="sm" variant="ghost" type="button" disabled={busy}
                onClick={()=>{setConfirmDeleteId(location.id);setEditingId(null);}}>
                <Trash2/> Remove
              </Button>
            </div>}
          </>}
        </li>)}
      </ul>
    </div>
    <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
      Saved locally in this browser. Location markers do not represent mapped buildings yet.
    </p>
  </section>;
}
