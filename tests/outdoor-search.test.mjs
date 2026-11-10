import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import ts from "typescript";

const src=(file)=>ts.transpileModule(readFileSync(new URL(file,import.meta.url),"utf8"),{
  compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022},
}).outputText;
const data=s=>"data:text/javascript;base64,"+Buffer.from(s).toString("base64");
const helperUrl=data(src("../src/lib/outdoor-search.ts"));
const {normalizeOutdoorQuery,parseOutdoorResults}=await import(helperUrl);

test("outdoor query only accepts user-submitted readable search text",()=>{
  assert.equal(normalizeOutdoorQuery(" Rizal   Park, Manila "),"Rizal Park, Manila");
  for(const bad of ["","   ","x","x".repeat(141),null,{},17])
    assert.equal(normalizeOutdoorQuery(bad),null);
});
test("geocoder results have valid map coordinates, useful zoom and no duplicate locations",()=>{
  const values=[
    {place_id:1,display_name:"Rizal Park, Manila",lat:"14.5824",lon:"120.9790",addresstype:"park"},
    {place_id:1,display_name:"Rizal Park, Manila",lat:"14.5824",lon:"120.9790",addresstype:"park"},
    {place_id:2,display_name:"Manila, Philippines",lat:"14.6",lon:"120.98",addresstype:"city"},
    {place_id:3,display_name:"Bad",lat:null,lon:"12"},
    {place_id:4,display_name:"Bad",lat:"91",lon:"12"},
    {place_id:5,display_name:"Bad",lat:"Infinity",lon:"12"},
    {place_id:6,display_name:"Bad",lat:"14",lon:"181"},
    {place_id:7,display_name:"Bad",lat:"",lon:"3"},
    {place_id:8,display_name:"Bad",lon:"3"},
  ];
  const results=parseOutdoorResults(values);
  assert.equal(results.length,2);
  assert.deepEqual(results[0],{
    id:"1",label:"Rizal Park, Manila",latitude:14.5824,longitude:120.979,zoom:16,
  });
  assert.equal(results[1].zoom,12);
  assert.deepEqual(parseOutdoorResults({}),[]);
  assert.deepEqual(parseOutdoorResults(null),[]);
});
test("geocoding API searches only on request, caches identical queries and limits bursts",async()=>{
  const apiUrl=data(src("../src/app/api/location-search/route.ts")
    .replaceAll('"@/lib/outdoor-search"',JSON.stringify(helperUrl))
    .replaceAll('"next/server"',JSON.stringify(data(
      'export const NextResponse={json:(data,init)=>Response.json(data,init)};'))));
  const {GET}=await import(apiUrl);
  const originalFetch=globalThis.fetch,realNow=Date.now;
  let now=10000,calls=0;
  Date.now=()=>now;
  globalThis.fetch=async (url,opts)=>{
    calls++;
    assert.match(String(url),/nominatim\.openstreetmap\.org\/search/);
    assert.ok(opts.headers["User-Agent"].includes("IndoorMapStudio"));
    assert.equal(new URL(String(url)).searchParams.get("q"),"Rizal Park, Manila");
    return Response.json([{place_id:5,display_name:"Rizal Park, Manila",
      lat:"14.5824",lon:"120.9790",addresstype:"park"}]);
  };
  try {
    const invalid=await GET(new Request("https://example.test/api/location-search?q=x"));
    assert.equal(invalid.status,400);
    const first=await GET(new Request(
      "https://example.test/api/location-search?q=Rizal%20Park%2C%20Manila"));
    assert.equal(first.status,200);
    assert.equal((await first.json()).results[0].latitude,14.5824);
    assert.equal(calls,1);
    const cached=await GET(new Request(
      "https://example.test/api/location-search?q=rizal%20park%2C%20manila"));
    assert.equal(cached.status,200);
    assert.equal(calls,1);
    const busy=await GET(new Request("https://example.test/api/location-search?q=Intramuros"));
    assert.equal(busy.status,429);
    assert.equal(calls,1);
  }finally{
    globalThis.fetch=originalFetch;
    Date.now=realNow;
  }
});
test("outdoor map target receives animation request and is not part of floor storage",()=>{
  const map=readFileSync(new URL("../src/components/map/map-canvas.tsx",import.meta.url),"utf8");
  const workspace=readFileSync(new URL("../src/components/map/map-workspace.tsx",import.meta.url),"utf8");
  const search=readFileSync(new URL("../src/components/map/outdoor-location-search.tsx",import.meta.url),"utf8");
  assert.match(map,/map\.flyTo\(\{/);
  assert.match(map,/longitude,target\.latitude/);
  assert.match(map,/duration:1800/);
  assert.match(map,/map\.on\("load", \(\)=>\{/);
  assert.match(map,/applyInitialSearch\(\)/);
  assert.match(workspace,/focusTarget=\{streetTarget\}/);
  assert.match(workspace,/setStreetTarget\(null\);setSearchChoice\(null\);setSelectedSavedLocationId\(null\);setResetStreet/);
  assert.match(search,/onSubmit=\{event=>\{void search\(event\)\}\}/);
  assert.doesNotMatch(search,/onKeyUp.*fetch|onChange.*fetch/);
});
