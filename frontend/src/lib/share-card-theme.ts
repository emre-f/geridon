// The share card ships to places we don't theme (Twitter, iMessage), so it
// uses a fixed dark palette rather than the app's CSS variables.
export const shareCardPalette = {
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

export const shareCardWidth = 1200;
export const shareCardHeight = 675;
export const shareCardScale = 2;

const fontStack =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export function shareCardFont(weight: number, size: number) {
  return `${weight} ${size}px ${fontStack}`;
}

// Hoisted: Intl constructors are expensive to rebuild per call.
const cardDateFormat = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

export function formatCardDate(ms: number) {
  return cardDateFormat.format(new Date(ms));
}
