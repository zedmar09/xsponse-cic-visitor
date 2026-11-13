export type FloatingPosition={x:number;y:number};
export type FloatingBounds={
  containerWidth:number;
  containerHeight:number;
  panelWidth:number;
  panelHeight:number;
  gap:number;
};

export function clampFloatingPosition(
  position:FloatingPosition,bounds:FloatingBounds,
):FloatingPosition{
  const maxX=Math.max(bounds.gap,bounds.containerWidth-bounds.panelWidth-bounds.gap);
  const maxY=Math.max(bounds.gap,bounds.containerHeight-bounds.panelHeight-bounds.gap);
  return {
    x:Math.min(maxX,Math.max(bounds.gap,position.x)),
    y:Math.min(maxY,Math.max(bounds.gap,position.y)),
  };
}
