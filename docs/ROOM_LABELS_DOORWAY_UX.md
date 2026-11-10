# Map editor UX feedback: visible room labels and simpler door setup

## Changes

- Show names of every saved room and walkable area as a readable, non-interactive overlay inside its polygon. The anchor is sampled within the shape, not simply the bounding-box midpoint, which can be outside an L-shaped room.
- The existing **Add doorway** tool still uses two clicks across the physical opening.
- On the second click, the editor automatically populates neighboring spaces when the geometric suggestion is unambiguous, while respecting a room already selected from the saved-room shortcut.
- Plain-language setup shows **This door connects: Room ↔ Hallway** instead of emphasizing the internal Side A / Side B model. Users can view and correct both room choices.
- The normal door default is both directions. One-way movement, building access, and emergency exit settings remain available.
- The old review checkbox has been replaced by **Confirm & save doorway**. Users may save incomplete setups with **Save for later**; reviewed status is set only by an explicit confirmation action when the required space references are present.
- Original floor-plan image handling and existing device markers remain unchanged. Legacy doors are still supported.

## Manual acceptance

- [ ] Load a floor plan with saved rectangular and concave rooms, long corridors, and name labels; check that every name is legible and appears inside its polygon.
- [ ] Pan and zoom; verify labels stay attached to their space and do not prevent drawing or dragging map elements.
- [ ] Draw a new room, save, and verify its name appears immediately. Edit and delete room outlines and verify label behavior.
- [ ] Click Add doorway, mark two ends, and verify neighboring room labels and automatic selections.
- [ ] Use a saved room's Add doorway shortcut; the selected room must stay selected if detected on either side.
- [ ] Change incorrect selections manually; check default two-way movement and one-way options.
- [ ] Confirm and save fully configured interior and building doors. Save a missing-room setup for later, reload, and finish it.
- [ ] Test overlapping or unmapped rooms; the editor must not silently create false connections.
- [ ] Verify legacy doors, mobile interactions, saved-plan reload, JSON export and CI.

## Limitations

The labels are centered approximately **inside** polygons and retain a readable fixed screen size. Tight rooms may have overlapping labels; future label collision handling could refine this. Suggested spaces are geometry heuristics, not verified physical door or wall connectivity. Visitor routing, access enforcement, and custom device placement remain deferred.
