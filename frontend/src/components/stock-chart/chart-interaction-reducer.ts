import { clamp, wheelZoomSensitivity, type Viewport } from "@/components/stock-chart/chart-types";

export interface InteractionState {
  viewport: Viewport;
  hoverIndex: number | null;
  hoverOnLine: boolean;
  dragStartIndex: number | null;
  dragEndIndex: number | null;
  isPanning: boolean;
}

export type InteractionAction =
  | { type: "reset"; viewport: Viewport }
  | { type: "panned"; start: number }
  | { type: "panDragged"; start: number }
  | { type: "zoomed"; deltaY: number; pointerRatio: number; totalCandles: number; minimumSize: number }
  | { type: "hovered"; index: number; onLine: boolean }
  | { type: "hoverCleared" }
  | { type: "panStarted" }
  | { type: "selectionStarted"; index: number }
  | { type: "released" };

export const idleInteraction = {
  hoverIndex: null,
  hoverOnLine: false,
  dragStartIndex: null,
  dragEndIndex: null,
  isPanning: false,
};

export function interactionReducer(
  state: InteractionState,
  action: InteractionAction,
): InteractionState {
  switch (action.type) {
    case "reset":
      return { viewport: action.viewport, ...idleInteraction };
    case "panned":
      return state.viewport.start === action.start
        ? state
        : { ...state, viewport: { ...state.viewport, start: action.start } };
    case "panDragged":
      return {
        ...state,
        hoverIndex: null,
        viewport:
          state.viewport.start === action.start
            ? state.viewport
            : { ...state.viewport, start: action.start },
      };
    case "zoomed": {
      const currentSize = clamp(
        state.viewport.size || action.totalCandles,
        action.minimumSize,
        action.totalCandles,
      );
      const currentStart = clamp(
        state.viewport.start,
        0,
        Math.max(action.totalCandles - currentSize, 0),
      );
      const nextSize = clamp(
        Math.round(currentSize * Math.exp(action.deltaY * wheelZoomSensitivity)),
        action.minimumSize,
        action.totalCandles,
      );
      const anchor = currentStart + action.pointerRatio * currentSize;
      const nextStart = clamp(
        Math.round(anchor - action.pointerRatio * nextSize),
        0,
        Math.max(action.totalCandles - nextSize, 0),
      );

      return { viewport: { start: nextStart, size: nextSize }, ...idleInteraction };
    }
    case "hovered":
      return {
        ...state,
        hoverIndex: action.index,
        hoverOnLine: action.onLine,
        dragEndIndex: state.dragStartIndex != null ? action.index : state.dragEndIndex,
      };
    case "hoverCleared":
      return state.isPanning || state.hoverIndex == null
        ? state
        : { ...state, hoverIndex: null, hoverOnLine: false };
    case "panStarted":
      return { ...state, ...idleInteraction, isPanning: true };
    case "selectionStarted":
      return {
        ...state,
        dragStartIndex: action.index,
        dragEndIndex: action.index,
        hoverIndex: action.index,
      };
    case "released":
      return { ...state, isPanning: false, dragStartIndex: null, dragEndIndex: null };
  }
}
