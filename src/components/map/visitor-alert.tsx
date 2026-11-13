"use client";

import {Siren,X} from "lucide-react";
import type {VisitorAlertEvent} from "@/lib/visitor-simulation";

export function VisitorAlert({alert,onDismiss}:{
  alert:VisitorAlertEvent;
  onDismiss:()=>void;
}){
  return <section role="alert" aria-live="assertive" aria-label="Restricted area alert"
    className="pointer-events-auto absolute left-1/2 top-1/2 z-40 w-[min(340px,calc(100%-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border-2 border-red-500 bg-white text-center shadow-[0_18px_55px_rgba(127,29,29,0.38)]">
    <div className="relative bg-red-600 px-10 py-2.5 text-white">
      <h2 className="text-sm font-extrabold uppercase tracking-[0.16em]">Alert</h2>
      <button type="button" onClick={onDismiss} aria-label="Close alert"
        className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-white/85 hover:bg-white/15 hover:text-white">
        <X className="size-4" aria-hidden="true"/>
      </button>
    </div>
    <div className="px-5 py-4">
      <div className="mx-auto grid size-14 place-items-center rounded-full bg-red-100 text-red-600 ring-8 ring-red-50">
        <Siren className="size-8 animate-pulse" aria-hidden="true"/>
      </div>
      <p className="mt-4 text-sm font-bold leading-6 text-red-800">
        # Visitor entered the restricted area: {alert.areaName}
      </p>
    </div>
  </section>;
}
