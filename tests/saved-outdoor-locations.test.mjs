import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import ts from "typescript";

const source=(path)=>ts.transpileModule(readFileSync(new URL(path,import.meta.url),"utf8"),{
  compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022},
}).outputText;
const url=s=>"data:text/javascript;base64,"+Buffer.from(s).toString("base64");
const helpers=await import(url(source("../src/lib/saved-outdoor-locations.ts")));

test("saved outdoor location retains selected geographic coordinates and stable ID",()=>{
  const fromSearch={id:"nominatim-123",label:"Rizal Park, Manila, Philippines",
    longitude:120.979,latitude:14.5824,zoom:16};
  const record=helpers.createSavedLocation(fromSearch,"  Main   Campus  ",
    "a-random-stable-uuid","2026-11-02T12:00:00Z");
  assert.equal(record.id,"a-random-stable-uuid");
  assert.equal(record.name,"Main Campus");
  assert.equal(record.address,fromSearch.label);
  assert.equal(record.latitude,14.5824);
  assert.equal(record.longitude,120.979);
  assert.equal(record.createdAt,record.updatedAt);
  assert.equal(record.zoom,16);
  assert.deepEqual(helpers.asOutdoorSearchTarget(record),{
    id:"a-random-stable-uuid",label:"Main Campus",
    longitude:120.979,latitude:14.5824,zoom:16,
  });
});
test("rename preserves geographic position and identity",()=>{
  const original=helpers.createSavedLocation({id:"123",label:"Makati City",
    longitude:121.0,latitude:14.55,zoom:12},"Head Office","stable-id","now");
  const renamed=helpers.renameSavedLocation(original,"  Main Office  ","later");
  assert.equal(renamed.name,"Main Office");
  assert.equal(renamed.id,"stable-id");
  assert.deepEqual({lat:renamed.latitude,lon:renamed.longitude},
    {lat:original.latitude,lon:original.longitude});
  assert.equal(original.name,"Head Office");
  assert.equal(renamed.updatedAt,"later");
});
test("invalid geographic coordinates and names are rejected before IndexedDB",()=>{
  const location={id:"1",label:"Test",latitude:14,longitude:121,zoom:12};
  for(const value of ["","a","x".repeat(91)])
    assert.throws(()=>helpers.createSavedLocation(location,value,"i","now"));
  for(const [latitude,longitude] of [[NaN,121],[91,120],[14,-181],[14,Infinity]])
    assert.throws(()=>helpers.createSavedLocation({...location,latitude,longitude},"OK","i","now"));
  assert.equal(helpers.validSavedLocation({...helpers.createSavedLocation(location,"Valid","i","now"),
    id:""}),false);
  assert.equal(helpers.createSavedLocation({...location,zoom:5},"Country","id","now").zoom,5);
});
test("location records use independent IndexedDB, never overwriting existing saved indoor floors",()=>{
  const floorStore=readFileSync(new URL("../src/lib/floor-plan-storage.ts",import.meta.url),"utf8");
  const locationStore=readFileSync(new URL("../src/lib/outdoor-location-storage.ts",import.meta.url),"utf8");
  assert.match(floorStore,/const DB_NAME = "maplibre-lab-indoor"/);
  assert.match(locationStore,/const DB_NAME="maplibre-lab-outdoor-locations"/);
  assert.match(locationStore,/store\.add\(place\)/);
  assert.doesNotMatch(locationStore,/removeFloorPlan|floor-plans|building-staircases/);
  assert.match(locationStore,/store\.getAll\(\)/);
  assert.match(locationStore,/store\.put\(place\)/);
  assert.match(locationStore,/store\.delete\(id\)/);
});
test("the map renders saved pins and makes them keyboard/click selectable",()=>{
  const canvas=readFileSync(new URL("../src/components/map/map-canvas.tsx",import.meta.url),"utf8");
  const workspace=readFileSync(new URL("../src/components/map/map-workspace.tsx",import.meta.url),"utf8");
  const manager=readFileSync(new URL("../src/components/map/outdoor-location-manager.tsx",import.meta.url),"utf8");
  assert.match(canvas,/renderSavedMarkers\(map,maplibregl,latestSavedLocationsRef\.current/);
  assert.match(canvas,/element\.addEventListener\("click"/);
  assert.match(canvas,/event\.key==="Enter"\|\|event\.key===" "/);
  assert.match(canvas,/onSavedLocationSelectRef\.current\(place\)/);
  assert.match(workspace,/setSavedLocations\(await listOutdoorLocations\(\)\)/);
  assert.match(workspace,/onSavedLocationSelect=\{pickSavedLocation\}/);
  assert.match(workspace,/setSelectedSavedLocationId\(null\);setResetStreet/);
  assert.match(manager,/Add this location/);
  assert.match(manager,/Delete/);
});
