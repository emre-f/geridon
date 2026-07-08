import type { Candle } from "@/lib/api";
import type { Viewport } from "@/components/stock-chart/chart-types";
import { sameCandleSlice, sliceViewport } from "@/components/stock-chart/chart-geometry";
import type { InteractionState } from "@/components/stock-chart/chart-interaction-reducer";

interface RefCell<T> {
  current: T;
}

export function emitHoverCandle(
  lastHoverCandleRef: RefCell<Candle | null | undefined>,
  onHoverCandleChange: ((candle: Candle | null) => void) | undefined,
  candle: Candle | null,
) {
  if (
    !onHoverCandleChange ||
    (lastHoverCandleRef.current !== undefined && lastHoverCandleRef.current === candle)
  ) {
    return;
  }

  lastHoverCandleRef.current = candle;
  onHoverCandleChange(candle);
}

export function emitVisibleCandles(
  lastVisibleCandlesRef: RefCell<Candle[] | null>,
  onVisibleCandlesChange: ((candles: Candle[]) => void) | undefined,
  candles: Candle[],
  viewport: Viewport,
) {
  const nextVisibleCandles = sliceViewport(candles, viewport);
  if (onVisibleCandlesChange && !sameCandleSlice(lastVisibleCandlesRef.current, nextVisibleCandles)) {
    lastVisibleCandlesRef.current = nextVisibleCandles;
    onVisibleCandlesChange(nextVisibleCandles);
  }
  return nextVisibleCandles;
}

export function activeCandleForVisibleCandles(
  state: InteractionState,
  nextVisibleCandles: Candle[],
) {
  const activeIndex =
    state.dragStartIndex != null && state.dragEndIndex != null
      ? state.dragEndIndex
      : state.hoverIndex;
  return activeIndex == null ? null : nextVisibleCandles[activeIndex] ?? null;
}
