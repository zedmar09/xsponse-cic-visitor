import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const spatialSource=readFileSync(new URL("../src/lib/device-spatial.ts",import.meta.url),"utf8");
const js=ts.transpileModule(spatialSource,{compilerOptions:{
  module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,
}}).outputText;
const url="data:text/javascript;base64,"+Buffer.from(js).toString("base64");
const {previewDevicePosition,cameraCoveragePolygon}=await import(url);

const camera={shape:"cone",radiusPx:80,widePx:120,widthPx:60,rotationDegrees:0};

test("drag preview moves the field of view in real time without mutating saved devices",()=>{
  const first={uuid:"camera-1",locationId:"location",floorId:"floor-a",name:"Camera",
    type:"shield",sizePx:38,point:{x:100,y:100},camera};
  const second={...first,uuid:"camera-2",point:{x:250,y:200}};
  const originals=[first,second];
  const preview=previewDevicePosition(originals,"camera-1",{x:145,y:125});
  assert.deepEqual(first.point,{x:100,y:100},"the persisted source must not change before dragend");
  assert.deepEqual(preview[0].point,{x:145,y:125});
  assert.strictEqual(preview[1],second,"other devices must remain untouched");
  assert.deepEqual(preview[0].camera,camera,"the camera configuration is preserved");
  const before=cameraCoveragePolygon(first.point,camera);
  const during=cameraCoveragePolygon(preview[0].point,camera);
  for(let i=0;i<before.length;i++){
    assert.ok(Math.abs(during[i].x-before[i].x-45)<0.0001);
    assert.ok(Math.abs(during[i].y-before[i].y-25)<0.0001);
  }
  const next=previewDevicePosition(originals,"camera-1",{x:160,y:170});
  assert.deepEqual(next[0].point,{x:160,y:170});
  assert.deepEqual(first.point,{x:100,y:100});
});

