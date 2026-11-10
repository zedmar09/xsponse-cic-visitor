# Indoor Map Studio — MapLibre Lab

A standalone Next.js + TypeScript + shadcn/ui + MapLibre GL JS 6 prototype for exploring XSPONSE-style indoor mapping.

## User workflow — no building measurements required

1. In **Street map**, save a geographic location pin. In **Indoor plan**, select that location, upload a PNG, JPEG or WebP floor image and use **Indoor floors for this location** to add more floors. Every floor keeps a separate picture and annotations.
2. Name each indoor floor (and optional level), then draw its rooms and walkable spaces. No building setup is required.
3. Room and walking-area names appear **inside their saved outlines** on the floor plan, including irregular shapes. Use these labels to identify rooms while configuring doors.
4. Under **4. Configure doorways**, click **Add doorway — click once**, then click near the opening in the wall. A four-sided doorway overlay appears and aligns with a mapped room/hallway boundary where possible. **Drag the middle** to move it, or **drag either yellow end handle** to change its width or angle. Click elsewhere to reposition. Optionally fine-tune the rectangle's visual thickness in the doorway editor. Confirm the suggested neighboring rooms using the visible room labels; if a suggestion is wrong, choose the actual connected spaces. Both-way movement is the normal default. Select **Confirm & save doorway** to mark reviewed or **Save for later** to keep an incomplete draft.
5. Under **4. Staircases & floor connections**, use **Add stairs** or **Add elevator**, draw the outline on the selected floor, and choose which other floors it serves. **No hallway access registration is required.** Existing stairs still work. On the destination floor, draw a staircase or elevator as another normal item and select the original floor. **The two independently drawn items will link automatically** when their types and floor selections match without ambiguity; they do not need the same name or saved object ID. You can also use **Add on this floor** on an existing item. The graph automatically finds overlapping or nearby green walking areas. Near-but-not-touching access is visibly estimated and needs a visual check. A selected floor with no mapped vertical zone remains pending. Staircase connections require consecutive mapped floors; elevators can serve nonadjacent floors.
6. Expand **5. Navigation & connectivity** (collapsed by default), choose **Show destinations & guidance**, and select a Start room and Destination room on **any floor**. The route shows each floor separately, with **View floor** / **Focus route** controls. A **solid red line** now runs from the source room's reviewed doorway to the destination room's reviewed doorway (or the stair/elevator corridor interface on cross-floor steps). There are no directional arrowheads. The route now selects the **shortest reachable path between actual doorways and stair/elevator interfaces**. It does not use room or walking-area label coordinates as navigation waypoints. Approved long corridor connections are checked at multiple crossing positions so the route can use the nearest opening. **Clearance-aware A\*** then minimizes physical route length inside the drawn polygons, staying approximately 7 image pixels away from their boundaries and mapped room obstacles. Doorways remain the precise start/end points; corners are rounded only if they stay within the safe corridor. **If a safe path cannot be drawn, no red line is displayed**. Instead, the relevant floor shows an explicit geometry-review warning. Previous centerline estimates that could overlap black wall outlines are disabled. Cross-floor directions identify the stairs or elevator used. A lift/stair must be mapped on both floors. A nearby walking area can be linked provisionally without an extra access-point click. The uploaded image's walls and furniture are not interpreted automatically. Verify every preview against the drawing before real visitor wayfinding.
7. Device pins remain unchanged; custom device-image placement is postponed.
8. Edit saved vertices, doorway rectangles and staircase outlines, undo/redo and export selected-floor geometry JSON as before.
9. Open **More options → Display settings** to show/hide room and walking-area labels/colors (including room outlines), door icons/shapes, entrance/exit icons, stair/elevator labels, device markers, and the route line. Preferences are stored in this browser without editing the floor-plan data. Previously saved doorway endpoints render as rectangles without a destructive data conversion.

**A room polygon does not establish physical dimensions.** Doorway spans are in image pixels; all direction settings are metadata for future navigation. Existing legacy doors remain readable but must be reviewed before relying on their movement permissions.

## Guidance and accuracy

