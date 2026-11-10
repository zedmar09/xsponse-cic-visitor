import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const spatialSource=readFileSync(new URL("../src/lib/device-spatial.ts",import.meta.url),"utf8");
const options={compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}};
const spatialCode=ts.transpileModule(spatialSource,options).outputText;
const spatialUrl="data:text/javascript;base64,"+Buffer.from(spatialCode).toString("base64");
const { identifyDeviceSpaces,cameraCoveragePolygon,pointWithinPolygon }=await import(spatialUrl);
const source=readFileSync(new URL("../src/lib/location-devices.ts",import.meta.url),"utf8");
const js=ts.transpileModule(source,options).outputText
  .replaceAll('"@/lib/device-spatial"',JSON.stringify(spatialUrl));
const url="data:text/javascript;base64,"+Buffer.from(js).toString("base64");
const {
  DEVICE_MODELS,ensureLocationDevices,placeLocationDevice,
  unplaceLocationDevice,deleteLocationDevices,updateLocationDevice,
  stageDevicePlacement,stageDeviceConfiguration,stageDeviceUnplacement,
  saveDevicePlacement,deviceChangesPending,
}=await import(url);

function memoryStorage(){
  const data=new Map();
  return {
    getItem(key){return data.has(key)?data.get(key):null;},
    setItem(key,value){data.set(key,String(value));},
  };
}

test("every location receives stable, unique device instances for all four SVG models",()=>{
  globalThis.window={localStorage:memoryStorage()};
  const first=ensureLocationDevices("location-1");
  const repeat=ensureLocationDevices("location-1");
  assert.deepEqual(repeat,first,"reopening must not regenerate UUIDs or quantities");
  assert.equal(new Set(first.map(device=>device.uuid)).size,first.length);
  assert.equal(DEVICE_MODELS.length,4);
  for(const model of DEVICE_MODELS){
    const devices=first.filter(device=>device.type===model.type);
    assert.ok(devices.length>=3&&devices.length<=10);
    assert.ok(model.icon.endsWith(".svg"));
    assert.ok(devices.every(device=>device.locationId==="location-1"&&
      device.floorId===null&&device.point===null));
  }
  const second=ensureLocationDevices("location-2");
  assert.ok(second.every(device=>device.locationId==="location-2"));
  assert.ok(second.every(device=>!first.some(existing=>existing.uuid===device.uuid)));
  deleteLocationDevices("location-2");
  assert.deepEqual(ensureLocationDevices("location-1"),first);
});

test("devices can be placed, moved between floors and returned to the same location inventory",()=>{
  globalThis.window={localStorage:memoryStorage()};
  const original=ensureLocationDevices("loc-a");
  const device=original[0];
  const placed=placeLocationDevice("loc-a",device.uuid,"floor-a",{x:54,y:89});
  assert.deepEqual(placed.find(d=>d.uuid===device.uuid)?.point,{x:54,y:89});
  assert.equal(placed.find(d=>d.uuid===device.uuid)?.floorId,"floor-a");
  const moved=placeLocationDevice("loc-a",device.uuid,"floor-b",{x:13,y:40});
  assert.equal(moved.find(d=>d.uuid===device.uuid)?.floorId,"floor-b");
  assert.equal(moved.filter(d=>d.uuid===device.uuid).length,1);
  assert.equal(ensureLocationDevices("loc-a").length,original.length);
  assert.throws(()=>placeLocationDevice("loc-other",device.uuid,"floor-a",{x:1,y:2}));
  assert.throws(()=>placeLocationDevice("loc-a",device.uuid,"floor-a",{x:NaN,y:2}));
  const unplaced=unplaceLocationDevice("loc-a",device.uuid);
  assert.equal(unplaced.find(d=>d.uuid===device.uuid)?.floorId,null);
  assert.equal(unplaced.find(d=>d.uuid===device.uuid)?.point,null);
});


