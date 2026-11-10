import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import ts from "typescript";

const transpile=(path)=>ts.transpileModule(
  readFileSync(new URL(path,import.meta.url),"utf8"),{
    compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022},
  }).outputText;
const moduleUrl=source=>"data:text/javascript;base64,"+Buffer.from(source).toString("base64");
const {
  defaultFloorPlacement,floorPlacementError,floorImageCorners,
  floorPlacementHeight,resizeFloorWidth,resizeFloorHeight,scaleFloorProportionally,
  resizeFloorFromCorner,resizeFloorFromHandle,floorResizeHandlePoints,
  rotateFloorFromHandle,floorRotationHandle,skewFloorFromHandle,
}=
  await import(moduleUrl(transpile("../src/lib/outdoor-floor-placement.ts")));
test("each floor has a geographic placement independent of the indoor pixels",()=>{
  const a=defaultFloorPlacement(120.9842,14.5995);
  const b={...a,longitude:121.001,widthMeters:65,rotationDegrees:90};
  assert.equal(floorPlacementError(a),null);
  assert.equal(floorPlacementError(b),null);
  assert.notDeepEqual(floorImageCorners(a,800,400),floorImageCorners(b,800,400));
  assert.deepEqual(a,defaultFloorPlacement(120.9842,14.5995));
});
test("corners preserve floor image aspect ratio at the equator",()=>{
  const p={...defaultFloorPlacement(0,0),widthMeters:100,opacity:0.5};
  const corners=floorImageCorners(p,1000,500);
  const width=(corners[1][0]-corners[0][0])*111320;
  const height=(corners[0][1]-corners[3][1])*111320;
  assert.ok(Math.abs(width-100)<1e-8);
  assert.ok(Math.abs(height-50)<1e-8);
  assert.deepEqual(corners[0],[-50/111320,25/111320]);
});
test("invalid coordinates or dimensions never produce an overlay",()=>{
  const p=defaultFloorPlacement(120,14);
  for(const change of [{latitude:90},{longitude:200},{widthMeters:0},{widthMeters:5001},
    {rotationDegrees:200},{opacity:0},{latitude:Number.NaN}]){
    const invalid={...p,...change};
    assert.ok(floorPlacementError(invalid));
    assert.throws(()=>floorImageCorners(invalid,1000,500));
  }
  assert.throws(()=>floorImageCorners(p,0,500));
});
test("outdoor editor places selected location floor, never an outdoor building",()=>{
  const workspace=readFileSync(new URL("../src/components/map/map-workspace.tsx",import.meta.url),"utf8");
  const canvas=readFileSync(new URL("../src/components/map/map-canvas.tsx",import.meta.url),"utf8");
  const plan=readFileSync(new URL("../src/lib/floor-plan.ts",import.meta.url),"utf8");
  assert.match(workspace,/f\.locationId===placementLocation\.id/);
  assert.match(workspace,/saveOutdoorPlacement/);
  assert.match(workspace,/onPlacementPointPick/);
  assert.match(canvas,/type:"image",url/);
  assert.match(canvas,/placementPreviews/);
  assert.match(canvas,/floorSourceId\(preview\.floorId\)/);
  assert.match(canvas,/floorImageCorners/);
  assert.match(plan,/outdoorPlacement\?: OutdoorFloorPlacement/);
  assert.doesNotMatch(workspace,/OutdoorBuildingManager|buildingPlacementMode|outdoorBuildings/);
});

test("new and existing floors keep proportional dimensions when locked",()=>{
  const original=defaultFloorPlacement(120,14);
  const doubled=resizeFloorWidth(original,80,1000,500,true);
  assert.equal(doubled.widthMeters,80);
  assert.equal(floorPlacementHeight(doubled,1000,500),40);
  const expanded=scaleFloorProportionally(doubled,1.1,1000,500);
  assert.equal(expanded.widthMeters,88);
  assert.equal(floorPlacementHeight(expanded,1000,500),44);
  assert.equal(original.widthMeters,40);
  const scaledByHeight=resizeFloorHeight(expanded,22,1000,500,true);
  assert.equal(scaledByHeight.widthMeters,44);
  assert.equal(floorPlacementHeight(scaledByHeight,1000,500),22);
});

