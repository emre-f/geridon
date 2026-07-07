---
name: verify
description: Build, run, and visually verify the geridon frontend (Vite + React) against the local backend.
---

# Verifying geridon

## Build / typecheck
```bash
cd frontend && npx tsc --noEmit && npm run build
```

## Run
The dev servers are usually already running: frontend on `http://localhost:5173`
(Vite, HMR picks up edits instantly), backend API on `127.0.0.1:8000` (node).
Check with `lsof -nP -iTCP -sTCP:LISTEN | grep -E "5173|8000"` before starting anything.
If not running: `cd frontend && npm run dev` and `cd backend && npm run dev`.

## Drive (headless browser)
The repo has no Playwright dependency; install it in the scratchpad. The locally
cached browsers may not match the npm version — launch with an explicit
`executablePath` to a cached binary:

```js
const browser = await chromium.launch({
  executablePath:
    process.env.HOME +
    "/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell",
});
```
(`ls ~/Library/Caches/ms-playwright/` to find current versions.)

## Flows worth driving
- Header tabs Charts / Strategies / Backtest (`aria-label="Workspace tab"`).
- Chart controls: `aria-label` of "Chart style", "Candle timeframe", "Visible range".
- Strategy builder group operator: `aria-label="Group operator"` (Strategies tab, below the chart).
- Theme toggle: button "Switch to light mode" / "Switch to dark mode" — screenshot both themes.

## Gotchas
- Range/timeframe/tab clicks trigger candle reloads and canvas chart re-renders that
  block the page main thread ~300ms; sample animations from the Node side
  (`locator.evaluate` in a loop), not with in-page `requestAnimationFrame`/`setTimeout`.
- Default symbol SPY loads real data from the backend SQLite; no seeding needed.
