# Indoor Mapping Completion Roadmap

**Project:** MapLibre Lab (standalone indoor mapping editor for future XSPONSE integration)
**Scope rule:** Every indoor floor belongs directly to a saved geographic location; do not create a separate outdoor building layer. Complete and audit the indoor mapping system **before** implementing visitor management, visitor passes, wearable GPS ingestion, realtime sockets, visitor alarms or live tracking. Each milestone is a separate reviewable change; do not implement several milestones together.

## Current baseline (as of 31 October 2026)

- Next.js + React + TypeScript + shadcn/ui + MapLibre, with worker file served at a same-origin URL.
- One floor-plan image stored locally in IndexedDB. Original and optional contrast/background-cleaned versions are retained.
- Room and walkable-area polygons, guided mouse preview, closure and basic snapping.
- Two-endpoint doorway portals with usage direction (entrance/exit/both/internal), optional links to adjacent areas.
- Camera/device **static** pins, exports containing image-local coordinates and portal metadata.
- GitHub CI checks install, lint, typecheck, production build and worker availability.
- Limitations: single floor, redraw-to-edit rather than movable vertices, no durable shared backend, no routing graph, no multi-floor connections, no access-rule evaluation, no accurate indoor wearable positioning.

Existing functionality is a **prototype**, not an audited, complete production indoor mapping system.

## Milestone IM-1 — Drawing editor accuracy & usability

Deliverables:
- Mapbox-like polygon drawing: preview segment, snapping, close shape, cancel, undo/redo, explicit feedback.
- Edit/move existing polygon vertices and segments **without redrawing**; editable doorway endpoints.
- Snap door endpoints to room/walkable boundaries with reasonable tolerance at any zoom.
- Validate self-intersections, disconnected or overlapping geometry and near-zero-length edges.
- Image cleanup may not erase critical lines silently; original-image toggle and preview/revert.
- Keyboard shortcuts and zoom/pan usability (including during long drawings).

**Audit gate:** Non-technical tester can trace a rectangular and irregular room, correct mistakes, and save/reopen geometry without changing pixel coordinates.

## Milestone IM-2 — Rooms, facilities and doorway topology

Deliverables:
- Named space types: room, hallway, lobby, facility, restricted space, outside.
- Distinguish a space's **access classification** (public/staff/restricted/emergency) from its name and visual style.
- Two-endpoint door portal with directional access, status/access metadata and clear Side A/Side B associations.
- Confirm adjacency between the portal and its neighboring spaces; flag invalid/unconnected doors.
- Preserve legacy point-only entrance/exit markers until deliberately migrated.
- Static devices/cameras assigned by ID to a room/space and to precise image coordinates.

**Audit gate:** Every mapped door accurately touches its intended room boundary and has clearly defined connected spaces and allowed traversal semantics. No physical door width is guessed from image pixels.

## Milestone IM-3 — Walkable geometry and navigation graph

Deliverables:
- Register corridors, open walkable polygons, obstacles and no-walk areas.
- Create and edit path nodes and edges, including waypoints at door portals and intersections.
- Validate route-network connectivity; visually highlight isolated rooms, unreachable endpoints and invalid edges.
- Use image-local geometry for topology; keep optional real-world scale separate.

**Audit gate:** Every navigable room can connect to the path network through an approved portal. The graph cannot route through walls or restricted polygons.

## Milestone IM-4 — Multiple floors and transitions

Deliverables:
- Saved-location / floor catalog (no outdoor buildings), floor names/levels, independent images and image-local coordinates. Legacy internal hierarchy identifiers may remain for navigation compatibility.
- Stairs, elevators and ramps as explicit cross-floor connections with directional/access metadata.
- Floor selector and view controls, consistent mapping identifiers.
- Validate vertical links against both participating floors.

**Audit gate:** A sample saved location with at least two floors has consistent, reversible navigation graph connections and correct floor-specific annotations.

## Milestone IM-5 — Static indoor wayfinding engine

Deliverables:
- Compute routes between administrator-selected manual start/destination points (A* or Dijkstra on validated graph).
- Exclude restricted/inaccessible connections based on generic access classes; support one-way doors.
- Route preview, alternate/no-route feedback, cross-floor steps and route instructions.
- Route calculations must **not** assume that pixel length equals meters.
- No live wearable data or actual visitor identity needed.

**Audit gate:** Test paths between rooms, floors, and a restricted region. Routes respect restrictions, avoid blocked routes, and explain when no legal route exists.

## Milestone IM-6 — Persistence, interoperability and final indoor-mapping audit

Deliverables:
- Stable versioned schema for saved location / floor image, rooms, facilities, doorway portals, path graph and static device IDs.
- Multi-floor import/export including associated image assets, validation and safe migration from existing IndexedDB data.
- Choose and verify a shared backend/persistence approach; avoid prematurely depending on XSPONSE internals.
- Audit model and potential adapters against existing XSPONSE e-mapping data and Mapbox-derived concepts.
- Repeatable validation/test fixtures, usability review and error recovery.

**Audit gate:** A map can be saved, reloaded, exported/imported and routed on multiple floors without geometry drift or lost permissions; design is reviewed for XSPONSE integration.

## Explicitly excluded until all mapping milestones pass

- Visitor management UI, registration, check-ins, invitation passes or identity/role-specific workflows.
- Wearable GPS/BLE/UWB integrations, socket event ingestion, realtime device tracking.
- Alerts claiming confirmed restricted-room entry from GPS-only observations.
- Production emergency/safety egress guidance without independent verification and appropriate compliance testing.

## Order of work

**IM-1 → audit/approval → IM-2 → audit/approval → IM-3 → audit/approval → IM-4 → audit/approval → IM-5 → audit/approval → IM-6 → final indoor mapping audit.**

A passed CI build verifies code quality and buildability; it does **not** prove map geometry, doorway boundaries, navigation, indoor positioning accuracy or production readiness. Each milestone needs browser testing with real sample floor plans before acceptance.
