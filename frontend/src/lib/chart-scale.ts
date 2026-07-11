export function niceTicks(min: number, max: number, count = 4) {
  if (!(max > min)) {
    return [min];
  }
  const step = (max - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(step));
  const niceStep = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((m) => m >= step) ?? step;
  const ticks: number[] = [];
  for (let tick = Math.ceil(min / niceStep) * niceStep; tick <= max + niceStep / 1e6; tick += niceStep) {
    ticks.push(tick);
  }
  return ticks;
}

export interface BarCorners {
  topLeft?: boolean;
  topRight?: boolean;
  bottomRight?: boolean;
  bottomLeft?: boolean;
}

// Rounds only the requested corners so a bar can keep a 4px rounded data-end
// while staying square at the baseline.
export function roundedBarPath(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  corners: BarCorners,
): string {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  const tl = corners.topLeft ? r : 0;
  const tr = corners.topRight ? r : 0;
  const br = corners.bottomRight ? r : 0;
  const bl = corners.bottomLeft ? r : 0;
  return [
    `M${x + tl},${y}`,
    `H${x + width - tr}`,
    tr ? `A${tr},${tr} 0 0 1 ${x + width},${y + tr}` : "",
    `V${y + height - br}`,
    br ? `A${br},${br} 0 0 1 ${x + width - br},${y + height}` : "",
    `H${x + bl}`,
    bl ? `A${bl},${bl} 0 0 1 ${x},${y + height - bl}` : "",
    `V${y + tl}`,
    tl ? `A${tl},${tl} 0 0 1 ${x + tl},${y}` : "",
    "Z",
  ]
    .filter(Boolean)
    .join("");
}
