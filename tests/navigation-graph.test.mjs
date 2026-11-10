import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
const source=(path)=>ts.transpileModule(readFileSync(new URL(path,import.meta.url),"utf8"),{
  compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022},
}).outputText;
const url=s=>"data:text/javascript;base64,"+Buffer.from(s).toString("base64");
const floorUrl=url(source("../src/lib/floor-plan.ts"));
const stairUrl=url(source("../src/lib/staircases.ts")
  .replaceAll('"@/lib/floor-plan"',JSON.stringify(floorUrl)));
const verticalUrl=url(source("../src/lib/vertical-connections.ts")
  .replaceAll('"@/lib/floor-plan"',JSON.stringify(floorUrl))
  .replaceAll('"@/lib/staircases"',JSON.stringify(stairUrl)));
const graphUrl=url(source("../src/lib/navigation-graph.ts")
  .replaceAll('"@/lib/floor-plan"',JSON.stringify(floorUrl))
  .replaceAll('"@/lib/staircases"',JSON.stringify(stairUrl))
  .replaceAll('"@/lib/vertical-connections"',JSON.stringify(verticalUrl)));
const {buildNavigationAudit,findValidatedRoute,potentialWalkwayPair,walkwayPairId,walkwayGeometryKey}=await import(graphUrl);
const {findAutomaticLandingAccess,matchVerticalFloors}=await import(verticalUrl);
const clearanceUrl=url(source("../src/lib/navigation-clearance.ts")
  .replaceAll('"@/lib/floor-plan"',JSON.stringify(floorUrl)));
const guidanceUrl=url(source("../src/lib/navigation-route-geometry.ts")
  .replaceAll('"@/lib/floor-plan"',JSON.stringify(floorUrl))
  .replaceAll('"@/lib/navigation-graph"',JSON.stringify(graphUrl))
  .replaceAll('"@/lib/navigation-clearance"',JSON.stringify(clearanceUrl)));
const {buildGuidedRoute,routeInsideArea,smoothRouteCorners,navTransitionPair}=await import(guidanceUrl);
const {clearanceAStar,segmentKeepsClearance,DEFAULT_WALL_CLEARANCE_PX}=await import(clearanceUrl);
const multifloorUrl=url(source("../src/lib/navigation-multifloor.ts")
  .replaceAll('"@/lib/navigation-route-geometry"',JSON.stringify(guidanceUrl)));
const {buildFloorRouteSteps}=await import(multifloorUrl);
const shortestUrl=url(source("../src/lib/navigation-shortest-route.ts")
  .replaceAll('"@/lib/floor-plan"',JSON.stringify(floorUrl))
  .replaceAll('"@/lib/staircases"',JSON.stringify(stairUrl))
  .replaceAll('"@/lib/navigation-graph"',JSON.stringify(graphUrl))
  .replaceAll('"@/lib/navigation-route-geometry"',JSON.stringify(guidanceUrl)));
