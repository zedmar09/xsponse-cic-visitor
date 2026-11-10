# Staircase setup — save now, connect more floors later

## What is implemented
- **Add Staircase** outlines a zone on the current floor and gives it a name. No second floor is required to save.
- A staircase has one stable ID per building; each mapped floor has its own outline and optional walkway access point.
- The **Destination floor(s)** picker lists other floors in the building, with clear Mapped vs Planned status. Checking a destination saves an *intended* floor; it does not create a landing or an active route.
- Existing staircases have **Edit destination floors**, which updates selections without redrawing mapped staircases.
- Leaving all destination boxes unchecked keeps a one-floor staircase as a valid draft. If the next floor has not been added yet, add it later and return to select it.
- **Mark hallway access** is a separate step from outlining the staircase. Click **inside the green walking area** beside the stair landing. The editor indicates whether the point is inside a walkable area before allowing you to save it.
- After adding a new floor, click **Go to [destination] & draw landing** under the same existing staircase (or switch floors and click **Add on this floor**). This starts a new outline *for the same staircase ID* without copying its origin-floor polygon. This adds a landing to the staircase without redrawing or losing its other floors.
- The status explicitly says **Saved · connect another floor later** when only one floor is mapped. With more floors it says **N floors mapped · navigation not configured**.
- Saved staircase shapes are shown in amber with a name; entry points are orange dots.
- Optional Up/Down direction metadata is recorded for later routing; it does not enforce access yet.
- IndexedDB v2 → v3 adds a dedicated staircase object store, leaving all existing floor records and images unmodified on upgrade.
- If a floor is deleted or its picture replaced, only that floor's staircase geometry is removed; other landings survive. This happens atomically with the floor change.
- Floor-specific staircase identity uses immutable floor IDs (never names or image coordinates from another floor).

## Manual acceptance checks
- [ ] Open an existing building plan; original rooms, walking areas, doors, images, and names still display.
- [ ] Draw Staircase A with a closed outline on Ground Floor. Save with no Level 2 present; verify status says connect later.
- [ ] Refresh the browser. Confirm Staircase A's outline, name and unlinked status survive.
- [ ] If Level 2 exists, choose it in Destination floor(s), save Staircase A, and verify it appears as a planned destination, not a completed landing.
- [ ] Edit destination floors on a saved staircase without redrawing; uncheck a planned destination and confirm it no longer appears.
- [ ] Check that already mapped floors cannot be unchecked in the destination editor.
- [ ] Delete a *test-only* floor that was selected as a pending destination (but not yet mapped); confirm the destination is cleared from Staircase A.
- [ ] Click Edit this floor, adjust the saved polygon corners, save and refresh again.
- [ ] Click Mark access point; pick the hallway connection. Save and re-edit or move it.
- [ ] Add Level 2 with its own image, then choose **Add on this floor** on Staircase A; save its independent outline.
- [ ] Switch floors repeatedly and refresh. Confirm floor-specific outlines/entry points stay in place and the same staircase name/identity appears on both.
- [ ] Add a third floor later; confirm the existing two remain intact.
- [ ] Verify the UI doesn't claim a validated route, accessible egress path, or actual navigation when 2+ floors are mapped.
- [ ] Test overlapping and irregular stair zones, draft cancel, browser zoom, undo/redo, mobile pointer input.
- [ ] On a *test-only* floor, replace the plan picture; confirm that floor's stale stair landing disappears and other floors remain.
- [ ] On a *test-only* floor, delete the floor; confirm its stair landing is removed but another floor's landing persists.
- [ ] Verify lint, TypeScript, all geometry tests, production build and MapLibre worker smoke checks.

## Important limitations
This feature **identifies** staircase footprints and access points, and associates corresponding floors with a staircase ID. It does not calculate paths, validate that a door opens into the staircase, verify that stairs physically serve a floor, or certify emergency exits. Stair accessibility, permitted directions, and route connectivity require later topology/audit work. The data is stored locally in this browser, not synced or backed up to a server.