test("camera models support circle/cone settings, but push button never has a camera",()=>{
  globalThis.window={localStorage:memoryStorage()};
  const items=ensureLocationDevices("camera-location");
  assert.ok(items.filter(d=>d.type==="p-button").every(d=>d.camera===null));
  assert.ok(items.filter(d=>d.type!=="p-button").every(d=>d.camera?.shape==="cone"));
  assert.ok(items.every(d=>d.sizePx===24));
  const shield=items.find(d=>d.type==="shield");
  const updated=updateLocationDevice("camera-location",shield.uuid,{
    sizePx:88,camera:{shape:"circle",radiusPx:180,widePx:130,widthPx:75,rotationDegrees:30},
  });
  assert.equal(updated.find(d=>d.uuid===shield.uuid)?.sizePx,88);
  assert.equal(ensureLocationDevices("camera-location").find(d=>d.uuid===shield.uuid)?.camera?.radiusPx,180);
  assert.throws(()=>updateLocationDevice("camera-location",shield.uuid,{sizePx:200}));
  assert.throws(()=>updateLocationDevice("camera-location",shield.uuid,{
    camera:{shape:"cone",radiusPx:80,widePx:0,widthPx:60,rotationDegrees:0},
  }));
  const push=items.find(d=>d.type==="p-button");
  const pushConfig=updateLocationDevice("camera-location",push.uuid,{
    camera:{shape:"circle",radiusPx:90,widePx:100,widthPx:90,rotationDegrees:0},
  });
  assert.equal(pushConfig.find(d=>d.uuid===push.uuid)?.camera,null);
});

test("spatial assignment detects overlapping room, walkway, doorway and facilities",()=>{
  const box=(id,kind,x0,y0,x1,y1)=>({id,name:id,kind,points:[
    {x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1},
  ]});
  const areas=[box("R-1","room",10,10,100,100),box("W-1","walkable",50,50,150,150)];
  const door={id:"D-1",name:"Main door",start:{x:70,y:0},end:{x:70,y:30},displayDepthPx:14};
  const landings=[{id:"S-1",name:"Stairs",kind:"staircase",outline:box("S","room",15,15,45,45).points}];
  const hit=identifyDeviceSpaces({x:70,y:65},areas,[door],landings);
  assert.deepEqual(hit.map(x=>x.category),["room","walkable"]);
  const doorHit=identifyDeviceSpaces({x:71,y:16},areas,[door],landings);
  assert.ok(doorHit.some(x=>x.category==="doorway"));
  assert.ok(identifyDeviceSpaces({x:25,y:25},areas,[door],landings)
    .some(x=>x.category==="staircase"));
  assert.deepEqual(identifyDeviceSpaces({x:500,y:500},areas,[door],landings),[]);
  assert.equal(pointWithinPolygon({x:10,y:10},areas[0].points),true);
});

test("circle and cone FOV geometry matches requested dimensions and orientation",()=>{
  const origin={x:100,y:100};
  const circle=cameraCoveragePolygon(origin,{shape:"circle",radiusPx:50,
    widePx:100,widthPx:60,rotationDegrees:0});
  assert.equal(circle.length,48);
  assert.ok(circle.every(p=>Math.abs(Math.hypot(p.x-100,p.y-100)-50)<.0001));
  const cone=cameraCoveragePolygon(origin,{shape:"cone",radiusPx:50,
    widePx:100,widthPx:60,rotationDegrees:0});
  assert.deepEqual(cone,[origin,{x:70,y:0},{x:130,y:0}]);
  const rotated=cameraCoveragePolygon(origin,{shape:"cone",radiusPx:50,
    widePx:100,widthPx:60,rotationDegrees:90});
  assert.ok(rotated[1].x>origin.x&&rotated[2].x>origin.x);
});


