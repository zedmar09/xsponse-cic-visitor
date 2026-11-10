import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../src/lib/floor-plan.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const geometry = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
const { pixelsToPlane, planeToPixels, polygonError, polygonArea,
  segmentImageLength, portalMidpoint, exportFloorPlanMetadata,
  ensureSpatialFoundation, spatialFoundationError, doorwaySetupError,
  doorwayReviewIssues, displayDoorPurpose, suggestDoorwaySides, areaLabelPoint,
  doorwayRectangle, proposeDoorwayPlacement, doorwayThicknessHandle,
  doorwayThicknessFromPointer } = geometry;

test("image coordinates roundtrip through the map projection", () => {
  for (const point of [{x:0,y:0},{x:2048,y:1024},{x:987.12,y:456.78}]) {
    const [lng,lat] = pixelsToPlane(point,2048,1024);
    const restored = planeToPixels({lng,lat},2048,1024);
    assert.ok(restored);
    assert.ok(Math.abs(restored.x-point.x)<0.011);
    assert.ok(Math.abs(restored.y-point.y)<0.011);
  }
  assert.equal(planeToPixels({lng:100,lat:100},2048,1024),null);
});
test("valid rectangular and irregular rooms pass validation", () => {
  const rect=[{x:2,y:2},{x:92,y:2},{x:92,y:58},{x:2,y:58}];
  const concave=[{x:2,y:2},{x:90,y:2},{x:90,y:40},{x:50,y:40},{x:50,y:85},{x:2,y:85}];
  assert.equal(polygonError(rect),null);
  assert.equal(polygonError(concave),null);
  assert.equal(polygonArea(rect),5040);
});
test("invalid room geometry is rejected", () => {
  assert.match(polygonError([{x:0,y:0},{x:100,y:100},{x:0,y:100},{x:100,y:0}]),/too narrow|crosses itself/i);
  assert.match(polygonError([{x:0,y:0},{x:5,y:5},{x:5,y:5},{x:0,y:10}]),/one image pixel/i);
  assert.match(polygonError([{x:0,y:0},{x:2,y:0}]),/at least three/i);
});
test("door endpoints and directions survive export", () => {
  const door={id:"d1",name:"East Door",usage:"both",start:{x:10,y:20},
    end:{x:10,y:55},spaceAId:"r1",spaceBId:null};
  assert.equal(segmentImageLength(door.start,door.end),35);
  assert.deepEqual(portalMidpoint(door),{x:10,y:37.5});
  const record={
    id:"active",planId:"p1",name:"Test",width:100,height:100,mimeType:"image/png",
    image:new Blob(["data"]),calibration:null,areas:[],portals:[door],markers:[],
    createdAt:"2026-10-31",updatedAt:"2026-10-31",
  };
  const exported=exportFloorPlanMetadata(record);
  assert.equal(exported.portals[0].imagePixelSpan,35);
  assert.deepEqual(exported.portals[0].startNormalized,{x:0.1,y:0.2});
  assert.equal(exported.portals[0].usage,"both");
  assert.equal(exported.image.includedInExport,false);
});

test("legacy projects preserve pixels and receive stable parent and floor IDs",()=>{
  const input={id:"active",planId:"old-1",name:"Map",width:500,height:400,mimeType:"image/png",
    image:new Blob(["image"]),calibration:null,createdAt:"2026-10-31",updatedAt:"2026-10-31",
    areas:[{id:"r",kind:"room",name:"Reception",points:[{x:20,y:10},{x:60,y:10},{x:60,y:50}]}],
    portals:[{id:"d",name:"Front Door",usage:"both",start:{x:20,y:10},end:{x:30,y:10},spaceAId:"r",spaceBId:null}],
    markers:[{id:"c",kind:"camera",name:"Camera",point:{x:40,y:20}}]};
  const mapped=ensureSpatialFoundation(input);
  assert.equal(mapped.hierarchy.floor.id,input.planId);
  assert.equal(mapped.hierarchy.building.siteId,mapped.hierarchy.site.id);
  assert.equal(mapped.hierarchy.floor.buildingId,mapped.hierarchy.building.id);
  assert.equal(mapped.areas[0].floorId,input.planId);
  assert.equal(mapped.portals[0].floorId,input.planId);
  assert.equal(mapped.markers[0].floorId,input.planId);
  assert.deepEqual(mapped.areas[0].points,input.areas[0].points);
  assert.deepEqual(mapped.portals[0].start,input.portals[0].start);
  assert.deepEqual(mapped.markers[0].point,input.markers[0].point);
  assert.equal(mapped.image,input.image);
  assert.deepEqual(ensureSpatialFoundation(mapped),mapped);
  assert.equal(spatialFoundationError(mapped),null);
  const exported=exportFloorPlanMetadata(mapped);
  assert.equal(exported.schemaVersion,4);
  assert.equal(exported.areas[0].floorId,input.planId);
});
test("floor parent/ownership validation rejects corrupt relationships",()=>{
  const base=ensureSpatialFoundation({id:"active",planId:"f1",name:"Map",width:100,height:100,mimeType:"image/png",
    image:new Blob(["a"]),calibration:null,areas:[],portals:[],markers:[],
    createdAt:"2026-11-02",updatedAt:"2026-11-02"});
  const hierarchy=base.hierarchy;
  assert.equal(spatialFoundationError({...base,hierarchy:{...hierarchy,floor:{...hierarchy.floor,name:"B1",level:-1}}}),null);
  assert.match(spatialFoundationError({...base,hierarchy:{...hierarchy,building:{...hierarchy.building,siteId:"wrong"}}}),/selected site/);
  assert.match(spatialFoundationError({...base,areas:[{id:"r1",floorId:"wrong",kind:"room",name:"R",points:[]}]}),/different floor/);
  assert.match(spatialFoundationError({...base,hierarchy:{...hierarchy,floor:{...hierarchy.floor,level:1.3}}}),/whole number/);
});

