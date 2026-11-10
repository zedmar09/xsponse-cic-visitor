# Navigation & Connectivity Audit — Review Gate

This milestone generates a **diagnostic topology graph**. It is NOT the indoor wayfinding engine and it does not certify routes, accessibility, emergency egress or wall clearance.

## User flow
1. Open the editor and choose **5. Navigation & connectivity audit → Generate & validate navigation**.
2. The app analyzes every saved floor in the current building using existing rooms/walkable areas, confirmed door metadata and staircase landing data. The selected floor's warnings and candidate walkway joins appear in the sidebar.
3. The prior full-map green/amber lines have been removed because they implied crossings through nonconnected rooms, doors, walls and exits. Choose **Start from** and click an item in **Destinations on this floor** instead. The map shows a green start circle, red end circle, optional purple verified-door checkpoints and a **blue continuous guided preview with arrows** if it can trace every approved transition while staying inside the actual saved polygons. No preview line is shown if the geometry cannot justify it.
4. Review every proposed walkway join against the original plan to ensure it is genuinely open. Approve or revoke one at a time; approval is stored with the floor. Moving/editing a source polygon removes its prior approvals.
5. Fix broken/unreviewed door links with the existing door editor. For a staircase, verify the destination floor has a corresponding landing, and set its hallway access point.
6. Switch to other floors and repeat. Graph indicators and review counts update automatically as geometry is saved.

## Data integrity
- The existing IndexedDB stores are not upgraded. A small optional `walkwayApprovals` array is added only when someone explicitly approves a passage on a floor.
- Original floor images, room polygons, portal endpoints, staircase outlines and IDs are not rewritten by generating the graph.
- Approvals are keyed by floor-local area IDs and an exact geometry signature, so moving a wall/corridor cancels the prior approval and requires another review.
- Floor JSON export carries the optional approvals. Existing saved plans without approvals load unchanged.
- The derived graph is computed from saved data. It is not persisted as a route or shared between users/browsers.
- Recorded one-way door direction is visible in graph metadata but **no directional routing is performed**.

## Browser acceptance checklist
- [ ] Back up important plan images and floor JSON, then test the PR on a separate browser origin or test profile.
- [ ] Verify existing multi-floor pictures, room outlines, saved doors and stairs appear unchanged.
- [ ] Choose Dining as the origin and click Toilet CR. Verify a blue directional line follows saved room/corridor polygons and reviewed door openings only when every transition is valid. If not, show no walking line and explain the invalid location. Never draw straight lines through walls.
- [ ] Generate audit; verify candidate passages appear when two walkable polygons share a line segment or genuinely overlap.
- [ ] A corner-only touch or small wall gap should NOT silently connect walking areas.
- [ ] Approve an actually open junction. Reload the browser; confirm that this link now appears accepted.
- [ ] Edit the corridor outline. Confirm the previous approval is cleared, and the junction requires re-review.
- [ ] Revoke an approval and check that the connectivity count adjusts.
- [ ] A draft door is flagged, and a reviewed door in an obviously wrong location is not accepted.
- [ ] Confirm correct doorway associations are still manually checked against the image because the algorithm cannot see raw image wall symbols.
- [ ] Flag an isolated room with no reviewed connection to the walking-area network.
- [ ] Test an unfinished stair destination (no upper landing): click its warning to start mapping the landing on that floor. Test a staircase without a hallway access point: click its warning, place the point **inside** the green walking area, and save. A point outside the walking area must not save as a usable connection.
- [ ] Switch floors and ensure warnings/links are scoped to their respective floors.
- [ ] Zoom and pan with destination circles selected; ensure MapLibre doesn't draw center-to-center lines or mistake disconnected exits for a path.
- [ ] Run CI lint, typecheck, all geometry tests, production build and worker deployment smoke tests.

## Deferred
- Real pedestrian route geometry, obstacles / no-walk polygons, intersection/path editing, elevators, calibrated length, shortest-path routing, access classification, one-way traversal enforcement, multi-floor route instructions, server sync and export/import of full buildings.
- The audit does not automatically validate an uploaded image's walls or structural access; approvals remain a human responsibility.

## Acceptance rule
Passing CI is insufficient. Before merging, audit a real sample floor and a deliberately disconnected test plan. The graph must never show a proposed centerline as a safe walking path.
