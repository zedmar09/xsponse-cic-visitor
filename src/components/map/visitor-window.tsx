"use client";

import {GripVertical} from "lucide-react";
import {DEMO_VISITORS} from "@/lib/demo-visitors";
import {useFloatingWindow} from "@/lib/use-floating-window";

export function VisitorWindow(){
  const {panelRef,position,startDrag,moveDrag,stopDrag,cancelDrag,moveWithKeyboard}=
    useFloatingWindow<HTMLElement>();

  return <section ref={panelRef} data-floating-window="visitors" aria-label={`Visitors [${DEMO_VISITORS.length}]`}
    className="absolute right-[72px] top-4 z-30 w-[min(300px,calc(100%-5.5rem))] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[0_12px_32px_rgba(15,23,42,0.18)]"
    style={position?{left:position.x,top:position.y,right:"auto"}:undefined}>
    <div role="button" tabIndex={0} aria-label="Drag visitors window"
      onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={stopDrag}
      onPointerCancel={stopDrag} onLostPointerCapture={cancelDrag}
      onKeyDown={moveWithKeyboard}
      className="flex touch-none select-none items-center gap-1.5 bg-[#F23D44] px-2.5 py-2 text-white outline-none cursor-grab active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white">
      <GripVertical className="size-3.5 text-white/80" aria-hidden="true"/>
      <span className="text-xs font-bold">Visitors [{DEMO_VISITORS.length}]</span>
    </div>
    <ul className="divide-y divide-slate-100" aria-label="Demo visitor list">
      {DEMO_VISITORS.map(visitor=><li key={visitor.id}
        className="grid grid-cols-[34px_minmax(0,1fr)] items-center gap-2 px-2.5 py-1.5">
        {/* Remote photos are fixed seeded demo assets from randomuser.me. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={visitor.avatarUrl} alt={`${visitor.fullName} avatar`} width="34" height="34"
          draggable={false} loading="lazy"
          className="size-[34px] rounded-full border border-slate-200 bg-slate-100 object-cover"/>
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-slate-900">{visitor.fullName}</p>
          <p className="text-[10px] leading-4 tabular-nums text-slate-500">{visitor.contactNumber}</p>
        </div>
      </li>)}
    </ul>
  </section>;
}