test("room and main doors handle entrance, exit, and bidirectional access",()=>{
  const areas=[
    {id:"hall",floorId:"floor",kind:"walkable",name:"Lobby",points:[]},
    {id:"office",floorId:"floor",kind:"room",name:"Office",points:[]},
  ];
  const door={id:"d",floorId:"floor",role:"room",usage:"entrance",name:"Office doorway",
    start:{x:10,y:10},end:{x:10,y:30},spaceAId:"hall",spaceBId:"office"};
  assert.equal(doorwaySetupError(door,areas),null);
  assert.equal(doorwaySetupError({...door,usage:"exit"},areas),null);
  assert.equal(doorwaySetupError({...door,usage:"both"},areas),null);
  assert.match(doorwaySetupError({...door,spaceBId:null},areas),/Side B/i);
  assert.match(doorwaySetupError({...door,spaceAId:"office"},areas),/different spaces/);
  assert.match(doorwaySetupError({...door,usage:"internal"},areas),/Choose Entrance/);
  const main={...door,role:"main",spaceAId:null,spaceBId:"hall"};
  assert.equal(doorwaySetupError(main,areas),null);
  assert.equal(doorwaySetupError({...main,usage:"exit"},areas),null);
  assert.equal(doorwaySetupError({...main,usage:"both"},areas),null);
  assert.match(doorwaySetupError({...main,spaceAId:"office"},areas),/Outside/);
  assert.match(doorwaySetupError({...main,spaceBId:"invalid"},areas),/inside lobby/);
  assert.equal(doorwaySetupError({...door,role:undefined,usage:"internal",spaceBId:null},areas),null);
});

test("recommended door model keeps purpose distinct from allowed direction",()=>{
  const areas=[
    {id:"hall",floorId:"f1",kind:"walkable",name:"Hall",points:[]},
    {id:"room",floorId:"f1",kind:"room",name:"Meeting room",points:[]},
  ];
  const base={id:"d1",floorId:"f1",name:"Meeting room door",purpose:"interior",reviewed:true,
    usage:"both",start:{x:20,y:20},end:{x:20,y:32},spaceAId:"hall",spaceBId:"room"};
  assert.equal(doorwaySetupError(base,areas),null);
  assert.deepEqual(doorwayReviewIssues(base,areas),[]);
  for(const usage of ["entrance","exit","both"]) {
    assert.equal(doorwaySetupError({...base,usage},areas),null);
    assert.deepEqual(doorwayReviewIssues({...base,usage},areas),[]);
  }
  // Incomplete geometry relationships may be saved as drafts, not marked as reviewed.
  assert.equal(doorwaySetupError({...base,spaceBId:null},areas),null);
  assert.match(doorwayReviewIssues({...base,spaceBId:null},areas).join(" "),/Side B/);
  assert.match(doorwayReviewIssues({...base,reviewed:false},areas).join(" "),/Confirm/);
  assert.match(doorwayReviewIssues({...base,spaceAId:null},areas).join(" "),/Side A/);
  assert.match(doorwaySetupError({...base,spaceAId:"room"},areas),/different spaces/);
  assert.match(doorwaySetupError({...base,spaceAId:"missing"},areas),/missing space/);
  const exterior={...base,purpose:"building",spaceAId:null,spaceBId:"hall"};
  assert.deepEqual(doorwayReviewIssues(exterior,areas),[]);
  assert.match(doorwaySetupError({...exterior,spaceAId:"room"},areas),/Outside/);
  const emergency={...exterior,purpose:"emergency",usage:"exit"};
  assert.deepEqual(doorwayReviewIssues(emergency,areas),[]);
  assert.match(doorwaySetupError({...emergency,usage:"entrance"},areas),/permit exit/);
  assert.equal(doorwaySetupError({...emergency,usage:"both"},areas),null);
  assert.equal(displayDoorPurpose({...base,purpose:undefined,role:"room"}),"interior");
  assert.equal(displayDoorPurpose({...base,purpose:undefined,role:"main"}),"building");
  assert.equal(displayDoorPurpose({...base,purpose:undefined,role:undefined}),null);
  assert.match(doorwayReviewIssues({...base,purpose:undefined,role:"main"},areas).join(" "),/purpose/);
});

