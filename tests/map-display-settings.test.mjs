import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import ts from "typescript";
const tsSource=readFileSync(new URL("../src/lib/map-display-settings.ts",import.meta.url),"utf8");
const js=ts.transpileModule(tsSource,{compilerOptions:{
  module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,
}}).outputText;
const url="data:text/javascript;base64,"+Buffer.from(js).toString("base64");
const {DEFAULT_DISPLAY_SETTINGS,parseDisplaySettings}=await import(url);
test("display settings default visible and malformed browser preferences are ignored",()=>{
  assert.ok(Object.values(DEFAULT_DISPLAY_SETTINGS).every(Boolean));
  assert.deepEqual(parseDisplaySettings(null),DEFAULT_DISPLAY_SETTINGS);
  assert.deepEqual(parseDisplaySettings({roomLabels:false,guideLine:false,
    doorwayIcons:"false",unexpected:4}),{
      ...DEFAULT_DISPLAY_SETTINGS,roomLabels:false,guideLine:false,
  });
  assert.equal(parseDisplaySettings({entranceExitMarkers:false}).entranceExitMarkers,false);
});
