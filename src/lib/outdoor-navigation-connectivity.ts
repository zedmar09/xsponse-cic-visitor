/** Location-scoped outdoor wayfinding must use the COMPLETE saved indoor
 * navigation graph, not only the floors with a geographic placement.
 *
 * Rooms on unplaced floors are hidden from the outdoor destination picker,
 * but their verified door / stair graph can still be essential for routing
 * between two placed floors (for example, via an intermediate level).
 */
import type { FloorPlanRecord } from "@/lib/floor-plan";
import type { NavNode, NavigationAudit, DestinationRoute } from "@/lib/navigation-graph";
import type { Staircase } from "@/lib/staircases";

export function outdoorNavigationScope(
  floors:FloorPlanRecord[],locationId:string|null,
):{graphFloors:FloorPlanRecord[];placedFloors:FloorPlanRecord[];buildingIds:string[]} {
  const graphFloors=locationId?
    floors.filter(f=>f.locationId===locationId):[];
  const placedFloors=graphFloors.filter(f=>Boolean(f.outdoorPlacement));
  const buildingIds=[...new Set(graphFloors.flatMap(f=>
    f.hierarchy?.building.id?[f.hierarchy.building.id]:[],
  ))].sort();
  return {graphFloors,placedFloors,buildingIds};
}

export function outdoorNavigationProblems(
  audit:NavigationAudit,route:DestinationRoute,
  start:NavNode|null,end:NavNode|null,
):string[] {
  if(!start||!end||route.status!=="unreachable")return [];
  const problems:string[]=[];
  const connected=(node:NavNode)=>{
    return audit.edges.some(edge=>{
      if(edge.status!=="ready")return false;
      const from=audit.nodes.find(n=>n.id===edge.fromId);
      const to=audit.nodes.find(n=>n.id===edge.toId);
      if(from?.kind==="outside"||to?.kind==="outside")return false;
      return edge.fromId===node.id||edge.toId===node.id;
    });
  };
  if(!connected(start))problems.push(
    `Start room "${start.label}" has no reviewed connection to another indoor space. Check its doorway assignment and wall alignment in Indoor plan.`);
  if(end.id!==start.id&&!connected(end))problems.push(
    `Destination "${end.label}" has no reviewed indoor connection. Check its doorway and adjacent walking areas.`);

  if(start.floorId!==end.floorId&&!audit.edges.some(e=>
    e.kind==="vertical"&&e.status==="ready"))
    problems.push("No validated stair/elevator connection joins these floors. Map the landings and walking-area access on each required level.");

  const pendingWalkways=audit.walkways.filter(w=>!w.approved).length;
  if(pendingWalkways>0)problems.push(
    `${pendingWalkways} walking-area join${pendingWalkways===1?" is":"s are"} not approved. Review the shared edges before treating them as passable.`);

  if(audit.readyDoorCount===0)problems.push(
    "No reviewed interior doorway is available in this location. Drawing rooms and doors alone does not approve a navigable opening.");

  const floorWarnings=audit.issues.filter(issue=>
    (issue.floorId===start.floorId||issue.floorId===end.floorId)&&
    issue.severity==="warning",
  ).slice(0,2);
  for(const issue of floorWarnings)problems.push(issue.message);

  if(!problems.length)problems.push(
    "These rooms are not in the same approved connection network. Check one-way door directions, reviewed openings and walking-area join approvals in Indoor plan.");
  return [...new Set(problems)].slice(0,5);
}
