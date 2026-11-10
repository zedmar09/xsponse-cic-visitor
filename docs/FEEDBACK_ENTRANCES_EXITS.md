# Guided doorway setup — recommended approach

Status: implemented on a separate review branch; browser acceptance is pending.

## Why

A doorway's **physical purpose** (interior connection, exterior building entry, designated emergency exit) is not the same as its **permitted movement** (A → B, B → A, both). The previous UI conflated "Entrance only" with purpose and asked an administrator to select sides before seeing any assistance.

## Editor flow

1. Choose one **Add doorway** tool. Draw the two endpoints along the actual doorway opening.
2. The editor samples the mapped polygons on opposite sides of the opening. If it finds one or two uniquely identified spaces, it suggests them. No assignments are silently persisted; users must click **Use suggested spaces**.
3. Choose purpose: **Interior**, **Building access**, or **Designated emergency exit**. Exterior purpose uses Outside as Side A and an interior mapped space as Side B.
4. Confirm Side A and Side B; a **Swap** action helps reverse interior sides. Directions are defined in terms of **A→B, B→A, both**, independent of purpose.
5. Confirm that location, assignments and direction agree with the source floor plan. Save a reviewed door, or save an incomplete one as **Draft / needs review**. An emergency exit must allow movement toward Outside.
6. The saved-door list identifies review status. Editing a connected room boundary clears that doorway's review status.

## Legacy and compatibility

- Existing doors retain their IDs, image coordinates, prior `role` and `usage` fields. No data is silently migrated or reinterpreted.
- Editing an old door lets administrators explicitly adopt the new `purpose` and `reviewed` properties. Existing old `internal` usage requires selecting a direction.
- The JSON schema remains version 4 with additive optional fields.
- Single-floor local IndexedDB and existing room/camera markers are unchanged.
- "Clean up the picture" remains removed.

## Important accuracy boundary

The suggestion algorithm samples the two sides of the marked opening in **original image pixels**. It does **not** detect door hinges, see through walls, prove adjacency, validate physical access, or measure distances in meters. Unmapped or overlapping spaces can produce no suggestion or ambiguity. Manual verification is required. "Reviewed" refers only to configuration, not fire-code compliance, accessibility or emergency-safety approval.

## Manual acceptance

- [ ] Create interior doors between two mapped spaces, including irregular and vertical wall outlines; verify suggestions and swapped directions.
- [ ] Draw an exterior door with one mapped space and Outside on the opposite side; save a two-way building door.
- [ ] Configure a designated emergency exit that allows outward movement; confirm inward-only setup cannot save.
- [ ] Test overlapping room geometry: ambiguous suggestions must not populate sides automatically.
- [ ] Save an incomplete doorway as a draft, reload, finish configuration, verify review status updates.
- [ ] Use the doorway shortcut beside a saved room; check preselection is preserved when using suggestions.
- [ ] Edit a reviewed doorway, move its endpoints and verify confirmation must be renewed.
- [ ] Edit a connected room outline and verify affected doorway review statuses are cleared.
- [ ] Open and edit a pre-existing role-based or `internal` portal; verify old positions remain intact.
- [ ] Test touch, drag interactions, snapping, export, lint, typecheck, tests, build and workers.

## Deferred

Navigation graph, route computation, automatic physical wall validation, floor-to-floor connections, safety certification, visitor access enforcement and custom device image handling.
