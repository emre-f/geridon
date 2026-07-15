import type { BacktestRunRecord } from "@/lib/api";
import {
  cardPadding,
  drawCardHeader,
  drawEquityCurve,
  drawHeadlineReturn,
  drawStatsRow,
  drawStrategySummary,
  fillCardBackground,
} from "@/lib/share-card-draw";
import { shareCardHeight, shareCardScale, shareCardWidth } from "@/lib/share-card-theme";

function renderBacktestCard(run: BacktestRunRecord, strategyName: string) {
  const canvas = document.createElement("canvas");
  canvas.width = shareCardWidth * shareCardScale;
  canvas.height = shareCardHeight * shareCardScale;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas 2D is not supported in this browser.");
  }
  context.scale(shareCardScale, shareCardScale);

  fillCardBackground(context);
  drawCardHeader(context, run);
  drawStrategySummary(context, run, strategyName);
  drawHeadlineReturn(context, run);
  drawEquityCurve(context, run, {
    x: cardPadding,
    y: 236,
    width: shareCardWidth - cardPadding * 2 - 92,
    height: 270,
  });
  drawStatsRow(context, run);

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
