# Simplified Multi-Floor Wayfinding — Browser Acceptance

## Requested workflow
- **All of these are collapsed by default:** 2. Outline rooms and walking spaces, 3. Configure doorways, 4. Staircases & floor connections, 5. Navigation & connectivity, Saved on this floor plan. Click each heading to expand. Choosing an edit shortcut expands the relevant section automatically.
- To register a staircase or elevator, draw **one zone on a floor**, name it, and select its served floors. There is **no mandatory separate landing access point**.
- To connect floors, draw the **same named vertical zone** on each served floor. Existing legacy staircase IDs and saved outlines are preserved. Old hallway-access data can stay stored harmlessly but is no longer required.
- A vertical zone needs a physical touching/overlap with a **green walking area** to participate in routing; otherwise extend or correct the walking-area or vertical-zone polygon. The app does not infer a connector across a spatial gap.
- **Stairs** link consecutive mapped floors. **Elevators** may serve nonconsecutive floors when each served floor is mapped. Directions up/down/both apply to vertical movement.
- With front desk on Floor 1 and destination on Floor 3, select Start (Front Desk) and Destination (e.g. Meeting Room 3), review **Floor 1 route → Elevator A → Floor 3 route**. Click View floor / Focus route for each section. A blue arrowed line is drawn on each floor only when saved areas and doors support one. Blue lines are floor-scoped; no fake line stretches between different floor-plan images.
- Room doors still need review, walking-area joins still need explicit approval, and a doorway cannot be used as a shortcut outside a building.
- If the route says "Connected" but cannot draw a blue line, it must show a specific geometry reason and instructions to fix it. The route should be previewed against the original plan before use.

## Manual tests
- [ ] Refresh a previously configured building. Old stairs, images, room polygons, doorways and destination selections remain unchanged.
- [ ] Expand each of the five headings above. Confirm they start closed on fresh page load and opened editing shortcuts are usable.
- [ ] Add an elevator on Floor 1 and another floor, without any hallway-access click; verify it is correctly linked through touching green walking areas.
- [ ] Keep a selected destination without a mapped elevator/stair zone; verify it is shown as pending, and no route is fabricated.
- [ ] Map Floor 1 ↔ Floor 3 via elevator with Floor 2 present; verify cross-floor directions. Staircase Floor 1 ↔ Floor 3 must require a Floor 2 landing.
- [ ] Test one-way up/down routes for a staircase.
- [ ] Test Front Desk → Level 2 Toilet and Level 3 Meeting Room. Use View floor and Focus route to see the blue arrows on each floor; confirm no segment crosses a known mapped room wall.
- [ ] Test a slightly offset doorway at a shared boundary; a route can snap only if both real polygon boundaries coincide.
- [ ] Test disconnected vertical zones/walkable areas; verify warnings and no false route.
- [ ] Verify the original saved floor is still present after switching, refreshing, and editing vertical zones.
- [ ] Check narrow sidebar/mobile layout, zoom/focus behavior, and MapLibre console.

## Important limitation
A drawn staircase or elevator zone identifies a **mapped transition**. It does not track real visitor position. Ordinary GPS indoors cannot reliably tell if someone is on a particular staircase or which floor they occupy; future live indoor tracking requires separately validated positioning signals and floor inference. Routes are previews based on uploaded plan geometry and admin confirmation, not certified accessible/evacuation paths. Elevator outages, access restrictions, and wheelchair preferences are not handled yet.