test("unlocked resize changes width or height independently",()=>{
  const initial=defaultFloorPlacement(121,15);
  const stretched=resizeFloorHeight(initial,60,1000,500,false);
  assert.equal(stretched.widthMeters,40);
  assert.equal(floorPlacementHeight(stretched,1000,500),60);
  const wide=resizeFloorWidth(stretched,100,1000,500,false);
  assert.equal(wide.widthMeters,100);
  assert.equal(floorPlacementHeight(wide,1000,500),60);
  const corners=floorImageCorners(wide,1000,500);
  assert.ok(Math.abs((corners[1][0]-corners[0][0])*111320*Math.cos(15*Math.PI/180)-100)<1e-6);
});

test("shearing warps floor corners without moving centre or changing saved indoor geometry",()=>{
  const p=defaultFloorPlacement(0,0);
  const before=floorImageCorners(p,800,400);
  const horizontal=floorImageCorners({...p,skewXDegrees:20},800,400);
  const vertical=floorImageCorners({...p,skewYDegrees:-15},800,400);
  assert.notDeepEqual(horizontal,before);
  assert.notDeepEqual(vertical,before);
  assert.equal((horizontal[0][0]+horizontal[2][0])/2,0);
  assert.equal((vertical[0][1]+vertical[2][1])/2,0);
  assert.equal(floorPlacementError({...p,skewXDegrees:36}),"Skew must be between -35 and 35 degrees.");
  assert.ok(floorPlacementError({...p,heightMeters:1}));
  assert.ok(floorPlacementError({...p,skewYDegrees:Infinity}));
});

test("unfitted floors never appear automatically; checkboxes control visible layers",()=>{
  const workspace=readFileSync(new URL("../src/components/map/map-workspace.tsx",import.meta.url),"utf8");
  const canvas=readFileSync(new URL("../src/components/map/map-canvas.tsx",import.meta.url),"utf8");
  assert.match(workspace,/visibleFloorIds,setVisibleFloorIds\]=useState<string\[\]>\(\[\]\)/);
  assert.match(workspace,/checked=\{visibleFloorIds\.includes\(f\.id\)\}/);
  assert.match(workspace,/onChange=\{event=>toggleFloorVisibility\(f\.id,event\.target\.checked\)\}/);
  assert.match(workspace,/lockProportions,setLockProportions\]=useState\(true\)/);
  assert.match(workspace,/Expand 10%/);
  assert.match(workspace,/skewXDegrees/);
  assert.match(workspace,/skewYDegrees/);
  assert.match(canvas,/type:"image",url/);
  assert.match(canvas,/const shown=\[\.\.\.latestPreviewsRef\.current\]/);
  assert.match(canvas,/draggable:true/);
  assert.match(canvas,/onPlacementPointPickRef\.current\(point\.lng,point\.lat\)/);
});

test("dragging an image corner resizes with or without proportions locked",()=>{
  const p={...defaultFloorPlacement(0,0),widthMeters:100};
  const locked=resizeFloorFromCorner(p,1000,500,0,[-100/111320,50/111320],true);
  assert.ok(Math.abs(locked.widthMeters-200)<1e-6);
  assert.ok(Math.abs(floorPlacementHeight(locked,1000,500)-100)<1e-6);
  const unlocked=resizeFloorFromCorner(p,1000,500,0,[-80/111320,35/111320],false);
  assert.ok(Math.abs(unlocked.widthMeters-160)<1e-6);
  assert.ok(Math.abs(floorPlacementHeight(unlocked,1000,500)-70)<1e-6);
  assert.deepEqual(resizeFloorFromCorner(p,1000,500,0,[70/111320,20/111320],false),p);
  assert.equal(p.widthMeters,100);
});

test("corner editing respects existing rotation and shear",()=>{
  const p={...defaultFloorPlacement(0,0),widthMeters:40,
    rotationDegrees:25,skewXDegrees:20,skewYDegrees:-10};
  const desired={...p,widthMeters:80,heightMeters:40};
  const movedCorner=floorImageCorners(desired,1000,500)[2];
  const next=resizeFloorFromCorner(p,1000,500,2,movedCorner,true);
  assert.ok(Math.abs(next.widthMeters-80)<1e-5);
  assert.ok(Math.abs(floorPlacementHeight(next,1000,500)-40)<1e-5);
  assert.equal(next.rotationDegrees,25);
  assert.equal(next.skewXDegrees,20);
});