- Polygon drawing shows vertices, a moving cursor/preview line, and snapping to the first vertex. It also snaps to nearby existing room corners.
- A single click near a mapped room/hallway edge produces a rectangle aligned to the closest edge within a screen-space tolerance; distant clicks place a horizontal free-positioned rectangle instead. Move the whole rectangle or drag its yellow end handles; optional thickness is only for visualization. Underlying saved door geometry remains two image-pixel endpoints. Nearby-area suggestions are heuristics and still require manual verification, especially where outlines overlap.
- Every room, walkable zone, doorway endpoint, camera and device position is stored in **original image coordinates** (top-left origin, +X right, +Y down). Export also includes normalized 0–1 positions.
- Zooming, panning and changing image appearance do **not** change saved coordinates.
- **Live hardware tracking is not implemented.** Map markers are user-configured static pins. Real-time positioning requires mapping hardware location data into the floor plan's coordinate system; WebSockets alone do not provide indoor positioning accuracy.
- Doorway usage and connected spaces are checked by the preliminary graph validator; routing and access enforcement are not yet implemented. Center-to-center diagnostic links must never be interpreted as paths through walls.

## Outdoor location search

Switch to **Street map → Find a location**, enter a place name, landmark or address, press **Search**, then select a result. MapLibre animates to the selected coordinates with `flyTo`, selects an appropriate zoom, and places an outdoor search marker. **Reset street map** restores the starting camera. Switching back to the indoor plan doesn't change or overwrite any saved floor images, room geometry, doorway data or staircases. Save the search result or map point as a location, then select it in Indoor plan to create floors and use Street map to align all configured indoor geometry outdoors. The optional image reference follows the same placement.

The optional public search endpoint `/api/location-search` uses OpenStreetMap's [Nominatim Search API](https://nominatim.org/release-docs/latest/api/Search/) **only when Search is submitted** (no autocomplete), displays OSM attribution, validates coordinates, caches previous queries for six hours, and limits outbound lookups to one per 1.1 seconds **per running server instance**. The public Nominatim service has a strict usage policy, is not designed for commercial/high-volume searches and cannot guarantee quota across multiple serverless instances. Before deploying multiple instances or using this in production, switch to a contracted geocoding provider or install a shared global rate limiter and cache. The provider might also be temporarily unavailable. Do not submit private addresses or confidential information to a public geocoder.

## Outdoor-to-indoor workflow — location first, no building setup

**User workflow:** Outdoor map → search or click a point → **Add location** → **Indoor plan** → select that location → create and configure multiple indoor maps/floors → Outdoor map → plot each indoor map/floor at its saved location pin.

1. **Phase 1 — Outdoor Location Management (complete):** Save a location by searching or clicking the outdoor map. Each location has a geographic pin.
2. **Phase 2 — Indoor Plan Placement (approved for progression):** Select the saved location in Indoor plan, create one or more independent floors, then return to Street map. Select the location and floor, click to set the image centre, adjust width in metres, rotation and opacity, and **Save floor placement**. Each floor has an independent geographic image transform stored in its existing IndexedDB record. This does not change any room/door pixel coordinates. **No outdoor building entity is created.**
3. **Phase 3 — Group-based Indoor Placement (implementation ready for browser acceptance):** Select a saved outdoor location and a configured indoor floor. **Saved indoor geometry is the primary map layer**: room and walkable polygons, doorway rectangles, staircase/elevator landing outlines, camera/device markers, entrance/exit pins, and labels appear automatically. Move the whole floor by dragging its filled shapes or its blue centre handle; drag blue corner handles to resize, the green handle to rotate, or use numerical rotation, skew and width/height controls (with a proportional lock). **Show floor plan** is an optional, default-off checkbox for the original image; it appears **underneath** the vectors and uses their **one shared placement**. A flat MapLibre image warp and Web Mercator bilinear interpolation keep image pixels and indoor vectors aligned even during skew. Apply saves one placement per floor, not rewritten indoor coordinates. Enable **Show all previously placed indoor floors** to view multiple saved levels together. Live browser visual acceptance (especially skew, overlap, drag and style switching) is still required.
4. **Phase 4 — Outdoor-to-Indoor Navigation & Connectivity (implemented in draft PR, browser acceptance pending):** From a saved outdoor location, enable **Navigation & connectivity** on Street map. Only geographically placed indoor floors at that location participate. Select a start room and a destination room from any placed floor, or click a locked room and choose **Start route here** / **Navigate here**. The street map reuses the indoor editor's validated door, approved walking-passage and stair/elevator graph. It draws only clearance-checked indoor walking segments in red on each independently aligned geographic floor, with start/end markers and explicit stair/elevator transition markers. **It never draws an invented ground-level line connecting separate floors**. The sidebar reports connectivity counts, warnings and floor-by-floor guidance, including missing or unverified route segments. Floor-plan pictures remain optional. This is an offline, browser-local mapped wayfinding preview, not GPS positioning, accessibility certification or emergency guidance.
5. **Phase 5 — Final Integration Audit (upcoming):** Test multiple locations, independent floor overlays, refresh persistence, export, indoor geometry preservation and deployment compatibility.

