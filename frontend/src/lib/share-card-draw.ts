import type { BacktestRunRecord } from "@/lib/api";
import { formatCompactCurrency, formatCurrency, formatPercent } from "@/lib/format";
import {
  formatCardDate,
  shareCardFont,
  shareCardHeight,
  shareCardPalette as palette,
  shareCardWidth,
} from "@/lib/share-card-theme";

export const cardPadding = 56;

interface CardFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

type EquityPoint = BacktestRunRecord["equity_curve"][number];

interface EquityCurveGeometry {
  context: CanvasRenderingContext2D;
  points: EquityPoint[];
  frame: CardFrame;
  xAt: (index: number) => number;
  yAt: (value: number) => number;
  baselineY: number;
  lineColor: string;
  fillColor: string;
  initialCapital: number;
}

function toneColor(run: BacktestRunRecord): string {
  return run.metrics.total_return_pct >= 0 ? palette.up : palette.down;
}

function drawEquityGridlines(context: CanvasRenderingContext2D, frame: CardFrame) {
  context.strokeStyle = palette.grid;
  context.lineWidth = 1;
  for (let tick = 0; tick <= 3; tick += 1) {
    const y = frame.y + (tick / 3) * frame.height;
    context.beginPath();
    context.moveTo(frame.x, y);
    context.lineTo(frame.x + frame.width, y);
    context.stroke();
  }
}

function drawInitialCapitalBaseline(geometry: EquityCurveGeometry) {
  const { context, frame, baselineY, initialCapital } = geometry;
  context.strokeStyle = palette.faint;
  context.setLineDash([6, 6]);
  context.beginPath();
  context.moveTo(frame.x, baselineY);
  context.lineTo(frame.x + frame.width, baselineY);
  context.stroke();
  context.setLineDash([]);
  context.fillStyle = palette.faint;
  context.font = shareCardFont(500, 15);
  context.textAlign = "left";
  context.fillText(formatCompactCurrency(initialCapital), frame.x + frame.width + 10, baselineY + 5);
}