const {findShortestMappedRoute}=await import(shortestUrl);
const rect=(id,kind,minX,minY,maxX,maxY,floorId="f1")=>({
  id,floorId,kind,name:id,points:[
    {x:minX,y:minY},{x:maxX,y:minY},{x:maxX,y:maxY},{x:minX,y:maxY}],
});
const ground=(areas=[],portals=[],walkwayApprovals=[],id="f1")=>({
  id,planId:id,name:id,width:400,height:300,mimeType:"image/png",
  image:new Blob(["image"]),calibration:null,areas,portals,walkwayApprovals,markers:[],
  hierarchy:{
    site:{id:"s",name:"Site"},building:{id:"b",siteId:"s",name:"Building"},
    floor:{id,buildingId:"b",name:id,level:id==="f1"?0:1},
  },createdAt:"2026-11-02",updatedAt:"2026-11-02",
});
const room=rect("Dining","room",0,0,100,100);
const hall=rect("Hall","walkable",100,0,200,100);
const hall2=rect("Hall2","walkable",200,0,300,100);
const door={
  id:"d1",floorId:"f1",name:"Dining door",purpose:"interior",reviewed:true,usage:"both",
  start:{x:100,y:35},end:{x:100,y:65},spaceAId:"Dining",spaceBId:"Hall",
};
test("adjacent walkable areas produce review candidates, never implicit travel approval",()=>{
  const report=buildNavigationAudit([ground([room,hall,hall2],[door])],[]);
  assert.equal(report.readyDoorCount,1);
  assert.equal(report.reviewDoorCount,0);
  assert.equal(report.walkways.length,1);
  assert.equal(report.walkways[0].approved,false);
  assert.equal(report.edges.filter(e=>e.status==="ready").length,1);
  assert.ok(report.issues.some(i=>i.category==="walkway"&&/confirmation/.test(i.message)));
  assert.ok(report.issues.some(i=>i.category==="space"&&i.message.includes("Hall2")));
});
test("confirmed walking passages link the network and invalidate on polygon edits",()=>{
  const approval={areaAId:"Hall",areaBId:"Hall2",geometryKey:walkwayGeometryKey(hall,hall2)};
  const valid=buildNavigationAudit([ground([room,hall,hall2],[door],[approval])],[]);
  assert.equal(valid.walkways[0].approved,true);
  assert.equal(valid.connectedSpaceCount,3);
  assert.equal(valid.spaceCount,3);
  const changed={...hall2,points:hall2.points.map(p=>({...p,y:p.y+5}))};
  const stale=buildNavigationAudit([ground([room,hall,changed],[door],[approval])],[]);
  assert.equal(stale.walkways[0].approved,false);
  assert.equal(stale.walkways[0].stale,true);
  assert.ok(stale.issues.some(i=>/geometry changed/.test(i.message)));
});
test("unreviewed and incorrectly positioned doors cannot silently become graph edges",()=>{
  const draft={...door,reviewed:false};
  const bad={...door,start:{x:370,y:230},end:{x:370,y:260}};
  const first=buildNavigationAudit([ground([room,hall],[draft])],[]);
  assert.equal(first.readyDoorCount,0);
  assert.equal(first.reviewDoorCount,1);
  const second=buildNavigationAudit([ground([room,hall],[bad])],[]);
  assert.equal(second.readyDoorCount,0);
  assert.ok(second.issues.some(i=>/could not be confirmed/.test(i.message)));
  const oneWay=buildNavigationAudit([ground([room,hall],[{...door,usage:"entrance"}])],[]);
  assert.equal(oneWay.edges.find(e=>e.kind==="door")?.direction,"forward");
  const outward=buildNavigationAudit([ground([room,hall],[{...door,usage:"exit"}])],[]);
  assert.equal(outward.edges.find(e=>e.kind==="door")?.direction,"backward");
});
test("touching only at a corner or separated by wall gap is not approved automatically",()=>{
  assert.equal(potentialWalkwayPair(hall,rect("onlyCorner","walkable",200,100,230,130)),false);
  assert.equal(potentialWalkwayPair(hall,rect("gap","walkable",208,0,300,100)),false);
  assert.equal(potentialWalkwayPair(hall,hall2),true);
  assert.equal(walkwayPairId("z","a"),walkwayPairId("a","z"));
});
test("staircase destinations and missing access points appear as warnings, not route-ready links",()=>{
  const stairs=[{
    id:"stair-A",buildingId:"b",name:"Staircase A",direction:"both",
    servedFloorIds:["f1","f2"],landings:[{
      floorId:"f1",outline:rect("stair","room",120,20,160,80).points,
      entryPoint:null,walkableAreaId:null,
    }],createdAt:"2026-11-02",updatedAt:"2026-11-02",
  }];
  const report=buildNavigationAudit([
    ground([hall],[]),ground([rect("Upper hall","walkable",50,50,180,110,"f2")],[],[],"f2")
  ],stairs);
  assert.ok(report.issues.some(i=>i.floorId==="f1"&&/does not touch/.test(i.message))===false);
  assert.ok(report.edges.some(e=>e.kind==="stair-access"&&e.status==="ready"));
  assert.ok(report.issues.some(i=>i.floorId==="f2"&&/draw a (staircase|elevator) on this floor/.test(i.message)));
  assert.equal(report.edges.filter(e=>e.kind==="vertical").length,0);
});

test("destination preview travels only through validated doorways and approved walking areas",()=>{
  const toilet=rect("Toilet CR","room",300,0,400,100);
  const door2={...door,id:"d2",name:"Toilet CR door",start:{x:300,y:35},
    end:{x:300,y:65},spaceAId:"Hall2",spaceBId:"Toilet CR"};
  const floor=ground([room,hall,hall2,toilet],[door,door2]);
  const notYet=buildNavigationAudit([floor],[]);
  const ids=name=>notYet.nodes.find(n=>n.label===name)?.id;
  assert.equal(findValidatedRoute(notYet,ids("Dining"),ids("Toilet CR")).status,"unreachable");
  const approval={areaAId:"Hall",areaBId:"Hall2",geometryKey:walkwayGeometryKey(hall,hall2)};
  const approved=buildNavigationAudit([ground([room,hall,hall2,toilet],[door,door2],[approval])],[]);
  const route=findValidatedRoute(approved,ids("Dining"),ids("Toilet CR"));
  assert.equal(route.status,"ready");
  assert.deepEqual(route.nodes.map(n=>n.label),["Dining","Hall","Hall2","Toilet CR"]);
  assert.deepEqual(route.edges.map(e=>e.kind),["door","walkway","door"]);
  assert.deepEqual(route.edges.filter(e=>e.doorPoint).map(e=>e.doorPoint),[
    {x:100,y:50},{x:300,y:50},
  ]);
  assert.equal(findValidatedRoute(approved,ids("Dining"),ids("Dining")).status,"same");
  assert.equal(findValidatedRoute(approved,"missing",ids("Toilet CR")).status,"missing");
});
test("destination selection respects one-way door and never uses candidate joins",()=>{
  const toilet=rect("Toilet CR","room",200,0,300,100);
  const exitOnly={...door,usage:"exit"};
  const otherDoor={...door,id:"d2",name:"Toilet CR",start:{x:200,y:35},end:{x:200,y:65},
    spaceAId:"Hall",spaceBId:"Toilet CR"};
  const floor=buildNavigationAudit([ground([room,hall,toilet],[exitOnly,otherDoor])],[]);
  const dining=floor.nodes.find(n=>n.label==="Dining").id;
  const end=floor.nodes.find(n=>n.label==="Toilet CR").id;
  assert.equal(findValidatedRoute(floor,dining,end).status,"unreachable");
  assert.equal(findValidatedRoute(floor,end,dining).status,"ready");
  const upper=buildNavigationAudit([ground([room,hall],[door]),
    ground([rect("Upper","room",0,0,100,100,"f2")],[],[],"f2")],[]);
  const start=upper.nodes.find(n=>n.label==="Dining").id;
  const other=upper.nodes.find(n=>n.label==="Upper").id;
  assert.equal(findValidatedRoute(upper,start,other).status,"unreachable"); // floors now work only with actual vertical edges
});

