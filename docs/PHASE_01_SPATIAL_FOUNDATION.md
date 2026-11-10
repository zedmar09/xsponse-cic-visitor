# Phase 01 — Spatial Foundation

**Status:** Code implemented for review. Browser acceptance and IM-1 manual drawing audit remain pending.

## Scope

- Each active floor plan has a **Site → Building → Floor** hierarchy with stable IDs, names, and optional signed integer floor level.
- Rooms, walking areas, doorways and existing device pins have explicit `floorId` assignments.
- A new section in the existing sidebar lets administrators edit the site, building and floor names without changing IDs.
- Existing locally saved IndexedDB plans get deterministic ancestor IDs derived from their unchanged `planId`; all geometry, portal links, original/processed image blobs and marker coordinates are preserved.
- New saves reject broken parent IDs, mismatched floor ownership, blank names, duplicate feature IDs and non-integer floor levels.
- Exports now use metadata schema version **4** and include the hierarchy and feature ownership. Images are not included.

The normalized legacy plan is written the next time a user saves; simply opening an old project does not overwrite it. Single-floor browser persistence remains unchanged.

## Required manual acceptance

- [ ] Open an older saved plan; verify polygons, doorway links, camera pins and original image remain unchanged.
- [ ] Change site/building/floor labels and floor level; save/reload; verify stable hierarchy IDs.
- [ ] Add and edit a room, doorway and marker; verify exported JSON uses the same floor ID.
- [ ] Test drag-to-edit, undo/redo, snapping, and browser/touch behavior using real floor plans (IM-1 audit).
- [ ] Confirm replacing a floor plan still warns before resetting old annotations.

## Explicitly deferred

Multiple buildings/floors in one shared catalog, classified facilities, access-control logic, route graphs, visitor registration, publishing to the geographic map, backend storage and hardware integrations. All are later phases.
