/** Independent outdoor alignment of a saved indoor floor. Image-local geometry never changes. */
export type OutdoorFloorPlacement = {
  longitude:number;
  latitude:number;
  widthMeters:number;
  /** Optional explicit height allows non-proportional resize; older records infer the image aspect. */
  heightMeters?:number;
  rotationDegrees:number;
  /** Shear in the image's horizontal and vertical directions. */
  skewXDegrees?:number;
  skewYDegrees?:number;
  /** Independent per-corner deformation, in local pre-rotation metres.
   * Order: top-left, top-right, bottom-right, bottom-left.
   * This is separate from the global affine skew sliders.
   */
  cornerWarpOffsets?: OutdoorFloorCorners;
  opacity:number;
};

export type OutdoorFloorCorners = [[number,number],[number,number],[number,number],[number,number]];

export function defaultFloorPlacement(longitude:number,latitude:number):OutdoorFloorPlacement {
  return {longitude,latitude,widthMeters:40,rotationDegrees:0,opacity:0.75};
}

export function floorPlacementHeight(p:OutdoorFloorPlacement,imageWidth:number,imageHeight:number):number {
  return p.heightMeters??p.widthMeters*imageHeight/imageWidth;
}

export function floorPlacementError(p:OutdoorFloorPlacement):string|null {
  if(!Number.isFinite(p.longitude)||p.longitude < -180||p.longitude > 180||
     !Number.isFinite(p.latitude)||p.latitude < -80||p.latitude > 80)
    return "Choose a valid outdoor point before placing this floor.";
  if(!Number.isFinite(p.widthMeters)||p.widthMeters < 2||p.widthMeters > 5000)
    return "Floor width must be between 2 and 5000 metres.";
  if(p.heightMeters!==undefined&&
    (!Number.isFinite(p.heightMeters)||p.heightMeters < 2||p.heightMeters > 5000))
    return "Floor height must be between 2 and 5000 metres.";
  if(!Number.isFinite(p.rotationDegrees)||p.rotationDegrees < -180||p.rotationDegrees > 180)
    return "Rotation must be between -180 and 180 degrees.";
  for(const angle of [p.skewXDegrees??0,p.skewYDegrees??0]){
    if(!Number.isFinite(angle)||Math.abs(angle)>35)
      return "Skew must be between -35 and 35 degrees.";
  }
  if(p.cornerWarpOffsets!==undefined){
    if(!Array.isArray(p.cornerWarpOffsets)||p.cornerWarpOffsets.length!==4||
      p.cornerWarpOffsets.some(offset=>!Array.isArray(offset)||offset.length!==2||
        offset.some(value=>!Number.isFinite(value)||Math.abs(value)>5000)))
      return "Each floor corner must have a valid warp offset within 5000 metres.";
  }
  if(!Number.isFinite(p.opacity)||p.opacity < 0.1||p.opacity > 1)
    return "Opacity must be between 10% and 100%.";
  return null;
}

export function resizeFloorWidth(
  p:OutdoorFloorPlacement,width:number,imageWidth:number,imageHeight:number,proportional:boolean,
):OutdoorFloorPlacement {
  if(!Number.isFinite(width)||width<2||width>5000)return p;
  const previousHeight=floorPlacementHeight(p,imageWidth,imageHeight);
  const nextHeight=proportional?previousHeight*width/p.widthMeters:previousHeight;
  if(!Number.isFinite(nextHeight)||nextHeight<2||nextHeight>5000)return p;
  return {...p,widthMeters:width,heightMeters:nextHeight};
}
export function resizeFloorHeight(
  p:OutdoorFloorPlacement,height:number,imageWidth:number,imageHeight:number,proportional:boolean,
):OutdoorFloorPlacement {
  if(!Number.isFinite(height)||height<2||height>5000)return p;
  const previousHeight=floorPlacementHeight(p,imageWidth,imageHeight);
  const width=proportional?p.widthMeters*height/previousHeight:p.widthMeters;
  if(!Number.isFinite(width)||width<2||width>5000)return p;
  return {...p,widthMeters:width,heightMeters:height};
}
export function scaleFloorProportionally(
  p:OutdoorFloorPlacement,factor:number,imageWidth:number,imageHeight:number,
):OutdoorFloorPlacement {
  if(!Number.isFinite(factor)||factor<=0)return p;
  return resizeFloorWidth(p,p.widthMeters*factor,imageWidth,imageHeight,true);
}