test("guided line follows reviewed Dining to Toilet CR doors and an approved corridor passage",()=>{
  const toilet=rect("Toilet CR","room",300,0,400,100);
  const toiletDoor={...door,id:"toilet-door",name:"Toilet entrance",
    start:{x:300,y:35},end:{x:300,y:65},spaceAId:"Hall2",spaceBId:"Toilet CR"};
  const approval={areaAId:"Hall",areaBId:"Hall2",geometryKey:walkwayGeometryKey(hall,hall2)};
  const saved=ground([room,hall,hall2,toilet],[door,toiletDoor],[approval]);
  const audit=buildNavigationAudit([saved],[]);
  const origin=audit.nodes.find(n=>n.label==="Dining").id;
  const dest=audit.nodes.find(n=>n.label==="Toilet CR").id;
  const sequence=findValidatedRoute(audit,origin,dest);
  const guidance=buildGuidedRoute(saved,sequence);
  assert.equal(guidance.status,"guided",guidance.message);
  assert.deepEqual(guidance.points[0],{x:100,y:50},"route must START at Dining doorway");
  assert.deepEqual(guidance.points.at(-1),{x:300,y:50},"route must END at Toilet CR doorway");
  assert.notDeepEqual(guidance.points[0],sequence.nodes[0].point,"do not guide through room center");
  assert.notDeepEqual(guidance.points.at(-1),sequence.nodes.at(-1).point,"do not guide through destination center");
  assert.ok(guidance.points.some(p=>Math.abs(p.x-100)<.01&&Math.abs(p.y-50)<.01));
  assert.ok(guidance.points.some(p=>Math.abs(p.x-200)<.01&&Math.abs(p.y-50)<.01));
  assert.ok(guidance.points.some(p=>Math.abs(p.x-300)<.01&&Math.abs(p.y-50)<.01));
  const unapproved=ground([room,hall,hall2,toilet],[door,toiletDoor]);
  assert.equal(buildGuidedRoute(unapproved,
    findValidatedRoute(buildNavigationAudit([unapproved],[]),origin,dest)).status,"unavailable");
});
test("concave walking areas bend around notches instead of drawing through walls",()=>{
  const polygon={
    id:"L-hall",floorId:"f1",kind:"walkable",name:"L Hall",
    points:[{x:0,y:0},{x:120,y:0},{x:120,y:25},
      {x:25,y:25},{x:25,y:120},{x:0,y:120}],
  };
  const start={x:100,y:13},end={x:13,y:100};
  const path=routeInsideArea(start,end,polygon);
  assert.ok(path&&path.length>2,"A direct diagonal would cross the missing notch");
  for(let i=1;i<path.length;i++){
    for(let j=0;j<=50;j++){
      const t=j/50,x=path[i-1].x*(1-t)+path[i].x*t;
      const y=path[i-1].y*(1-t)+path[i].y*t;
      assert.ok(x<=25.01||y<=25.01,`Line must stay within L corridor: ${x}, ${y}`);
    }
  }
});
test("guided preview rejects door positions that are not on both area boundaries",()=>{
  const artificial={...door,doorPoint:{x:150,y:70}};
  const saved=ground([room,hall],[door]);
  const audit=buildNavigationAudit([saved],[]);
  const route=findValidatedRoute(audit,audit.nodes.find(n=>n.label==="Dining").id,
    audit.nodes.find(n=>n.label==="Hall").id);
  const fake={...route,edges:[{...route.edges[0],doorPoint:artificial.doorPoint}]};
  const rejected=buildGuidedRoute(saved,fake);
  assert.equal(rejected.status,"needs-review");
  assert.deepEqual(rejected.points,[]);
});
test("exterior exits cannot create fake room-to-room walking paths via Outside",()=>{
  const second=rect("Other room","room",200,0,300,100);
  const entrance1={...door,id:"outer1",purpose:"building",spaceAId:null,spaceBId:"Dining",
    start:{x:0,y:35},end:{x:0,y:65}};
  const entrance2={...door,id:"outer2",purpose:"building",spaceAId:null,spaceBId:"Other room",
    start:{x:300,y:35},end:{x:300,y:65}};
  const audit=buildNavigationAudit([ground([room,second],[entrance1,entrance2])],[]);
  assert.equal(findValidatedRoute(audit,
    audit.nodes.find(n=>n.label==="Dining").id,
    audit.nodes.find(n=>n.label==="Other room").id).status,"unreachable");
});

