"use client";

import { useState } from "react";
import { AlertTriangle, MapPin, Network, RefreshCw, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { findValidatedRoute, type DestinationRoute, type NavigationAudit,
  type WalkwayCandidate } from "@/lib/navigation-graph";
import type { GuidedRoute } from "@/lib/navigation-route-geometry";
import type { FloorRouteStep } from "@/lib/navigation-multifloor";
import type { FloorPlanRecord } from "@/lib/floor-plan";
import { verticalName } from "@/lib/vertical-connections";
import type { Staircase } from "@/lib/staircases";

type Props={
  active:boolean;onToggle:()=>void;report:NavigationAudit;floorId:string;busy:boolean;
  startId:string|null;destinationId:string|null;route:DestinationRoute;
  guidance:GuidedRoute|null;routeSteps:FloorRouteStep[];floors:FloorPlanRecord[];
  staircases:Staircase[];onResolveStair:(id:string)=>void;onViewFloor:(id:string)=>void;
  onStartChange:(id:string)=>void;onDestinationChange:(id:string)=>void;
  onApprove:(item:WalkwayCandidate)=>void;onRevoke:(item:WalkwayCandidate)=>void;
};
export function NavigationAuditPanel({
  active,onToggle,report,floorId,busy,startId,destinationId,route,guidance,routeSteps,
  floors,staircases,onResolveStair,onViewFloor,onStartChange,onDestinationChange,onApprove,onRevoke,
}:Props) {
  const [search,setSearch]=useState("");
  const floorName=(id:string)=>floors.find(f=>f.hierarchy?.floor.id===id)?.hierarchy?.floor.name??"Unknown floor";
  const rooms=report.nodes.filter(n=>n.kind==="room")
    .sort((a,b)=>floorName(a.floorId).localeCompare(floorName(b.floorId))||a.label.localeCompare(b.label));
  const options=rooms.filter(n=>n.id!==startId&&n.label.toLowerCase().includes(search.trim().toLowerCase()));
  const pending=report.walkways.filter(w=>w.floorId===floorId);
  const issues=report.issues.filter(i=>i.floorId===floorId);
  const warnings=issues.filter(i=>i.severity==="warning");
  return <div className="mt-3 space-y-3">
    <p className="text-xs leading-5 text-muted-foreground">
      Pick a room and destination anywhere in the building. A smooth red line connects
      their doorway openings on each floor only when the path stays clear of drawn walls.
      If no safe line exists, the floor explains which geometry needs review.
    </p>
    <Button size="sm" className="w-full" variant={active?"outline":"default"}
      disabled={busy} onClick={onToggle}>
      {active?<RefreshCw/>:<Network/>}{active?"Hide route setup":"Show destinations & guidance"}
    </Button>
    {active&&<>
      <div className="rounded-lg border border-sky-200 bg-white p-3">
        <h4 className="flex items-center gap-2 text-sm font-semibold">
          <MapPin className="size-4 text-sky-700"/> Start and destination
        </h4>
        <label htmlFor="navigation-start-room" className="mt-3 block text-xs font-semibold">Start from</label>
        <select id="navigation-start-room" value={startId??""} disabled={busy||rooms.length===0}
          onChange={e=>onStartChange(e.target.value)}
          className="mt-1 h-9 w-full rounded-md border border-input bg-white px-2 text-xs">
          {rooms.length===0?<option value="">No rooms</option>:rooms.map(n=>
            <option key={n.id} value={n.id}>{floorName(n.floorId)} · {n.label}</option>)}
        </select>
        <label htmlFor="navigation-destination-search" className="mt-3 block text-xs font-semibold">
          Destination (any floor)
        </label>
        <input id="navigation-destination-search" value={search} placeholder="Search e.g. Toilet CR"
          onChange={e=>setSearch(e.target.value)}
          className="mt-1 h-9 w-full rounded-md border border-input bg-white px-2 text-xs"/>
        <div className="mt-2 max-h-52 space-y-1 overflow-y-auto" role="group"
          aria-label="Select destination">
          {options.map(n=>{
            const found=findValidatedRoute(report,startId,n.id);
            return <button key={n.id} type="button" disabled={busy}
              aria-pressed={destinationId===n.id} onClick={()=>onDestinationChange(n.id)}
              className={`flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-xs disabled:opacity-50 ${destinationId===n.id?
                "border-sky-500 bg-sky-100 font-semibold":"border-slate-200 bg-white hover:border-sky-300"}`}>
              <span className="min-w-0 flex-1 truncate">{n.label} · {floorName(n.floorId)}</span>
              <span className={found.status==="ready"?"text-emerald-700":"text-amber-800"}>
                {found.status==="ready"?"Network linked":"Review"}
              </span>
            </button>;
          })}
          {options.length===0&&<p className="p-2 text-xs text-muted-foreground">No matching destinations</p>}
        </div>
      </div>
      {destinationId&&<div className="rounded-lg border border-sky-200 bg-white p-3">
        <h4 className="text-sm font-semibold">Guided directions</h4>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Large green pin = start · Large red pin = destination · Solid red = wall-inset route
        </p>
        {route.status==="ready"?<>
          <p className="mt-2 text-xs text-emerald-800">
            {route.edges.length} reviewed connection{route.edges.length===1?"":"s"} in the route.
          </p>
          {route.routeSource==="topology"&&<p role="status"
            className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs leading-5 text-amber-900">
            Your saved doorways and floor connections are linked. The shortest-path
            geometry could not be fully validated; only safe, drawable floor segments
            will appear. Review the floor-specific instructions below.
          </p>}
          <div className="mt-2 space-y-3">
            {routeSteps.map((step,i)=><div key={`${step.floorId}-${i}`}
              className={`rounded-md border p-3 ${step.floorId===floorId?
                "border-blue-300 bg-blue-50/70":"border-slate-200 bg-slate-50"}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold">
                  {i+1}. {step.floorName}
                </span>
                <Button size="sm" variant="outline" disabled={busy}
                  onClick={()=>onViewFloor(step.floorId)}>
                  {step.floorId===floorId?"Focus route":"View floor"}
                </Button>
              </div>
              {step.guidance.status==="guided"?
                <p className="mt-1 text-xs font-semibold text-red-800">
                  Follow the solid red line through the mapped walking areas.
                </p>:
                <p role="alert" className="mt-1 text-xs leading-5 text-amber-900">
                  No wall-clear route line: {step.guidance.message}
                </p>}
              <ol className="mt-2 space-y-1 border-l-2 border-sky-200 pl-3">
                {step.nodes.map((n,j)=><li key={`${n.id}-${j}`} className="text-[11px]">
                  {j===0?"Start/enter":j===step.nodes.length-1?"Reach":"Continue through"}: {n.label}
                  {step.edges[j]&&<span className="block text-slate-600">
                    {step.edges[j].kind==="door"?"Through door":
                      step.edges[j].kind==="stair-access"?"To vertical connection":"Through open walking area"}: {step.edges[j].label}
                  </span>}
                </li>)}
              </ol>
              {step.transitionAfter&&<p className="mt-2 rounded-md bg-amber-50 p-2 text-xs font-semibold text-amber-900">
                Then use {step.transitionAfter.label} to go to {floorName(
                  step.transitionAfter.fromId===step.nodes.at(-1)?.id?
                    route.nodes.find(n=>n.id===step.transitionAfter!.toId)?.floorId??"":
                    route.nodes.find(n=>n.id===step.transitionAfter!.fromId)?.floorId??""
                )}.
              </p>}
            </div>)}
          </div>
          {guidance?.status!=="guided"&&<p className="mt-2 text-[11px] text-amber-900">
            Select a floor above to see its red route line. If no line appears, its
            saved door/corridor shapes still need review; a connection count alone
            does not guarantee drawable geometry.
          </p>}
        </>:<p className="mt-2 text-xs leading-5 text-amber-900">
          No valid route yet. Review room doors, open hallway joins, or missing stairs/elevator
          locations on the destination floor. A destination selection alone cannot make an
          unmapped floor traversable.
        </p>}
      </div>}
      <details className="rounded-lg border border-sky-100 bg-white p-3">
        <summary className="cursor-pointer text-xs font-semibold">
          Connection audit · {warnings.length} warning{warnings.length===1?"":"s"}
        </summary>
        <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-md bg-slate-50 p-2">Reviewed doors: {report.readyDoorCount}</div>
          <div className="rounded-md bg-slate-50 p-2">Doors to review: {report.reviewDoorCount}</div>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          {report.connectedSpaceCount}/{report.spaceCount} spaces have checked
          topological access to a walking network.
        </p>
        <h4 className="mt-3 text-xs font-semibold">Open walking-area passages</h4>
        {pending.length===0?<p className="mt-1 text-xs text-muted-foreground">
          No adjacent walking areas detected here.
        </p>:<div className="mt-2 space-y-2">{pending.map(item=>
          <div key={item.id} className="rounded-md border p-2 text-xs">
            <p className="font-semibold">{item.label}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {item.approved?"Approved":item.stale?"Approval expired — outline changed":
                "Candidate only — check floor-plan walls"}
            </p>
            <Button size="sm" variant="outline" className="mt-2 w-full" disabled={busy}
              onClick={()=>item.approved?onRevoke(item):onApprove(item)}>
              {item.approved?"Revoke passage":"Approve verified open passage"}
            </Button>
          </div>)}</div>}
        <h4 className="mt-3 flex items-center gap-2 text-xs font-semibold">
          <ShieldAlert className="size-3.5 text-amber-700"/> Issues on this floor
        </h4>
        {issues.length===0?<p className="mt-2 text-xs text-emerald-700">
          No topology issues on this floor.
        </p>:<ul className="mt-2 max-h-64 space-y-2 overflow-y-auto">
          {issues.slice(0,40).map(item=>{
            const stair=item.category==="staircase"?staircases.find(s=>s.id===item.entityId):null;
            return <li key={item.id} className="rounded-md border border-amber-100 bg-amber-50/50 p-2 text-[11px] leading-5">
              <span className="flex items-center gap-1 font-semibold text-amber-900">
                <AlertTriangle className="size-3"/> {item.category} · {item.severity==="warning"?"Review":"Information"}
              </span>
              <p className="mt-1">{item.message}</p>
              {stair&&item.severity==="warning"&&<Button size="sm" variant="outline"
                disabled={busy} className="mt-2" onClick={()=>onResolveStair(stair.id)}>
                Edit {verticalName(stair).toLowerCase()} location
              </Button>}
            </li>;
          })}
        </ul>}
      </details>
      <p className="text-[11px] leading-5 text-sky-900">
        An outline is enough to register each staircase or elevator on a floor.
        Floor-to-floor guidance requires its locations to be mapped on both floors and
        connected to drawn walking areas. Actual indoor visitor location cannot be
        reliably inferred from ordinary GPS alone.
      </p>
    </>}
  </div>;
}
