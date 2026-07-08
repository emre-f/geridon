import { useEffect, useMemo, useReducer, useRef, type RefObject } from "react";

import type { Candle } from "@/lib/api";
import { clamp, margin, type ChartMode, type PanDrag } from "@/components/stock-chart/chart-types";
import {
  nearestIndex,
  onPriceSeries,
  sliceViewport,
  viewportForWindow,
  viewportMinimum,
} from "@/components/stock-chart/chart-geometry";
import {
  idleInteraction,
  interactionReducer,
  zoomViewport,
} from "@/components/stock-chart/chart-interaction-reducer";
import {
  activeCandleForVisibleCandles,
  emitHoverCandle,
  emitVisibleCandles,
} from "@/components/stock-chart/chart-interaction-emissions";
import type { ChartLayout } from "@/components/stock-chart/build-chart-layout";

interface ChartInteractionOptions {
  candles: Candle[];
  timeframe: string;
  mode: ChartMode;
  visibleStartMs: number | undefined;
  visibleEndMs: number | undefined;
  svgRef: RefObject<SVGSVGElement | null>;
  /** Latest layout, set during render; only read inside event handlers. */
  layoutRef: RefObject<ChartLayout | null>;
  onVisibleCandlesChange?: (candles: Candle[]) => void;
  onHoverCandleChange?: (candle: Candle | null) => void;
}