test("mapped staircases create cross-floor routes without hallway access registration",()=>{
  const f1=ground([rect("Front Desk","room",0,0,100,100),hall],[],[],"f1");
  const f2=ground([rect("Conference","room",0,0,100,100,"f2"),{
    ...hall,id:"Hall F2",name:"Hall F2",floorId:"f2"}],[],[],"f2");
  const door1={...door,id:"desk-door",name:"Desk door",spaceAId:"Front Desk",spaceBId:"Hall"};
  const door2={...door,id:"conference-door",name:"Conference door",floorId:"f2",
    spaceAId:"Conference",spaceBId:"Hall F2"};
  f1.portals=[door1];f2.portals=[door2];
  const stairs=[{id:"stairs-a",kind:"staircase",name:"Staircase A",buildingId:"b",
    direction:"both",servedFloorIds:["f1","f2"],
    landings:[
      {floorId:"f1",outline:rect("s1","walkable",150,30,185,80).points,
        entryPoint:null,walkableAreaId:null},
      {floorId:"f2",outline:rect("s2","walkable",150,30,185,80,"f2").points,
        entryPoint:null,walkableAreaId:null},
    ],createdAt:"2026-11-02",updatedAt:"2026-11-02"}];
  const report=buildNavigationAudit([f1,f2],stairs);
  const a=report.nodes.find(n=>n.label==="Front Desk").id;
  const b=report.nodes.find(n=>n.label==="Conference").id;
  const route=findValidatedRoute(report,a,b);
  assert.equal(route.status,"ready",JSON.stringify(report.issues));
  assert.equal(route.edges.filter(e=>e.kind==="vertical").length,1);
  assert.equal(route.edges.filter(e=>e.kind==="stair-access").length,2);
  const steps=buildFloorRouteSteps([f1,f2],stairs,route);
  assert.equal(steps.length,2);
  assert.equal(steps[0].guidance.status,"guided",steps[0].guidance.message);
  assert.equal(steps[1].guidance.status,"guided",steps[1].guidance.message);
  assert.ok(steps[0].transitionAfter?.label.includes("Staircase A"));
});
test("elevators can connect nonadjacent floors while unmapped destinations stay unavailable",()=>{
  const createFloor=(id,level)=>({...ground([
    rect(`Room-${id}`,"room",0,0,100,100,id),
    rect(`Hall-${id}`,"walkable",100,0,200,100,id)],[],[],id),
    hierarchy:{...ground([],[],[],id).hierarchy,floor:{id,buildingId:"b",name:id,level}}});
  const f1=createFloor("f1",1),f2=createFloor("f2",2),f3=createFloor("f3",3);
  const landing=id=>({floorId:id,outline:rect("lift","room",130,30,175,80,id).points,
    entryPoint:null,walkableAreaId:null});
  const elevator={id:"lift-a",name:"Elevator A",kind:"elevator",buildingId:"b",direction:"both",
    servedFloorIds:["f1","f3"],landings:[landing("f1"),landing("f3")],
    createdAt:"2026-11-02",updatedAt:"2026-11-02"};
  const stair={...elevator,id:"stairs-b",name:"Staircase B",kind:"staircase"};
  const nav=buildNavigationAudit([f1,f2,f3],[elevator,stair]);
  assert.ok(nav.edges.some(e=>e.kind==="vertical"&&e.label.includes("Elevator A")));
  assert.ok(!nav.edges.some(e=>e.kind==="vertical"&&e.label.includes("Staircase B")));
  assert.ok(nav.issues.some(i=>/intermediate floor/.test(i.message)));
  const selectedOnly={...elevator,landings:[landing("f1")]};
  const pending=buildNavigationAudit([f1,f2,f3],[selectedOnly]);
  assert.equal(pending.edges.filter(e=>e.kind==="vertical").length,0);
  assert.ok(pending.issues.some(i=>/draw a (staircase|elevator) on this floor/.test(i.message)));
});