test("dragging the top rotation handle changes angle, not location or image size",()=>{
  const p={...defaultFloorPlacement(0,0),widthMeters:100};
  const from=floorRotationHandle(p,1000,500);
  const angle=30*Math.PI/180;
  const to=[
    from[0]*Math.cos(angle)+from[1]*Math.sin(angle),
    -from[0]*Math.sin(angle)+from[1]*Math.cos(angle),
  ];
  const rotated=rotateFloorFromHandle(p,from,to);
  assert.equal(rotated.rotationDegrees,30);
  assert.equal(rotated.longitude,0);
  assert.equal(rotated.latitude,0);
  assert.equal(rotated.widthMeters,100);
});

test("eight Photoshop-style handles follow the transformed bounding border",()=>{
  const p={...defaultFloorPlacement(121,14),widthMeters:120,heightMeters:75,
    rotationDegrees:31,skewXDegrees:12,skewYDegrees:-9};
  const handles=floorResizeHandlePoints(p,1200,750);
  const corners=floorImageCorners(p,1200,750);
  assert.equal(handles.length,8);
  assert.deepEqual(handles.slice(0,4),corners);
  const mercY=(latitude)=>Math.log(Math.tan(Math.PI/4+latitude*Math.PI/360));
  for(let index=0;index<4;index++){
    const left=corners[index],right=corners[(index+1)%4];
    const mid=handles[index+4];
    assert.ok(Math.abs(mid[0]-(left[0]+right[0])/2)<1e-10);
    assert.ok(Math.abs(mercY(mid[1])-(mercY(left[1])+mercY(right[1]))/2)<1e-10);
  }
});

test("edge grips resize a single dimension without lock, both with lock",()=>{
  const p={...defaultFloorPlacement(0,0),widthMeters:100,heightMeters:50};
  const handles=floorResizeHandlePoints(p,1000,500);
  const doubleEdge=(index)=>[
    p.longitude+2*(handles[index][0]-p.longitude),
    p.latitude+2*(handles[index][1]-p.latitude),
  ];
  const right=resizeFloorFromHandle(p,1000,500,5,doubleEdge(5),false);
  const left=resizeFloorFromHandle(p,1000,500,7,doubleEdge(7),false);
  const top=resizeFloorFromHandle(p,1000,500,4,doubleEdge(4),false);
  const bottom=resizeFloorFromHandle(p,1000,500,6,doubleEdge(6),false);
  assert.ok(Math.abs(right.widthMeters-200)<1e-5);
  assert.ok(Math.abs(left.widthMeters-200)<1e-5);
  assert.ok(Math.abs(floorPlacementHeight(right,1000,500)-50)<1e-6);
  assert.ok(Math.abs(right.heightMeters-50)<1e-6);
  assert.ok(Math.abs(top.heightMeters-100)<1e-5);
  assert.ok(Math.abs(bottom.heightMeters-100)<1e-5);
  assert.ok(Math.abs(top.widthMeters-100)<1e-5);
  const locked=resizeFloorFromHandle(p,1000,500,5,doubleEdge(5),true);
  assert.ok(Math.abs(locked.widthMeters-200)<1e-5);
  assert.ok(Math.abs(locked.heightMeters-100)<1e-5);
  assert.deepEqual(p,{...defaultFloorPlacement(0,0),widthMeters:100,heightMeters:50});
});

