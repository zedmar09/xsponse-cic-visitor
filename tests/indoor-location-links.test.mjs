import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import ts from "typescript";
const source=path=>ts.transpileModule(readFileSync(new URL(path,import.meta.url),"utf8"),{
  compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022},
}).outputText;
const url=s=>"data:text/javascript;base64,"+Buffer.from(s).toString("base64");
const {
  locationFloors,unassignedLocationFloors,assignFloorLocation,unassignFloorLocation,
}=await import(url(source("../src/lib/indoor-location-links.ts")));
const floor=(id,group,loc=null)=>({
  id,planId:id,locationId:loc,name:id,
  image:"DO-NOT-REPLACE-IMAGE",
  areas:[{id:`room-${id}`,points:[{x:12,y:14},{x:50,y:14},{x:50,y:80}]}],
  portals:[{id:`door-${id}`,start:{x:20,y:20},end:{x:30,y:20}}],
  walkwayApprovals:[{areaAId:"one",areaBId:"two",geometryKey:"same"}],
  hierarchy:{
    site:{id:"site",name:"Site"},
    building:{id:group,siteId:"site",name:"Internal legacy navigation group"},
    floor:{id,buildingId:group,name:id,level:0},
  },
  createdAt:"earlier",updatedAt:"earlier",
});
const known=["location-A","location-B"];
test("each saved location owns any number of existing independent floor records",()=>{
  const floors=[
    floor("A-GF","group-a","location-A"),floor("A-F1","group-a","location-A"),
    floor("A-ANNEX","another-group","location-A"),
    floor("B-GF","group-b","location-B"),
  ];
  assert.deepEqual(locationFloors(floors,"location-A").map(f=>f.id),["A-GF","A-F1","A-ANNEX"]);
  assert.deepEqual(locationFloors(floors,"location-B").map(f=>f.id),["B-GF"]);
  assert.deepEqual(locationFloors(floors,null),[]);
});
test("associating an existing floor changes location ownership, not any indoor geometry",()=>{
  const existing=floor("old-plan","group-a");
  const before=JSON.stringify(existing);
  const linked=assignFloorLocation(existing,"location-A",[existing],known,"now");
  assert.equal(linked.locationId,"location-A");
  assert.deepEqual(linked.areas,existing.areas);
  assert.deepEqual(linked.portals,existing.portals);
  assert.deepEqual(linked.walkwayApprovals,existing.walkwayApprovals);
  assert.equal(linked.image,existing.image);
  assert.equal(JSON.stringify(existing),before);
  assert.equal(linked.hierarchy.building.id,existing.hierarchy.building.id);
  const unassigned=unassignFloorLocation(linked,"location-A","later");
  assert.equal(unassigned.locationId,null);
  assert.deepEqual(unassigned.areas,existing.areas);
});
test("never silently reassign a floor or split stair-connected levels between different locations",()=>{
  const first=assignFloorLocation(floor("F1","shared"),"location-A",[],known,"now");
  assert.throws(()=>assignFloorLocation(first,"location-B",[first],known,"later"),
    /Unassign this floor/);
  assert.throws(()=>assignFloorLocation(floor("F2","shared"),"location-B",[first],known,"later"),
    /Related indoor floors/);
  assert.throws(()=>assignFloorLocation(floor("F3","other"),"missing",[],known,"now"),
    /Select a saved outdoor location/);
  assert.throws(()=>unassignFloorLocation(first,"location-B","later"),/does not belong/);
});
test("legacy unassigned floors and orphaned location links remain available for reassignment",()=>{
  const floors=[floor("old","a"),floor("orphaned","b","deleted-location"),
    floor("still-valid","c","location-A")];
  assert.deepEqual(unassignedLocationFloors(floors,known).map(f=>f.id),["old","orphaned"]);
  const recovered=assignFloorLocation(floors[1],"location-B",floors,known,"now");
  assert.equal(recovered.locationId,"location-B");
});
test("indoor UI selects location before editing and new floor images inherit that location",()=>{
  const code=readFileSync(new URL("../src/components/map/map-workspace.tsx",import.meta.url),"utf8");
  const selector=readFileSync(new URL("../src/components/map/indoor-location-selector.tsx",import.meta.url),"utf8");
  const map=readFileSync(new URL("../src/components/map/map-canvas.tsx",import.meta.url),"utf8");
  assert.match(code,/locationId:addNewFloor\?selectedIndoorLocationId:record!\.locationId/);
  assert.match(code,/onChoose=\{selectIndoorLocation\}/);
  assert.match(code,/onAttach=\{attachExistingIndoorFloor\}/);
  assert.match(code,/onOpen=\{id=>\{void switchFloor\(id\)\}\}/);
  assert.match(code,/Set up indoor maps \/ floors/);
  assert.doesNotMatch(code,/OutdoorBuildingManager|buildingPlacementMode|outdoorBuildings/);
  assert.doesNotMatch(map,/outdoor-building-footprints|onOutdoorBuildingSelect/);
  assert.match(selector,/No indoor maps at this location yet/);
  assert.match(selector,/Create first indoor floor/);
});
test("Phase 2 does not change the existing indoor editor storage schema",()=>{
  const src=readFileSync(new URL("../src/lib/floor-plan-storage.ts",import.meta.url),"utf8");
  assert.match(src,/const DB_NAME = "maplibre-lab-indoor"/);
  assert.match(src,/const DB_VERSION = 3/);
  assert.match(src,/const STORE_NAME = "floor-plans"/);
});

test("unassigning or recovering a floor clears geographic placement but leaves indoor geometry intact",()=>{
  const source=floor("F-A","one","location-A");
  source.outdoorPlacement={longitude:121,latitude:14,widthMeters:40,rotationDegrees:0,opacity:0.75};
  const free=unassignFloorLocation(source,"location-A","now");
  assert.equal(free.outdoorPlacement,null);
  assert.deepEqual(free.areas,source.areas);
  assert.deepEqual(free.portals,source.portals);
  const moved=assignFloorLocation(free,"location-B",[free],known,"later");
  assert.equal(moved.outdoorPlacement,null);
  assert.deepEqual(moved.areas,source.areas);
  const orphaned={...source,locationId:"deleted-location"};
  const recovered=assignFloorLocation(orphaned,"location-B",[orphaned],known,"later");
  assert.equal(recovered.outdoorPlacement,null);
});