test("automatic stair/lift access rejects single corner contact or a walking-area gap",()=>{
  const selected=ground([rect("West Corridor","walkable",100,0,200,100)],[]);
  const corner={floorId:"f1",outline:rect("Corner","room",200,100,260,180).points,
    entryPoint:null,walkableAreaId:null};
  assert.equal(findAutomaticLandingAccess(corner,selected)?.estimated,true);
  const gap={...corner,outline:rect("Gap","room",204,20,260,80).points};
  assert.equal(findAutomaticLandingAccess(gap,selected)?.estimated,true);
  const shared={...corner,outline:rect("Shared","room",200,20,260,80).points};
  assert.equal(findAutomaticLandingAccess(shared,selected)?.estimated,false);
});

test("separately drawn Staircase 1 on floor 1 and Staircase 2 on floor 2 are linked by destination floors",()=>{
  const f1=ground([rect("Reception","room",0,0,100,100),hall],[
    {...door,id:"desk",name:"Reception doorway",spaceAId:"Reception",spaceBId:"Hall"}],[],"f1");
  const f2=ground([rect("Room X","room",0,0,100,100,"f2"),
    {...hall,id:"Hall F2",name:"Hall F2",floorId:"f2"}],[
    {...door,id:"room-x",floorId:"f2",name:"Room X doorway",
      spaceAId:"Room X",spaceBId:"Hall F2"}],[],"f2");
  const shape=rect("stairs","walkable",155,20,185,80).points;
  const stairs=[
    {id:"stairs-one",name:"Staircase 1",kind:"staircase",buildingId:"b",direction:"both",
      servedFloorIds:["f1","f2"],
      landings:[{floorId:"f1",outline:shape,entryPoint:null,walkableAreaId:null}],
      createdAt:"2026-11-02",updatedAt:"2026-11-02"},
    {id:"stairs-two",name:"Staircase 2",kind:"staircase",buildingId:"b",direction:"both",
      servedFloorIds:["f1","f2"],
      landings:[{floorId:"f2",outline:shape,entryPoint:null,walkableAreaId:null}],
      createdAt:"2026-11-02",updatedAt:"2026-11-02"},
  ];
  const pairs=matchVerticalFloors([f1,f2],stairs);
  assert.equal(pairs.links.length,1);
  assert.equal(pairs.pending.length,0);
  const graph=buildNavigationAudit([f1,f2],stairs);
  const origin=graph.nodes.find(n=>n.label==="Reception").id;
  const dest=graph.nodes.find(n=>n.label==="Room X").id;
  const route=findValidatedRoute(graph,origin,dest);
  assert.equal(route.status,"ready",JSON.stringify(graph.issues));
  assert.equal(route.edges.filter(e=>e.kind==="vertical").length,1);
  const steps=buildFloorRouteSteps([f1,f2],stairs,route);
  assert.equal(steps.length,2);
  assert.equal(steps[0].guidance.status,"guided");
  assert.equal(steps[1].guidance.status,"guided");
});
test("one selected destination finds only one counterpart and rejects ambiguous unpaired shafts",()=>{
  const f1=ground([hall],[],[],"f1"),f2=ground([
    {...hall,id:"hall2",floorId:"f2"}],[],[],"f2");
  const loc=id=>({floorId:id,outline:rect("shaft","room",140,10,175,65).points,
    entryPoint:null,walkableAreaId:null});
  const a={id:"a",name:"Stair 1",kind:"staircase",direction:"both",
    buildingId:"b",servedFloorIds:["f1","f2"],landings:[loc("f1")]};
  const b={...a,id:"b",name:"Stair 2",servedFloorIds:["f2"],landings:[loc("f2")]};
  assert.equal(matchVerticalFloors([f1,f2],[a,b]).links.length,1);
  const c={...b,id:"c",name:"Stair 3"};
  assert.equal(matchVerticalFloors([f1,f2],[a,b,c]).links.length,0);
  assert.ok(matchVerticalFloors([f1,f2],[a,b,c]).pending.length>0);
});
test("nearby but not touching stair zone needs no manual access registration and is marked estimated",()=>{
  const floor=ground([rect("hall","walkable",100,0,200,100)],[]);
  const zone={floorId:"f1",outline:rect("shaft","room",210,20,250,60).points,
    entryPoint:null,walkableAreaId:null};
  const found=findAutomaticLandingAccess(zone,floor);
  assert.ok(found);assert.equal(found.estimated,true);
  const distant={...zone,outline:rect("far","room",320,150,390,220).points};
  assert.equal(findAutomaticLandingAccess(distant,floor),null);
});
test("connected graph with inaccurate doorway geometry hides the misleading line",()=>{
  const saved=ground([room,hall],[door]);
  const audit=buildNavigationAudit([saved],[]);
  const route=findValidatedRoute(audit,
    audit.nodes.find(n=>n.label==="Dining").id,
    audit.nodes.find(n=>n.label==="Hall").id);
  const broken={...route,edges:route.edges.map(e=>({...e,doorPoint:{x:170,y:70}}))};
  const guide=buildGuidedRoute(saved,broken);
  assert.equal(guide.status,"needs-review");
  assert.deepEqual(guide.points,[]);
  assert.match(guide.message,/opening|wall-clear/i);
});

