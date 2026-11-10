import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import ts from "typescript";

const transpile=path=>ts.transpileModule(
  readFileSync(new URL(path,import.meta.url),"utf8"),{
    compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022},
  }).outputText;
const asModule=source=>"data:text/javascript;base64,"+
  Buffer.from(source).toString("base64");
const placementModule=asModule(transpile("../src/lib/outdoor-floor-placement.ts"));
const cameraGeometryModule=asModule(transpile("../src/lib/device-spatial.ts"));
const geometryModule=asModule(transpile("../src/lib/outdoor-indoor-geometry.ts")
  .replace('from "@/lib/outdoor-floor-placement"',`from "${placementModule}"`)
  .replace('from "@/lib/device-spatial"',`from "${cameraGeometryModule}"`));
const outdoorRouteModule=asModule(transpile("../src/lib/outdoor-navigation.ts")
  .replace('from "@/lib/outdoor-floor-placement"',`from "${placementModule}"`)
  .replace('from "@/lib/outdoor-indoor-geometry"',`from "${geometryModule}"`));
const {buildOutdoorNavigationOverlay,outdoorNavigationSummary}=
  await import(outdoorRouteModule);
const {outdoorNavigationScope,outdoorNavigationProblems}=
  await import(asModule(transpile("../src/lib/outdoor-navigation-connectivity.ts")));
const {defaultFloorPlacement}=await import(placementModule);
const {indoorPointToLngLat}=await import(geometryModule);
const floor=(id,longitude,placed=true)=>({
  id,planId:id,name:id,width:1000,height:500,
  locationId:"location-1",
  hierarchy:{building:{id:"group-1"},floor:{id,name:id,level:id==="floor-a"?0:1}},
  outdoorPlacement:placed?
    {...defaultFloorPlacement(longitude,14),widthMeters:120}:null,
});
const node=(id,floorId,label,kind="room")=>({
  id,floorId,kind,label,point:{x:500,y:250},
});
const makeRoute=()=>({
  status:"ready",
  nodes:[node("floor-a:area:cinema","floor-a","Cinema"),
    node("floor-a:area:hall","floor-a","Hall")],
  edges:[{id:"door-1",kind:"door",label:"Doorway"}],
});
const makeStep=(f,points,extra={})=>({
  floorId:f,floorName:f,
  nodes:[node(f+":area:first",f,"First"),node(f+":area:last",f,"Last")],
  edges:[],guidance:{status:"guided",points,message:"Valid wall-clear geometry"},
  transitionAfter:null,...extra,
});

test("projects the indoor editor's approved route onto the floor's geographic transform",()=>{
  const mapFloor=floor("floor-a",121);
  const points=[{x:100,y:100},{x:350,y:110},{x:700,y:320}];
  const overlay=buildOutdoorNavigationOverlay(makeRoute(),
    [makeStep("floor-a",points)],[mapFloor]);
  const line=overlay.features.filter(f=>f.properties.kind==="route-segment");
  assert.equal(line.length,1);
  assert.equal(line[0].properties.floorId,"floor-a");
  assert.deepEqual(line[0].geometry.coordinates,points.map(pt=>
    indoorPointToLngLat(pt,mapFloor.outdoorPlacement,1000,500)));
  assert.deepEqual(overlay.features.filter(f=>f.properties.kind==="route-start")
    .map(f=>f.geometry.coordinates),[line[0].geometry.coordinates[0]]);
  assert.deepEqual(overlay.features.filter(f=>f.properties.kind==="route-end")
    .map(f=>f.geometry.coordinates),[line[0].geometry.coordinates.at(-1)]);
});

