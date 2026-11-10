import type * as MapLibre from "maplibre-gl";
let loader: Promise<typeof MapLibre> | undefined;
/** Always register a same-origin MapLibre v6 worker BEFORE constructing a map. */
export function loadMapLibre(): Promise<typeof MapLibre> {
  loader ??= import("maplibre-gl").then(lib => {
    lib.setWorkerUrl(`/vendor/maplibre-gl/maplibre-gl-worker.mjs?v=${lib.getVersion()}`);
    return lib;
  });
  return loader;
}