/** MapLibre image corners: top-left, top-right, bottom-right, bottom-left.
 * A sheared, rotated, possibly non-square quadrilateral is mapped in geographic
 * coordinates. Local pixel annotations remain untouched. Scale is approximate
 * over large map areas; this is for plan overlay alignment, not geodetic surveying.
 */
export function floorImageCorners(
  p:OutdoorFloorPlacement,imageWidth:number,imageHeight:number,
):OutdoorFloorCorners {
  const error=floorPlacementError(p);
  if(error)throw new Error(error);
  if(!Number.isFinite(imageWidth)||!Number.isFinite(imageHeight)||imageWidth<=0||imageHeight<=0)
    throw new Error("Indoor floor image dimensions must be positive.");
  const height=floorPlacementHeight(p,imageWidth,imageHeight);
  if(height<2||height>5000)
    throw new Error("Floor height must be between 2 and 5000 metres.");
  const angle=p.rotationDegrees*Math.PI/180;
  const cos=Math.cos(angle),sin=Math.sin(angle);
  const shearX=Math.tan((p.skewXDegrees??0)*Math.PI/180);
  const shearY=Math.tan((p.skewYDegrees??0)*Math.PI/180);
  const halfWidth=p.widthMeters/2,halfHeight=height/2;
  const eastMetersPerDegree=111320*Math.cos(p.latitude*Math.PI/180);
  const toLngLat=(x:number,y:number,index:number):[number,number]=>{
    const offset=p.cornerWarpOffsets?.[index]??[0,0];
    const sx=x+shearX*y+offset[0],sy=y+shearY*x+offset[1];
    const east=sx*cos+sy*sin;
    const north=-sx*sin+sy*cos;
    return [p.longitude+east/eastMetersPerDegree,p.latitude+north/111320];
  };
  const corners:OutdoorFloorCorners=[
    toLngLat(-halfWidth,halfHeight,0),toLngLat(halfWidth,halfHeight,1),
    toLngLat(halfWidth,-halfHeight,2),toLngLat(-halfWidth,-halfHeight,3),
  ];
  if(!isConvexFloorQuad(corners,p.latitude))
    throw new Error("The floor corners cannot cross or fold over one another.");
  return corners;
}

/** A handle lies outward from the top edge to make rotation intuitive. */
export function floorRotationHandle(
  p:OutdoorFloorPlacement,imageWidth:number,imageHeight:number,
):[number,number] {
  const corners=floorImageCorners(p,imageWidth,imageHeight);
  const midTop:[number,number]=[
    (corners[0][0]+corners[1][0])/2,
    (corners[0][1]+corners[1][1])/2,
  ];
  return [
    p.longitude+(midTop[0]-p.longitude)*1.5,
    p.latitude+(midTop[1]-p.latitude)*1.5,
  ];
}

/** Rotating a draggable top handle changes bearing without moving floor centre. */
export function rotateFloorFromHandle(
  p:OutdoorFloorPlacement,from:[number,number],to:[number,number],
):OutdoorFloorPlacement {
  if(floorPlacementError(p)||!Number.isFinite(to[0])||!Number.isFinite(to[1]))return p;
  const toBearing=(point:[number,number])=>{
    const east=(point[0]-p.longitude)*111320*Math.cos(p.latitude*Math.PI/180);
    const north=(point[1]-p.latitude)*111320;
    return Math.atan2(east,north);
  };
  const oldBearing=toBearing(from),nextBearing=toBearing(to);
  if(!Number.isFinite(oldBearing)||!Number.isFinite(nextBearing))return p;
  const raw=p.rotationDegrees+(nextBearing-oldBearing)*180/Math.PI;
  const angle=((raw+180)%360+360)%360-180;
  return {...p,rotationDegrees:Number(angle.toFixed(3))};
}

/** Dragging a corner changes its local x/y extents. With proportions locked,
 * both dimensions expand by one common factor; otherwise they scale separately.
 * Rotation and shear are explicitly preserved, not guessed from screen pixels.
 */
/** A warped image quad must stay convex; folded quads cannot map reliably
 * in MapLibre (and could put doorways on the wrong side of rooms).
 */