test("edge resize remains correct with existing rotation and skew",()=>{
  const p={...defaultFloorPlacement(121,14),widthMeters:40,heightMeters:25,
    rotationDegrees:42,skewXDegrees:-15,skewYDegrees:8};
  const target={...p,widthMeters:80,heightMeters:55};
  const proposed=floorResizeHandlePoints(target,800,500);
  const right=resizeFloorFromHandle(p,800,500,5,proposed[5],false);
  const bottom=resizeFloorFromHandle(p,800,500,6,proposed[6],false);
  // Geographic midpoint interpolation introduces sub-millimetre Mercator
  // rounding at nonzero latitude; 1 mm is stricter than map-pixel accuracy.
  assert.ok(Math.abs(right.widthMeters-80)<1e-3);
  assert.ok(Math.abs(right.heightMeters-25)<1e-3);
  assert.ok(Math.abs(bottom.heightMeters-55)<1e-3);
  assert.ok(Math.abs(bottom.widthMeters-40)<1e-3);
  assert.equal(right.rotationDegrees,42);
  assert.equal(bottom.skewXDegrees,-15);
  assert.equal(bottom.skewYDegrees,8);
  assert.deepEqual(resizeFloorFromHandle(p,800,500,5,[p.longitude-0.01,p.latitude],false),p);
  assert.deepEqual(resizeFloorFromHandle(p,800,500,8,[p.longitude,p.latitude],false),p);
});

