import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workspace=readFileSync(new URL("../src/components/map/map-workspace.tsx",import.meta.url),"utf8");

test("outdoor editor omits the default instruction and measurements badge",()=>{
  assert.doesNotMatch(workspace,/Outdoor map · Select a floor to position all indoor details/);
  assert.doesNotMatch(workspace,/No building measurements needed/);
  assert.match(workspace,/view==="street"&&\(placingFloor\|\|pickOnMap\)/);
  assert.match(workspace,/Floor placement · Click map to choose its centre/);
  assert.match(workspace,/Pick mode · Click a map point to create a location/);
});

test("visitor indoor setup does not expose device management or placement",()=>{
  assert.match(workspace,/const SHOW_INDOOR_DEVICE_TOOLS = false;/);
  assert.match(workspace,/selectedIndoorLocationId&&SHOW_INDOOR_DEVICE_TOOLS&&<DeviceInventory/);
  assert.match(workspace,/SHOW_INDOOR_DEVICE_TOOLS&&<>[\s\S]*?<h3[^>]*>Device markers<\/h3>/);
  assert.match(workspace,/placedDevices=\{SHOW_INDOOR_DEVICE_TOOLS\?/);
  assert.match(workspace,/onDeviceDrop=\{SHOW_INDOOR_DEVICE_TOOLS\?dropLocationDevice:\(\)=>\{\}\}/);
  assert.match(workspace,/markers=\{visibleMarkers\}/);
  assert.match(workspace,/marker\.kind!=="camera"&&marker\.kind!=="device"/);
  assert.doesNotMatch(workspace,/\["deviceMarkers","Camera & device icons"\]/);
});

test("visitor indoor setup hides navigation and connectivity controls",()=>{
  assert.match(workspace,/const SHOW_INDOOR_NAVIGATION_TOOLS = false;/);
  assert.match(workspace,/record&&hierarchy&&SHOW_INDOOR_NAVIGATION_TOOLS&&<details/);
  assert.match(workspace,/navigationSelection=\{SHOW_INDOOR_NAVIGATION_TOOLS\?navSelection:null\}/);
  assert.doesNotMatch(workspace,/\["guideLine","Navigation guide lines"\]/);
});

test("room, doorway and staircase editors remain accessible",()=>{
  assert.match(workspace,/>2\. Outline rooms and walking spaces<\/summary>/);
  assert.match(workspace,/>3\. Configure doorways<\/summary>/);
  assert.match(workspace,/>4\. Staircases &amp; floor connections<\/summary>/);
});
