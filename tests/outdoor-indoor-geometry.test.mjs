import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import ts from "typescript";

const transpile=(path)=>ts.transpileModule(
  readFileSync(new URL(path,import.meta.url),"utf8"),{
    compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022},
  }).outputText;
const asModule=(source)=>"data:text/javascript;base64,"+Buffer.from(source).toString("base64");
const floorPlacementSource=asModule(transpile("../src/lib/outdoor-floor-placement.ts"));
const cameraGeometrySource=asModule(transpile("../src/lib/device-spatial.ts"));
const geometrySource=transpile("../src/lib/outdoor-indoor-geometry.ts")
  .replace('from "@/lib/outdoor-floor-placement"',`from "${floorPlacementSource}"`)
  .replace('from "@/lib/device-spatial"',`from "${cameraGeometrySource}"`);
const {outdoorIndoorFeatures,indoorPointToLngLat,doorwayOverlayCorners,
  inspectOutdoorIndoorFeature}=
  await import(asModule(geometrySource));
const {
  defaultFloorPlacement,floorImageCorners,
  resizeFloorFromCorner,rotateFloorFromHandle,floorRotationHandle,skewFloorFromHandle,
}=
  await import(floorPlacementSource);

const makeFloor=()=>({
  floorId:"floor-a",name:"Ground floor",
  imageWidth:1000,imageHeight:500,
  placement:{...defaultFloorPlacement(121,14),widthMeters:100,heightMeters:50,
    rotationDegrees:27,skewXDegrees:12,skewYDegrees:-5},
  areas:[
    {id:"room-1",floorId:"floor-a",kind:"room",name:"Lobby",points:[
      {x:0,y:0},{x:300,y:0},{x:300,y:200},{x:0,y:200},
    ]},
    {id:"walk-1",floorId:"floor-a",kind:"walkable",name:"Hallway",points:[
      {x:0,y:220},{x:800,y:220},{x:800,y:280},{x:0,y:280},
    ]},
  ],
  portals:[{id:"door-1",floorId:"floor-a",name:"Lobby door",usage:"both",
    start:{x:100,y:200},end:{x:160,y:200},displayDepthPx:12,
    spaceAId:"room-1",spaceBId:"walk-1"}],
  markers:[{id:"camera-1",floorId:"floor-a",kind:"camera",name:"Lobby camera",
    point:{x:80,y:70}}],
  landings:[{id:"stair-1",kind:"staircase",name:"Stair A",outline:[
    {x:850,y:150},{x:950,y:150},{x:950,y:260},{x:850,y:260},
  ]},{id:"lift-1",kind:"elevator",name:"Elevator",outline:[
    {x:850,y:300},{x:950,y:300},{x:950,y:400},{x:850,y:400},
  ]}],
});

test("indoor feature projector aligns all image corners including rotated and skewed group",()=>{
  const f=makeFloor(),corners=floorImageCorners(f.placement,f.imageWidth,f.imageHeight);
  const points=[{x:0,y:0},{x:f.imageWidth,y:0},{x:f.imageWidth,y:f.imageHeight},
    {x:0,y:f.imageHeight}];
  for(let i=0;i<4;i++){
    const p=indoorPointToLngLat(points[i],f.placement,f.imageWidth,f.imageHeight);
    assert.ok(Math.abs(p[0]-corners[i][0])<1e-10);
    assert.ok(Math.abs(p[1]-corners[i][1])<1e-10);
  }
});

test("all saved annotation types are visible in one group and use shared placement",()=>{
  const f=makeFloor(),before=structuredClone(f);
  const collection=outdoorIndoorFeatures(f);
  assert.equal(collection.type,"FeatureCollection");
  for(const cat of ["room","walkable","doorway","staircase","elevator","camera",
    "area-label","doorway-label","vertical-label"]){
    assert.ok(collection.features.some(v=>v.properties.category===cat),cat);
  }
  const room=collection.features.find(v=>v.properties.category==="room");
  assert.equal(room.geometry.type,"Polygon");
  assert.deepEqual(room.geometry.coordinates[0][0],
    indoorPointToLngLat(f.areas[0].points[0],f.placement,1000,500));
  assert.equal(collection.features.find(v=>v.properties.category==="camera")
    .geometry.type,"Point");
  assert.deepEqual(f,before,"projecting must not mutate source geometry");
});