function isConvexFloorQuad(corners:OutdoorFloorCorners,latitude:number):boolean {
  const latitudeScale=111320,longitudeScale=111320*Math.cos(latitude*Math.PI/180);
  const pts=corners.map(c=>[c[0]*longitudeScale,c[1]*latitudeScale]);
  let sign=0;
  for(let i=0;i<4;i++){
    const a=pts[i],b=pts[(i+1)%4],c=pts[(i+2)%4];
    const cross=(b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]);
    // Keep the clockwise top-left -> top-right -> bottom-right -> bottom-left order.
    if(!Number.isFinite(cross)||cross>=-0.01)return false;
    sign+=cross;
  }
  return sign<0;
}

export function resizeFloorFromCorner(
  p:OutdoorFloorPlacement,imageWidth:number,imageHeight:number,
  cornerIndex:number,to:[number,number],proportional:boolean,
):OutdoorFloorPlacement {
  if(cornerIndex<0||cornerIndex>3||!Number.isInteger(cornerIndex)||
    !Number.isFinite(to[0])||!Number.isFinite(to[1])||floorPlacementError(p))return p;
  if(imageWidth<=0||imageHeight<=0)return p;
  const east=(to[0]-p.longitude)*111320*Math.cos(p.latitude*Math.PI/180);
  const north=(to[1]-p.latitude)*111320;
  const angle=p.rotationDegrees*Math.PI/180;
  const cos=Math.cos(angle),sin=Math.sin(angle);
  const sx=east*cos-north*sin,sy=east*sin+north*cos;
  const shearX=Math.tan((p.skewXDegrees??0)*Math.PI/180);
  const shearY=Math.tan((p.skewYDegrees??0)*Math.PI/180);
  const determinant=1-shearX*shearY;
  const offset=p.cornerWarpOffsets?.[cornerIndex]??[0,0];
  const x=(sx-shearX*sy)/determinant-
    (offset[0]-shearX*offset[1])/determinant;
  const y=(sy-shearY*sx)/determinant-
    (offset[1]-shearY*offset[0])/determinant;
  const signX=cornerIndex===0||cornerIndex===3?-1:1;
  const signY=cornerIndex===0||cornerIndex===1?1:-1;
  const h=floorPlacementHeight(p,imageWidth,imageHeight);
  const startX=signX*p.widthMeters/2,startY=signY*h/2;
  // Disallow crossing over the image centre or turning the polygon inside out.
  if(x*signX<=0||y*signY<=0)return p;
  if(proportional){
    const factor=(x*startX+y*startY)/(startX*startX+startY*startY);
    return scaleFloorProportionally(p,factor,imageWidth,imageHeight);
  }
  const result={...p,widthMeters:2*x*signX,heightMeters:2*y*signY};
  return floorPlacementError(result)?p:result;
}

/** Photoshop-style transform handles: corners TL/TR/BR/BL (0-3), then
 * top/right/bottom/left edge midpoints (4-7). Midpoints are interpolated
 * in Web Mercator to match the image source's flat map projection.
 */
export function floorResizeHandlePoints(
  p:OutdoorFloorPlacement,imageWidth:number,imageHeight:number,
):[number,number][] {
  const corners=floorImageCorners(p,imageWidth,imageHeight);
  const mercY=(latitude:number)=>Math.log(Math.tan(Math.PI/4+latitude*Math.PI/360));
  const latFromMercY=(y:number)=>(2*Math.atan(Math.exp(y))-Math.PI/2)*180/Math.PI;
  const midpoint=(a:[number,number],b:[number,number]):[number,number]=>[
    (a[0]+b[0])/2,latFromMercY((mercY(a[1])+mercY(b[1]))/2),
  ];
  return [
    ...corners,
    midpoint(corners[0],corners[1]), // top
    midpoint(corners[1],corners[2]), // right
    midpoint(corners[2],corners[3]), // bottom
    midpoint(corners[3],corners[0]), // left
  ];
}

/** Keep original corner behavior. Edge grips resize their relevant dimension
 * about the group's centre; when Lock proportions is active, both dimensions
 * change together. Rotation and skew are inverted before measuring the drag.
 */
