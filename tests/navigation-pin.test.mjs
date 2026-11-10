import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import ts from "typescript";

const source=readFileSync(new URL("../src/lib/navigation-pin.ts",import.meta.url),"utf8");
const js=ts.transpileModule(source,{compilerOptions:{
  module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,
}}).outputText;
const moduleUrl="data:text/javascript;base64,"+Buffer.from(js).toString("base64");
const {createNavigationPinElement,NAVIGATION_PIN_SIZE_PX,NAVIGATION_PIN_Z_INDEX}=await import(moduleUrl);

test("navigation pin is a large circular map-pin icon with top stacking and accessible start/end labels",()=>{
  const prior=globalThis.document;
  const fake=(tag)=>({
    tag,
    style:{},
    attributes:{},
    children:[],
    title:"",
    setAttribute(name,value){this.attributes[name]=value;},
    appendChild(child){this.children.push(child);return child;},
  });
  globalThis.document={
    createElement:tag=>fake(tag),
    createElementNS:(_,tag)=>fake(tag),
  };
  try{
    assert.ok(NAVIGATION_PIN_SIZE_PX>=44,"marker larger than doorway icon");
    assert.ok(NAVIGATION_PIN_Z_INDEX>10000);
    for(const [kind,color] of [["start","#059669"],["end","#dc2626"]]){
      const pin=createNavigationPinElement(kind);
      assert.equal(pin.attributes["data-navigation-pin"],kind);
      assert.equal(pin.attributes.role,"img");
      assert.match(pin.attributes["aria-label"],/doorway/);
      assert.equal(pin.style.width,`${NAVIGATION_PIN_SIZE_PX}px`);
      assert.equal(pin.style.height,`${NAVIGATION_PIN_SIZE_PX}px`);
      assert.equal(pin.style.borderRadius,"50%");
      assert.equal(pin.style.backgroundColor,color);
      assert.equal(pin.style.pointerEvents,"none");
      assert.equal(pin.style.zIndex,String(NAVIGATION_PIN_Z_INDEX));
      assert.equal(pin.children[0].tag,"svg");
      assert.deepEqual(pin.children[0].children.map(c=>c.tag),["path","circle"]);
    }
  }finally{
    if(prior===undefined)delete globalThis.document;
    else globalThis.document=prior;
  }
});
test("canvas route pins mount above doorway DOM icons on every load and update",()=>{
  const canvas=readFileSync(new URL("../src/components/map/floor-plan-canvas.tsx",import.meta.url),"utf8");
  assert.match(canvas,/marker\.getElement\(\)\.style\.zIndex=String\(NAVIGATION_PIN_Z_INDEX\)/);
  const onLoad=canvas.slice(canvas.indexOf('map.on("load",()=>{'));
  assert.ok(onLoad.indexOf('updateRoutePins(map,lib,data.navigationSelection')>
    onLoad.indexOf('for(const portal of data.portals)'),
    "map-load endpoint icons must be mounted after doorway icons");
  assert.ok(canvas.includes("routePins.current.forEach(marker=>marker.remove())"),
    "route pins are replaced when the selection changes");
  assert.ok(canvas.includes("routePins.current.forEach(m=>m.remove())"),
    "route pins are removed when the map unmounts");
});