test("drawing a wall opening suggests different polygons on each side",()=>{
  const top={id:"top",floorId:"floor",kind:"room",name:"Upper",points:[
    {x:0,y:0},{x:100,y:0},{x:100,y:50},{x:0,y:50}]};
  const bottom={id:"bottom",floorId:"floor",kind:"walkable",name:"Hall",points:[
    {x:0,y:50},{x:100,y:50},{x:100,y:100},{x:0,y:100}]};
  const start={x:40,y:50},end={x:60,y:50};
  const both=suggestDoorwaySides(start,end,[top,bottom]);
  assert.equal(both.status,"two-spaces");
  assert.equal(both.sideAId,"bottom");
  assert.equal(both.sideBId,"top");
  const reversed=suggestDoorwaySides(end,start,[top,bottom]);
  assert.equal(reversed.status,"two-spaces");
  assert.equal(reversed.sideAId,"top");
  assert.equal(reversed.sideBId,"bottom");
  const one=suggestDoorwaySides(start,end,[top]);
  assert.deepEqual(one,{status:"one-space",sideAId:null,sideBId:"top"});
  const none=suggestDoorwaySides(start,end,[]);
  assert.equal(none.status,"none");
  const overlap=suggestDoorwaySides(start,end,[top,bottom,{...top,id:"overlap"}]);
  assert.equal(overlap.status,"ambiguous");
  assert.equal(suggestDoorwaySides(start,{x:41,y:50},[top,bottom]).status,"none");
});

test("room label anchors stay inside rectangular and concave polygons",()=>{
  const inside=(point,polygon)=>{
    let state=false;
    for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
      const a=polygon[i],b=polygon[j];
      if((a.y>point.y)!==(b.y>point.y)&&
        point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x)state=!state;
    }
    return state;
  };
  const rectangle=[{x:10,y:20},{x:110,y:20},{x:110,y:80},{x:10,y:80}];
  const rectLabel=areaLabelPoint(rectangle);
  assert.ok(inside(rectLabel,rectangle));
  assert.ok(Math.abs(rectLabel.x-60)<15&&Math.abs(rectLabel.y-50)<15);
  // Bounding box center (50,50) is outside this L-shaped room.
  const concave=[{x:0,y:0},{x:80,y:0},{x:80,y:20},{x:20,y:20},
    {x:20,y:80},{x:0,y:80}];
  const label=areaLabelPoint(concave);
  assert.ok(inside(label,concave));
  assert.ok(label.x<25||label.y<25);
  const hallway=[{x:0,y:0},{x:200,y:0},{x:200,y:15},{x:0,y:15}];
  assert.ok(inside(areaLabelPoint(hallway),hallway));
  assert.deepEqual(areaLabelPoint([]),{x:0,y:0});
});

test("doorway rectangle has four corners while canonical endpoints remain unchanged",()=>{
  const start={x:20,y:50},end={x:80,y:50};
  const polygon=doorwayRectangle(start,end,20);
  assert.equal(polygon.length,4);
  assert.deepEqual(polygon,[
    {x:20,y:60},{x:80,y:60},{x:80,y:40},{x:20,y:40},
  ]);
  assert.deepEqual(start,{x:20,y:50});
  assert.deepEqual(end,{x:80,y:50});
  const vertical=doorwayRectangle({x:60,y:10},{x:60,y:50},12);
  assert.equal(vertical.length,4);
  assert.ok(vertical[0].x<vertical[3].x);
  assert.deepEqual(doorwayRectangle(start,start,10),[]);
});

test("one click near drawn wall automatically aligns a door to that wall",()=>{
  const room={id:"room",floorId:"f",kind:"room",name:"Dining",points:[
    {x:10,y:10},{x:210,y:10},{x:210,y:110},{x:10,y:110},
  ]};
  const result=proposeDoorwayPlacement({x:120,y:113},[room],60,16);
  assert.equal(result.aligned,true);
  assert.ok(Math.abs(result.start.y-110)<0.001);
  assert.ok(Math.abs(result.end.y-110)<0.001);
  assert.equal(Math.round(Math.hypot(
    result.end.x-result.start.x,result.end.y-result.start.y)),60);
  const left=proposeDoorwayPlacement({x:12,y:55},[room],40,16);
  assert.equal(left.aligned,true);
  assert.ok(Math.abs(left.start.x-10)<0.001);
  assert.ok(Math.abs(left.end.x-10)<0.001);
});

