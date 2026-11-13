import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import ts from "typescript";

const source=(path)=>ts.transpileModule(readFileSync(new URL(path,import.meta.url),"utf8"),{
  compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022},
}).outputText;
const url=value=>"data:text/javascript;base64,"+Buffer.from(value).toString("base64");

test("demo visitor roster contains five complete, stable profiles",async()=>{
  const {DEMO_VISITORS}=await import(url(source("../src/lib/demo-visitors.ts")));
  assert.equal(DEMO_VISITORS.length,5);
  assert.equal(new Set(DEMO_VISITORS.map(visitor=>visitor.id)).size,5);
  for(const visitor of DEMO_VISITORS){
    assert.match(visitor.fullName,/^[A-Z][a-z]+ [A-Z][a-z]+$/);
    assert.ok(visitor.contactNumber.length>=10);
    assert.match(visitor.avatarUrl,/^https:\/\/randomuser\.me\/api\/portraits\/(?:women|men)\/\d+\.jpg$/);
  }
});

test("floating visitor window clamps drag positions inside the map",async()=>{
  const {clampFloatingPosition}=await import(url(source("../src/lib/floating-window.ts")));
  const bounds={containerWidth:800,containerHeight:600,panelWidth:360,panelHeight:350,gap:8};
  assert.deepEqual(clampFloatingPosition({x:-20,y:-10},bounds),{x:8,y:8});
  assert.deepEqual(clampFloatingPosition({x:900,y:700},bounds),{x:432,y:242});
  assert.deepEqual(clampFloatingPosition({x:240,y:100},bounds),{x:240,y:100});
});

test("selected outdoor location displays a draggable visitor window and simulated map visitors",()=>{
  const workspace=readFileSync(new URL("../src/components/map/map-workspace.tsx",import.meta.url),"utf8");
  const panel=readFileSync(new URL("../src/components/map/visitor-window.tsx",import.meta.url),"utf8");
  const canvas=readFileSync(new URL("../src/components/map/map-canvas.tsx",import.meta.url),"utf8");
  assert.match(workspace,/view==="street"&&selectedSavedLocationId&&<VisitorWindow/);
  assert.match(workspace,/className="relative isolate min-w-0 flex-1 overflow-hidden/);
  assert.match(panel,/Visitors \[\{DEMO_VISITORS\.length\}\]/);
  assert.match(panel,/onPointerDown=\{startDrag\}/);
  assert.match(panel,/right-\[72px\] top-4/);
  assert.match(panel,/w-\[min\(300px,calc\(100%-5\.5rem\)\)\]/);
  assert.match(panel,/bg-\[#F23D44\]/);
  assert.match(panel,/className="size-\[34px\]/);
  assert.match(workspace,/visitorSnapshots=\{visitorSimulation\.visitors\}/);
  assert.match(canvas,/visitor-map-marker/);
});

test("outdoor map carries the supplied XSPONSE logo without overlapping map instructions",()=>{
  const workspace=readFileSync(new URL("../src/components/map/map-workspace.tsx",import.meta.url),"utf8");
  assert.match(workspace,/view==="street"&&<div[^>]*aria-label="XSPONSE branding"/);
  assert.match(workspace,/src="\/xsponse_logo\.png"/);
  assert.match(workspace,/w-\[170px\]/);
  assert.match(workspace,/top-\[68px\]/);
});

test("visitor log samples every visitor with timestamp and coordinates every 3 seconds",async()=>{
  const log=await import(url(source("../src/lib/visitor-log.ts")));
  assert.equal(log.VISITOR_LOG_INTERVAL_MS,3000);
  const visitors=[
    {id:"a",fullName:"Ann Lee",color:"#2563eb",locationName:"Lab",floorName:"Floor 1",
      floorRecordId:"f1",point:{x:12.345,y:6.78},alerting:false},
    {id:"b",fullName:"Bo Kim",color:"#db2777",locationName:"Records, East",floorName:"Floor 2",
      floorRecordId:"f2",point:{x:1,y:2},alerting:true},
  ];
  const project=visitor=>visitor.id==="a"?[121.123456789,14.987654321]:null;
  const entry=log.createVisitorLogEntry(new Date("2026-11-10T03:04:05.000Z"),visitors,project);
  assert.equal(entry.timestamp,"2026-11-10T03:04:05.000Z");
  assert.deepEqual(entry.rows.map(row=>[row.x,row.y,row.latitude,row.longitude]),
    [[12.3,6.8,14.9876543,121.1234568],[1,2,null,null]]);
  let entries=[];
  for(let index=0;index<5;index++)entries=log.appendVisitorLog(entries,{...entry,id:String(index)},3);
  assert.deepEqual(entries.map(item=>item.id),["4","3","2"]);
  const csv=log.visitorLogCsv([entry]).split("\n");
  assert.equal(csv[0],"timestamp,visitor,location,floor,latitude,longitude,pixel_x,pixel_y,restricted");
  assert.equal(csv[2],'2026-11-10T03:04:05.000Z,Bo Kim,"Records, East",Floor 2,,,1,2,true');
});

test("visitor log is a second draggable window below the visitors window",()=>{
  const workspace=readFileSync(new URL("../src/components/map/map-workspace.tsx",import.meta.url),"utf8");
  const panel=readFileSync(new URL("../src/components/map/visitor-log-window.tsx",import.meta.url),"utf8");
  assert.match(workspace,/view==="street"&&selectedSavedLocationId&&<VisitorLogWindow/);
  assert.match(panel,/onPointerDown=\{startDrag\}/);
  assert.match(panel,/data-floating-window="visitors"/);
  assert.match(panel,/VISITOR_LOG_INTERVAL_MS/);
});