test("doorway-to-doorway guidance begins at origin opening and finishes at destination opening",()=>{
  const roomB=rect("Room B","room",200,0,300,100);
  const otherDoor={...door,id:"door-b",name:"Room B door",
    start:{x:200,y:40},end:{x:200,y:60},spaceAId:"Hall",spaceBId:"Room B"};
  const floor=ground([room,hall,roomB],[door,otherDoor]);
  const audit=buildNavigationAudit([floor],[]);
  const ids=(name)=>audit.nodes.find(n=>n.label===name).id;
  const guide=buildGuidedRoute(floor,findValidatedRoute(audit,ids("Dining"),ids("Room B")));
  assert.equal(guide.status,"guided");
  assert.deepEqual(guide.points[0],{x:100,y:50});
  assert.deepEqual(guide.points.at(-1),{x:200,y:50});
  assert.ok(!guide.points.some(p=>p.x===50&&p.y===50),"origin center must be excluded");
  assert.ok(!guide.points.some(p=>p.x===250&&p.y===50),"destination center must be excluded");
});
test("smooth corners preserve doorway endpoints and round only geometrically allowed bends",()=>{
  const path=[{x:0,y:10},{x:60,y:10},{x:60,y:90}];
  const round=smoothRouteCorners(path);
  assert.deepEqual(round[0],path[0]);
  assert.deepEqual(round.at(-1),path.at(-1));
  assert.ok(round.length>3,"a right angle has a rounded curve");
  assert.ok(round.some(p=>p.x<60&&p.y>10),"rounded corner should have intermediate points");
  // Geometry refusal must keep the original sharp corner, not cross mapped walls.
  const rejected=smoothRouteCorners(path,(a,b)=>a.y===b.y||a.x===b.x);
  assert.deepEqual(rejected,path);
});
test("imprecise route never draws through room centers or onto walls",()=>{
  const roomB=rect("Room B","room",200,0,300,100);
  const otherDoor={...door,id:"door-b",name:"Room B door",
    start:{x:200,y:40},end:{x:200,y:60},spaceAId:"Hall",spaceBId:"Room B"};
  const floor=ground([room,hall,roomB],[door,otherDoor]);
  const audit=buildNavigationAudit([floor],[]);
  const ids=(name)=>audit.nodes.find(n=>n.label===name).id;
  const route=findValidatedRoute(audit,ids("Dining"),ids("Room B"));
  const inaccurate={...route,edges:route.edges.map(e=>({...e,doorPoint:{x:e.doorPoint.x+20,y:80}}))};
  const guided=buildGuidedRoute(floor,inaccurate);
  assert.equal(guided.status,"needs-review");
  assert.deepEqual(guided.points,[]);
});

test("A* keeps an inset clearance from a concave corridor and never hugs the black wall boundary",()=>{
  const L={id:"L",floorId:"f1",kind:"walkable",name:"L corridor",
    points:[{x:0,y:0},{x:130,y:0},{x:130,y:32},
      {x:32,y:32},{x:32,y:140},{x:0,y:140}]};
  const start={x:110,y:15},end={x:15,y:120};
  const path=clearanceAStar(start,end,L);
  assert.ok(path&&path.length>=3,"A* must bend around the inset hallway");
  assert.deepEqual(path[0],start);assert.deepEqual(path.at(-1),end);
  for(let i=1;i<path.length;i++){
    assert.ok(segmentKeepsClearance(path[i-1],path[i],L,[],DEFAULT_WALL_CLEARANCE_PX,
      [start,end]),`Segment ${i} crosses or hugs the corridor boundary`);
  }
  assert.ok(path.some(p=>p.x>7&&p.x<25&&p.y>15),
    "walking path must pass through the vertical interior, not along x=32 wall");
});
test("A* avoids a drawn room obstacle within a broad walking polygon",()=>{
  const wide=rect("open","walkable",0,0,250,160);
  const obstacle=rect("obstacle","room",90,0,160,115);
  const start={x:25,y:70},end={x:225,y:70};
  const path=clearanceAStar(start,end,wide,[obstacle]);
  assert.ok(path&&path.length>2,"should detour around the room");
  for(let i=1;i<path.length;i++)
    assert.ok(segmentKeepsClearance(path[i-1],path[i],wide,[obstacle],7,[start,end]),
      "cannot cross the obstacle or skim its walls");
  assert.ok(path.some(p=>p.y>120),"detour must go below room's southern boundary");
});
test("no corridor clearance means no guided line even when graph topology is linked",()=>{
  const thin=rect("thin","walkable",100,0,200,12);
  const roomA=rect("A","room",0,0,100,12);
  const roomB=rect("B","room",200,0,300,12);
  const a={...door,id:"a",name:"A doorway",spaceAId:"A",spaceBId:"thin",
    start:{x:100,y:3},end:{x:100,y:9}};
  const b={...door,id:"b",name:"B doorway",spaceAId:"thin",spaceBId:"B",
    start:{x:200,y:3},end:{x:200,y:9}};
  const floor=ground([roomA,thin,roomB],[a,b]);
  const audit=buildNavigationAudit([floor],[]);
  const id=n=>audit.nodes.find(x=>x.label===n).id;
  const route=findValidatedRoute(audit,id("A"),id("B"));
  assert.equal(route.status,"ready");
  const safe=buildGuidedRoute(floor,route);
  assert.equal(safe.status,"needs-review");
  assert.deepEqual(safe.points,[],"never draw the old center-to-center estimated line");
});