test("cross-floor routes draw independent line strings, not false ground-level shortcuts",()=>{
  const stairsA=node("floor-a:stair:stairs","floor-a","Main stairs","staircase");
  const stairsB=node("floor-b:stair:stairs","floor-b","Main stairs","staircase");
  const start=node("floor-a:area:cinema","floor-a","Cinema");
  const end=node("floor-b:area:food","floor-b","Food court");
  const transition={kind:"vertical",label:"Staircase: Main stairs",
    fromId:stairsA.id,toId:stairsB.id};
  const route={status:"ready",nodes:[start,stairsA,stairsB,end],
    edges:[{kind:"door"},{...transition},{kind:"door"}]};
  const steps=[
    makeStep("floor-a",[{x:130,y:100},{x:420,y:200}],{
      nodes:[start,stairsA],transitionAfter:transition}),
    makeStep("floor-b",[{x:500,y:230},{x:840,y:280}],{nodes:[stairsB,end]}),
  ];
  const overlay=buildOutdoorNavigationOverlay(route,steps,
    [floor("floor-a",121),floor("floor-b",121.004)]);
  const lines=overlay.features.filter(f=>f.properties.kind==="route-segment");
  assert.equal(lines.length,2);
  assert.deepEqual(lines.map(l=>l.properties.floorId),["floor-a","floor-b"]);
  assert.ok(lines.every(l=>l.geometry.type==="LineString"));
  assert.equal(overlay.features.filter(f=>f.properties.kind==="floor-transition").length,1);
  assert.equal(overlay.features.filter(f=>f.properties.kind==="floor-entry").length,1);
  assert.equal(overlay.features.filter(f=>f.properties.kind==="route-start").length,1);
  assert.equal(overlay.features.filter(f=>f.properties.kind==="route-end").length,1);
  assert.ok(lines[1].geometry.coordinates[0][0]-lines[0].geometry.coordinates[0][0]>0.003);
});

test("never show an invented line for unplaced, invalid or needs-review floor geometry",()=>{
  const good=floor("floor-a",121),unplaced=floor("floor-b",121.01,false);
  const steps=[
    makeStep("floor-a",[{x:100,y:100},{x:200,y:200}]),
    makeStep("floor-b",[{x:300,y:300},{x:400,y:400}]),
    makeStep("floor-c",[],{guidance:{
      status:"needs-review",points:[],message:"Doorway clearance not verified"}}),
  ];
  const route=makeRoute();
  const overlay=buildOutdoorNavigationOverlay(route,steps,[good,unplaced]);
  assert.equal(overlay.features.filter(f=>f.properties.kind==="route-segment").length,1);
  assert.equal(overlay.features.filter(f=>f.properties.floorId==="floor-b").length,0);
  assert.equal(overlay.features.filter(f=>f.properties.floorId==="floor-c").length,0);
  const report=outdoorNavigationSummary(route,steps,new Set(["floor-a"]));
  assert.equal(report.drawable,1);
  assert.deepEqual(report.unplaced,["floor-b","floor-c"]);
  assert.match(report.needsReview[0],/Doorway clearance not verified/);
  for(const status of ["missing","unreachable","same"])
    assert.deepEqual(buildOutdoorNavigationOverlay({...route,status},steps,[good])
      .features,[]);
});

