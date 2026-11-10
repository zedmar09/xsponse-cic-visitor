"use client";

import type { FloorPlanRecord } from "@/lib/floor-plan";

type Props={
  floors:FloorPlanRecord[];
  sourceFloorId:string;
  selectedFloorIds:string[];
  mappedFloorIds:string[];
  onChange:(ids:string[])=>void;
  disabled?:boolean;
};
export function StaircaseDestinationPicker({
  floors,sourceFloorId,selectedFloorIds,mappedFloorIds,onChange,disabled=false,
}:Props) {
  const source=floors.find(f=>f.hierarchy?.floor.id===sourceFloorId);
  const other=floors.filter(f=>f.hierarchy?.floor.id!==sourceFloorId);
  return <fieldset disabled={disabled} className="mt-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3">
    <legend className="px-1 text-xs font-semibold text-amber-950">Destination floor(s)</legend>
    <p className="text-xs leading-5 text-slate-700">
      From: <strong>{source?.hierarchy?.floor.name??"Current floor"}</strong>.
      Select which floors this staircase or elevator serves.
    </p>
    {other.length===0
      ?<p className="mt-2 text-xs leading-5 text-amber-800">
        No other floors exist yet. You can save now, add a new floor later, and return to choose it.
      </p>
      :<div className="mt-2 space-y-2">
        {other.map(f=>{
          const id=f.hierarchy?.floor.id??f.planId;
          const mapped=mappedFloorIds.includes(id);
          const checked=mapped||selectedFloorIds.includes(id);
          return <label key={id} className="flex cursor-pointer items-start gap-2 rounded-md border border-amber-100 bg-white p-2 text-xs">
            <input type="checkbox" checked={checked} disabled={mapped||disabled}
              onChange={e=>onChange(e.target.checked?
                [...new Set([...selectedFloorIds,id])]:selectedFloorIds.filter(x=>x!==id))}
              className="mt-0.5 size-4 shrink-0 accent-amber-700"/>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold text-slate-900">{f.hierarchy?.floor.name??f.name}</span>
              <span className="block text-[11px] text-slate-600">
                {mapped?"Zone already mapped on this floor":checked?"Selected — draw this zone on that floor":"Select as destination"}
              </span>
            </span>
          </label>;
        })}
      </div>}
    <p className="mt-2 text-[11px] leading-5 text-amber-900">
      Choosing a floor records your plan; it does not draw a staircase or elevator zone on that floor.
      Leave every box unchecked to select destinations later.
    </p>
  </fieldset>;
}
