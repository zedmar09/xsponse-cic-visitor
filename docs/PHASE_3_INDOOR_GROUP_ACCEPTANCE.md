# Phase 3 — Indoor group placement acceptance review

**Status:** Core geometry-first Phase 3 was merged. Follow-up editing improvements add an eight-point Photoshop-style resize frame and a rotation-icon handle. Automated checks and real-browser drag acceptance are separate gates.

## Agreed behavior

- The saved indoor geometry is the **primary** outdoor content. After selecting a saved outdoor location and one of its indoor floors, MapLibre displays the floor's configured **rooms, walkable areas, doorway rectangles, stair/elevator landing polygons, camera/device markers, and legacy entrance/exit pins**, plus area/vertical labels.
- Floor-plan **picture** is optional, starts hidden every session and is controlled by per-floor **Show floor plan** checkboxes. Hiding a picture does **not** hide the selected floor's indoor geometry.
- The selected indoor content is **one group**, not individually repositionable rooms or doorways on the outdoor map. Drag any filled room/walkway/door/stair area or the blue centre handle to move all annotations. A blue outline encloses the selected floor even when its picture is hidden. Drag any of its **four corner** or **four edge-midpoint** grips to resize, and drag the green circular-arrow rotation handle to rotate. All eight grips and the border update throughout the drag; releasing a handle commits the local draft. With Lock proportions on, both dimensions scale together; with it off, side handles modify only the corresponding dimension. Width, height, proportional lock, rotation and horizontal/vertical skew remain available in the sidebar.
- **Apply indoor group placement** saves the floor's geographic placement in its existing IndexedDB floor-plan record and **locks** that floor. The resize border, corner/edge grips, rotation handle, centre move handle and edit controls disappear; dragging indoor polygons no longer moves the placement. Selecting that saved floor later keeps it locked. **Edit placement** explicitly unlocks the group; **Cancel editing** restores its saved transform without rewriting indoor geometry.
- In locked view, clicking a mapped **room, walkable area, doorway, staircase or elevator** shows a dismissible bottom-right inspection card: `You are clicking "Cinema" at 121.000123, 14.599877 coordinates.` These are the precise clicked **longitude, latitude** (WGS84), not the polygon's centre or the room's original pixel coordinates. Location/centre pick modes retain priority. Neither room/door pixels nor original floor image bytes are modified. Other floors retain independent placements.
- Showing the optional image positions it underneath the indoor details at exactly the same four corners. Flat MapLibre warp and matching Web Mercator bilinear pixel-to-map math make the **whole image** follow the indoor geometry, not just the corners.
- **Show all previously placed indoor floors** may be enabled to show multiple floor geometries; other floors use their saved positions rather than the selected floor's draft. Checking another floor's picture shows its corresponding geometry as well.

## Browser acceptance cases (pending)

- [ ] Apply a newly positioned indoor group. Verify the selection frame, all eight resize grips, rotation icon and centre marker disappear, and dragging the placed room/walkway no longer moves any geometry.
- [ ] Reload, reselect the location and saved floor. Confirm it opens **locked** with indoor details still rendered and the optional picture remaining optional.
- [ ] Click **Edit placement**: all transform controls return and dragging works. Click **Cancel editing**: the original saved position is restored and tools are hidden; edit again, change and **Apply** to re-lock.
- [ ] While locked, click each room, walkable region, doorway, staircase and elevator. Verify the bottom-right card shows its actual saved name and the **clicked** longitude/latitude, even with the picture hidden.
- [ ] Click different points of the same room; verify the coordinates change even though the room name stays the same. Click empty outdoor space and close the card; ensure no indoor geometry moves.
- [ ] Verify clicking in explicit map-location or floor-centre pick mode still performs that pick rather than showing an inspection card.

- [ ] Select a location with a floor whose image is hidden. Confirm saved rooms, walking spaces, doorways, stair/elevator landings and device markers render without requiring the picture.
- [ ] Drag a room or walkway directly. Confirm all geometry moves together. Drag the centre marker as an alternative.
- [ ] Turn on **Show floor plan**. Check pixel alignment of room corners, doorway shapes, stair/elevator outlines and markers against the picture.
- [ ] Verify the visible blue selection border encloses the whole indoor floor, even when the optional picture is hidden.
- [ ] Confirm exactly eight square grips: four corners and top/right/bottom/left edge midpoints. A **larger ROTATE icon with two curved arrows**, a ROTATE label and a **green connector stalk from the top-centre grip** must clearly belong to the selected floor.
- [ ] In **Resize** mode, all eight handles still work as before, with an optional proportional lock.
- [ ] In **Skew** mode, drag each purple corner handle independently. For example, moving **top-left changes only top-left**, while top-right/bottom-right/bottom-left remain geographically fixed. Dragging an edge midpoint moves its two adjacent corners together, leaving the opposite edge fixed.
- [ ] Confirm Skew mode prevents dragging a corner through another edge (folded or invalid floor shapes), and its live previews match the optional image and saved vectors.
- [ ] Apply and reload the floor. Confirm the separate per-corner warp persists in the browser, while indoor original coordinates and other floors remain unchanged.
- [ ] Drag all eight grips in turn. Edge grips should adjust only the relevant axis when unlocked, or both proportionally when locked; corner grips should support both dimensions. Check the border and every configured indoor feature redraw **continuously while dragging**, not just when released.
- [ ] Drag the rotation-icon handle. Confirm border, eight grips, indoor geometry, and optional floor-plan image rotate together **continuously**, with no snapping back on release.
- [ ] Rotate, skew in both axes, resize width and height, lock/unlock proportional resizing, and expand/shrink. Confirm the raster and every vector element remain aligned, not just the outer corners.
- [ ] Turn off the picture. The indoor geometry and edit handles must stay present.
- [ ] Click **Apply indoor group placement**; refresh browser; select location/floor. Verify transform persistence, optional picture hidden by default and unchanged original indoor annotations.
- [ ] Test a second floor at the same saved location; check both independently, then enable **Show all previously placed indoor floors**. Confirm each level retains its own geographic transform.
- [ ] Change the outdoor basemap style (Streets / Light) and confirm overlays and handles reappear correctly.
- [ ] Test a large/complex saved floor during drag; inspect for frame flicker, delayed overlays, or dropped markers.
- [ ] Confirm no outdoor building setup was created.

## Technical constraints

- Outdoor alignments are **approximate geographic placements**, not surveyed indoor locations. A user-provided width or calibrated reference is needed for physical accuracy.
- Saved indoor geometry and source images are only in this browser's IndexedDB (no cross-device backend).
- Dragging filled polygons uses mouse events; handle dragging uses MapLibre marker gestures. Touch editing and production accessibility require dedicated acceptance checks.
- Indoor routes and connected floor topology remain governed by indoor editor data; placing the group outdoors must not rewrite that routing graph.