test("live selection border connects eight grip positions and rotates with the indoor group",()=>{
  const canvas=readFileSync(new URL("../src/components/map/map-canvas.tsx",import.meta.url),"utf8");
  assert.match(canvas,/SELECTION_FRAME_SOURCE="selected-indoor-resize-frame"/);
  assert.match(canvas,/coordinates:\[\.\.\.corners,corners\[0\]\]/);
  assert.match(canvas,/line-dasharray":\[3,1\.5\]/);
  assert.match(canvas,/if\(selected\)\{/);
  assert.match(canvas,/const selection=map\.getSource\(SELECTION_FRAME_SOURCE\)/);
  assert.match(canvas,/selection\.setData\(floorSelectionBorder\(/);
  assert.match(canvas,/floorResizeHandlePoints\(current\.placement,current\.imageWidth,current\.imageHeight\)/);
  assert.match(canvas,/handles\.forEach\(\(point,index\)=>\{/);
  assert.match(canvas,/transformHandlesRef\.current\[8\]/);
  assert.match(canvas,/resizeFloorFromHandle\(base,current\.imageWidth,current\.imageHeight/);
  assert.match(canvas,/corner\.on\("drag",\(\)=>\{/);
  assert.match(canvas,/preview\(resized\(\)\)/);
  assert.match(canvas,/rotElement\.innerHTML='<svg aria-hidden="true"/);
});

test("Skew mode moves ONLY the selected corner, preserving every other corner",()=>{
  const initial=defaultFloorPlacement(121,14);
  const base=floorImageCorners(initial,1200,800);
  const target=[
    base[0][0]+4/(111320*Math.cos(14*Math.PI/180)),
    base[0][1]+3/111320,
  ];
  const warped=skewFloorFromHandle(initial,1200,800,0,target);
  const corners=floorImageCorners(warped,1200,800);
  assert.ok(Math.abs(corners[0][0]-target[0])<1e-10);
  assert.ok(Math.abs(corners[0][1]-target[1])<1e-10);
  for(let i=1;i<4;i++)assert.deepEqual(corners[i],base[i],
    `unselected corner ${i} should not move`);
  assert.deepEqual(initial,defaultFloorPlacement(121,14));
  assert.deepEqual(warped.cornerWarpOffsets?.slice(1),[[0,0],[0,0],[0,0]]);
});

test("Skew top edge midpoint moves only top-left and top-right, leaving bottom fixed",()=>{
  const initial=defaultFloorPlacement(121,14);
  const corners=floorImageCorners(initial,1200,800);
  const handle=floorResizeHandlePoints(initial,1200,800)[4];
  const moved=skewFloorFromHandle(initial,1200,800,4,[
    handle[0]+2/(111320*Math.cos(14*Math.PI/180)),
    handle[1]+5/111320,
  ]);
  const updated=floorImageCorners(moved,1200,800);
  assert.notDeepEqual(updated[0],corners[0]);
  assert.notDeepEqual(updated[1],corners[1]);
  assert.deepEqual(updated[2],corners[2]);
  assert.deepEqual(updated[3],corners[3]);
  assert.ok(Math.abs(moved.cornerWarpOffsets[0][0]-moved.cornerWarpOffsets[1][0])<1e-10);
  assert.ok(Math.abs(moved.cornerWarpOffsets[0][1]-moved.cornerWarpOffsets[1][1])<1e-10);
});

test("Skew of all eight grips keeps original dimensions, bearing and saved pixels",()=>{
  const p={...defaultFloorPlacement(121,14),widthMeters:100,heightMeters:60,
    rotationDegrees:30,skewXDegrees:10};
  for(let index=0;index<8;index++){
    const handle=floorResizeHandlePoints(p,1200,800)[index];
    const warped=skewFloorFromHandle(p,1200,800,index,[
      handle[0]+1/(111320*Math.cos(14*Math.PI/180)),
      handle[1]+1/111320,
    ]);
    assert.equal(warped.widthMeters,100);
    assert.equal(warped.heightMeters,60);
    assert.equal(warped.rotationDegrees,30);
    assert.equal(warped.skewXDegrees,10);
    assert.notDeepEqual(floorImageCorners(warped,1200,800),floorImageCorners(p,1200,800));
    assert.equal(floorResizeHandlePoints(warped,1200,800).length,8);
  }
});

test("Skew rejects crossed corners, oversized offsets and nonfinite coordinates",()=>{
  const p={...defaultFloorPlacement(0,0),widthMeters:40,heightMeters:20};
  const corners=floorImageCorners(p,1000,500);
  assert.deepEqual(skewFloorFromHandle(p,1000,500,0,corners[2]),p,
    "corner drag must not flip the floor polygon");
  assert.deepEqual(skewFloorFromHandle(p,1000,500,0,[Number.NaN,0]),p);
  const huge=[10000/111320,10000/111320];
  assert.deepEqual(skewFloorFromHandle(p,1000,500,0,huge),p);
  assert.ok(floorPlacementError({...p,cornerWarpOffsets:[[0,0],[0,0],[0,0]]}));
  assert.ok(floorPlacementError({...p,cornerWarpOffsets:[[0,0],[Infinity,0],[0,0],[0,0]]}));
});

test("Rotation and resize still work after independent corner skew",()=>{
  const p={...defaultFloorPlacement(0,0),widthMeters:100,heightMeters:50};
  const handle=floorResizeHandlePoints(p,1000,500)[0];
  const warped=skewFloorFromHandle(p,1000,500,0,[
    handle[0]+3/111320,handle[1]+2/111320,
  ]);
  const otherCorners=floorImageCorners(warped,1000,500);
  const rotated={...warped,rotationDegrees:40};
  assert.notDeepEqual(floorImageCorners(rotated,1000,500),otherCorners);
  assert.deepEqual(rotated.cornerWarpOffsets,warped.cornerWarpOffsets);
  const resizeCorner=floorResizeHandlePoints(warped,1000,500)[2];
  const changed=resizeFloorFromHandle(warped,1000,500,2,[
    p.longitude+(resizeCorner[0]-p.longitude)*1.25,
    p.latitude+(resizeCorner[1]-p.latitude)*1.25,
  ],true);
  assert.ok(changed.widthMeters>warped.widthMeters);
  assert.deepEqual(changed.cornerWarpOffsets,warped.cornerWarpOffsets);
});

test("Skew tool and oversized connected ROTATE icon are displayed and update in real-time",()=>{
  const workspace=readFileSync(new URL("../src/components/map/map-workspace.tsx",import.meta.url),"utf8");
  const canvas=readFileSync(new URL("../src/components/map/map-canvas.tsx",import.meta.url),"utf8");
  assert.match(workspace,/placementEditMode,setPlacementEditMode/);
  assert.match(workspace,/setPlacementEditMode\("skew"\)/);
  assert.match(workspace,/transformMode=\{placementEditMode\}/);
  assert.match(canvas,/SELECTION_ROTATE_LINE="selected-indoor-rotate-connector"/);
  assert.match(canvas,/role:"rotation-stem"/);
  assert.match(canvas,/topCentre,rotationPoint/);
  assert.match(canvas,/width:46px;height:46px/);
  assert.match(canvas,/>ROTATE<\/span>/);
  assert.match(canvas,/skewFloorFromHandle\(base,current\.imageWidth,current\.imageHeight/);
  assert.match(canvas,/corner\.on\("drag",\(\)=>\{/);
  assert.match(canvas,/preview\(resized\(\)\)/);
  assert.match(canvas,/selection\.setData\(floorSelectionBorder\(/);
});
