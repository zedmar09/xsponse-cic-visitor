"use client";

import { useState } from "react";
import { Layers3, Plus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { FloorPlanRecord } from "@/lib/floor-plan";

type Props={
  floors:FloorPlanRecord[];
  activeId:string|null;
  busy:boolean;
  onSelect:(id:string)=>void;
  onAdd:(name:string,level:number|null)=>void;
};
const label=(floor:FloorPlanRecord)=>floor.hierarchy?.floor.name??floor.name;
export function FloorManager({floors,activeId,busy,onSelect,onAdd}:Props){
  const [adding,setAdding]=useState(false);
  const [name,setName]=useState("");
  const [level,setLevel]=useState("");
  const [error,setError]=useState("");
  const add=()=>{
    const clean=name.trim(),trimmedLevel=level.trim();
    const number=trimmedLevel===""?null:Number(trimmedLevel);
    if(!clean){setError("Give this floor a name, such as Level 2.");return;}
    if(number!==null&&(!Number.isSafeInteger(number)||number < -1000||number > 1000)){
      setError("Floor level must be a whole number between -1000 and 1000.");return;
    }
    if(number!==null&&floors.some(f=>f.hierarchy?.floor.level===number)){
      setError("A floor already uses this level number. Choose another level.");return;
    }
    if(floors.some(f=>label(f).toLowerCase()===clean.toLowerCase())){
      setError("A floor already has that name.");return;
    }
    setError("");
    onAdd(clean,number);
    setAdding(false);
    setName("");setLevel("");
  };
  return <section className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-3">
    <div className="flex items-center gap-2">
      <Layers3 className="size-4 text-indigo-700"/>
      <h3 className="text-sm font-semibold">Indoor floors for this location</h3>
    </div>
    <p className="mt-1 text-xs leading-5 text-muted-foreground">
      Choose a floor to work on. Every floor has its own picture, rooms and doorways.
      Switching floors does not delete your saved work.
    </p>
    <div role="group" aria-label="Choose floor" className="mt-3 space-y-2">
      {floors.map(f=><button key={f.id} type="button" disabled={busy}
        aria-current={f.id===activeId?"true":undefined}
        onClick={()=>onSelect(f.id)}
        className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs disabled:opacity-50 ${f.id===activeId?
          "border-indigo-500 bg-indigo-100 font-semibold text-indigo-900":"border-border bg-white hover:border-indigo-300"}`}>
        <span className="min-w-0 flex-1 truncate">{label(f)}</span>
        {f.hierarchy?.floor.level!==null&&f.hierarchy?.floor.level!==undefined &&
          <span className="shrink-0 text-[11px] text-muted-foreground">Level {f.hierarchy.floor.level}</span>}
        {f.id===activeId&&<span className="shrink-0 text-[11px] text-indigo-700">Editing</span>}
      </button>)}
    </div>
    {adding?<div className="mt-3 rounded-lg border border-border bg-white p-3">
      <label htmlFor="new-floor-name" className="text-xs font-semibold">New floor name</label>
      <input id="new-floor-name" value={name} maxLength={90} placeholder="e.g. Second Floor"
        onChange={e=>{setName(e.target.value);setError("");}}
        className="mt-1 h-9 w-full rounded-md border border-input px-2 text-sm"/>
      <label htmlFor="new-floor-level" className="mt-3 block text-xs font-semibold">Floor level (optional)</label>
      <input id="new-floor-level" value={level} type="number" step={1} min={-1000} max={1000}
        placeholder="e.g. 2, 0 or -1" onChange={e=>{setLevel(e.target.value);setError("");}}
        className="mt-1 h-9 w-full rounded-md border border-input px-2 text-sm"/>
      <p className="mt-1 text-[11px] text-muted-foreground">Next, choose this floor&apos;s image. Your current floor stays saved.</p>
      {error&&<p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
      <div className="mt-3 flex gap-2">
        <Button size="sm" disabled={busy} onClick={add}><Upload/> Choose image &amp; add</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={()=>{setAdding(false);setError("");}}>Cancel</Button>
      </div>
    </div>:<Button size="sm" variant="outline" className="mt-3 w-full" disabled={busy}
      onClick={()=>setAdding(true)}><Plus/> Add floor</Button>}
    <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
      Saved in this browser only. Configure staircases and elevators in the indoor editor.
    </p>
  </section>;
}
