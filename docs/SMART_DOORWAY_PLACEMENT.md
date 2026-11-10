# Smart doorway placement — review checklist

## Design decision
Administrators click **once near an opening** rather than identifying two endpoints manually. The editor renders a **four-sided translucent rectangle** over the plan, with two yellow resize/rotation handles and a draggable body. The existing door data model remains the two canonical image-pixel endpoints; `displayDepthPx` optionally controls the rectangle's visual thickness.

- Clicking near a mapped polygon boundary snaps the overlay's center and orientation to the nearest wall segment; clicking away from a boundary places a horizontal, freely adjustable rectangle.
- Dragging the center moves the entire rectangle; dragging yellow handles changes length and orientation.
- Clicking elsewhere while in Add Doorway mode repositions it; users must confirm neighboring spaces before marking it reviewed.
- Width and thickness are **image-pixel visual values**, not surveyed or calibrated physical dimensions.
- Existing saved portals render as rectangles with no coordinate migration.
- The current assisted room matching, connection confirmation, draft saving, and purpose/direction controls remain in place.
- Device placement, actual route computation and permission enforcement are not part of this phase.

## Manual acceptance
- [ ] Open an existing plan with saved doorways; verify door positions and room links are unchanged.
- [ ] Add doorway with a single click near a horizontal or vertical room wall; verify automatic alignment.
- [ ] Click away from mapped walls; verify free rectangle placement and clear help message.
- [ ] Drag the center to reposition; drag yellow handles to resize or rotate the overlay.
- [ ] Click another wall to reposition; confirm the editor suggests appropriate spaces.
- [ ] Open optional rectangle thickness and change visual thickness; save, reload and edit. Make sure measured dimensions are not implied.
- [ ] Test at different map zoom levels, narrow door openings and short walls.
- [ ] Save a doorway as a reviewed configuration and another as a draft; verify after reload.
- [ ] Test old legacy portals, room label visibility, undo/redo, browser and touch interactions.
- [ ] Verify lint, TypeScript typecheck, geometry tests, production build, MapLibre worker setup and smoke test.

## Known limits
Wall detection works on **mapped polygon boundaries**, not the raw plan image itself. It cannot reliably infer door-swing arcs, wall thickness, physical clearance, site access rules, or whether a doorway is operational. Rectangle thickness is a display preference; it does not change the navigation centerline. Manual administrator review is still needed.