test("indoor marker updates are not blocked by GeoJSON tile loading and drag events refresh the FOV",()=>{
  const canvas=readFileSync(new URL("../src/components/map/floor-plan-canvas.tsx",import.meta.url),"utf8");
  assert.match(canvas,/if\(!map\)return;\s*let disposed=false;\s*void loadMapLibre\(\)\.then\(lib=>\{[\s\S]*?updateDeviceMarkers\(map,lib,devicesRef\.current\)/);
  const markerEffect=canvas.slice(
    canvas.indexOf("// DOM markers are independent of GeoJSON tile loading"),
    canvas.indexOf("},[deviceMarkerPositionsKey,selectedDeviceId,displaySettings.deviceMarkers,updateDeviceMarkers]);"),
  );
  assert.ok(markerEffect.length>150,"device marker synchronization effect must exist");
  assert.doesNotMatch(markerEffect,/if\(!map\|\|!map\.loaded\(\)\)return;/);
  assert.match(canvas,/marker\.on\("drag",\(\)=>\{/);
  assert.match(canvas,/deviceDragPreviewRef\.current=\{deviceId:device\.uuid,point\}/);
  assert.match(canvas,/refreshRef\.current\(\); \/\/ Live FOV translation/);
  assert.match(canvas,/marker\.on\("dragend",\(\)=>\{/);
  assert.match(canvas,/deviceMoveRef\.current\(device\.uuid,point\)/);
  assert.match(canvas,/marker\.getElement\(\)\.style\.zIndex=/);
});


test("all device SVGs preserve their source proportions and white alpha silhouettes",async()=>{
  const source=readFileSync(new URL("../src/lib/device-icon.ts",import.meta.url),"utf8");
  const code=ts.transpileModule(source,{compilerOptions:{
    module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,
  }}).outputText;
  const mod=await import("data:text/javascript;base64,"+Buffer.from(code).toString("base64"));
  const native={
    "single-sided":[1158,1031],
    "double-sided":[1400,697],
    "p-button":[407,698],
    "shield":[512,840],
  };
  for(const [type,[w,h]] of Object.entries(native)){
    const one=mod.deviceIconDimensions(type,40,1);
    const half=mod.deviceIconDimensions(type,40,.5);
    const double=mod.deviceIconDimensions(type,40,2);
    assert.ok(Math.abs(one.width/one.height-w/h)<1e-9,
      type+" must not be distorted into a square");
    assert.ok(Math.abs(Math.max(one.width,one.height)-40)<1e-9);
    assert.ok(Math.abs(one.width/half.width-2)<1e-9);
    assert.ok(Math.abs(double.height/one.height-2)<1e-9);
    assert.ok(Math.abs(one.width/one.height-half.width/half.height)<1e-9,
      type+" must have same floor-relative footprint at all zoom levels");
  }
  assert.match(source,/maskImage:/);
  assert.match(source,/WebkitMaskImage:/);
  assert.match(source,/background:"#ffffff"/);
  assert.match(source,/image\.draggable=false/);
});

test("indoor markers follow the floor image scale, without ever changing their saved size",()=>{
  const indoor=readFileSync(new URL("../src/components/map/floor-plan-canvas.tsx",import.meta.url),"utf8");
  const outdoor=readFileSync(new URL("../src/components/map/map-canvas.tsx",import.meta.url),"utf8");
  assert.match(indoor,/applyDeviceIconDimensions\(element,device\.type,device\.sizePx,/);
  assert.match(indoor,/1\/imagePixelsPerScreenPixel\(map,width,height\)/);
  assert.match(indoor,/syncDeviceMarkerDimensions\(map\)/);
  assert.match(indoor,/\.setLngLat\(place\(device\.point,width,height\)\)/);
  assert.match(indoor,/marker\.on\("drag",\(\)=>\{/);
  assert.match(outdoor,/createDeviceIconElement\(device\.type,model\.icon,/);
  assert.match(outdoor,/applyDeviceIconDimensions\(el,device\.type,device\.sizePx\)/);
  const inventory=readFileSync(new URL("../src/components/map/device-inventory.tsx",import.meta.url),"utf8");
  assert.match(inventory,/floor-image px/);
  assert.match(inventory,/Rotate camera cone direction/);
  assert.match(inventory,/Save device placement/);
  assert.match(inventory,/Cancel setup/);
});

test("outdoor device overlays read committed devices only after saving",()=>{
  const workspace=readFileSync(new URL("../src/components/map/map-workspace.tsx",import.meta.url),"utf8");
  assert.match(workspace,/setLocationDevices\(stageDevicePlacement\(/);
  assert.match(workspace,/setLocationDevices\(stageDeviceConfiguration\(/);
  assert.match(workspace,/setLocationDevices\(stageDeviceUnplacement\(/);
  assert.match(workspace,/const saved=saveDevicePlacement\(selectedIndoorLocationId,locationDevices\)/);
  assert.match(workspace,/setDeviceSaveRevision\(current=>current\+1\)/);
  assert.match(workspace,/\},\[selectedSavedLocationId,deviceSaveRevision\]\)/);
  assert.match(workspace,/setLocationDevices\(savedDeviceBaseline\.map\(/);
  assert.match(workspace,/devices:outdoorDevices\.filter\(device=>device\.floorId===f\.id\)/);
});


test("camera FOV edits redraw only polygons, without remounting every device SVG",()=>{
  const canvas=readFileSync(new URL("../src/components/map/floor-plan-canvas.tsx",import.meta.url),"utf8");
  assert.match(canvas,/const deviceMarkerPositionsKey=placedDevices\.map\(device=>/);
  assert.match(canvas,/\[device\.uuid,device\.type,device\.point\?\.x,device\.point\?\.y,device\.sizePx\]/);
  assert.match(canvas,/\},\[deviceMarkerPositionsKey,selectedDeviceId,displaySettings\.deviceMarkers,updateDeviceMarkers\]\)/);
  assert.doesNotMatch(canvas,/\},\[placedDevices,selectedDeviceId,displaySettings\.deviceMarkers,updateDeviceMarkers\]\)/,
    "camera-only edits must not recreate SVG marker elements");
});

test("cancel resets every provisional indoor device overlay and ends active resize",()=>{
  const workspace=readFileSync(new URL("../src/components/map/map-workspace.tsx",import.meta.url),"utf8");
  const indoor=readFileSync(new URL("../src/components/map/floor-plan-canvas.tsx",import.meta.url),"utf8");
  assert.match(workspace,/const cancelDeviceChanges=\(\)=>\{/);
  assert.match(workspace,/setLocationDevices\(savedDeviceBaseline\.map\(/);
  assert.match(workspace,/setSelectedDeviceId\(null\)/);
  assert.match(workspace,/setDeviceResetKey\(current=>current\+1\)/);
  assert.match(workspace,/deviceResetKey=\{deviceResetKey\}/);
  const resetEffect=indoor.slice(indoor.indexOf("if(lastResetKey.current===deviceResetKey)return;"),
    indoor.indexOf("},[deviceResetKey,refresh,updateDeviceMarkers]);"));
  assert.ok(resetEffect.length>200,"reset effect should be present");
  assert.match(resetEffect,/deviceInteractionGenerationRef\.current\+\+/);
  assert.match(resetEffect,/activeResizeCleanupRef\.current\?\.\(\)/);
  assert.match(resetEffect,/deviceDragPreviewRef\.current=null/);
  assert.match(resetEffect,/refresh\(\)/);
  assert.match(resetEffect,/updateDeviceMarkers\(map,lib,devicesRef\.current\)/);
  assert.match(indoor,/interactionGeneration!==deviceInteractionGenerationRef\.current/);
});

test("the white backing and icon use the SVG outline without a square background",async()=>{
  const source=readFileSync(new URL("../src/lib/device-icon.ts",import.meta.url),"utf8");
  const code=ts.transpileModule(source,{compilerOptions:{
    module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,
  }}).outputText;
  const {createDeviceIconElement,applyDeviceIconDimensions}=await import(
    "data:text/javascript;base64,"+Buffer.from(code).toString("base64")
  );
  const previous=globalThis.document;
  globalThis.document={
    createElement(tag){
      return {tagName:tag,style:{},dataset:{},attributes:{},children:[],
        setAttribute(key,value){this.attributes[key]=value;},
        append(...elements){this.children.push(...elements);}};
    },
  };
  try{
    const root=createDeviceIconElement("double-sided","/double-sided.svg","Test camera");
    applyDeviceIconDimensions(root,"double-sided",50,.5);
    assert.ok(root.style.width.endsWith("px"));
    assert.equal(root.style.background,"transparent","root must not have a square white background");
    const [backing,image]=root.children;
    assert.equal(backing.dataset.deviceWhiteBacking,"true");
    assert.equal(backing.style.background,"#ffffff");
    assert.match(backing.style.maskImage,/double-sided\.svg/);
    assert.match(backing.style.WebkitMaskImage,/double-sided\.svg/);
    assert.equal(image.src,"/double-sided.svg");
    assert.equal(image.draggable,false);
    assert.ok(parseFloat(root.style.width)>parseFloat(root.style.height),
      "landscape image must have landscape white backing");
    const portrait=createDeviceIconElement("p-button","/p-button.svg","Push button");
    applyDeviceIconDimensions(portrait,"p-button",50,1);
    assert.ok(parseFloat(portrait.style.width)<parseFloat(portrait.style.height));
    assert.equal(root.children.length,2,"resize grip is separate from the icon/background");
  }finally{
    globalThis.document=previous;
  }
});