**Backward compatibility:** The previous Phase 2 build incorrectly added outdoor buildings. This revision **removes the building controls and map footprints**; it does not delete existing floor images or annotations. Legacy outdoor-building IndexedDB records are retained (not displayed) to avoid destructive migration. Existing unassigned indoor plans remain in the editor's database and can be assigned to a location. Existing indoor multi-floor navigation uses internal stable group IDs to preserve stair/elevator links; those internal IDs are not an outdoor building entity or a required administrator step.

**Storage:** The selected geographic location is stored in `maplibre-lab-outdoor-locations`. Each indoor floor stores an optional direct `locationId` reference in its existing `maplibre-lab-indoor` record. Each floor optionally stores its independent `outdoorPlacement` (longitude, latitude, width/optional height in metres, rotation, horizontal/vertical skew and opacity); legacy placements retain the source-image aspect ratio. Floor-plan **image** visibility checkbox state is intentionally session-only and defaults to hidden, including after reload; saved indoor geometry appears when its floor is selected. The option to show all already-placed floors is also session-only. Assigning an existing floor preserves original image-local geometry; moving between locations clears any stale geographic placement. Data remains local to this browser, with no multi-user/server synchronization yet. An unassigned floor remains available even if a location is later removed.

## Image handling

The application does not alter newly uploaded floor-plan images. Previously saved plans which contain a cleaned preview now display the original image when available, preserving pixel-based annotations. Legacy cleanup options may remain in older records for backward compatibility.

## Backward compatibility

- Existing locally saved room/walkable polygons and camera/device point markers are still loaded.
- Old **single-point** entrance/exit markers are retained as legacy points; they are not silently converted into two-point door openings. Redraw those with the new doorway tool when ready.
- Replacing a floor plan requires confirmation and resets that floor's annotations.
- Doors without a stored category are shown as legacy doors; classify them explicitly before using them for route planning.

## Worker and development setup

MapLibre 6's module worker is copied from the installed package to a same-origin URL under `public/vendor/maplibre-gl/`. The `predev` and `prebuild` scripts do this automatically. CI verifies worker assets and requests them via HTTP in a running Next.js production server.

```bash
git pull origin main
npm ci
npm run dev
```

Open http://localhost:3000. Node.js 20.9+ required.

```bash
npm run lint
npm run typecheck
npm run build
```

## Storage, deployment and future integrations

The current prototype stores **multiple independent floor plans locally in IndexedDB** with their uploaded floor-plan images and annotations (older records can retain processed previews). The originally saved legacy floor is preserved in place and listed alongside new floors. No backend, account sharing, socket stream, device localization or XSPONSE integration exists yet. Basic **cross-floor** routing via mapped stairs and elevators is available as a visual preview, not live visitor tracking. A provisional navigation graph and **same-floor polygon-contained guided preview** are derived in the browser and are not saved as navigable directions. Exported JSON includes geometry but **not** image data.

The flat MapLibre identity projection is experimental and is display-only; do not treat these coordinates as geographic latitude/longitude. GPS can be unreliable inside buildings. Integrating indoor position sensors requires suitable positioning infrastructure, floor-specific coordinate calibration, uncertainty handling, and mapping hardware updates into the same local reference frame.

IM-1 editor improvements include draggable saved vertices and doorway endpoints, drawing-session undo/redo, and priority for the green closing vertex. Additional segment insertion, browser/touch validation, doorway-topology checks, vertical-route validation and cross-floor routing remain pending. See [IM-1 audit](docs/IM-1_DRAWING_AUDIT.md).

## Phase 01: Spatial foundation

Each floor plan now records its site, building and floor identity, optional floor level, and floor ownership for every saved room, walking area, doorway and marker. Existing locally saved plans are safely normalized using their current plan ID; no map coordinates change. JSON exports use schema version 4. The multi-floor manager now supports multiple selectable saved floors and staircase identification, including incomplete one-floor staircases that can be connected later. Elevator and navigation routing remain future phases. See [Phase 01 review checklist](docs/PHASE_01_SPATIAL_FOUNDATION.md).