test("one-click placement stays inside wall segment and falls back gracefully",()=>{
  const tiny={id:"room",floorId:"f",kind:"room",name:"Small",points:[
    {x:0,y:0},{x:28,y:0},{x:28,y:60},{x:0,y:60},
  ]};
  const corner=proposeDoorwayPlacement({x:1,y:1},[tiny],90,12);
  assert.equal(corner.aligned,true);
  assert.ok(Math.hypot(corner.end.x-corner.start.x,corner.end.y-corner.start.y)<=61);
  const free=proposeDoorwayPlacement({x:600,y:600},[tiny],40,10);
  assert.equal(free.aligned,false);
  assert.deepEqual(free,{start:{x:580,y:600},end:{x:620,y:600},aligned:false});
});

test("door thickness handle is offset from rectangle and can be dragged in 1-pixel steps",()=>{
  const start={x:10,y:30},end={x:110,y:30};
  const clearance=20;
  const handle=doorwayThicknessHandle(start,end,14,clearance);
  assert.deepEqual(handle,{x:60,y:57});
  assert.equal(doorwayThicknessFromPointer(start,end,handle,clearance),14);
  // In a centered rectangle a half-pixel movement of one edge changes total thickness by one pixel.
  assert.equal(doorwayThicknessFromPointer(start,end,{...handle,y:57.5},clearance),15);
  assert.equal(doorwayThicknessFromPointer(start,end,{...handle,y:58},clearance),16);
  assert.equal(doorwayThicknessFromPointer(start,end,{...handle,y:56.5},clearance),13);
  assert.equal(doorwayThicknessFromPointer(start,end,{...handle,y:-100},clearance),6);
  assert.equal(doorwayThicknessFromPointer(start,end,{...handle,y:400},clearance),48);
  const verticalStart={x:50,y:10},verticalEnd={x:50,y:70};
  const verticalHandle=doorwayThicknessHandle(verticalStart,verticalEnd,25,12);
  assert.equal(doorwayThicknessFromPointer(verticalStart,verticalEnd,verticalHandle,12),25);
  assert.equal(doorwayThicknessHandle(start,start,20,12),null);
});

test("a legacy saved floor and a new floor can share building IDs without geometry drift",()=>{
  const old={
    id:"active",planId:"legacy-plan",name:"Ground floor",width:1200,height:900,
    mimeType:"image/png",image:new Blob(["original image"]),calibration:null,
    areas:[{id:"room-A",kind:"room",name:"Dining Room",points:[
      {x:100,y:100},{x:250,y:100},{x:250,y:200},{x:100,y:200}]}],
    portals:[],markers:[],createdAt:"2026-10-01",updatedAt:"2026-11-02",
  };
  const ground=ensureSpatialFoundation(old);
  const sibling=ensureSpatialFoundation({
    id:"floor-upper",planId:"upper",name:"Second floor",width:800,height:600,
    mimeType:"image/png",image:new Blob(["second image"]),calibration:null,
    hierarchy:{
      site:{...ground.hierarchy.site},
      building:{...ground.hierarchy.building},
      floor:{id:"upper",buildingId:ground.hierarchy.building.id,name:"Second Floor",level:2},
    },
    areas:[{id:"room-B",floorId:"upper",kind:"room",name:"Upper Room",points:[
      {x:20,y:30},{x:140,y:30},{x:140,y:100},{x:20,y:100}]}],
    portals:[],markers:[],createdAt:"2026-11-02",updatedAt:"2026-11-02",
  });
  assert.equal(ground.id,"active");
  assert.equal(sibling.id,"floor-upper");
  assert.equal(ground.hierarchy.building.id,sibling.hierarchy.building.id);
  assert.equal(ground.hierarchy.floor.id,"legacy-plan");
  assert.equal(sibling.hierarchy.floor.id,"upper");
  assert.equal(sibling.areas[0].floorId,"upper");
  assert.equal(spatialFoundationError(ground),null);
  assert.equal(spatialFoundationError(sibling),null);
  assert.deepEqual(ground.areas[0].points,old.areas[0].points);
  assert.equal(ground.image,old.image);
  assert.equal(exportFloorPlanMetadata(sibling).hierarchy.floor.name,"Second Floor");
  assert.match(spatialFoundationError({...sibling,areas:[
    {...sibling.areas[0],floorId:"legacy-plan"}]}),/different floor/);
});
