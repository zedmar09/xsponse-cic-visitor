# Phase 2 — Location-first indoor plan placement audit

Status: **IMPLEMENTED — CI and real-map browser acceptance pending** (updated 2026-11-02).

## Required order (no outdoor buildings)

1. In **Outdoor map**, save a geographic location/pin.
2. In **Indoor plan**, choose the saved location before editing.
3. Create one or more independent indoor maps/floors, each owned directly by that location. Existing unassigned floors may be attached without resetting geometry.
4. Return to **Outdoor map**, select the same location/pin, then position **each indoor map/floor separately** over the map at the correct footprint. Save each placement.
5. Refresh and verify floor ownership and geographic alignment persist without changing indoor-local geometry.

## Verified in source (not a browser acceptance test)

- `src/components/map/indoor-location-selector.tsx`: location selector, associated floor list, first-floor action, attach/unassign existing floor.
- `src/lib/indoor-location-links.ts`: direct location ownership and safeguards against silently moving floors to another location.
- `src/components/map/map-workspace.tsx`: new floor records inherit selected location; outdoor map offers opening selected location's indoor floors.
- `tests/indoor-location-links.test.mjs`: source-level/unit checks for multiple floors per location and ownership.
- Existing historical `hierarchy.building` fields are internal multi-floor/navigation compatibility data; they are **not** outdoor building entities.

## Implemented in the current Phase 2 branch

- Outdoor floor selection in the saved-location panel, with a visible floor image overlay.
- Per-floor centre positioning by clicking the outdoor map, size in metres, rotation and transparency.
- Geographic corner projection preserving image aspect ratio and indoor-local coordinates.
- Persisted `outdoorPlacement` for each indoor floor in the existing IndexedDB floor-plan record.
- Ability to remove a floor placement; moving a floor between locations clears stale alignment.
- Placement in exported floor metadata, plus regression tests for geometry, validation and wiring.
- No outdoor building entity, footprint, or building-first setup.

## Remaining acceptance work (do not mark Phase 2 approved yet)

- [ ] Lint, TypeScript typecheck, unit tests and production build pass on the latest commit.
- [ ] Browser acceptance with real image overlays in MapLibre, including style switching and refresh.
- [ ] Confirm two floors under one location can be aligned independently at different positions/rotations.
- [ ] Check that a saved overlay remains correct after zoom, pan and image reload.
- [ ] Verify persistence across browser reload and that a second location never shows another location's floors.
- [ ] Validate map alignment visually at the actual deployment latitude; numeric metres are approximate.
- [ ] Ensure the placement UX remains usable on mobile-size screens.

## Acceptance scenarios

- [ ] Save location A via outdoor map click and location B via search.
- [ ] Select location A in Indoor plan and create floor Ground and floor 2.
- [ ] Return to outdoor map; pick location A and place Ground and floor 2 individually.
- [ ] Confirm saved overlay transforms survive refresh and changing selected locations.
- [ ] Confirm location B does not display A's floors.
- [ ] Confirm room, door and walkway pixel coordinates remain unchanged after outdoor placement.
- [ ] Confirm older unassigned plans remain recoverable.

## Phase boundaries

**Phase 2**: finish creating/associating floors to locations and positioning each floor over outdoor geography.

**Phase 3**: integrate multi-floor selection, switching and relationships using those placed floors.

**Phase 4**: outdoor pin to floor overlay interaction and transitions.

**Phase 5**: final end-to-end integration audit.

Do not reinstate the former `feat/phase-2-buildings-indoor-floor-links` building-first flow.
