# Multi-Floor Manager — first phase

Status: implemented for review on a separate branch. The current goal is **create, name, select and preserve floors**. Vertical links, navigation and shared server persistence are not included.

## User flow

1. Existing users open the editor and see their original floor in the **Floors in this building** panel. Its room boundaries, walking areas, doorway settings, image data, and feature IDs remain unchanged.
2. Choose **Add floor** and enter a floor name and optional signed integer level (ground 0, second 2, basement -1, etc.). Upload its own PNG/JPEG/WebP plan. The existing floor is **not replaced**.
3. Select any floor from the list to switch the canvas, map image, rooms, walking spaces and doorways. The selected floor stays selected after a browser refresh.
4. Rename or renumber the selected floor using **Edit site, building & floor names**. Site/building names are propagated to all related floors.
5. If deliberately replacing a picture is necessary, use **More options → Replace THIS floor's picture**. A confirmation explains that only this floor's annotations will be cleared. Other floors remain untouched.
6. Deleting a floor requires typing its exact name, and affects only that floor's saved plan and annotations.

## Storage / migration details

- Bump the existing IndexedDB database from v1 to **v2**, preserving the original `floor-plans` object store and the original `"active"` row **as-is**.
- Introduce a separate `floor-plan-settings` store for the last-selected floor ID. Existing legacy data does not get rewritten on database upgrade.
- New plans have independent `id` keys and unique `planId` / hierarchy floor IDs. New floors inherit the site/building parent identity of the currently selected floor, with a unique floor ID and their own image-pixel coordinate system.
- Changing floor images or deleting a floor remains explicitly scoped to that floor only. A fresh floor is inserted with IndexedDB `add` (never `put`), protecting against accidental overwrites.
- Normal save/reload behavior remains local-browser persistence. Export is still geometry-only **for the selected floor**, not a complete building backup.
- This is not a cloud backup and it does not synchronize across browsers or devices.

## Manual acceptance checklist

- [ ] **Back up important work before testing**: the current coordinate JSON does not include the image, so keep the source image separately. Ideally test in a copied browser profile or a separate local app origin first.
- [ ] Open an existing plan with many rooms and doors; confirm its ID, geometry and image appear unchanged.
- [ ] Add a Level 2 floor and separate image. Verify the original ground-floor annotations are not copied into it and have not disappeared.
- [ ] Switch Ground ↔ Level 2 many times; confirm rooms, doorways and per-floor picture are isolated.
- [ ] Reload the page and confirm it returns to the last-selected floor.
- [ ] Add a basement (-1) and confirm the floor selector handles ordering/levels.
- [ ] Rename a building and verify the name is consistent across its floors.
- [ ] Rename/renumber one floor and verify other floor names and levels are not changed.
- [ ] Verify that uploading a floor from **Add floor** cannot overwrite a previously saved floor.
- [ ] Test replacing an image only on a sacrificial test floor; confirm other floors remain intact.
- [ ] Verify deleting one test floor leaves the others intact; verify exact-name confirmation.
- [ ] Test undo/redo and saving rooms/doors on different floors; confirm saved feature IDs reference the corresponding floor ID.
- [ ] Check browser console, keyboard/pointer interactions and narrow/mobile layouts.

## Deferred

Stairs/elevators/ramps, vertical landing positions, stair service direction, floor-to-floor connectivity, room taxonomy expansion, network routing, shared backend, whole-building export/import and visitor check-in are later tasks. The existing map geometry accuracy review remains separate from this floor-manager acceptance gate.