test("rotating, resizing, skewing and moving always transform whole group together",()=>{
  const f=makeFloor();
  const base=outdoorIndoorFeatures(f);
  const modified={...f,placement:{...f.placement,
    longitude:121.005,latitude:14.003,widthMeters:200,heightMeters:80,
    rotationDegrees:-40,skewXDegrees:-20,skewYDegrees:15}};
  const transformed=outdoorIndoorFeatures(modified);
  assert.equal(base.features.length,transformed.features.length);
  assert.notDeepEqual(base.features[0].geometry,transformed.features[0].geometry);
  assert.notDeepEqual(base.features.at(-1).geometry,transformed.features.at(-1).geometry);
  assert.deepEqual(modified.areas,f.areas);
  assert.deepEqual(modified.landings,f.landings);
});

test("doorway visual quadrilateral follows original saved endpoint coordinates",()=>{
  const points=doorwayOverlayCorners({x:0,y:0},{x:20,y:0},10);
  assert.deepEqual(points,[{x:0,y:5},{x:20,y:5},{x:20,y:-5},{x:0,y:-5}]);
});

test("outdoor studio always renders selected indoor shapes, independently of picture checkbox",()=>{
  const workspace=readFileSync(new URL("../src/components/map/map-workspace.tsx",import.meta.url),"utf8");
  const canvas=readFileSync(new URL("../src/components/map/map-canvas.tsx",import.meta.url),"utf8");
  assert.match(workspace,/f.id===placementFloorId\|\|visibleFloorIds\.includes\(f\.id\)/);
  assert.match(workspace,/showImage:visibleFloorIds\.includes\(f\.id\)/);
  assert.match(workspace,/areas:f\.areas\?\?\[\],portals:f\.portals\?\?\[\],markers:f\.markers\?\?\[\]/);
  assert.match(workspace,/landingOnFloor\(stair,id\)/);
  assert.match(canvas,/map\.addSource\(source,\{type:"geojson",data:outdoorIndoorFeatures\(preview\)\}\)/);
  assert.match(canvas,/if\(preview\.showImage\)/);
  assert.match(canvas,/map\.queryRenderedFeatures\(event\.point/);
  assert.match(canvas,/onPlacementTransformRef\.current\(\{\.\.\.drag\.placement/);
  assert.match(workspace,/Apply indoor group placement/);
});

test("resize and rotation handle gestures update floor previews during drag, not only on release",()=>{
  const canvas=readFileSync(new URL("../src/components/map/map-canvas.tsx",import.meta.url),"utf8");
  assert.match(canvas,/corner\.on\("dragstart"/);
  assert.match(canvas,/corner\.on\("drag",\(\)=>\{/);
  assert.match(canvas,/corner\.on\("dragend"/);
  assert.match(canvas,/rotate\.on\("dragstart"/);
  assert.match(canvas,/rotate\.on\("drag",\(\)=>\{/);
  assert.match(canvas,/rotate\.on\("dragend"/);
  assert.match(canvas,/centre\.on\("drag",\(\)=>\{/);
  assert.match(canvas,/requestAnimationFrame\(\(\)=>\{/);
  assert.match(canvas,/cancelAnimationFrame\(frame\)/);
  assert.match(canvas,/preview\(resized\(\)\)/);
  assert.match(canvas,/preview\(rotated\(\)\)/);
  assert.match(canvas,/vectorSource\.setData\(outdoorIndoorFeatures\(\{\.\.\.current,placement:next\}\)\)/);
  assert.match(canvas,/imageSource\.setCoordinates\(/);
  assert.match(canvas,/if\(dragging\?\.kind==="corner"&&dragging\.index===index\)return/);
  assert.match(canvas,/if\(dragging\?\.kind!=="rotation"\)/);
  assert.match(canvas,/onPlacementTransformRef\.current\(next\)/);
});

test("intermediate pointer movements transform indoor shapes continuously from the drag baseline",()=>{
  const floor=makeFloor(),original=structuredClone(floor);
   const p=floor.placement;
  const corner=floorImageCorners(p,floor.imageWidth,floor.imageHeight)[2];
  const to=(factor)=>[
    p.longitude+(corner[0]-p.longitude)*factor,
    p.latitude+(corner[1]-p.latitude)*factor,
  ];
  const early=resizeFloorFromCorner(p,floor.imageWidth,floor.imageHeight,2,to(1.3),true);
  const late=resizeFloorFromCorner(p,floor.imageWidth,floor.imageHeight,2,to(1.8),true);
  assert.ok(late.widthMeters>early.widthMeters);
  const earlyFeatures=outdoorIndoorFeatures({...floor,placement:early});
  const lateFeatures=outdoorIndoorFeatures({...floor,placement:late});
  assert.notDeepEqual(earlyFeatures.features[0].geometry,lateFeatures.features[0].geometry);
  const from=floorRotationHandle(p,floor.imageWidth,floor.imageHeight);
  const around=(radians)=>{
    const dx=from[0]-p.longitude,dy=from[1]-p.latitude;
    return [p.longitude+dx*Math.cos(radians)+dy*Math.sin(radians),
      p.latitude-dx*Math.sin(radians)+dy*Math.cos(radians)];
  };
  const turn1=rotateFloorFromHandle(p,from,around(Math.PI/12));
  const turn2=rotateFloorFromHandle(p,from,around(Math.PI/6));
  assert.notEqual(turn1.rotationDegrees,turn2.rotationDegrees);
  assert.notDeepEqual(outdoorIndoorFeatures({...floor,placement:turn1}).features[0].geometry,
    outdoorIndoorFeatures({...floor,placement:turn2}).features[0].geometry);
  assert.deepEqual(floor,original,"draft transforms must never rewrite indoor pixel geometry");
});

test("individual corner warp preserves floor-plan and indoor vector corner alignment",()=>{
  const f=makeFloor();
  const before=structuredClone(f);
  const corner=floorImageCorners(f.placement,f.imageWidth,f.imageHeight)[0];
  const changed=skewFloorFromHandle(f.placement,f.imageWidth,f.imageHeight,0,[
    corner[0]+3/(111320*Math.cos(f.placement.latitude*Math.PI/180)),
    corner[1]+2/111320,
  ]);
  const warped={...f,placement:changed};
  const warpedCorners=floorImageCorners(changed,f.imageWidth,f.imageHeight);
  for(const [index,point] of [
    {x:0,y:0},{x:f.imageWidth,y:0},
    {x:f.imageWidth,y:f.imageHeight},{x:0,y:f.imageHeight},
  ].entries()){
    const projected=indoorPointToLngLat(point,changed,f.imageWidth,f.imageHeight);
    assert.ok(Math.abs(projected[0]-warpedCorners[index][0])<1e-10);
    assert.ok(Math.abs(projected[1]-warpedCorners[index][1])<1e-10);
  }
  const original=outdoorIndoorFeatures(f);
  const updated=outdoorIndoorFeatures(warped);
  assert.notDeepEqual(original.features[0].geometry,updated.features[0].geometry);
  assert.notDeepEqual(original.features.at(-1).geometry,updated.features.at(-1).geometry);
  assert.deepEqual(f,before,"original saved indoor drawing remains unchanged");
});

test("inspection reads each supported indoor polygon and the exact clicked WGS84 position",()=>{
  const floor=makeFloor();
  const features=outdoorIndoorFeatures(floor).features;
  const visible=["floor-a"];
  const position=[121.000123456,14.599876543];
  const kinds=["room","walkable","doorway","staircase","elevator"];
  for(const category of kinds){
    const feature=features.find(f=>f.properties.category===category);
    assert.ok(feature,`missing test feature for ${category}`);
    const click=inspectOutdoorIndoorFeature([feature],visible,...position);
    assert.deepEqual(click,{
      floorId:"floor-a",featureId:feature.properties.id,category,
      name:feature.properties.name,longitude:position[0],latitude:position[1],
    });
  }
  const cinema={properties:{floorId:"floor-a",id:"room-cinema",
    category:"room",name:"Cinema"}};
  const chosen=inspectOutdoorIndoorFeature([cinema],visible,...position);
  assert.equal(chosen.name,"Cinema");
  assert.equal(chosen.longitude.toFixed(6),"121.000123");
  assert.equal(chosen.latitude.toFixed(6),"14.599877");
});

test("inspection ignores labels, hidden floors, unrelated map features and invalid coordinates",()=>{
  const clicked={properties:{floorId:"floor-a",category:"room",id:"one",name:"Cinema"}};
  const label={properties:{floorId:"floor-a",category:"area-label",id:"one",name:"Cinema"}};
  assert.equal(inspectOutdoorIndoorFeature([clicked],["floor-b"],121,14),null);
  assert.equal(inspectOutdoorIndoorFeature([label],["floor-a"],121,14),null);
  assert.equal(inspectOutdoorIndoorFeature([{properties:{category:"room"}},label],
    ["floor-a"],121,14),null);
  assert.equal(inspectOutdoorIndoorFeature([clicked],["floor-a"],Infinity,14),null);
  assert.equal(inspectOutdoorIndoorFeature([clicked],["floor-a"],121,NaN),null);
  assert.equal(inspectOutdoorIndoorFeature([clicked],["floor-a"],181,14),null);
  assert.equal(inspectOutdoorIndoorFeature([{properties:null},label,clicked],
    ["floor-a"],121,14)?.name,"Cinema");
  assert.equal(inspectOutdoorIndoorFeature([
    {properties:{floorId:"floor-a",category:"walkable",id:"p",name:""}},
  ],["floor-a"],121,14)?.name,"Walkable area");
});

test("after Apply the selected floor locks and only explicit Edit reveals transform tools",()=>{
  const work=readFileSync(new URL("../src/components/map/map-workspace.tsx",import.meta.url),"utf8");
  const canvas=readFileSync(new URL("../src/components/map/map-canvas.tsx",import.meta.url),"utf8");
  assert.match(work,/editingPlacedFloorId,setEditingPlacedFloorId/);
  assert.match(work,/!placementFloor\.outdoorPlacement\|\|editingPlacedFloorId===placementFloor\.id/);
  assert.match(work,/setEditingPlacedFloorId\(null\);\s*setFeedback\(\{type:"success",message:/);
  assert.match(work,/onClick=\{startEditingPlacement\}><Pencil\/> Edit placement/);
  assert.match(work,/onClick=\{cancelEditingPlacement\}>Cancel editing/);
  assert.match(work,/\{placementUnlocked&&<>/);
  assert.match(work,/editableFloorId=\{placementUnlocked\?placementFloorId:null\}/);
  assert.match(canvas,/const current=activeFloorRef\.current;\s*if\(!map\|\|!current\)return/);
  assert.match(canvas,/const selected=shown\.find\(preview=>preview\.floorId===editableFloorId\)/);
  assert.match(canvas,/if\(!floor\)return/);
});

test("locked feature click opens a bottom-right coordinates card and never triggers placement",()=>{
  const canvas=readFileSync(new URL("../src/components/map/map-canvas.tsx",import.meta.url),"utf8");
  assert.match(canvas,/if\(placingFloorRef\.current\)\{/);
  assert.match(canvas,/if\(pickOnMapRef\.current\)\{/);
  assert.match(canvas,/if\(editableFloorIdRef\.current!==null\)return/);
  assert.match(canvas,/map\.queryRenderedFeatures\(event\.point,\{layers\}\)/);
  assert.match(canvas,/setInspectedFeature\(inspectOutdoorIndoorFeature\(/);
  assert.match(canvas,/bottom-14 right-4/);
  assert.match(canvas,/You are clicking <strong>/);
  assert.match(canvas,/inspectedFeature\.longitude\.toFixed\(6\)/);
  assert.match(canvas,/inspectedFeature\.latitude\.toFixed\(6\)/);
  assert.match(canvas,/Close indoor inspection/);
});


test("device camera coverage projects with the same resized outdoor floor and excludes push buttons",()=>{
  const floor=makeFloor();
  const camera={shape:"circle",radiusPx:45,widePx:100,widthPx:80,rotationDegrees:0};
  floor.devices=[
    {uuid:"cam-a",locationId:"loc",floorId:floor.floorId,type:"shield",
      name:"Shield 01",point:{x:100,y:120},sizePx:48,camera},
    {uuid:"button-a",locationId:"loc",floorId:floor.floorId,type:"p-button",
      name:"Push button",point:{x:260,y:120},sizePx:48,camera:null},
  ];
  const before=structuredClone(floor.devices);
  const projected=outdoorIndoorFeatures(floor);
  const coverage=projected.features.filter(feature=>feature.properties.category==="camera-fov");
  assert.equal(coverage.length,1,"only the shield generates a camera polygon");
  assert.equal(coverage[0].properties.id,"cam-a");
  assert.deepEqual(coverage[0].geometry.coordinates[0][0],
    indoorPointToLngLat({x:145,y:120},floor.placement,1000,500));
  assert.deepEqual(floor.devices,before,"projection must not mutate device records");
  const enlarged=outdoorIndoorFeatures({...floor,placement:{
    ...floor.placement,widthMeters:180,heightMeters:90,rotationDegrees:-20,
  }});
  const far=enlarged.features.find(feature=>feature.properties.id==="cam-a");
  assert.notDeepEqual(far.geometry.coordinates[0][0],coverage[0].geometry.coordinates[0][0],
    "camera coverage follows the group's rotation and resize");
});
