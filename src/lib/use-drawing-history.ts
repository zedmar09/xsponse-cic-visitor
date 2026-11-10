"use client";

import { useCallback, useRef, useState } from "react";
import type { PixelPoint } from "@/lib/floor-plan";

export type DraftFrame = { points: PixelPoint[]; closed: boolean };
type History = { past: DraftFrame[]; current: DraftFrame; future: DraftFrame[] };
const initialFrame: DraftFrame = { points: [], closed: false };
const MAX_UNDO = 100;

function equalFrame(a: DraftFrame, b: DraftFrame) {
  return a.closed === b.closed &&
    a.points.length === b.points.length &&
    a.points.every((p, i) => p.x === b.points[i].x && p.y === b.points[i].y);
}

export function useDrawingHistory() {
  const [state, setState] = useState<History>({ past: [], current: initialFrame, future: [] });
  const draggingFrom = useRef<DraftFrame | null>(null);
  const reset = useCallback((points: PixelPoint[] = [], closed = false) => {
    draggingFrom.current = null;
    setState({ past: [], current: { points: [...points], closed }, future: [] });
  }, []);
  const commit = useCallback((operation: (current: DraftFrame) => DraftFrame) => {
    setState(previous => {
      const next = operation(previous.current);
      if (equalFrame(next, previous.current)) return previous;
      return {
        past: [...previous.past, previous.current].slice(-MAX_UNDO),
        current: next,
        future: [],
      };
    });
  }, []);
  const add = useCallback((point: PixelPoint, maxPoints: number) => commit(frame => {
    if (frame.closed || frame.points.length >= maxPoints) return frame;
    return { ...frame, points: [...frame.points, point] };
  }), [commit]);
  const close = useCallback(() => commit(frame =>
    !frame.closed && frame.points.length >= 3 ? { ...frame, closed: true } : frame
  ), [commit]);
  const removeLast = useCallback(() => commit(frame => ({
    closed: false,
    points: frame.points.slice(0, -1),
  })), [commit]);
  const undo = useCallback(() => setState(previous => {
    if (!previous.past.length || draggingFrom.current) return previous;
    return {
      past: previous.past.slice(0, -1),
      current: previous.past[previous.past.length - 1],
      future: [previous.current, ...previous.future],
    };
  }), []);
  const redo = useCallback(() => setState(previous => {
    if (!previous.future.length || draggingFrom.current) return previous;
    return {
      past: [...previous.past, previous.current].slice(-MAX_UNDO),
      current: previous.future[0],
      future: previous.future.slice(1),
    };
  }), []);
  const activePoints = state.current.points;
  const activeClosed = state.current.closed;
  const beginVertexDrag = useCallback(() => {
    draggingFrom.current = { closed: activeClosed, points: [...activePoints] };
  }, [activeClosed, activePoints]);
  const moveVertex = useCallback((index: number, point: PixelPoint) => {
    setState(previous => {
      if (!draggingFrom.current || !previous.current.points[index]) return previous;
      const points = previous.current.points.map((p, i) => i === index ? point : p);
      return { ...previous, current: { ...previous.current, points } };
    });
  }, []);
  const endVertexDrag = useCallback(() => {
    const before = draggingFrom.current;
    draggingFrom.current = null;
    if (!before) return;
    setState(previous => equalFrame(before, previous.current) ? previous : ({
      past: [...previous.past, before].slice(-MAX_UNDO),
      current: previous.current,
      future: [],
    }));
  }, []);

  return {
    points: state.current.points,
    closed: state.current.closed,
    undoAvailable: state.past.length > 0,
    redoAvailable: state.future.length > 0,
    reset, add, close, removeLast, undo, redo,
    beginVertexDrag, moveVertex, endVertexDrag,
  };
}
