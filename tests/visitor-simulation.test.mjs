import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import ts from "typescript";

const source=(path)=>ts.transpileModule(readFileSync(new URL(path,import.meta.url),"utf8"),{
  compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022},
}).outputText;
const url=value=>"data:text/javascript;base64,"+Buffer.from(value).toString("base64");
const simulation=await import(url(source("../src/lib/visitor-simulation.ts")));

test("restricted-area candidates include placed rooms only",()=>{
  const floors=[{
    id:"record-a",planId:"floor-a",outdoorPlacement:{longitude:121,latitude:14},
    hierarchy:{floor:{id:"floor-a"}},areas:[
      {id:"room",floorId:"floor-a",kind:"room",name:"Records",points:[{x:0,y:0},{x:20,y:0},{x:20,y:20},{x:0,y:20}]},
      {id:"walk",floorId:"floor-a",kind:"walkable",name:"Hall",points:[{x:20,y:0},{x:40,y:0},{x:40,y:20},{x:20,y:20}]},
    ],
  },{
    id:"record-b",planId:"floor-b",outdoorPlacement:null,
    areas:[{id:"hidden",floorId:"floor-b",kind:"room",name:"Unplaced",points:[{x:0,y:0},{x:1,y:0},{x:1,y:1}]}],
  }];
  assert.deepEqual(simulation.eligibleRestrictedRooms(floors),[{
    floorId:"floor-a",floorRecordId:"record-a",roomId:"room",name:"Records",
    points:[{x:0,y:0},{x:20,y:0},{x:20,y:20},{x:0,y:20}],
  }]);
});

test("session random generator is repeatable for the same seed",()=>{
  const a=simulation.createSeededRandom("location:session");
  const b=simulation.createSeededRandom("location:session");
  assert.deepEqual([a(),a(),a(),a()],[b(),b(),b(),b()]);
  assert.notEqual(simulation.createSeededRandom("other")(),simulation.createSeededRandom("location:session")());
});

test("path movement interpolates and consumes several segments safely",()=>{
  const path=[{x:0,y:0},{x:10,y:0},{x:10,y:10}];
  assert.deepEqual(simulation.moveAlongPath(path,1,path[0],6),{
    point:{x:6,y:0},segmentIndex:1,done:false,
  });
  assert.deepEqual(simulation.moveAlongPath(path,1,path[0],15),{
    point:{x:10,y:5},segmentIndex:2,done:false,
  });
  assert.deepEqual(simulation.moveAlongPath(path,1,path[0],30),{
    point:{x:10,y:10},segmentIndex:2,done:true,
  });
});

test("room containment and restricted entry transitions rearm after exit",()=>{
  const room=[{x:0,y:0},{x:20,y:0},{x:20,y:20},{x:0,y:20}];
  assert.equal(simulation.pointInPolygon({x:10,y:10},room),true);
  assert.equal(simulation.pointInPolygon({x:30,y:10},room),false);

  const first=simulation.restrictedPresenceTransition(new Set(),["v1","v2"]);
  assert.deepEqual(first.entered,["v1","v2"]);
  assert.deepEqual(first.exited,[]);
  const steady=simulation.restrictedPresenceTransition(first.inside,["v1","v2"]);
  assert.deepEqual(steady.entered,[]);
  const leave=simulation.restrictedPresenceTransition(steady.inside,["v2"]);
  assert.deepEqual(leave.exited,["v1"]);
  const reenter=simulation.restrictedPresenceTransition(leave.inside,["v1","v2"]);
  assert.deepEqual(reenter.entered,["v1"]);
});

