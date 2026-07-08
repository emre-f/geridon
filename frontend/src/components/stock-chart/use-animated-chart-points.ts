import { useEffect, useRef, useState } from "react";

import { chartMorphDurationMs, clamp, type ChartPoint } from "@/components/stock-chart/chart-types";

function lerp(start: number, end: number, amount: number) {
  return start + (end - start) * amount;
}

function easeOutCubic(value: number) {
  return 1 - Math.pow(1 - value, 3);
}

function sampledPoint(points: ChartPoint[], ratio: number) {
  if (points.length === 0) {
    return null;
  }

  if (points.length === 1) {
    return points[0];
  }

  const rawIndex = ratio * (points.length - 1);
  const lowerIndex = Math.floor(rawIndex);
  const upperIndex = Math.min(Math.ceil(rawIndex), points.length - 1);
  const amount = rawIndex - lowerIndex;
  const lower = points[lowerIndex];
  const upper = points[upperIndex];

  return {
    candle: amount < 0.5 ? lower.candle : upper.candle,
    x: lerp(lower.x, upper.x, amount),
    openY: lerp(lower.openY, upper.openY, amount),
    highY: lerp(lower.highY, upper.highY, amount),
    lowY: lerp(lower.lowY, upper.lowY, amount),
    closeY: lerp(lower.closeY, upper.closeY, amount),
    rising: amount < 0.5 ? lower.rising : upper.rising,
  };
}

function resamplePoints(sourcePoints: ChartPoint[], targetPoints: ChartPoint[]) {
  if (sourcePoints.length === 0 || targetPoints.length === 0) {
    return targetPoints;
  }

  return targetPoints.map((targetPoint, index) => {
    const ratio = targetPoints.length === 1 ? 0 : index / (targetPoints.length - 1);
    const sourcePoint = sampledPoint(sourcePoints, ratio) ?? targetPoint;

    return {
      ...targetPoint,
      x: sourcePoint.x,
      openY: sourcePoint.openY,
      highY: sourcePoint.highY,
      lowY: sourcePoint.lowY,
      closeY: sourcePoint.closeY,
    };
  });
}

function interpolatePoints(fromPoints: ChartPoint[], toPoints: ChartPoint[], amount: number) {
  return toPoints.map((targetPoint, index) => {
    const sourcePoint = fromPoints[index] ?? targetPoint;

    return {
      ...targetPoint,
      x: lerp(sourcePoint.x, targetPoint.x, amount),
      openY: lerp(sourcePoint.openY, targetPoint.openY, amount),
      highY: lerp(sourcePoint.highY, targetPoint.highY, amount),
      lowY: lerp(sourcePoint.lowY, targetPoint.lowY, amount),
      closeY: lerp(sourcePoint.closeY, targetPoint.closeY, amount),
    };
  });
}

/** Morphs the line chart only when `morphKey` changes (a new dataset); pan/zoom/hover snap. */
export function useAnimatedChartPoints(targetPoints: ChartPoint[], morphKey: unknown) {
  const [animatedPoints, setAnimatedPoints] = useState(targetPoints);
  const animatingRef = useRef(false);
  const morphKeyRef = useRef(morphKey);
  const displayedRef = useRef(targetPoints);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const keyChanged = !Object.is(morphKeyRef.current, morphKey);
    morphKeyRef.current = morphKey;

    const stopAnimation = () => {
      if (frameRef.current != null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };

    if (!keyChanged) {
      if (animatingRef.current) {
        stopAnimation();
        animatingRef.current = false;
        setAnimatedPoints(targetPoints);
      }
      displayedRef.current = targetPoints;
      return;
    }

    stopAnimation();

    const reduceMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion || displayedRef.current.length === 0 || targetPoints.length === 0) {
      animatingRef.current = false;
      displayedRef.current = targetPoints;
      setAnimatedPoints(targetPoints);
      return;
    }

    const fromPoints = resamplePoints(displayedRef.current, targetPoints);
    const startTime = performance.now();
    animatingRef.current = true;

    function animate(now: number) {
      const elapsed = now - startTime;
      const progress = easeOutCubic(clamp(elapsed / chartMorphDurationMs, 0, 1));
      const nextPoints = interpolatePoints(fromPoints, targetPoints, progress);

      displayedRef.current = nextPoints;
      setAnimatedPoints(nextPoints);

      if (elapsed < chartMorphDurationMs) {
        frameRef.current = requestAnimationFrame(animate);
      } else {
        animatingRef.current = false;
        displayedRef.current = targetPoints;
        setAnimatedPoints(targetPoints);
        frameRef.current = null;
      }
    }

    frameRef.current = requestAnimationFrame(animate);

    return () => {
      if (frameRef.current != null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [targetPoints, morphKey]);

  return animatingRef.current ? animatedPoints : targetPoints;
}
