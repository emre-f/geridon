# Geridon Frontend

Vite + React + TypeScript app for charts, the strategy builder, backtests, optimization, and Signals.

## Setup

Requires Node 22.5 or later and a running [backend](../backend/README.md).

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173.

The app calls the backend at `http://127.0.0.1:8000`. To use another address, create `frontend/.env.local`:

```bash
VITE_API_BASE_URL=http://127.0.0.1:9000
```

## Commands

| command | what it does |
| --- | --- |
| `npm run dev` | start the dev server with hot reload |
| `npm run build` | type-check and build to `dist/` |
| `npm run preview` | serve the production build locally |
| `npm test` | run the unit tests |
| `npm run doctor` | check the React code with react-doctor |

## Empty screens

- **No charts:** the backend has no candles. Run `npm run backfill -- --once` in `backend/`.
- **Empty Signals tab:** no events are ingested. See the ingest table in the [backend README](../backend/README.md).