/** Viewport zoom/pan plus hover and drag-to-measure state for the chart SVG. */
export function useChartInteraction({
  candles,
  timeframe,
  mode,
  visibleStartMs,
  visibleEndMs,
  svgRef,
  layoutRef,
  onVisibleCandlesChange,
  onHoverCandleChange,
}: ChartInteractionOptions) {
  const [state, dispatch] = useReducer(interactionReducer, {
    viewport: { start: 0, size: 0 },
    ...idleInteraction,
  });
  const panDragRef = useRef<PanDrag | null>(null);
  const wheelHandlerRef = useRef<(event: WheelEvent) => void>(() => {});
  const lastHoverCandleRef = useRef<Candle | null | undefined>(undefined);
  const lastVisibleCandlesRef = useRef<Candle[] | null>(null);

  const minimumViewportSize = viewportMinimum(candles.length);
  const viewportSize =
    candles.length === 0
      ? 0
      : clamp(state.viewport.size || candles.length, minimumViewportSize, candles.length);
  const viewportStart = clamp(state.viewport.start, 0, Math.max(candles.length - viewportSize, 0));
  const visibleCandles = useMemo(
    () => sliceViewport(candles, { start: viewportStart, size: viewportSize }),
    [candles, viewportSize, viewportStart],
  );
  const canPan = viewportSize > 0 && viewportSize < candles.length;
  const canZoomIn = candles.length > minimumViewportSize && viewportSize > minimumViewportSize;
  const canZoomOut = viewportSize < candles.length;

  useEffect(() => {
    panDragRef.current = null;
    lastHoverCandleRef.current = undefined;
    lastVisibleCandlesRef.current = null;
    dispatch({ type: "reset", viewport: viewportForWindow(candles, visibleStartMs, visibleEndMs) });
  }, [candles, timeframe, visibleEndMs, visibleStartMs]);

  function handleWheel(event: WheelEvent) {
    const layout = layoutRef.current;
    if (candles.length === 0 || !layout) {
      return;
    }

    // Keep the page from scrolling/zooming while the cursor is over the chart,
    // even when the viewport is already at a pan or zoom limit.
    event.preventDefault();

    const horizontalPan = Math.abs(event.deltaX) > Math.abs(event.deltaY);
    if (horizontalPan && canPan) {
      const candleDelta = Math.round(event.deltaX / Math.max(layout.step, 1));
      const nextStart = clamp(viewportStart + candleDelta, 0, Math.max(candles.length - viewportSize, 0));
      if (nextStart !== viewportStart) {
        dispatch({ type: "panned", start: nextStart });
        const nextVisibleCandles = emitVisibleCandles(
          lastVisibleCandlesRef,
          onVisibleCandlesChange,
          candles,
          { start: nextStart, size: viewportSize },
        );
        emitHoverCandle(
          lastHoverCandleRef,
          onHoverCandleChange,
          activeCandleForVisibleCandles(state, nextVisibleCandles),
        );
      }
      return;
    }

    const svg = svgRef.current;
    if (
      !svg ||
      (event.deltaY < 0 && !canZoomIn) ||
      (event.deltaY > 0 && !canZoomOut) ||
      event.deltaY === 0
    ) {
      return;
    }

    const rect = svg.getBoundingClientRect();
    const pointerX = clamp(event.clientX - rect.left, margin.left, margin.left + layout.plotWidth);
    const pointerRatio = clamp((pointerX - margin.left) / layout.plotWidth, 0, 1);

    panDragRef.current = null;
    const nextViewport = zoomViewport(
      { start: viewportStart, size: viewportSize },
      event.deltaY,
      pointerRatio,
      candles.length,
      minimumViewportSize,
    );
    dispatch({ type: "zoomed", viewport: nextViewport });
    emitHoverCandle(lastHoverCandleRef, onHoverCandleChange, null);
    if (nextViewport.start !== viewportStart || nextViewport.size !== viewportSize) {
      emitVisibleCandles(lastVisibleCandlesRef, onVisibleCandlesChange, candles, nextViewport);
    }
  }

  wheelHandlerRef.current = handleWheel;

  const hasCandles = candles.length > 0;

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) {
      return;
    }

    // React registers wheel listeners as passive, which makes preventDefault a
    // no-op and lets the page scroll while zooming. Attach a native
    // non-passive listener instead.
    const listener = (event: WheelEvent) => wheelHandlerRef.current(event);
    svg.addEventListener("wheel", listener, { passive: false });
    return () => svg.removeEventListener("wheel", listener);
  }, [hasCandles, svgRef]);

  function pointerTarget(event: React.PointerEvent<SVGSVGElement>, layout: ChartLayout) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = clamp(event.clientX - rect.left, margin.left, margin.left + layout.plotWidth);
    const index = nearestIndex(x, layout.points);
    return {
      index,
      onLine: onPriceSeries(event.clientY - rect.top, layout.points[index], mode),
    };
  }

  function handlePointerMove(event: React.PointerEvent<SVGSVGElement>) {
    const layout = layoutRef.current;
    if (!layout || layout.points.length === 0) {
      return;
    }

    const panDrag = panDragRef.current;
    if (panDrag && canPan) {
      const candleDelta = Math.round((panDrag.clientX - event.clientX) / Math.max(layout.step, 1));
      const nextStart = clamp(panDrag.start + candleDelta, 0, Math.max(candles.length - viewportSize, 0));
      dispatch({ type: "panDragged", start: nextStart });
      emitHoverCandle(lastHoverCandleRef, onHoverCandleChange, null);
      if (nextStart !== viewportStart) {
        emitVisibleCandles(lastVisibleCandlesRef, onVisibleCandlesChange, candles, {
          start: nextStart,
          size: viewportSize,
        });
      }
      return;
    }

    const { index, onLine } = pointerTarget(event, layout);
    dispatch({ type: "hovered", index, onLine });
    emitHoverCandle(lastHoverCandleRef, onHoverCandleChange, layout.points[index]?.candle ?? null);
  }

  function handlePointerDown(event: React.PointerEvent<SVGSVGElement>) {
    const layout = layoutRef.current;
    if (!layout || layout.points.length === 0) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    const { index, onLine } = pointerTarget(event, layout);

    // Grabbing the price series measures P/L; grabbing empty chart pans. With
    // nothing to pan, any drag measures.
    if (canPan && !onLine) {
      panDragRef.current = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        start: viewportStart,
      };
      dispatch({ type: "panStarted" });
      emitHoverCandle(lastHoverCandleRef, onHoverCandleChange, null);
      return;
    }

    dispatch({ type: "selectionStarted", index });
    emitHoverCandle(lastHoverCandleRef, onHoverCandleChange, layout.points[index]?.candle ?? null);
  }

  function handlePointerUp(event: React.PointerEvent<SVGSVGElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (panDragRef.current?.pointerId === event.pointerId) {
      panDragRef.current = null;
    }

    dispatch({ type: "released" });
  }

  return {
    hoverIndex: state.hoverIndex,
    hoverOnLine: state.hoverOnLine,
    dragStartIndex: state.dragStartIndex,
    dragEndIndex: state.dragEndIndex,
    isPanning: state.isPanning,
    visibleCandles,
    canPan,
    handlePointerMove,
    handlePointerDown,
    handlePointerUp,
    handlePointerCancel: handlePointerUp,
    handlePointerLeave: () => {
      dispatch({ type: "hoverCleared" });
      if (state.dragStartIndex == null || state.dragEndIndex == null) {
        emitHoverCandle(lastHoverCandleRef, onHoverCandleChange, null);
      }
    },
  };
}
