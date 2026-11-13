# Visitor Walking and Restricted-Room Alert Implementation Plan

1. Add pure simulation helpers and tests for room-only restriction eligibility, deterministic session randomization, path movement, room containment, and entry deduplication.
2. Add a client simulation controller that builds only validated, wall-clear visitor routes from the existing navigation graph and coordinates five visitor runtimes.
3. Project visitor positions through each floor's saved outdoor placement and expose compact map snapshots, restricted-room state, and alert events.
4. Extend the outdoor MapLibre canvas with reusable avatar markers and a flashing restricted-room overlay without recreating map sources every animation frame.
5. Add the centered siren alert popout and connect dismissal and automatic timeout behavior.
6. Wire the simulation into the selected-location workspace, keep all placed floor geometry available, and load stair/elevator topology independently of the optional navigation UI.
7. Add source-level integration tests, then run the complete geometry suite, ESLint, TypeScript, and a production build if time permits.
