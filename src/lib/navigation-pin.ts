/** MapLibre DOM pin for a selected route endpoint.
 * DOM markers are intentionally above the MapLibre canvas AND ordinary
 * doorway DOM markers. pointer-events:none preserves doorway editing.
 */
export type NavigationPinKind="start"|"end";

export const NAVIGATION_PIN_SIZE_PX=48;
export const NAVIGATION_PIN_Z_INDEX=2147483647;

export function createNavigationPinElement(kind:NavigationPinKind):HTMLElement {
  const el=document.createElement("div");
  const start=kind==="start";
  el.setAttribute("data-navigation-pin",kind);
  el.setAttribute("role","img");
  el.setAttribute("aria-label",start?"Route start at doorway":"Route destination at doorway");
  el.title=start?"Start":"Destination";
  Object.assign(el.style,{
    width:`${NAVIGATION_PIN_SIZE_PX}px`,
    height:`${NAVIGATION_PIN_SIZE_PX}px`,
    boxSizing:"border-box",
    borderRadius:"50%",
    border:"4px solid white",
    backgroundColor:start?"#059669":"#dc2626",
    color:"#ffffff",
    display:"flex",
    alignItems:"center",
    justifyContent:"center",
    boxShadow:"0 3px 12px rgba(0,0,0,.4), 0 0 0 2px rgba(255,255,255,.65)",
    pointerEvents:"none",
    userSelect:"none",
    zIndex:String(NAVIGATION_PIN_Z_INDEX),
  });

  const ns="http://www.w3.org/2000/svg";
  const svg=document.createElementNS(ns,"svg");
  for(const [name,value] of Object.entries({
    viewBox:"0 0 24 24",width:"25",height:"25",fill:"none",
    stroke:"currentColor","stroke-width":"2.3",
    "stroke-linecap":"round","stroke-linejoin":"round",
    "aria-hidden":"true",
  }))svg.setAttribute(name,value);
  const pin=document.createElementNS(ns,"path");
  pin.setAttribute("d","M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z");
  const dot=document.createElementNS(ns,"circle");
  dot.setAttribute("cx","12");
  dot.setAttribute("cy","10");
  dot.setAttribute("r","2.5");
  svg.appendChild(pin);
  svg.appendChild(dot);
  el.appendChild(svg);
  return el;
}
