import type { DeviceType } from "@/lib/location-devices";

/** Actual SVG canvas dimensions. Size is the LONGEST edge in the floor image,
 * not a square wrapper. The white backing follows the SVG alpha silhouette.
 */
const SOURCE_DIMENSIONS:Record<DeviceType,{width:number;height:number}>={
  "single-sided":{width:1158,height:1031},
  "double-sided":{width:1400,height:697},
  "p-button":{width:407,height:698},
  "shield":{width:512,height:840},
};
export type DeviceIconDimensions={width:number;height:number};
export function deviceIconDimensions(
  type:DeviceType,sizePx:number,screenPixelsPerFloorPixel=1,
):DeviceIconDimensions{
  const original=SOURCE_DIMENSIONS[type];
  const longest=Math.max(original.width,original.height);
  const scale=Number.isFinite(screenPixelsPerFloorPixel)&&screenPixelsPerFloorPixel>0
    ?screenPixelsPerFloorPixel:1;
  const dimension=Math.max(0.01,sizePx*scale);
  return {
    width:dimension*original.width/longest,
    height:dimension*original.height/longest,
  };
}

/** Indoor marker dimensions follow the projection scale, keeping a constant
 * device footprint relative to the floor at every zoom. Does not edit sizePx.
 */
export function applyDeviceIconDimensions(
  element:HTMLElement,type:DeviceType,sizePx:number,screenPixelsPerFloorPixel=1,
):void{
  const {width,height}=deviceIconDimensions(type,sizePx,screenPixelsPerFloorPixel);
  const w=width+"px",h=height+"px";
  Object.assign(element.style,{
    width:w,height:h,minWidth:w,maxWidth:w,minHeight:h,maxHeight:h,
  });
}

/** White alpha-silhouette backing rather than a forced square white box. */
export function createDeviceIconElement(
  type:DeviceType,iconUrl:string,alt:string,
):HTMLDivElement{
  const element=document.createElement("div");
  element.dataset.deviceType=type;
  element.setAttribute("role","img");
  element.setAttribute("aria-label",alt);
  Object.assign(element.style,{
    boxSizing:"border-box",display:"block",flexShrink:"0",
    overflow:"visible",background:"transparent",border:"0",
    padding:"0",boxShadow:"none",transition:"none",
  });
  const backing=document.createElement("div");
  backing.dataset.deviceWhiteBacking="true";
  Object.assign(backing.style,{
    position:"absolute",inset:"0",background:"#ffffff",
    maskImage:`url("${iconUrl}")`,WebkitMaskImage:`url("${iconUrl}")`,
    maskSize:"100% 100%",WebkitMaskSize:"100% 100%",
    maskRepeat:"no-repeat",WebkitMaskRepeat:"no-repeat",
    pointerEvents:"none",
  });
  const image=document.createElement("img");
  image.src=iconUrl;
  image.alt="";
  image.draggable=false;
  Object.assign(image.style,{
    position:"absolute",inset:"1px",
    width:"calc(100% - 2px)",height:"calc(100% - 2px)",
    objectFit:"fill",pointerEvents:"none",display:"block",
  });
  element.append(backing,image);
  return element;
}