test("shortest mapped route chooses nearby door, never the room/corridor label waypoint",()=>{
  const first=rect("From","room",0,0,100,200);
  const corridor=rect("Corridor","walkable",100,0,400,200);
  const last=rect("To","room",400,0,500,200);
  const lower={...door,id:"lower",name:"Lower door",
    start:{x:100,y:155},end:{x:100,y:185},spaceAId:"From",spaceBId:"Corridor"};
  const upper={...door,id:"upper",name:"Upper door",
    start:{x:100,y:15},end:{x:100,y:45},spaceAId:"From",spaceBId:"Corridor"};
  const finish={...door,id:"destination",name:"Destination",
    start:{x:400,y:15},end:{x:400,y:45},
    spaceAId:"Corridor",spaceBId:"To"};
  const floor=ground([first,corridor,last],[lower,upper,finish]);
  const graph=buildNavigationAudit([floor],[]);
  const id=(name)=>graph.nodes.find(n=>n.label===name).id;
  const route=findShortestMappedRoute(graph,[floor],[],id("From"),id("To"));
  assert.equal(route.status,"ready");
  assert.deepEqual(route.edges.map(e=>e.label),["Upper door","Destination"]);
  assert.ok(route.distancePx<340,"shortest route uses top doors rather than area centers");
  const steps=buildFloorRouteSteps([floor],[],route);
  assert.equal(steps[0].guidance.status,"guided",steps[0].guidance.message);
  assert.deepEqual(steps[0].guidance.points[0],{x:100,y:30});
  assert.deepEqual(steps[0].guidance.points.at(-1),{x:400,y:30});
  assert.ok(!steps[0].guidance.points.some(p=>Math.abs(p.y-100)<.01),
    "do not route through corridor label y=100");
});
test("shortest corridor join chooses the near side of a long approved opening",()=>{
  const first=rect("Start","room",0,0,100,200);
  const left=rect("Left hall","walkable",100,0,240,200);
  const right=rect("Right hall","walkable",240,0,400,200);
  const last=rect("Finish","room",400,0,500,200);
  const startDoor={...door,id:"d-start",name:"Start doorway",
    start:{x:100,y:15},end:{x:100,y:45},
    spaceAId:"Start",spaceBId:"Left hall"};
  const endDoor={...door,id:"d-end",name:"Finish doorway",
    start:{x:400,y:15},end:{x:400,y:45},
    spaceAId:"Right hall",spaceBId:"Finish"};
  const approval={areaAId:"Left hall",areaBId:"Right hall",
    geometryKey:walkwayGeometryKey(left,right)};
  const floor=ground([first,left,right,last],[startDoor,endDoor],[approval]);
  const graph=buildNavigationAudit([floor],[]);
  const id=(name)=>graph.nodes.find(n=>n.label===name).id;
  const route=findShortestMappedRoute(graph,[floor],[],id("Start"),id("Finish"));
  assert.equal(route.status,"ready");
  assert.deepEqual(route.edges.map(e=>e.kind),["door","walkway","door"]);
  assert.ok(route.transitions?.[1].from.y<65,
    "choose opening near y=30 instead of midpoint of whole boundary y=100");
  const guidance=buildFloorRouteSteps([floor],[],route)[0].guidance;
  assert.equal(guidance.status,"guided",guidance.message);
  assert.ok(guidance.points.every(p=>p.y<75),
    "the route should never swing to corridor labels");
  assert.ok(route.distancePx<340,"walking distance is nearly a direct horizontal path");
});
test("shortest mapped route rejects a graph link with no clearance instead of guessing through labels",()=>{
  const thin=rect("Thin","walkable",100,0,400,12);
  const a=rect("A","room",0,0,100,12),b=rect("B","room",400,0,500,12);
  const startDoor={...door,id:"da",name:"A door",
    start:{x:100,y:3},end:{x:100,y:9},spaceAId:"A",spaceBId:"Thin"};
  const endDoor={...door,id:"db",name:"B door",start:{x:400,y:3},
    end:{x:400,y:9},spaceAId:"Thin",spaceBId:"B"};
  const floor=ground([a,thin,b],[startDoor,endDoor]);
  const audit=buildNavigationAudit([floor],[]);
  const id=(name)=>audit.nodes.find(n=>n.label===name).id;
  const route=findShortestMappedRoute(audit,[floor],[],id("A"),id("B"));
  assert.equal(route.status,"unreachable");
  assert.deepEqual(route.edges,[]);
});