test("indoor navigation is location-scoped and reuses audited graph plus wall-clear routing",()=>{
  const workspace=readFileSync(new URL("../src/components/map/map-workspace.tsx",import.meta.url),"utf8");
  const canvas=readFileSync(new URL("../src/components/map/map-canvas.tsx",import.meta.url),"utf8");
  assert.match(workspace,/outdoorNavigationScope\(\s*floors,selectedSavedLocationId\)/);
  assert.match(workspace,/buildNavigationAudit\(/);
  assert.match(workspace,/findShortestMappedRoute\(outdoorNavAudit,outdoorGraphFloors/);
  assert.match(workspace,/buildFloorRouteSteps\(\s*outdoorGraphFloors,outdoorStairs/);
  assert.match(workspace,/buildingIds\.map\(id=>listStaircases\(id\)\)/);
  assert.match(workspace,/outdoorNavReady\?outdoorGraphFloors:\[\]/);
  assert.match(workspace,/outdoorNavigationProblems\(/);
  assert.match(workspace,/findValidatedRoute\(outdoorNavAudit/);
  assert.match(workspace,/buildFloorRouteSteps\(/);
  assert.match(workspace,/buildOutdoorNavigationOverlay\(/);
  assert.match(workspace,/id="outdoor-route-from"/);
  assert.match(workspace,/id="outdoor-route-to"/);
  assert.match(workspace,/onNavigationRoomPick=\{setRouteRoomFromMap\}/);
  assert.match(workspace,/Show navigation on map/);
  assert.match(canvas,/type:"geojson",data:initial/);
  assert.match(canvas,/OUTDOOR_ROUTE_SOURCE="outdoor-indoor-navigation-geometry"/);
  assert.match(canvas,/OUTDOOR_ROUTE_LAYERS/);
  assert.match(canvas,/source\.setData\(outdoorRouteOverlay\)/);
  assert.match(canvas,/Start route here/);
  assert.match(canvas,/Navigate here/);
});

test("graph includes unplaced intermediate floors but only offers placed rooms as endpoints",()=>{
  const a=floor("floor-a",121);
  const intermediate=floor("floor-b",121.002,false);
  const end=floor("floor-c",121.004);
  const other={...floor("floor-d",120),locationId:"another-location",
    hierarchy:{...floor("floor-d",120).hierarchy,building:{id:"group-2"}}};
  const scope=outdoorNavigationScope([a,intermediate,end,other],"location-1");
  assert.deepEqual(scope.graphFloors.map(f=>f.planId),["floor-a","floor-b","floor-c"]);
  assert.deepEqual(scope.placedFloors.map(f=>f.planId),["floor-a","floor-c"]);
  assert.deepEqual(scope.buildingIds,["group-1"]);
  assert.deepEqual(outdoorNavigationScope([a,other],null),
    {graphFloors:[],placedFloors:[],buildingIds:[]});
});

test("outdoor route diagnostics distinguish locked placement from missing approved links",()=>{
  const start=node("floor-a:area:cinema","floor-a","Cinema");
  const end=node("floor-b:area:shop","floor-b","Shop");
  const audit={nodes:[start,end],edges:[],issues:[
    {floorId:"floor-a",severity:"warning",message:"Cinema: doorway needs approval."},
  ],walkways:[{approved:false}],readyDoorCount:0};
  const route={status:"unreachable",nodes:[],edges:[]};
  const notes=outdoorNavigationProblems(audit,route,start,end);
  assert.ok(notes.some(note=>note.includes('Start room "Cinema"')));
  assert.ok(notes.some(note=>note.includes('Destination "Shop"')));
  assert.ok(notes.some(note=>note.includes("stair/elevator")));
  assert.ok(notes.some(note=>note.includes("not approved")));
  assert.ok(notes.some(note=>note.includes("No reviewed interior doorway")));
  assert.deepEqual(outdoorNavigationProblems(audit,{...route,status:"ready"},start,end),[]);
  assert.deepEqual(outdoorNavigationProblems(audit,route,null,end),[]);
});

test("outdoor routing diagnostics do not mislabel topology that is present but blocked",()=>{
  const start=node("floor-a:area:cinema","floor-a","Cinema");
  const end=node("floor-a:area:shop","floor-a","Shop");
  const mid=node("floor-a:area:hall","floor-a","Hall","walkable");
  const audit={nodes:[start,mid,end],edges:[
    {fromId:start.id,toId:mid.id,status:"ready",kind:"door"},
    {fromId:mid.id,toId:end.id,status:"ready",kind:"door"},
  ],issues:[],walkways:[],readyDoorCount:2};
  const notes=outdoorNavigationProblems(audit,{status:"unreachable",nodes:[],edges:[]},
    start,end);
  assert.equal(notes.length,1);
  assert.match(notes[0],/not in the same approved connection network/);
});
