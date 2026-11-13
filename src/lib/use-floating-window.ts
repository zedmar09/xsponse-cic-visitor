"use client";

import {useEffect,useRef,useState,type KeyboardEvent,type PointerEvent} from "react";
import {clampFloatingPosition,type FloatingPosition} from "@/lib/floating-window";

const EDGE_GAP=8;
type DragState={pointerId:number;offsetX:number;offsetY:number};

/** Shared drag / keyboard-move behaviour for panels floating over the map.
 * Positions are clamped inside the panel's parent (the map section). */
export function useFloatingWindow<T extends HTMLElement>(
  initialPosition?:(panel:T,container:HTMLElement)=>FloatingPosition|null,
){
  const panelRef=useRef<T>(null);
  const dragRef=useRef<DragState|null>(null);
  const initialRef=useRef(initialPosition);
  const [position,setPosition]=useState<FloatingPosition|null>(null);

  const bounds=(panel:HTMLElement,container:HTMLElement)=>({
    containerWidth:container.clientWidth,
    containerHeight:container.clientHeight,
    panelWidth:panel.offsetWidth,
    panelHeight:panel.offsetHeight,
    gap:EDGE_GAP,
  });
  const clamp=(candidate:FloatingPosition)=>{
    const panel=panelRef.current;
    const container=panel?.parentElement;
    if(!panel||!container)return candidate;
    return clampFloatingPosition(candidate,bounds(panel,container));
  };
  const currentPosition=()=>{
    const panel=panelRef.current;
    const container=panel?.parentElement;
    if(!panel||!container)return {x:EDGE_GAP,y:EDGE_GAP};
    const panelRect=panel.getBoundingClientRect();
    const containerRect=container.getBoundingClientRect();
    return {x:panelRect.left-containerRect.left,y:panelRect.top-containerRect.top};
  };

  const startDrag=(event:PointerEvent<HTMLDivElement>)=>{
    if(event.button!==0)return;
    const panel=panelRef.current;
    if(!panel)return;
    const rect=panel.getBoundingClientRect();
    setPosition(clamp(currentPosition()));
    dragRef.current={
      pointerId:event.pointerId,
      offsetX:event.clientX-rect.left,
      offsetY:event.clientY-rect.top,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  };

  const moveDrag=(event:PointerEvent<HTMLDivElement>)=>{
    const drag=dragRef.current;
    const container=panelRef.current?.parentElement;
    if(!drag||drag.pointerId!==event.pointerId||!container)return;
    const containerRect=container.getBoundingClientRect();
    setPosition(clamp({
      x:event.clientX-containerRect.left-drag.offsetX,
      y:event.clientY-containerRect.top-drag.offsetY,
    }));
    event.preventDefault();
    event.stopPropagation();
  };

  const stopDrag=(event:PointerEvent<HTMLDivElement>)=>{
    if(dragRef.current?.pointerId!==event.pointerId)return;
    dragRef.current=null;
    if(event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    event.stopPropagation();
  };

  const cancelDrag=()=>{dragRef.current=null;};

  const moveWithKeyboard=(event:KeyboardEvent<HTMLDivElement>)=>{
    const step=event.shiftKey?32:12;
    const movement=event.key==="ArrowLeft"?{x:-step,y:0}:
      event.key==="ArrowRight"?{x:step,y:0}:
      event.key==="ArrowUp"?{x:0,y:-step}:
      event.key==="ArrowDown"?{x:0,y:step}:null;
    if(!movement)return;
    const current=position??currentPosition();
    setPosition(clamp({x:current.x+movement.x,y:current.y+movement.y}));
    event.preventDefault();
    event.stopPropagation();
  };

  useEffect(()=>{
    const panel=panelRef.current;
    const container=panel?.parentElement;
    if(!panel||!container)return;
    const initial=initialRef.current?.(panel,container);
    if(initial)setPosition(clampFloatingPosition(initial,bounds(panel,container)));
    if(typeof ResizeObserver==="undefined")return;
    const observer=new ResizeObserver(()=>{
      setPosition(current=>current?clampFloatingPosition(current,bounds(panel,container)):current);
    });
    observer.observe(container);
    observer.observe(panel);
    return ()=>observer.disconnect();
  },[]);

  return {panelRef,position,startDrag,moveDrag,stopDrag,cancelDrag,moveWithKeyboard};
}
