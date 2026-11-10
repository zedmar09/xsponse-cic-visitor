"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import { DEVICE_DRAG_TYPE, DEVICE_MODELS, type LocationDevice } from "@/lib/location-devices";
import { supportsCamera, type CameraCoverage, type DeviceSpatialMatch } from "@/lib/device-spatial";

type Props = {
  locationName: string;
  floorName: string | null;
  devices: LocationDevice[];
  floorNames: Record<string, string>;
  assignments: Record<string, DeviceSpatialMatch[]>;
  selectedDeviceId: string | null;
  busy: boolean;
  hasPendingChanges: boolean;
  onSave: () => void;
  onCancel: () => void;
  onCloseSetup: () => void;
  markersVisible: boolean;
  onEnableMarkers: () => void;
  onSelect: (id:string) => void;
  onConfigure: (id:string, patch:{sizePx?:number;camera?:CameraCoverage}) => void;
  onUnplace: (deviceId: string) => void;
};

export function DeviceInventory({
  locationName, floorName, devices, floorNames, assignments, selectedDeviceId,
  busy, hasPendingChanges, onSave, onCancel, onCloseSetup,
  markersVisible, onEnableMarkers, onSelect, onConfigure, onUnplace,
}: Props) {
  const root=useRef<HTMLDetailsElement>(null);
  useEffect(()=>{
    if(selectedDeviceId&&root.current)root.current.open=true;
  },[selectedDeviceId]);
  const selected=devices.find(d=>d.uuid===selectedDeviceId)??null;
  const selectedModel=DEVICE_MODELS.find(model=>model.type===selected?.type);
  const placed=devices.filter(device=>device.floorId!==null).length;
  const updateCamera=(patch:Partial<CameraCoverage>)=>{
    if(selected?.camera)onConfigure(selected.uuid,{camera:{...selected.camera,...patch}});
  };
  const numberField=(label:string,key:"radiusPx"|"widePx"|"widthPx"|"rotationDegrees",min:number,max:number)=>{
    if(!selected?.camera)return null;
    return <label key={key} className="block text-[11px] font-semibold text-slate-700">
      {label}
      <input type="number" min={min} max={max} step={1} disabled={busy}
        value={selected.camera[key]}
        onChange={event=>{
          const value=Number(event.target.value);
          if(Number.isFinite(value)&&value>=min&&value<=max)updateCamera({[key]:value});
        }}
        className="mt-1 w-full rounded border border-slate-300 bg-white p-2 text-sm font-normal"/>
    </label>;
  };
  return <details ref={root} className="rounded-xl border border-violet-200 bg-violet-50/40 p-3">
    <summary className="cursor-pointer text-sm font-semibold text-violet-950">
      Devices · {devices.length} total ({placed} placed)
    </summary>
    <p className="mt-2 text-xs leading-5 text-slate-600">
      {locationName} has its own UUID-based inventory. Drag an instance onto a floor;
      mapped zones and camera coverage are detected from its position.
    </p>
    {!floorName && <p className="mt-2 text-xs font-medium text-amber-800">
      Open an indoor floor before placing devices.
    </p>}
    <p className="mt-2 text-[11px] text-slate-600">
      Target: {floorName || "No floor selected"} · {devices.length-placed} unplaced
    </p>
    <div className="mt-3 rounded-md border border-slate-200 bg-white p-2">
      <p className="text-[11px] text-slate-600">
        {hasPendingChanges
          ? "Unsaved device placement or camera changes. They will appear on Street Map after saving."
          : "All device placement changes are saved."}
      </p>
      <div className="mt-2 flex gap-2">
        <button type="button" disabled={busy||!hasPendingChanges} onClick={onSave}
          className="flex-1 rounded-md bg-indigo-700 px-2 py-2 text-xs font-semibold text-white disabled:opacity-40">
          Save device placement
        </button>
        <button type="button" disabled={busy||(!hasPendingChanges&&!selectedDeviceId)} onClick={onCancel}
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-40">
          Cancel setup
        </button>
      </div>
    </div>
    {!markersVisible&&<div role="status" className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-900">
      Camera and device icons are hidden by your map display settings.
      <button type="button" onClick={onEnableMarkers}
        className="ml-2 rounded border border-amber-600 bg-white px-2 py-1 font-semibold">
        Show device icons
      </button>
    </div>}
    {selected&&<section className="mt-3 rounded-lg border border-violet-300 bg-white p-3" aria-label="Selected device configuration">
      <div className="flex items-center gap-2">
        {selectedModel&&<Image src={selectedModel.icon} alt="" width={26} height={26}
          unoptimized className="size-6 object-contain"/>}
        <div className="min-w-0">
          <p className="truncate text-xs font-bold text-violet-900">{selected.name}</p>
          <p className="truncate font-mono text-[10px] text-slate-500" title={selected.uuid}>{selected.uuid}</p>
        </div>
      </div>
      <button type="button" onClick={onCloseSetup}
        className="mt-2 rounded border border-slate-200 px-2 py-1 text-[11px] text-slate-700">
        Close settings (keep draft)
      </button>
      <p className="mt-2 text-[11px] text-slate-700">
        {selected.floorId ? "Floor: " + (floorNames[selected.floorId]??"Unknown") : "Not yet placed"}
      </p>
      <div className="mt-1 flex flex-wrap gap-1">
        {(assignments[selected.uuid]??[]).map(match=>
          <span key={match.category+":"+match.id} className="rounded bg-indigo-100 px-2 py-0.5 text-[10px] text-indigo-900">
            {match.category}: {match.name}
          </span>)}
        {selected.floorId&&(assignments[selected.uuid]??[]).length===0&&
          <span className="text-[11px] text-amber-700">Outside currently mapped rooms, walkways and facilities</span>}
      </div>
      <label className="mt-3 block text-xs font-semibold">
        Device footprint (16–160 floor-image px)
        <input type="range" min={16} max={160} step={2} value={selected.sizePx}
          disabled={busy} onChange={event=>onConfigure(selected.uuid,{sizePx:Number(event.target.value)})}
          className="mt-1 w-full"/>
        <span className="text-[11px] font-normal text-slate-500">{selected.sizePx} floor-image px on the longest side · Shape stays proportional to the floor when you zoom. Drag the bottom grip to resize.</span>
      </label>
      {supportsCamera(selected.type)&&selected.camera&&<>
        <p className="mt-3 text-xs font-semibold">Camera field of view</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {(["circle","cone"] as const).map(shape=><button key={shape} type="button" disabled={busy}
            aria-pressed={selected.camera?.shape===shape}
            onClick={()=>updateCamera({shape})}
            className={"rounded border p-2 text-xs capitalize "+(selected.camera?.shape===shape?"border-violet-500 bg-violet-100":"border-slate-200")}>
            {shape}
          </button>)}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {selected.camera.shape==="circle"
            ? numberField("Radius (plan px)","radiusPx",5,3000)
            : <>
                {numberField("Wide / reach (plan px)","widePx",5,3000)}
                {numberField("Width at far edge (plan px)","widthPx",5,3000)}
                <label className="col-span-2 block text-[11px] font-semibold text-slate-700">
                  Rotate cone direction · {selected.camera.rotationDegrees}°
                  <input type="range" min={-360} max={360} step={1}
                    value={selected.camera.rotationDegrees} disabled={busy}
                    onChange={event=>updateCamera({rotationDegrees:Number(event.target.value)})}
                    aria-label="Rotate camera cone direction"
                    className="mt-2 w-full accent-violet-700"/>
                  <span className="mt-1 flex justify-between text-[10px] font-normal text-slate-500">
                    <span>-360°</span><span>0° (up)</span><span>360°</span>
                  </span>
                </label>
              </>}
        </div>
        <p className="mt-2 text-[10px] text-slate-500">
          FOV and device footprint use original floor-image pixels, so their relative size and position stay fixed as the indoor map zooms.
        </p>
      </>}
      {!supportsCamera(selected.type)&&<p className="mt-3 text-xs text-slate-500">
        Push buttons do not support camera coverage.
      </p>}
    </section>}
    <div className="mt-3 space-y-2">
      {DEVICE_MODELS.map(model=>{
        const matches=devices.filter(device=>device.type===model.type);
        const onMap=matches.filter(device=>device.floorId!==null).length;
        return <details key={model.type} className="rounded-lg border border-violet-100 bg-white p-2">
          <summary className="flex cursor-pointer items-center gap-2 text-xs font-semibold">
            <Image src={model.icon} alt="" width={28} height={28} unoptimized className="size-7 shrink-0 object-contain"/>
            <span className="flex-1">{model.label}</span>
            <span className="text-[11px] font-normal text-slate-500">{onMap}/{matches.length} placed</span>
          </summary>
          <div className="mt-2 max-h-64 space-y-1 overflow-auto">
            {matches.map(device=><div key={device.uuid}
              draggable={!busy&&Boolean(floorName)}
              onDragStart={event=>{
                if(busy||!floorName){event.preventDefault();return;}
                event.dataTransfer.setData(DEVICE_DRAG_TYPE,device.uuid);
                event.dataTransfer.effectAllowed="move";
              }}
              className={"flex cursor-grab items-center gap-2 rounded-md border p-1.5 active:cursor-grabbing "+(
                selectedDeviceId===device.uuid?"border-violet-500 bg-violet-50":"border-slate-100 bg-slate-50")}>
              <Image src={model.icon} alt="" width={24} height={24} unoptimized className="size-6 object-contain"/>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">{device.name}</p>
                <p className="truncate font-mono text-[10px] text-slate-500" title={device.uuid}>{device.uuid}</p>
                <p className="text-[10px] text-slate-600">
                  {device.floorId?"Placed · "+(floorNames[device.floorId]??"Unknown floor"):"Not placed"}
                </p>
                {device.floorId&&(assignments[device.uuid]??[]).map(match=>
                  <p className="truncate text-[10px] text-indigo-700" key={match.id+":"+match.category}>
                    {match.category}: {match.name}
                  </p>)}
              </div>
              <div className="flex flex-col gap-1">
                <button type="button" disabled={busy} onClick={()=>onSelect(device.uuid)}
                  aria-label={"Configure "+device.name}
                  className="rounded border bg-white px-1.5 py-1 text-[10px] text-violet-800">Configure</button>
                {device.floorId&&<button type="button" disabled={busy}
                  onClick={()=>onUnplace(device.uuid)} aria-label={"Unplace "+device.name}
                  className="rounded border bg-white px-1.5 py-1 text-[10px] text-red-700">Unplace</button>}
              </div>
            </div>)}
          </div>
        </details>;
      })}
    </div>
  </details>;
}