function traceEquityPath(geometry: EquityCurveGeometry) {
  const { context, points, xAt, yAt } = geometry;
  context.beginPath();
  points.forEach((point, index) => {
    const x = xAt(index);
    const y = yAt(point.equity);
    if (index === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  });
}

function fillAreaUnderCurve(geometry: EquityCurveGeometry) {
  const { context, points, xAt, baselineY, fillColor } = geometry;
  traceEquityPath(geometry);
  context.lineTo(xAt(points.length - 1), baselineY);
  context.lineTo(xAt(0), baselineY);
  context.closePath();
  context.fillStyle = fillColor;
  context.fill();
}

function strokeEquityLine(geometry: EquityCurveGeometry) {
  const { context, lineColor } = geometry;
  traceEquityPath(geometry);
  context.strokeStyle = lineColor;
  context.lineWidth = 3;
  context.lineJoin = "round";
  context.stroke();
}

function markFinalEquity(geometry: EquityCurveGeometry) {
  const { context, points, xAt, yAt, lineColor } = geometry;
  const endX = xAt(points.length - 1);
  const endY = yAt(points.at(-1)!.equity);
  context.beginPath();
  context.arc(endX, endY, 6, 0, Math.PI * 2);
  context.fillStyle = lineColor;
  context.fill();
  context.strokeStyle = palette.backgroundBottom;
  context.lineWidth = 3;
  context.stroke();
  context.fillStyle = lineColor;
  context.font = shareCardFont(600, 16);
  context.textAlign = "left";
  context.fillText(formatCompactCurrency(points.at(-1)!.equity), endX + 14, endY + 5);
}

function labelDateRange(context: CanvasRenderingContext2D, points: EquityPoint[], frame: CardFrame) {
  context.fillStyle = palette.faint;
  context.font = shareCardFont(500, 15);
  context.textAlign = "left";
  context.fillText(formatCardDate(points[0].timestamp_ms), frame.x, frame.y + frame.height + 26);
  context.textAlign = "right";
  context.fillText(
    formatCardDate(points.at(-1)!.timestamp_ms),
    frame.x + frame.width,
    frame.y + frame.height + 26,
  );
}

export function drawEquityCurve(
  context: CanvasRenderingContext2D,
  run: BacktestRunRecord,
  frame: CardFrame,
) {
  const points = run.equity_curve;
  if (points.length === 0) {
    return;
  }

  const equities = points.map((point) => point.equity);
  const min = Math.min(...equities, run.initial_capital);
  const max = Math.max(...equities, run.initial_capital);
  const pad = (max - min || max || 1) * 0.1;
  const domainMin = min - pad;
  const domainMax = max + pad;

  const xAt = (index: number) =>
    frame.x + (points.length === 1 ? frame.width / 2 : (index / (points.length - 1)) * frame.width);
  const yAt = (value: number) =>
    frame.y + ((domainMax - value) / (domainMax - domainMin)) * frame.height;

  const positive = run.metrics.total_return_pct >= 0;
  const geometry: EquityCurveGeometry = {
    context,
    points,
    frame,
    xAt,
    yAt,
    baselineY: yAt(run.initial_capital),
    lineColor: positive ? palette.up : palette.down,
    fillColor: positive ? palette.upFill : palette.downFill,
    initialCapital: run.initial_capital,
  };

  drawEquityGridlines(context, frame);
  drawInitialCapitalBaseline(geometry);
  fillAreaUnderCurve(geometry);
  strokeEquityLine(geometry);
  markFinalEquity(geometry);
  labelDateRange(context, points, frame);
}

export function fillCardBackground(context: CanvasRenderingContext2D) {
  const gradient = context.createLinearGradient(0, 0, 0, shareCardHeight);
  gradient.addColorStop(0, palette.backgroundTop);
  gradient.addColorStop(1, palette.backgroundBottom);
  context.fillStyle = gradient;
  context.fillRect(0, 0, shareCardWidth, shareCardHeight);
  context.strokeStyle = palette.border;
  context.lineWidth = 2;
  context.strokeRect(1, 1, shareCardWidth - 2, shareCardHeight - 2);
}

export function drawCardHeader(context: CanvasRenderingContext2D, run: BacktestRunRecord) {
  context.textAlign = "left";
  context.fillStyle = palette.ink;
  context.font = shareCardFont(700, 26);
  context.fillText("geridon", cardPadding, cardPadding + 12);
  context.fillStyle = palette.faint;
  context.font = shareCardFont(500, 18);
  context.fillText("backtest", cardPadding + 108, cardPadding + 12);

  context.fillStyle = palette.faint;
  context.font = shareCardFont(500, 16);
  context.textAlign = "right";
  context.fillText(
    `ran ${formatCardDate(Date.parse(run.created_at + "Z") || Date.now())}`,
    shareCardWidth - cardPadding,
    cardPadding + 12,
  );
}

export function drawStrategySummary(
  context: CanvasRenderingContext2D,
  run: BacktestRunRecord,
  strategyName: string,
) {
  context.textAlign = "left";
  context.fillStyle = palette.ink;
  context.font = shareCardFont(700, 40);
  context.fillText(strategyName, cardPadding, cardPadding + 78, shareCardWidth - cardPadding * 2 - 300);
  context.fillStyle = palette.muted;
  context.font = shareCardFont(500, 19);
  const sizingLabel =
    run.position_mode === "always_in"
      ? "always in market · flips 100% long/short"
      : run.position_mode === "three_state"
        ? "three-state · 100% long / short / cash"
        : `buy ${run.buy_percent}% of equity · sell ${run.sell_percent}% of position`;
  context.fillText(
    `${run.ticker} · ${run.timeframe.toUpperCase()} · ${sizingLabel}`,
    cardPadding,
    cardPadding + 112,
  );
}

export function drawHeadlineReturn(context: CanvasRenderingContext2D, run: BacktestRunRecord) {
  context.textAlign = "right";
  context.fillStyle = toneColor(run);
  context.font = shareCardFont(750, 64);
  context.fillText(formatPercent(run.metrics.total_return_pct), shareCardWidth - cardPadding, cardPadding + 92);
}

export function drawStatsRow(context: CanvasRenderingContext2D, run: BacktestRunRecord) {
  const stats = [
    { label: "Started with", value: formatCurrency(run.initial_capital) },
    { label: "Ended with", value: formatCurrency(run.metrics.final_equity) },
    { label: "Trades", value: String(run.metrics.trade_count) },
    {
      label: "Win rate",
      value:
        run.metrics.win_rate_pct == null ? "—" : `${run.metrics.win_rate_pct.toFixed(0)}%`,
    },
  ];
  const statsY = shareCardHeight - cardPadding - 34;
  const statWidth = (shareCardWidth - cardPadding * 2) / stats.length;
  const tone = toneColor(run);
  stats.forEach((stat, index) => {
    const x = cardPadding + index * statWidth;
    context.textAlign = "left";
    context.fillStyle = palette.faint;
    context.font = shareCardFont(500, 15);
    context.fillText(stat.label.toUpperCase(), x, statsY);
    context.fillStyle = index === 1 ? tone : palette.ink;
    context.font = shareCardFont(650, 26);
    context.fillText(stat.value, x, statsY + 34);
  });
}
