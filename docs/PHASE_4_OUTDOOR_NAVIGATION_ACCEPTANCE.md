# Phase 4 — Outdoor indoor navigation & connectivity acceptance

**Status:** Implemented on draft PR #30. Automated CI and real browser route verification are separate acceptance gates.

## Intended behavior

- Use the saved outdoor location and its independently placed indoor floors. The outdoor map does **not** require an outdoor building. No unplaced floor is offered as a destination, and floor-plan images remain optional.
- Turn on **Navigation & connectivity** in the Street map sidebar. Existing indoor saved geometry renders for every placed floor in the selected location.
- Choose a **Start room** and **Destination room** by selectors (floor name + room name), or click a locked room and choose **Start route here** or **Navigate here** in the bottom-right feature card.
- Use the **existing** validated navigation engine: `buildNavigationAudit`, `findShortestMappedRoute`, `findValidatedRoute` for connectivity fallback, and `buildFloorRouteSteps` for clearance-checked walking instructions. Respect door direction, reviewed openings, approved walking-area joins and mapped stairs/elevator links. Candidate/unreviewed graph edges are **not** traversable.
- Display solid red, white-halo indoor walking segments on the outdoor geographic map. Project each saved pixel route through exactly the same four-corner placement as the floor's room geometry and optional raster.
- Render separate start/end markers and amber staircase/elevator transition markers. On multi-floor routes, there is **no** flat line connecting separate floors.
- Explain when a topological connection exists but no wall-clear trajectory can be drawn; hide the impossible walking segment rather than displaying a straight line through walls. Route lines should update on selecting another room.
- Show approved doorway count, approved walkway joins, vertical links and warnings without changing any indoor graph or floor record.

## Connection diagnosis and regression

- **Applied · Locked** is a floor-placement state, **not** an indoor connectivity approval. Saved rooms, doors, walking areas and stairs need a validated network separately.
- Route graph includes every indoor floor assigned to the selected saved location, even if an intermediate level has no outdoor placement. Only placed rooms can be selected as outdoor start/destination, and only placed levels can show geographic route lines.
- Stair/elevator links are read independently from IndexedDB for each internal navigation group assigned to the saved location; opening Street map directly after a reload must not depend on opening a floor in Indoor plan first.
- When routing is genuinely unreachable, show actionable diagnostics: disconnected start/destination room, pending walkway approvals, unreviewed doorways, or missing mapped floor connectors. Do not silently declare the group connected and do not fabricate a route.

## Browser acceptance checklist

- [ ] After applying/locking a floor, open Street map directly from a fresh browser session and enable navigation. Confirm stair/elevator links load independently, even when no indoor editor floor was opened in that session.
- [ ] Build a 3-floor reviewed route where the intermediate floor has not yet been geographically placed. Endpoints on placed floors should remain connected in the indoor graph; intermediate guidance must state that its outdoor route segment cannot yet be shown.
- [ ] If no approved door or corridor joins connect two selected rooms, verify the outdoor panel reports which room or connection requires attention rather than a generic "No validated route" message.
- [ ] Validate the same origin/destination in the Indoor plan navigation panel. If it is reachable there, outdoor route topology should also be reachable when its floors share one saved location.



- [ ] Create a location with two placed floors and several room/walkway/doorway shapes; in Street map enable navigation. Both floors' saved indoor shapes become visible even with floor-plan pictures turned off.
- [ ] Select start and destination rooms on one floor. Verify a red line follows actual saved walkable regions and reviewed doorway openings; no room-centre-to-room-centre straight line is invented.
- [ ] Select a cross-floor destination. Verify each floor's path is separate and the stair/elevator change is indicated with markers and textual guidance, not a flat geographic line through the building.
- [ ] Change the start/destination via clicking a locked room's inspection card. Confirm room names in the sidebar and route line update without unlocking placement or moving geometry.
- [ ] Confirm a one-way door respects its configured direction (reverse should be unreachable when no other valid path exists).
- [ ] Confirm an unapproved walkway join and an unreviewed doorway never become a valid route. Review/approve in Indoor plan and verify the outdoor route is then available.
- [ ] Confirm missing stair landings or unplaced floors produce explanation rather than an invented route. Ensure a floor transition requires mapped, connected stairs/elevator.
- [ ] Confirm all floor-plan preview toggles leave route geometry aligned. Check a skewed/rotated floor and compare the red path with the saved indoor room/door geometry.
- [ ] Toggle Streets/Light basemap style, then change route selections and hide navigation. Verify overlays clean up, persist across style switching while active, and do not leave stale lines.
- [ ] Repeat after browser refresh, using saved IndexedDB floors. No new building setup must be requested.

## Limitations

- Indoor navigation uses administrator-drawn geometry, not live indoor positioning. GPS does not resolve a person's indoor room or floor.
- The rendered route is a visualization of the saved audit, **not** a guarantee that every real-world wall or obstacle was mapped; do not use as emergency evacuation or accessible-path certification.
- The historical graph's floor-to-floor links rely on its stable internal grouping / landing matches. Only *validated existing* cross-floor links are used, never new links invented from geographic proximity.
- Data remains local to the browser; multi-device synchronization remains outside this task.