test("workspace wires validated visitor movement, map avatars, room alarm, and siren alert",()=>{
  const workspace=readFileSync(new URL("../src/components/map/map-workspace.tsx",import.meta.url),"utf8");
  const canvas=readFileSync(new URL("../src/components/map/map-canvas.tsx",import.meta.url),"utf8");
  const hook=readFileSync(new URL("../src/lib/use-outdoor-visitor-simulation.ts",import.meta.url),"utf8");
  const alert=readFileSync(new URL("../src/components/map/visitor-alert.tsx",import.meta.url),"utf8");
  assert.match(hook,/buildNavigationAudit/);
  assert.match(hook,/findShortestMappedRoute/);
  assert.match(hook,/buildFloorRouteSteps/);
  assert.match(hook,/VISITOR_FIX_INTERVAL_MS=2000/);
  assert.match(hook,/setInterval\(fix,VISITOR_FIX_INTERVAL_MS\)/);
  assert.match(hook,/pathStaysInMappedSpace/);
  assert.doesNotMatch(hook,/requestAnimationFrame/);
  assert.match(canvas,/VISITOR_TRAIL_SOURCE/);
  assert.match(canvas,/visitor-map-marker__location/);
  assert.match(workspace,/useOutdoorVisitorSimulation/);
  assert.match(workspace,/visitorSnapshots=/);
  assert.match(workspace,/restrictedRoom=/);
  assert.match(canvas,/visitor-map-marker/);
  assert.match(canvas,/restricted-room-fill/);
  assert.match(canvas,/restricted-room-outline/);
  assert.match(alert,/Siren/);
  assert.match(alert,/# Visitor entered the restricted area:/);
  assert.match(alert,/role="alert"/);
});

test("walking records each passed corner so the trail follows the path",()=>{
  const path=[{x:0,y:0},{x:10,y:0},{x:10,y:10}];
  assert.deepEqual(simulation.walkAlongPath(path,1,path[0],15).traversed,
    [{x:10,y:0},{x:10,y:5}]);
  assert.deepEqual(simulation.walkAlongPath(path,1,path[0],4).traversed,[{x:4,y:0}]);
  const end=simulation.walkAlongPath(path,1,path[0],50);
  assert.equal(end.done,true);
  assert.deepEqual(end.traversed,[{x:10,y:0},{x:10,y:10}]);
});

test("visitor paths must stay inside drawn spaces and on the floor image",()=>{
  // Two rooms separated by a 6px wall gap with a reviewed doorway hop.
  const spaces=[
    {id:"a",name:"Lobby",kind:"walkable",points:[{x:0,y:0},{x:40,y:0},{x:40,y:40},{x:0,y:40}]},
    {id:"b",name:"Records",kind:"room",points:[{x:46,y:0},{x:90,y:0},{x:90,y:40},{x:46,y:40}]},
  ];
  const bounds={width:100,height:50};
  const door={from:{x:40,y:20},to:{x:46,y:20}};
  const throughDoor=[{x:20,y:20},{x:40,y:20},{x:46,y:20},{x:70,y:20}];
  assert.equal(simulation.pathStaysInMappedSpace(throughDoor,spaces,bounds,[door]),true);
  // Same hop without a reviewed opening crosses the wall: rejected.
  assert.equal(simulation.pathStaysInMappedSpace(throughDoor,spaces,bounds),false);
  // A diagonal shortcut through the wall gap is rejected even with the door.
  assert.equal(simulation.pathStaysInMappedSpace([{x:20,y:5},{x:70,y:35}],spaces,bounds,[door]),false);
  // Outside the floor picture is rejected.
  assert.equal(simulation.pathStaysInMappedSpace([{x:20,y:20},{x:20,y:60}],spaces,
    {width:100,height:50}),false);
});

test("current location prefers the room over the corridor and names fallbacks",()=>{
  const spaces=[
    {id:"hall",name:"",kind:"walkable",points:[{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}]},
    {id:"room",name:"Server Room",kind:"room",points:[{x:10,y:10},{x:30,y:10},{x:30,y:30},{x:10,y:30}]},
  ];
  assert.equal(simulation.mappedSpaceLabel(simulation.locateInSpaces({x:20,y:20},spaces)),"Server Room");
  assert.equal(simulation.mappedSpaceLabel(simulation.locateInSpaces({x:60,y:60},spaces)),"Walkway");
  assert.equal(simulation.mappedSpaceLabel(simulation.locateInSpaces({x:160,y:60},spaces)),"Doorway");
});