test("placements and FOV adjustments are drafts until Save; Cancel restores saved state",()=>{
  globalThis.window={localStorage:memoryStorage()};
  const saved=ensureLocationDevices("staged-location");
  const camera=saved.find(device=>device.type==="shield");
  const initial=saved.find(device=>device.uuid===camera.uuid);
  let draft=stageDevicePlacement(saved,"staged-location",camera.uuid,"floor-a",{x:150,y:250});
  draft=stageDeviceConfiguration(draft,"staged-location",camera.uuid,{
    sizePx:32,camera:{...camera.camera,shape:"cone",rotationDegrees:120},
  });
  assert.equal(deviceChangesPending(draft,saved),true);
  assert.equal(draft.find(device=>device.uuid===camera.uuid).camera.rotationDegrees,120);
  assert.deepEqual(saved.find(device=>device.uuid===camera.uuid),initial,
    "staged edits must not mutate the saved snapshot");
  assert.deepEqual(ensureLocationDevices("staged-location"),saved,
    "the street map must see the original inventory before save");

  // Cancel discards the draft without writing it to localStorage.
  draft=ensureLocationDevices("staged-location");
  assert.deepEqual(draft,saved);
  assert.equal(deviceChangesPending(draft,saved),false);

  // Save publishes all staged edits as one location-level snapshot.
  draft=stageDevicePlacement(saved,"staged-location",camera.uuid,"floor-a",{x:40,y:45});
  draft=stageDeviceConfiguration(draft,"staged-location",camera.uuid,{
    camera:{...camera.camera,rotationDegrees:-95},
  });
  const committed=saveDevicePlacement("staged-location",draft);
  assert.deepEqual(ensureLocationDevices("staged-location"),committed);
  assert.equal(committed.find(d=>d.uuid===camera.uuid).point.x,40);
  assert.equal(committed.find(d=>d.uuid===camera.uuid).camera.rotationDegrees,-95);
  assert.equal(deviceChangesPending(committed,committed),false);

  draft=stageDeviceUnplacement(committed,"staged-location",camera.uuid);
  assert.equal(draft.find(d=>d.uuid===camera.uuid).floorId,null);
  assert.ok(ensureLocationDevices("staged-location")
    .find(d=>d.uuid===camera.uuid).floorId==="floor-a",
    "unplacing must not reach the outdoor map until save");
  saveDevicePlacement("staged-location",draft);
  assert.equal(ensureLocationDevices("staged-location")
    .find(d=>d.uuid===camera.uuid).floorId,null);
});

test("saving rejects another location's devices and malformed or duplicated IDs atomically",()=>{
  globalThis.window={localStorage:memoryStorage()};
  const saved=ensureLocationDevices("location-one");
  const other=ensureLocationDevices("location-two");
  assert.throws(()=>saveDevicePlacement("location-one",other));
  assert.throws(()=>saveDevicePlacement("location-one",[
    {...saved[0],uuid:saved[1].uuid},...saved.slice(1),
  ]));
  assert.throws(()=>saveDevicePlacement("location-one",[
    {...saved[0],sizePx:NaN},...saved.slice(1),
  ]));
  assert.throws(()=>stageDevicePlacement(saved,"location-one",saved[0].uuid,"floor",{x:Infinity,y:2}));
  assert.throws(()=>stageDeviceConfiguration(saved,"location-one",saved[0].uuid,{sizePx:4}));
  assert.deepEqual(ensureLocationDevices("location-one"),saved);
});

test("old default device icon size migrates from 38px to compact 24px",()=>{
  const storage=memoryStorage();
  globalThis.window={localStorage:storage};
  const saved=ensureLocationDevices("previous-version");
  const legacy=saved.map(({sizeVersion,...d},i)=>({...d,sizePx:i===1?64:38}));
  const data=JSON.parse(storage.getItem("maplibre-location-device-inventory-v1"));
  data["previous-version"]=legacy;
  storage.setItem("maplibre-location-device-inventory-v1",JSON.stringify(data));
  const migrated=ensureLocationDevices("previous-version");
  assert.equal(migrated[0].sizePx,24);
  assert.equal(migrated[1].sizePx,64);
});


test("a user-chosen 38px icon stays 38px after Save instead of being remigrated",()=>{
  globalThis.window={localStorage:memoryStorage()};
  const saved=ensureLocationDevices("custom-38");
  const custom=stageDeviceConfiguration(saved,"custom-38",saved[0].uuid,{sizePx:38});
  saveDevicePlacement("custom-38",custom);
  assert.equal(ensureLocationDevices("custom-38")[0].sizePx,38);
});
