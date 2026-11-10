"use client";

import { useState } from "react";
import { CheckCircle2, Save, Undo2, Redo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  doorwayReviewIssues, segmentImageLength, suggestDoorwaySides,
  type DoorPurpose, type DoorUsage, type FloorArea, type FloorPortal, type PixelPoint,
} from "@/lib/floor-plan";

type Props={
  floorId:string;
  depth:number;onDepthChange:(value:number)=>void;
  purpose:DoorPurpose;onPurposeChange:(value:DoorPurpose)=>void;
  usage:DoorUsage;onUsageChange:(value:DoorUsage)=>void;
  name:string;onNameChange:(value:string)=>void;
  spaceAId:string;onSpaceAChange:(value:string)=>void;
  spaceBId:string;onSpaceBChange:(value:string)=>void;
  areas:FloorArea[];points:PixelPoint[];editing:boolean;saving:boolean;
  canUndo:boolean;canRedo:boolean;
  onSuggest:(sideA:string|null,sideB:string|null)=>void;
  onSwap:()=>void;
  onConfirmSave:()=>void;onSaveDraft:()=>void;
  onRemoveLast:()=>void;onUndo:()=>void;onRedo:()=>void;onCancel:()=>void;
};

export function DoorwayEditor(p:Props) {
  const [showConnections,setShowConnections]=useState(false);
  const span=p.points.length===2?segmentImageLength(p.points[0],p.points[1]):0;
  const suggestion=p.points.length===2?suggestDoorwaySides(p.points[0],p.points[1],p.areas):null;
  const outside=p.purpose!=="interior";
  const fromId=outside?"":p.spaceAId;
  const readyToConnect=Boolean(p.spaceBId&&(outside||p.spaceAId));
  const draft:FloorPortal={
    id:"draft",floorId:p.floorId,name:p.name,usage:p.usage,purpose:p.purpose,reviewed:true,
    start:p.points[0]??{x:0,y:0},end:p.points[1]??{x:0,y:0},
    spaceAId:fromId||null,spaceBId:p.spaceBId||null,
  };
  const issues=doorwayReviewIssues(draft,p.areas);
  const valid=readyToConnect&&p.points.length===2&&span>=3&&Boolean(p.name.trim())&&issues.length===0;
  const name=(id:string)=>p.areas.find(a=>a.id===id)?.name??"Unassigned space";
  const fromName=outside?"Outside":p.spaceAId?name(p.spaceAId):"Choose a space";
  const toName=p.spaceBId?name(p.spaceBId):"Choose a space";
  const hasSuggestion=Boolean(suggestion&&(suggestion.status==="two-spaces"||suggestion.status==="one-space"));
  return <div className="mt-3 space-y-4 rounded-lg border border-indigo-200 bg-indigo-50 p-3">
    <section>
      <h4 className="text-sm font-semibold text-indigo-900">1. Place the door on the map</h4>
      <p className="mt-1 text-xs leading-5 text-indigo-800">
        {p.points.length<2
          ?"Click once near the doorway in the floor plan. A rectangular overlay will appear."
          :"Door placed! Drag the rectangle to move it, or drag either yellow handle to change its width or angle. Click elsewhere to reposition."}
      </p>
      {p.points.length===2&&<p className="mt-1 text-[11px] text-indigo-700">
        Width shown: {span.toFixed(0)} floor-plan pixels (visual only, not meters)
      </p>}
      <div className="mt-3 rounded-md border border-indigo-200 bg-white/85 p-2">
        <label htmlFor="door-depth" className="flex items-center justify-between gap-2 text-xs font-semibold">
          <span>Rectangle thickness</span><span>{p.depth} px</span>
        </label>
        <input id="door-depth" type="range" min={6} max={48} step={1} value={p.depth}
          onChange={e=>p.onDepthChange(Number(e.target.value))}
          className="mt-2 w-full accent-indigo-600"/>
        <p className="mt-1 text-[11px] leading-4 text-indigo-900">
          Fine-tune in 1-pixel steps, or drag the <strong>blue circular handle</strong>
          beside the rectangle directly on the map.
          Yellow handles still adjust its width and angle; drag the rectangle itself to move it.
        </p>
        <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
          Thickness is for visual placement only, not a measured door or wall dimension.
        </p>
      </div>
    </section>
    <section>
      <label htmlFor="door-purpose" className="block text-xs font-semibold">2. Where is this door?</label>
      <select id="door-purpose" value={p.purpose} onChange={e=>p.onPurposeChange(e.target.value as DoorPurpose)}
        className="mt-1 h-10 w-full rounded-md border border-input bg-white px-2 text-sm">
        <option value="interior">Inside — between rooms or hallways</option>
        <option value="building">Building entrance / exit — connects to outside</option>
        <option value="emergency">Emergency exit — connects to outside</option>
      </select>
      {p.purpose==="emergency"&&<p className="mt-1 text-[11px] leading-4 text-amber-800">
        The emergency designation must be checked on site. Saving it does not certify an exit as safe.
      </p>}
    </section>
    <section>
      <h4 className="text-sm font-semibold">3. Check the connected rooms</h4>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        Read the room labels on the map. The app proposes connections after you place a door; check them before confirming.
      </p>
      {p.areas.length===0&&<p className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs leading-5 text-amber-900">
        No rooms or hallways have been saved yet. Go to Step 3 above, draw and save the spaces first.
        You can still save this door for later.
      </p>}
      <div className="mt-2 rounded-lg border border-indigo-200 bg-white p-3">
        <p className="text-[11px] font-medium text-slate-500">This door connects</p>
        <p className="mt-1 break-words text-sm font-bold text-slate-900">
          {fromName} <span aria-label="connected to" className="text-indigo-600">↔</span> {toName}
        </p>
        {readyToConnect?<p className="mt-1 text-[11px] text-emerald-700">Check that these match the rooms shown on the map.</p>
          :<p className="mt-1 text-[11px] text-amber-700">Select the missing room below to finish this door.</p>}
      </div>
      {p.points.length===2&&hasSuggestion&&
        <Button size="sm" variant="outline" className="mt-2 w-full"
          onClick={()=>p.onSuggest(suggestion!.sideAId,suggestion!.sideBId)}>
          Use nearby room suggestion
        </Button>}
      {p.points.length===2&&suggestion?.status==="ambiguous"&&<p className="mt-2 text-xs text-amber-800">
        Overlapping room outlines found; choose the correct rooms manually.
      </p>}
      {p.points.length===2&&suggestion?.status==="none"&&<p className="mt-2 text-xs text-amber-800">
        No reliable nearby rooms found. You can choose them below.
      </p>}
      <button type="button" className="mt-3 text-xs font-semibold text-indigo-800 underline underline-offset-2"
        onClick={()=>setShowConnections(v=>!v)}>
        {showConnections?"Hide room choices":"Change or choose connected rooms"}
      </button>
      {(showConnections||!readyToConnect)&&<div className="mt-2 space-y-2">
        {outside
          ?<p className="rounded bg-white p-2 text-xs">One side: <strong>Outside the building</strong></p>
          :<div>
            <label htmlFor="space-from" className="block text-xs font-semibold">Room or hallway on one side</label>
            <select id="space-from" value={p.spaceAId} onChange={e=>p.onSpaceAChange(e.target.value)}
              className="mt-1 h-10 w-full rounded-md border border-input bg-white px-2 text-xs">
              <option value="">Choose first room/hallway…</option>
              {p.areas.map(a=><option key={a.id} value={a.id}>{a.name} ({a.kind})</option>)}
            </select>
          </div>}
        <div>
          <label htmlFor="space-to" className="block text-xs font-semibold">{outside?"Room or lobby inside":"Room or hallway on the other side"}</label>
          <select id="space-to" value={p.spaceBId} onChange={e=>p.onSpaceBChange(e.target.value)}
            className="mt-1 h-10 w-full rounded-md border border-input bg-white px-2 text-xs">
            <option value="">Choose a space…</option>
            {p.areas.map(a=><option key={a.id} value={a.id}>{a.name} ({a.kind})</option>)}
          </select>
        </div>
        {!outside&&<Button size="sm" variant="outline" disabled={!p.spaceAId||!p.spaceBId} onClick={p.onSwap}>
          Swap the two rooms
        </Button>}
      </div>}
    </section>
    <section>
      <label htmlFor="door-usage" className="block text-xs font-semibold">4. Can people go through both ways?</label>
      <select id="door-usage" value={p.usage} onChange={e=>p.onUsageChange(e.target.value as DoorUsage)}
        className="mt-1 h-10 w-full rounded-md border border-input bg-white px-2 text-xs">
        <option value="both">Yes — both directions (recommended)</option>
        {p.purpose!=="emergency"&&<option value="entrance">One-way: {fromName} → {toName}</option>}
        <option value="exit">One-way: {toName} → {fromName}</option>
        {p.usage==="internal"&&<option value="internal">Old door setting — select a direction</option>}
      </select>
      <p className="mt-1 text-[11px] leading-4 text-indigo-900">
        Most normal doors use both directions. Choose one-way only when people must travel in one direction.
      </p>
    </section>
    <div className="rounded-lg border border-indigo-200 bg-white p-3">
      {valid
        ?<p className="flex items-center gap-2 text-xs text-emerald-800"><CheckCircle2 className="size-4"/> Ready to confirm</p>
        :<p className="text-xs leading-5 text-amber-800">
          {p.points.length!==2?"Click once near the doorway to place it.":
            !readyToConnect?"Choose the rooms this door connects (or save for later).":
            issues.length?issues[0]:"Finish the door details."}
        </p>}
      <p className="mt-1 text-[11px] leading-4 text-slate-600">
        Confirming means you checked the opening and rooms on the floor plan; it does not verify real-world access or safety.
      </p>
      <Button size="sm" className="mt-3 w-full" disabled={!valid||p.saving} onClick={p.onConfirmSave}>
        <Save/> Confirm &amp; save doorway
      </Button>
      <Button size="sm" className="mt-2 w-full" variant="outline"
        disabled={p.saving||p.points.length!==2||span<3||!p.name.trim()||p.usage==="internal"}
        onClick={p.onSaveDraft}>Save for later (incomplete doorway)</Button>
    </div>
    <details className="text-xs text-indigo-900">
      <summary className="cursor-pointer font-semibold">Drawing tools (undo / redo)</summary>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={!p.points.length||p.saving}
          onClick={p.onRemoveLast}><Undo2/> Remove last</Button>
        <Button size="sm" variant="outline" disabled={!p.canUndo||p.saving}
          onClick={p.onUndo}><Undo2/> Undo</Button>
        <Button size="sm" variant="outline" disabled={!p.canRedo||p.saving}
          onClick={p.onRedo}><Redo2/> Redo</Button>
      </div>
    </details>
    <Button size="sm" variant="ghost" onClick={p.onCancel}>Cancel</Button>
  </div>;
}
