# IM-1 — Drawing Editor Accuracy Audit

**Status:** Implementation changes submitted for review; browser acceptance pending.
**Scope:** Drawing accuracy and usability only. No visitor management, access rules, wayfinding graph, or live positioning.

## Findings from the previous editor
- High: existing polygons needed complete redraw to correct one corner.
- High: door endpoints could not be edited after saving.
- Medium: the new polygon closing point could lose snapping priority to an unrelated nearby room.
- Medium: undo removed the last point but there was no redo or move history.
- Medium: invalid self-intersecting polygons were only explained after attempting to save.
- Pending: browser behavior, mobile/touch interactions, wall segment insertion, overlap warnings and room topology.

## Implemented in this IM-1 pass
- Open an existing room/walkable area for vertex editing; drag yellow corners and Save or Cancel.
- Open an existing doorway; drag either yellow endpoint and preserve its usage and linked spaces.
- Draft undo/redo with bounded snapshots, including completed vertex drags.
- Preserve earlier saved geometry until the edited version is explicitly saved.
- Prioritize the polygon's green closing point over nearby saved-geometry snapping.
- Show polygon errors before Save; block invalid geometry.
- Keyboard: Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z redo, Ctrl/Cmd+Y redo, Enter close, Escape cancel (when not typing).
- Regression tests for image-coordinate transforms, polygons and doorway metadata export.
- No change to the IndexedDB schema or drawing coordinates.

## Manual acceptance gate (required before marking IM-1 complete)

- [ ] Draw and save a four-corner room; close by selecting the green first corner.
- [ ] Draw and save a six-corner irregular room with preview following cursor.
- [ ] Undo and redo a corner. Close/undo/redo the outline and save it.
- [ ] Edit a saved room by dragging its third vertex; save, reload and confirm geometry persists.
- [ ] Edit it again, move one corner, cancel, reload and verify the original saved shape remains.
- [ ] Edit and save both endpoints of a two-point doorway, retaining Entrance & Exit or other direction.
- [ ] Drag an area vertex to create a self-intersection; Save must be blocked clearly.
- [ ] Confirm edits do not drift after zoom/pan/resize/hiding the sidebar.
- [ ] Test snapping when rooms share walls and when the new room is close to the first room's corner.
- [ ] Toggle processed/original image; coordinates must remain stable.
- [ ] Test mouse, trackpad, and touch devices; report any browser-specific problems.

## Remaining IM-1 work before acceptance
- Ability to add or remove a vertex on an existing edge and manipulate wall segments.
- Review overlap/collision warnings carefully (shared room walls must remain allowed).
- Test real-world image quality and image cleanup visually.
- Verify drag behavior in browsers and mobile/touch devices, and handle any failures.
- Green CI validates code and algorithms, **not** user-interaction accuracy.

**Do not start IM-2 or Visitor Management until the IM-1 acceptance checklist passes.**