test("realistic outlined wall gap: reviewed door links inset room and corridor polygons without false no-route",()=>{
  // The plan image has a thick black wall between the blue room and green
  // corridor outlines. Each outline stops at the wall edge (14px apart).
  const reception=rect("Reception","room",0,0,95,100);
  const corridor=rect("Corridor","walkable",109,0,270,100);
  const toilet=rect("Toilet CR","room",284,0,380,100);
  const floor=ground([reception,corridor,toilet],[]);
  const fromId="f1:area:Reception",hallId="f1:area:Corridor",toId="f1:area:Toilet CR";
  const doorway=(id,name,spaceAId,spaceBId,x)=>({
    id,floorId:"f1",fromId:spaceAId,toId:spaceBId,kind:"door",
    status:"ready",direction:"both",label:name,doorPoint:{x,y:50},
    doorSpanPx:14,start:{x:0,y:0},end:{x:0,y:0},
  });
  const e1=doorway("d1","Reception door",fromId,hallId,102);
  const e2=doorway("d2","Toilet door",hallId,toId,277);
  const nodes=[
    {id:fromId,floorId:"f1",label:"Reception",kind:"room",point:{x:47,y:50}},
    {id:hallId,floorId:"f1",label:"Corridor",kind:"walkable",point:{x:190,y:50}},
    {id:toId,floorId:"f1",label:"Toilet CR",kind:"room",point:{x:330,y:50}},
  ];
  const audit={nodes,edges:[e1,e2],issues:[],walkways:[],
    readyDoorCount:2,reviewDoorCount:0,connectedSpaceCount:3,spaceCount:3};
  const pair1=navTransitionPair(e1,reception,corridor);
  assert.deepEqual(pair1,{from:{x:95,y:50},to:{x:109,y:50}});
  const pair2=navTransitionPair(e2,corridor,toilet);
  assert.deepEqual(pair2,{from:{x:270,y:50},to:{x:284,y:50}});
  const result=findShortestMappedRoute(audit,[floor],[],fromId,toId);
  assert.equal(result.status,"ready","do not claim no valid route when the door crosses a saved wall gap");
  assert.equal(result.edges.length,2);
  const guided=buildGuidedRoute(floor,result);
  assert.equal(guided.status,"guided",guided.message);
  assert.deepEqual(guided.points[0],{x:95,y:50});
  assert.deepEqual(guided.points.at(-1),{x:284,y:50});
  assert.ok(guided.points.some((p,i)=>i>0&&
    (guided.points[i-1].x+p.x)/2>110&&
    (guided.points[i-1].x+p.x)/2<270&&
    (guided.points[i-1].y+p.y)/2>=7&&
    (guided.points[i-1].y+p.y)/2<=93),
    "a long direct segment is valid without a redundant center/label waypoint");
});
test("never invent a passage across a wall gap without a matching registered doorway width",()=>{
  const room=rect("Room","room",0,0,95,100);
  const hall=rect("Hall","walkable",125,0,250,100);
  const edge={id:"d",floorId:"f1",fromId:"f1:area:Room",toId:"f1:area:Hall",
    kind:"door",status:"ready",direction:"both",label:"Too short doorway",
    doorPoint:{x:110,y:50},doorSpanPx:6,start:{x:110,y:50},end:{x:110,y:50}};
  assert.equal(navTransitionPair(edge,room,hall),null);
});

test("end-to-end editor audit: manually registered doorways across thick image-wall gaps remain navigable",()=>{
  const reception=rect("Reception","room",0,0,95,100);
  const corridor=rect("Corridor","walkable",109,0,270,100);
  const toilet=rect("Toilet CR","room",284,0,380,100);
  const d1={...door,id:"d-reception",name:"Reception door",
    start:{x:102,y:35},end:{x:102,y:65},displayDepthPx:14,
    spaceAId:"Reception",spaceBId:"Corridor"};
  const d2={...door,id:"d-toilet",name:"Toilet door",
    start:{x:277,y:35},end:{x:277,y:65},displayDepthPx:14,
    spaceAId:"Corridor",spaceBId:"Toilet CR"};
  const floor=ground([reception,corridor,toilet],[d1,d2]);
  const audit=buildNavigationAudit([floor],[]);
  assert.equal(audit.readyDoorCount,2,JSON.stringify(audit.issues));
  assert.equal(audit.reviewDoorCount,0);
  const from=audit.nodes.find(n=>n.label==="Reception").id;
  const to=audit.nodes.find(n=>n.label==="Toilet CR").id;
  const route=findShortestMappedRoute(audit,[floor],[],from,to);
  assert.equal(route.status,"ready","real graph must not say no valid route");
  const visual=buildFloorRouteSteps([floor],[],route);
  assert.equal(visual.length,1);
  assert.equal(visual[0].guidance.status,"guided",visual[0].guidance.message);
  assert.deepEqual(visual[0].guidance.points[0],{x:95,y:50});
  assert.deepEqual(visual[0].guidance.points.at(-1),{x:284,y:50});
});
