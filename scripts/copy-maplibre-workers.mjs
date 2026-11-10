import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";

const source = path.join(process.cwd(), "node_modules", "maplibre-gl", "dist");
const destination = path.join(process.cwd(), "public", "vendor", "maplibre-gl");
const names = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];
mkdirSync(destination, { recursive: true });
for (const name of names) {
  const from = path.join(source, name);
  if (!existsSync(from)) throw new Error(`Missing MapLibre runtime: ${from}. Run npm ci.`);
  copyFileSync(from, path.join(destination, name));
}
console.log("MapLibre worker files copied to /vendor/maplibre-gl");
