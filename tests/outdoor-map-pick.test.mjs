import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import ts from "typescript";

const src=path=>ts.transpileModule(readFileSync(new URL(path,import.meta.url),"utf8"),{
  compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022},
}).outputText;
const asUrl=s=>"data:text/javascript;base64,"+Buffer.from(s).toString("base64");
const outdoorUrl=asUrl(src("../src/lib/outdoor-search.ts"));
const {outdoorLocationFromMapPoint}=await import(outdoorUrl);
const savedUrl=asUrl(src("../src/lib/saved-outdoor-locations.ts")
  .replaceAll('"@/lib/outdoor-search"',JSON.stringify(outdoorUrl)));
const {createSavedLocation,asOutdoorSearchTarget}=await import(savedUrl);

test("a chosen point on the actual outdoor map becomes a geographic location candidate",()=>{
  const picked=outdoorLocationFromMapPoint(120.9842129,14.5995782,17.25);
  assert.deepEqual(picked,{
    id:"map-point:14.599578:120.984213",
    label:"Map point: 14.599578, 120.984213",
    latitude:14.599578,longitude:120.984213,
    zoom:17.25,source:"map",
  });
  const saved=createSavedLocation(picked,"  Main    Building  ","uuid-1","2026-11-02T00:00:00Z");
  assert.equal(saved.name,"Main Building");
  assert.equal(saved.latitude,14.599578);
  assert.equal(saved.longitude,120.984213);
  assert.equal(saved.address,"Map point: 14.599578, 120.984213");
  assert.equal(saved.id,"uuid-1");
  assert.equal(asOutdoorSearchTarget(saved).id,"uuid-1");
});
test("map-point selection never accepts invalid coordinates or invalid zoom",()=>{
  for(const [lng,lat,zoom] of [
    [Infinity,14,15],[121,-91,12],[-181,14,16],
    [121,91,12],[121,14,NaN],[NaN,14,12],
  ])assert.equal(outdoorLocationFromMapPoint(lng,lat,zoom),null);
  assert.equal(outdoorLocationFromMapPoint(180,90,30)?.zoom,19);
  assert.equal(outdoorLocationFromMapPoint(-180,-90,0)?.zoom,2);
});
test("a map click is handled only in deliberate pick mode, never during normal map navigation",()=>{
  const canvas=readFileSync(new URL("../src/components/map/map-canvas.tsx",import.meta.url),"utf8");
  const work=readFileSync(new URL("../src/components/map/map-workspace.tsx",import.meta.url),"utf8");
  const manager=readFileSync(new URL("../src/components/map/outdoor-location-manager.tsx",import.meta.url),"utf8");
  assert.match(canvas,/map\.on\("click",event=>\{/);
  assert.match(canvas,/if\(pickOnMapRef\.current\)\{/);
  assert.match(canvas,/if\(editableFloorIdRef\.current!==null\)return/);
  assert.match(canvas,/event\.lngLat\.lng,event\.lngLat\.lat,map\.getZoom\(\)/);
  assert.match(canvas,/onMapPointPickRef\.current\(point\)/);
  assert.match(canvas,/\(pickOnMap\|\|placingFloor\)\?"crosshair":""/);
  assert.match(canvas,/if\(placingFloorRef\.current\)\{/);
  assert.match(canvas,/onPlacementPointPickRef\.current\(event\.lngLat\.lng,event\.lngLat\.lat\)/);
  assert.match(canvas,/element\.addEventListener\("click",event=>\{event\.stopPropagation\(\);select\(\);\}\)/);
  assert.match(work,/Pick location on map/);
  assert.match(work,/onMapPointPick=\{pickOutdoorMapPoint\}/);
  assert.match(work,/setPickOnMap\(false\);\s*setSearchChoice\(point\)/);
  assert.match(manager,/searchResult\?\.source==="map"\?"":/);
  assert.match(manager,/Selected map coordinates:/);
  assert.match(manager,/Add this location/);
  assert.doesNotMatch(canvas,/saveFloorPlan|replaceFloorPlanImage|indexedDB/);
});
