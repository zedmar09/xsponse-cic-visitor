import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
const source = path => ts.transpileModule(readFileSync(new URL(path,import.meta.url),"utf8"),{
  compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022},
}).outputText;
const url=source=>"data:text/javascript;base64,"+Buffer.from(source).toString("base64");
const floorUrl=url(source("../src/lib/floor-plan.ts"));
const stairJs=source("../src/lib/staircases.ts").replaceAll('"@/lib/floor-plan"',JSON.stringify(floorUrl));
const {staircaseError,stairConnectionLabel,landingOnFloor}=await import(url(stairJs));

const baseFloor=(id,buildingId="b1")=>({
  id:`floor-${id}`,planId:id,name:id,width:500,height:400,
  mimeType:"image/png",image:new Blob(["image"]),calibration:null,
  hierarchy:{
    site:{id:"s1",name:"Site"},building:{id:buildingId,siteId:"s1",name:"Building"},
    floor:{id,buildingId,name:id,level:id==="f1"?0:1},
  },
  areas:[{id:`hall-${id}`,floorId:id,kind:"walkable",name:"Hallway",points:[
    {x:10,y:10},{x:120,y:10},{x:120,y:200},{x:10,y:200}]}],
  portals:[],markers:[],createdAt:"2026-11-02",updatedAt:"2026-11-02",
});
const landing=(floorId)=>({
  floorId,outline:[{x:20,y:20},{x:90,y:20},{x:90,y:130},{x:20,y:130}],
  entryPoint:null,walkableAreaId:null,
});
const stair={
  id:"stairs-1",buildingId:"b1",name:"Staircase A",direction:"both",
  landings:[landing("f1")],createdAt:"2026-11-02",updatedAt:"2026-11-02",
};
test("a staircase may be saved before any second floor exists",()=>{
  assert.equal(staircaseError(stair,[baseFloor("f1")]),null);
  assert.equal(stairConnectionLabel(stair),"Saved · choose other floors later");
  assert.equal(landingOnFloor(stair,"f1")?.entryPoint,null);
  assert.equal(landingOnFloor(stair,"f2"),null);
});
test("connecting a second landing keeps the first floor outline unchanged",()=>{
  const second={...stair,landings:[...stair.landings,landing("f2")]};
  const floors=[baseFloor("f1"),baseFloor("f2")];
  assert.equal(staircaseError(second,floors),null);
  assert.equal(stairConnectionLabel(second),"2 floor locations mapped");
  assert.deepEqual(landingOnFloor(second,"f1"),stair.landings[0]);
  const added={...second,landings:second.landings.map(l=>l.floorId==="f2"
    ?{...l,entryPoint:{x:12,y:30},walkableAreaId:"hall-f2"}:l)};
  assert.equal(staircaseError(added,floors),null);
  assert.equal(landingOnFloor(added,"f1")?.entryPoint,null);
  assert.deepEqual(landingOnFloor(added,"f2")?.entryPoint,{x:12,y:30});
});
test("rejects invalid, cross-building, duplicate and off-image staircase landings",()=>{
  const f1=baseFloor("f1"),f2=baseFloor("f2");
  assert.match(staircaseError({...stair,landings:[]},[f1]),/at least one/);
  assert.match(staircaseError({...stair,landings:[landing("f1"),landing("f1")]},[f1]),/same floor/);
  assert.match(staircaseError({...stair,landings:[landing("f2")]},[f1]),/unknown floor/);
  assert.match(staircaseError({...stair,landings:[landing("f2")]},[f1,baseFloor("f2","b2")]),/unknown floor/);
  assert.match(staircaseError({...stair,landings:[{...landing("f1"),outline:[
    {x:2,y:2},{x:20,y:20},{x:2,y:20},{x:20,y:2}]}]},[f1]),/Invalid staircase outline/);
  // Old manually selected hallway fields must never prevent editing a drawn zone.
  assert.equal(staircaseError({...stair,landings:[{...landing("f1"),entryPoint:{x:-1,y:2}}]},[f1]),null);
  assert.equal(staircaseError({...stair,landings:[{...landing("f1"),walkableAreaId:"missing"}]},[f1]),null);
  assert.equal(staircaseError({...stair,direction:"up"},[f1]),null);
  assert.equal(staircaseError({...stair,direction:"down"},[f1]),null);
  assert.equal(staircaseError({...stair,landings:[landing("f1"),landing("f2")]},[f1,f2]),null);
});

test("destination selection is saved as pending even without a second landing",()=>{
  const ground=baseFloor("f1"),upper=baseFloor("f2");
  const planned={...stair,servedFloorIds:["f1","f2"]};
  assert.equal(staircaseError(planned,[ground,upper]),null);
  assert.match(stairConnectionLabel(planned),/floor selected.*outline needed on destination/i);
  assert.equal(landingOnFloor(planned,"f2"),null); // never pretend selection created geometry
  const completed={...planned,landings:[...stair.landings,landing("f2")]};
  assert.equal(staircaseError(completed,[ground,upper]),null);
  assert.equal(stairConnectionLabel(completed),"2 floor locations mapped");
  assert.equal(staircaseError({...stair},[ground]),null); // legacy records remain valid
});
test("invalid destination IDs and missing mapped-floor declarations are rejected",()=>{
  const ground=baseFloor("f1"),upper=baseFloor("f2");
  assert.match(staircaseError({...stair,servedFloorIds:["f1","f1"]},[ground,upper]),/more than once/);
  assert.match(staircaseError({...stair,servedFloorIds:["f1","deleted"]},[ground,upper]),/does not exist/);
  assert.match(staircaseError({...stair,servedFloorIds:["f2"]},[ground,upper]),/mapped staircase landing/);
  assert.match(staircaseError({...stair,servedFloorIds:["f1","f3"]},[ground,upper]),/does not exist/);
  assert.equal(staircaseError({...stair,servedFloorIds:["f1"]},[ground,upper]),null);
});

test("legacy staircase and optional elevator kind validate without access registration",()=>{
  const ground=baseFloor("f1"),upper=baseFloor("f2");
  const legacy={...stair,landings:[landing("f1"),landing("f2")],
    servedFloorIds:["f1","f2"]};
  assert.equal(staircaseError(legacy,[ground,upper]),null);
  assert.equal(staircaseError({...legacy,kind:"elevator"},[ground,upper]),null);
  assert.match(staircaseError({...legacy,kind:"portal"},[ground,upper]),/Choose stairs or elevator/);
});
