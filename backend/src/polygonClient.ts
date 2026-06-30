import type { PolygonAggregate } from "./types.ts";

interface PolygonAggregateRow {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  vw?: number;
  n?: number;
}

interface PolygonAggregatePayload {
  results?: PolygonAggregateRow[];
}

export class PolygonClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey: string, baseUrl = "https://api.polygon.io") {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  async getAggregates(options: {
    ticker: string;
    multiplier: number;
    timespan: string;
    startMs: number;
    endMs: number;
    adjusted: boolean;
  }): Promise<PolygonAggregate[]> {
    const url = new URL(
      `${this.baseUrl}/v2/aggs/ticker/${options.ticker}/range/${options.multiplier}/${options.timespan}/${options.startMs}/${options.endMs}`,
    );
    url.searchParams.set("adjusted", String(options.adjusted));
    url.searchParams.set("sort", "asc");
    url.searchParams.set("limit", "50000");
    url.searchParams.set("apiKey", this.apiKey);

    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) {
      throw new Error(`Polygon request failed with HTTP ${response.status}.`);
    }

    const payload = (await response.json()) as PolygonAggregatePayload;
    return (payload.results ?? []).map((row) => ({
      timestamp_ms: Number(row.t),
      open: Number(row.o),
      high: Number(row.h),
      low: Number(row.l),
      close: Number(row.c),
      volume: Number(row.v),
      vwap: row.vw == null ? null : Number(row.vw),
      transactions: row.n == null ? null : Number(row.n),
    }));
  }
}
