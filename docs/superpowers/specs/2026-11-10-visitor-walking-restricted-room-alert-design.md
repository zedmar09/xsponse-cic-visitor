# Visitor Walking and Restricted-Room Alert Design

Date: 2026-11-10

## Objective

Animate the five demo visitors on the outdoor map after a saved location is selected. Visitors must follow the location's mapped indoor navigation geometry instead of crossing walls. One random room is restricted for the selected-location session. Entering that room flashes the room, pulses the visitor's map avatar red, and opens an alert containing a centered siren icon.

## Confirmed behavior

- The existing five demo profiles remain the visitor roster.
- One restricted area is selected when the saved location is selected and remains fixed until the location is deselected, changed, or the page is reloaded.
- Only an area whose saved kind is `room` can be restricted. Walkable areas, doorways, staircases, and elevators are never restricted.
- All five visitors move continuously between reachable rooms using reviewed doorways, approved walkable connections, and mapped stairs or elevators.
- Visitors start outside the restricted room. One randomly chosen visitor receives the restricted room as an early destination so the demo reliably presents the alarm; subsequent destinations are random.
- A visitor never receives a route that crosses an unmapped wall or uses an unreviewed connection.
- Entering the restricted room triggers one alert per entry. The visitor must leave before entering again can trigger another alert.
- The restricted room flashes red while at least one visitor is inside it.
- Every visitor currently inside the restricted room has a red pulsing ring around their map avatar.
- The alert is a map-centered popout with the title `Alert`, a centered siren icon, and the message `# Visitor entered the restricted area: [area name]`.
- The alert has a close control and auto-dismisses after six seconds. A newer event replaces the visible alert instead of stacking cards.

## Architecture

### Pure simulation model

Add a focused visitor-simulation module under `src/lib`. It owns pure types and calculations for:

- eligible restricted-room selection;
- visitor spawn-room and destination selection;
- conversion of validated navigation results into ordered floor/pixel waypoints;
- distance-based interpolation between waypoints;
- floor transitions through stairs and elevators;
- point-in-room detection; and
- entry/exit event deduplication.

Random choices use a session-local generator initialized when a location is selected. The restricted-room choice is therefore stable during that selection but may change after reselection or reload.

The simulation consumes the existing `buildNavigationAudit`, `findShortestMappedRoute`, and `buildFloorRouteSteps` outputs. It does not create a second navigation graph or infer shortcuts from polygon centers.

### Runtime controller

Add a React hook or controller that starts only when the street map has a selected saved location and its floor/stair inventory is ready. It maintains five independent visitor states:

- visitor identity;
- current floor and pixel position;
- current validated route and waypoint index;
- walking, connector-transition, or destination-dwell phase;
- current room ID, if any; and
- restricted-entry armed state.

Visitors choose a new reachable room after a short dwell. Walking speed varies slightly per visitor so the group does not move in lockstep. A short pause represents travel through a staircase or elevator before movement resumes on the destination floor.

The animation uses one shared `requestAnimationFrame` loop. Only five compact render snapshots are published to the map, avoiding independent timers and unnecessary application-wide rerenders.

### Map rendering

Extend the outdoor map interface with:

- visitor render snapshots containing visitor ID, avatar URL, floor ID, geographic position, and alert state;
- the selected restricted-room identity; and
- whether that room currently has an intruder.

Floor pixel positions are converted with the existing `indoorPointToLngLat` projection, preserving each floor's outdoor placement and warp.

Visitors render as circular avatar markers above the indoor geometry. The normal marker has a compact neutral border and readable shadow. A visitor inside the restricted room receives an animated red pulse without replacing the photo.

The restricted room receives a dedicated red overlay. Its opacity alternates while occupied to create the flash; when empty, it remains subtly marked so the demo operator can identify the selected restricted room without implying an active alarm.

The existing draggable `Visitors [5]` window remains at the top right and continues to list the same five identities. Dragging it does not affect the map simulation.

### Alert popout

Add a small alert component positioned at the center of the map viewport and above map controls and visitor markers. Its vertical layout is:

1. `Alert` title;
2. centered red siren icon; and
3. `# Visitor entered the restricted area: [area name]` message.

The popout includes a close button, uses an assertive live region for accessibility, and auto-dismisses after six seconds. Dismissing the popout does not stop the room flash or avatar pulse while the visitor remains inside.

## Data flow

1. The user selects the saved outdoor location.
2. The workspace loads placed floors, rooms, reviewed doorways, approved walkable joins, and staircase/elevator connections.
3. The navigation audit identifies usable room nodes and reachable components.
4. The simulation chooses one reachable placed room as restricted and, when alternatives exist, initializes five visitors in other usable rooms.
5. One randomly chosen visitor receives the restricted room as an early destination. Other destinations, and all later destinations, are selected randomly from rooms reachable by that visitor.
6. Each visitor receives a validated shortest route with wall-clear guidance.
7. The shared animation loop advances visitors along projected route waypoints.
8. Point-in-polygon detection determines room entry and exit on the visitor's current floor.
9. A first transition from outside to inside the restricted room emits an alert event and sets the room/avatar alarm states.
10. Leaving clears that visitor's pulse and rearms their next entry alert. The room stops flashing after the last intruding visitor leaves.

## Failure and fallback behavior

- If there are no placed rooms, the roster remains visible but no simulation or restricted-room alert starts.
- If there is only one usable room, visitors remain safely positioned there; no impossible route is fabricated.
- If a candidate destination is unreachable, the visitor chooses another room in its reachable component.
- If a floor lacks a valid outdoor placement, visitors are not rendered on that floor even if its topology exists.
- If stair/elevator data is unavailable, visitors remain on routes supported by the loaded floors rather than jumping between levels.
- Changing or deselecting the saved location cancels the animation frame, clears markers and alerts, and creates a new simulation when appropriate.
- Invalid avatar images fall back to visitor initials without stopping movement.

## Testing

Pure unit tests cover:

- restricted selection accepts rooms only;
- the selected restricted room remains stable for a location session;
- all visitors spawn outside the restricted room and one receives it as an early destination;
- route waypoint interpolation and floor transitions;
- point-in-polygon room entry and exit;
- one alert per entry with rearming after exit;
- multiple visitors keeping the room alarm active until the final visitor exits; and
- unreachable and single-room fallbacks.

Component tests cover:

- five avatar markers are supplied after initialization;
- a restricted visitor receives the red pulse state;
- the room overlay switches between idle and active flash states;
- the alert includes the title, centered siren icon, exact area message, close control, and auto-dismiss behavior; and
- selecting a different saved location resets the simulation.

The full existing test suite, lint, and TypeScript checks must pass. Manual verification should confirm that markers follow mapped openings, connector transitions do not draw straight lines between floors, the panel remains draggable, and alarms remain legible over both light and dark map content.

## Out of scope

- Real visitor telemetry or backend persistence.
- Editing which room is restricted.
- Security escalation workflows, notification delivery, or alarm history.
- Crowds, collision avoidance, or physically exact pedestrian behavior.
- Restricting walkable areas, doorways, staircases, or elevators.
