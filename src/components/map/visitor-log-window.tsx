"use client";

import {useEffect,useRef,useState} from "react";
import {Download,GripVertical,Pause,Play,Trash2} from "lucide-react";
import type {FloorPlacementPreview} from "@/components/map/map-canvas";
import type {PixelPoint} from "@/lib/floor-plan";
import {indoorPointToLngLat} from "@/lib/outdoor-indoor-geometry";
import {useFloatingWindow} from "@/lib/use-floating-window";
import {
  appendVisitorLog,createVisitorLogEntry,visitorLogCsv,VISITOR_LOG_INTERVAL_MS,
  type VisitorLogEntry,
} from "@/lib/visitor-log";
import type {VisitorMapSnapshot} from "@/lib/visitor-simulation";

const timeLabel=(iso:string)=>new Date(iso).toLocaleTimeString([], {
  hour:"2-digit",minute:"2-digit",second:"2-digit",
});
const coordinateLabel=(latitude:number|null,longitude:number|null)=>
  latitude===null||longitude===null?"Not placed on map":
    `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;

/** Opens directly beneath the Visitors window; dragged independently after. */
const belowVisitorsWindow=(panel:HTMLElement,container:HTMLElement)=>{
  const visitors=container.querySelector<HTMLElement>('[data-floating-window="visitors"]');
  if(!visitors)return null;
  const box=visitors.getBoundingClientRect(),area=container.getBoundingClientRect();
  return {x:box.right-area.left-panel.offsetWidth,y:box.bottom-area.top+8};
};

export function VisitorLogWindow({visitors,placements}:{
  visitors:VisitorMapSnapshot[];
  placements:FloorPlacementPreview[];
}){
  const {panelRef,position,startDrag,moveDrag,stopDrag,cancelDrag,moveWithKeyboard}=
    useFloatingWindow<HTMLElement>(belowVisitorsWindow);
  const [entries,setEntries]=useState<VisitorLogEntry[]>([]);
  const [paused,setPaused]=useState(false);
  const latestRef=useRef({visitors,placements});
  useEffect(()=>{latestRef.current={visitors,placements};},[visitors,placements]);

  // Every 3 s: one timestamped sample with all visitors' coordinates, using
  // the same floor placement the map uses to draw each visitor.
  useEffect(()=>{
    if(paused)return;
    const record=()=>{
      const {visitors:current,placements:floors}=latestRef.current;
      if(!current.length)return;
      const project=(visitor:VisitorMapSnapshot,point:PixelPoint):[number,number]|null=>{
        const floor=floors.find(item=>item.floorId===visitor.floorRecordId);
        if(!floor)return null;
        try{return indoorPointToLngLat(point,floor.placement,floor.imageWidth,floor.imageHeight);}
        catch{return null;}
      };
      const entry=createVisitorLogEntry(new Date(),current,project);
      setEntries(previous=>appendVisitorLog(previous,entry));
    };
    const interval=window.setInterval(record,VISITOR_LOG_INTERVAL_MS);
    return ()=>window.clearInterval(interval);
  },[paused]);

  const download=()=>{
    const blob=new Blob([visitorLogCsv(entries)],{type:"text/csv"});
    const link=document.createElement("a");
    link.href=URL.createObjectURL(blob);
    link.download=`visitor-log-${new Date().toISOString().replace(/[:.]/g,"-")}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const toolButton="grid size-6 place-items-center rounded text-white/90 hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-40";

  return <section ref={panelRef} data-floating-window="visitor-log" aria-label="Visitor coordinate log"
    className="absolute right-[72px] top-[300px] z-30 flex max-h-[min(340px,calc(100%-1rem))] w-[min(300px,calc(100%-5.5rem))] flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[0_12px_32px_rgba(15,23,42,0.18)]"
    style={position?{left:position.x,top:position.y,right:"auto"}:undefined}>
    <div className="flex items-center bg-slate-800 pr-1.5 text-white">
      <div role="button" tabIndex={0} aria-label="Drag visitor log window"
        onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={stopDrag}
        onPointerCancel={stopDrag} onLostPointerCapture={cancelDrag}
        onKeyDown={moveWithKeyboard}
        className="flex min-w-0 flex-1 touch-none select-none items-center gap-1.5 px-2.5 py-2 outline-none cursor-grab active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white">
        <GripVertical className="size-3.5 shrink-0 text-white/70" aria-hidden="true"/>
        <span className="truncate text-xs font-bold">Visitor log</span>
        <span className="text-[10px] font-medium text-white/60">every {VISITOR_LOG_INTERVAL_MS/1000}s</span>
        {!paused&&<span className="ml-1 size-1.5 shrink-0 animate-pulse rounded-full bg-emerald-400" aria-hidden="true"/>}
      </div>
      <button type="button" className={toolButton} onClick={()=>setPaused(value=>!value)}
        aria-label={paused?"Resume visitor log":"Pause visitor log"} title={paused?"Resume":"Pause"}>
        {paused?<Play className="size-3.5"/>:<Pause className="size-3.5"/>}
      </button>
      <button type="button" className={toolButton} onClick={download} disabled={!entries.length}
        aria-label="Download visitor log as CSV" title="Download CSV">
        <Download className="size-3.5"/>
      </button>
      <button type="button" className={toolButton} onClick={()=>setEntries([])} disabled={!entries.length}
        aria-label="Clear visitor log" title="Clear">
        <Trash2 className="size-3.5"/>
      </button>
    </div>
    <ol className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto" aria-label="Visitor coordinate samples" aria-live="off">
      {!entries.length&&<li className="px-3 py-4 text-center text-[11px] text-slate-500">
        {paused?"Logging paused.":"Waiting for the first sample…"}
      </li>}
      {entries.map(entry=><li key={entry.id} className="px-2.5 py-1.5">
        <time dateTime={entry.timestamp}
          className="block text-[10px] font-bold tabular-nums text-slate-700">{timeLabel(entry.timestamp)}</time>
        <ul className="mt-0.5 space-y-0.5">
          {entry.rows.map(row=><li key={row.visitorId}
            className="grid grid-cols-[8px_minmax(0,1fr)] items-start gap-1.5 text-[10px] leading-[14px]">
            <span className="mt-[3px] size-2 rounded-full" style={{background:row.alerting?"#ef4444":row.color}} aria-hidden="true"/>
            <span className="min-w-0">
              <span className="font-semibold text-slate-900">{row.fullName}</span>
              <span className={row.alerting?"font-semibold text-red-600":"text-slate-500"}> · {row.locationName} · {row.floorName}</span>
              <span className="block truncate font-mono tabular-nums text-slate-600"
                title={`Pixel ${row.x}, ${row.y}`}>{coordinateLabel(row.latitude,row.longitude)} <span className="text-slate-400">({row.x}, {row.y} px)</span></span>
            </span>
          </li>)}
        </ul>
      </li>)}
    </ol>
  </section>;
}
