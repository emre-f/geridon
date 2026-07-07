import { useSyncExternalStore } from "react";

const paletteStorageKey = "geridon-color-palette";

export const minPaletteColors = 6;
export const maxPaletteColors = 24;

// Validated for distinctness and >=3:1 contrast on both app card surfaces.
export const defaultPaletteColors = [
  "#3987e5",
  "#199e70",
  "#c98500",
  "#008300",
  "#9085e9",
  "#e66767",
  "#d55181",
  "#d95926",
];

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

function loadPaletteColors(): string[] {
  try {
    const stored = JSON.parse(localStorage.getItem(paletteStorageKey) ?? "[]");
    if (Array.isArray(stored)) {
      const colors = stored.flatMap((color) => (isHexColor(color) ? [color.toLowerCase()] : []));
      if (colors.length >= minPaletteColors) {
        return colors.slice(0, maxPaletteColors);
      }
    }
  } catch {
    // Fall through to defaults when storage is unavailable or malformed.
  }

  return [...defaultPaletteColors];
}

let paletteColors = loadPaletteColors();
const paletteListeners = new Set<() => void>();

function setPaletteColors(nextColors: string[]) {
  paletteColors = nextColors;

  try {
    localStorage.setItem(paletteStorageKey, JSON.stringify(nextColors));
  } catch {
    // Ignore storage failures so palette edits still work for this session.
  }

  for (const listener of paletteListeners) {
    listener();
  }
}

function getPaletteColors() {
  return paletteColors;
}

function subscribeToPalette(listener: () => void) {
  paletteListeners.add(listener);
  return () => {
    paletteListeners.delete(listener);
  };
}

export function usePaletteColors() {
  return useSyncExternalStore(subscribeToPalette, getPaletteColors);
}

export function paletteColorAt(index: number) {
  return paletteColors[index % paletteColors.length];
}

/** Adds a color and returns its index; returns the existing index for duplicates. */
export function addPaletteColor(color: string) {
  if (!isHexColor(color)) {
    return -1;
  }

  const normalized = color.toLowerCase();
  const existingIndex = paletteColors.indexOf(normalized);
  if (existingIndex !== -1) {
    return existingIndex;
  }
  if (paletteColors.length >= maxPaletteColors) {
    return -1;
  }

  setPaletteColors([...paletteColors, normalized]);
  return paletteColors.length - 1;
}

export function updatePaletteColor(index: number, color: string) {
  if (!isHexColor(color) || index < 0 || index >= paletteColors.length) {
    return;
  }

  const nextColors = [...paletteColors];
  nextColors[index] = color.toLowerCase();
  setPaletteColors(nextColors);
}

export function removePaletteColor(index: number) {
  if (paletteColors.length <= minPaletteColors || index < 0 || index >= paletteColors.length) {
    return;
  }

  setPaletteColors(paletteColors.filter((_, colorIndex) => colorIndex !== index));
}