export function resizeFloorFromHandle(
  p:OutdoorFloorPlacement,imageWidth:number,imageHeight:number,
  handleIndex:number,to:[number,number],proportional:boolean,
):OutdoorFloorPlacement {
  if(!Number.isInteger(handleIndex)||handleIndex<0||handleIndex>7||
    !Number.isFinite(to[0])||!Number.isFinite(to[1])||floorPlacementError(p)||
    imageWidth<=0||imageHeight<=0)return p;
  if(handleIndex<4)return resizeFloorFromCorner(
    p,imageWidth,imageHeight,handleIndex,to,proportional,
  );
  const east=(to[0]-p.longitude)*111320*Math.cos(p.latitude*Math.PI/180);
  const north=(to[1]-p.latitude)*111320;
  const angle=p.rotationDegrees*Math.PI/180;
  const cosine=Math.cos(angle),sine=Math.sin(angle);
  const rotatedX=east*cosine-north*sine;
  const rotatedY=east*sine+north*cosine;
  const shearX=Math.tan((p.skewXDegrees??0)*Math.PI/180);
  const shearY=Math.tan((p.skewYDegrees??0)*Math.PI/180);
  const determinant=1-shearX*shearY;
  const edgeCorners:Array<[number,number]>=[
    [0,1],[1,2],[2,3],[3,0],
  ];
  const [a,b]=edgeCorners[handleIndex-4];
  const left=p.cornerWarpOffsets?.[a]??[0,0];
  const right=p.cornerWarpOffsets?.[b]??[0,0];
  const offsetX=(left[0]+right[0])/2,offsetY=(left[1]+right[1])/2;
  const x=(rotatedX-shearX*rotatedY-offsetX+shearX*offsetY)/determinant;
  const y=(rotatedY-shearY*rotatedX-offsetY+shearY*offsetX)/determinant;
  switch(handleIndex){
    case 4: return y>0?resizeFloorHeight(p,2*y,imageWidth,imageHeight,proportional):p;
    case 5: return x>0?resizeFloorWidth(p,2*x,imageWidth,imageHeight,proportional):p;
    case 6: return y<0?resizeFloorHeight(p,-2*y,imageWidth,imageHeight,proportional):p;
    case 7: return x<0?resizeFloorWidth(p,-2*x,imageWidth,imageHeight,proportional):p;
    default: return p;
  }
}

/** In Skew mode: a corner grip moves ONLY its corresponding corner. An edge
 * grip moves the two corners of that edge by the same amount. Its midpoint
 * follows the drag, while the other two corners stay fixed.
 *
 * Offsets are saved in floor-local, pre-rotation metres, so later rotation
 * moves the complete warped group. Image and indoor vectors keep exactly
 * the same four-corner MapLibre geographic mapping.
 */
export function skewFloorFromHandle(
  p:OutdoorFloorPlacement,imageWidth:number,imageHeight:number,
  handleIndex:number,to:[number,number],
):OutdoorFloorPlacement {
  if(!Number.isInteger(handleIndex)||handleIndex<0||handleIndex>7||
    !Number.isFinite(to[0])||!Number.isFinite(to[1])||floorPlacementError(p)||
    imageWidth<=0||imageHeight<=0)return p;
  let from:[number,number];
  try{from=floorResizeHandlePoints(p,imageWidth,imageHeight)[handleIndex];}
  catch{return p;}
  const metresEast=(to[0]-from[0])*111320*Math.cos(p.latitude*Math.PI/180);
  const metresNorth=(to[1]-from[1])*111320;
  const angle=p.rotationDegrees*Math.PI/180;
  const cos=Math.cos(angle),sin=Math.sin(angle);
  // Undo the group's rotation; local offsets are applied after affine shear.
  const localX=metresEast*cos-metresNorth*sin;
  const localY=metresEast*sin+metresNorth*cos;
  const offsets:OutdoorFloorCorners=[
    ...(p.cornerWarpOffsets??[[0,0],[0,0],[0,0],[0,0]]),
  ].map(([x,y])=>[x,y]) as OutdoorFloorCorners;
  const affected=handleIndex<4?[handleIndex]:
    [[0,1],[1,2],[2,3],[3,0]][handleIndex-4];
  for(const index of affected){
    offsets[index]=[offsets[index][0]+localX,offsets[index][1]+localY];
  }
  const next:OutdoorFloorPlacement={...p,cornerWarpOffsets:offsets};
  if(floorPlacementError(next))return p;
  try{floorImageCorners(next,imageWidth,imageHeight);}
  catch{return p;}
  return next;
}
