import type { BacktestRunRecord } from "@/lib/api";
import { formatCompactCurrency, formatCurrency, formatPercent } from "@/lib/format";

// The share card ships to places we don't theme (Twitter, iMessage), so it
// uses a fixed dark palette rather than the app's CSS variables.
const palette = {
  backgroundTop: "#1c1712",
  backgroundBottom: "#100d0a",
  border: "#3a322a",
  ink: "#f4eee3",
  muted: "#a89e8d",
  faint: "#6b6355",
  up: "#3fc78f",
  upFill: "rgba(63, 199, 143, 0.16)",
  down: "#e06a52",
  downFill: "rgba(224, 106, 82, 0.16)",
  grid: "rgba(168, 158, 141, 0.16)",
};

const cardWidth = 1200;
const cardHeight = 675;
const scale = 2;

const fontStack =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

function font(weight: number, size: number) {
  return `${weight} ${size}px ${fontStack}`;
}

function formatCardDate(ms: number) {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(ms));
}

function drawEquityCurve(
  context: CanvasRenderingContext2D,
  run: BacktestRunRecord,
  frame: { x: number; y: number; width: number; height: number },
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
  const lineColor = positive ? palette.up : palette.down;
  const fillColor = positive ? palette.upFill : palette.downFill;

  // Grid lines.
  context.strokeStyle = palette.grid;
  context.lineWidth = 1;
  for (let tick = 0; tick <= 3; tick += 1) {
    const y = frame.y + (tick / 3) * frame.height;
    context.beginPath();
    context.moveTo(frame.x, y);
    context.lineTo(frame.x + frame.width, y);
    context.stroke();
  }

  // Baseline at initial capital.
  const baselineY = yAt(run.initial_capital);
  context.strokeStyle = palette.faint;
  context.setLineDash([6, 6]);
  context.beginPath();
  context.moveTo(frame.x, baselineY);
  context.lineTo(frame.x + frame.width, baselineY);
  context.stroke();
  context.setLineDash([]);
  context.fillStyle = palette.faint;
  context.font = font(500, 15);
  context.textAlign = "left";
  context.fillText(formatCompactCurrency(run.initial_capital), frame.x + frame.width + 10, baselineY + 5);

  // Area fill down to the baseline.
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
  context.lineTo(xAt(points.length - 1), baselineY);
  context.lineTo(xAt(0), baselineY);
  context.closePath();
  context.fillStyle = fillColor;
  context.fill();

  // Equity line.
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
  context.strokeStyle = lineColor;
  context.lineWidth = 3;
  context.lineJoin = "round";
  context.stroke();

  // End dot + final value label.
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
  context.font = font(600, 16);
  context.textAlign = "left";
  context.fillText(formatCompactCurrency(points.at(-1)!.equity), endX + 14, endY + 5);

  // Start/end dates under the plot.
  context.fillStyle = palette.faint;
  context.font = font(500, 15);
  context.textAlign = "left";
  context.fillText(formatCardDate(points[0].timestamp_ms), frame.x, frame.y + frame.height + 26);
  context.textAlign = "right";
  context.fillText(
    formatCardDate(points.at(-1)!.timestamp_ms),
    frame.x + frame.width,
    frame.y + frame.height + 26,
  );
}

export function renderBacktestCard(run: BacktestRunRecord, strategyName: string) {
  const canvas = document.createElement("canvas");
  canvas.width = cardWidth * scale;
  canvas.height = cardHeight * scale;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas 2D is not supported in this browser.");
  }
  context.scale(scale, scale);

  // Background.
  const gradient = context.createLinearGradient(0, 0, 0, cardHeight);
  gradient.addColorStop(0, palette.backgroundTop);
  gradient.addColorStop(1, palette.backgroundBottom);
  context.fillStyle = gradient;
  context.fillRect(0, 0, cardWidth, cardHeight);
  context.strokeStyle = palette.border;
  context.lineWidth = 2;
  context.strokeRect(1, 1, cardWidth - 2, cardHeight - 2);

  const positive = run.metrics.total_return_pct >= 0;
  const toneColor = positive ? palette.up : palette.down;
  const padding = 56;

  // Header: wordmark + run context.
  context.textAlign = "left";
  context.fillStyle = palette.ink;
  context.font = font(700, 26);
  context.fillText("geridon", padding, padding + 12);
  context.fillStyle = palette.faint;
  context.font = font(500, 18);
  context.fillText("backtest", padding + 108, padding + 12);

  context.fillStyle = palette.faint;
  context.font = font(500, 16);
  context.textAlign = "right";
  context.fillText(`ran ${formatCardDate(Date.parse(run.created_at + "Z") || Date.now())}`, cardWidth - padding, padding + 12);

  // Strategy name + setup line.
  context.textAlign = "left";
  context.fillStyle = palette.ink;
  context.font = font(700, 40);
  context.fillText(strategyName, padding, padding + 78, cardWidth - padding * 2 - 300);
  context.fillStyle = palette.muted;
  context.font = font(500, 19);
  const sizingLabel =
    run.position_mode === "always_in"
      ? "always in market · flips 100% long/short"
      : `buy ${run.buy_percent}% of equity · sell ${run.sell_percent}% of position`;
  context.fillText(
    `${run.ticker} · ${run.timeframe.toUpperCase()} · ${sizingLabel}`,
    padding,
    padding + 112,
  );

  // Headline return, top-right.
  context.textAlign = "right";
  context.fillStyle = toneColor;
  context.font = font(750, 64);
  context.fillText(formatPercent(run.metrics.total_return_pct), cardWidth - padding, padding + 92);

  // Equity curve.
  drawEquityCurve(context, run, {
    x: padding,
    y: 236,
    width: cardWidth - padding * 2 - 92,
    height: 270,
  });

  // Stats row.
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
  const statsY = cardHeight - padding - 34;
  const statWidth = (cardWidth - padding * 2) / stats.length;
  stats.forEach((stat, index) => {
    const x = padding + index * statWidth;
    context.textAlign = "left";
    context.fillStyle = palette.faint;
    context.font = font(500, 15);
    context.fillText(stat.label.toUpperCase(), x, statsY);
    context.fillStyle = index === 1 ? toneColor : palette.ink;
    context.font = font(650, 26);
    context.fillText(stat.value, x, statsY + 34);
  });

  return canvas;
}

export function downloadBacktestCard(run: BacktestRunRecord, strategyName: string) {
  const canvas = renderBacktestCard(run, strategyName);
  const slug = strategyName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "strategy";

  canvas.toBlob((blob) => {
    if (!blob) {
      return;
    }
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `geridon-${slug}-${run.ticker.toLowerCase()}.png`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, "image/png");
}
