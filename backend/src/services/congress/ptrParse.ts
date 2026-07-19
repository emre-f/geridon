import type { EfdSearchRow } from "./efdClient.ts";

export interface PtrFiling {
  member: string;
  filed_date_ms: number;
  path: string;
  report_id: string;
  electronic: boolean;
  amendment: boolean;
}

export interface PtrTransactionRow {
  transaction_date: string;
  owner: string;
  ticker: string;
  asset_name: string;
  asset_type: string;
  transaction_type: string;
  amount: string;
  comment: string;
}

/** eFD dates look like "07/16/2026"; returns UTC midnight of that day. */
export function parseUsDateMs(value: string): number | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) {
    return null;
  }
  const month = Number(match[1]);
  const day = Number(match[2]);
  const timestampMs = Date.UTC(Number(match[3]), month - 1, day);
  const date = new Date(timestampMs);
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? timestampMs : null;
}

const namedEntities: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&([a-z]+);/g, (match, name: string) => namedEntities[name] ?? match);
}

function cellText(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

/**
 * A search row's report link is the only place the filing kind shows up:
 * electronic PTRs live under /search/view/ptr/{id}/ and parse as HTML, paper
 * filings live under /search/view/paper/{id}/ and are scanned images the
 * ingestion can only count, never parse.
 */
export function parseSearchRow(row: EfdSearchRow): PtrFiling | null {
  const [firstName, lastName, , linkHtml, dateReceived] = row;
  const href = /href="([^"]+)"/.exec(linkHtml)?.[1];
  const filedDateMs = parseUsDateMs(dateReceived);
  if (href == null || filedDateMs == null) {
    return null;
  }
  const reportId = /\/view\/(?:ptr|paper)\/([^/]+)\//.exec(href)?.[1];
  if (reportId == null) {
    return null;
  }
  return {
    member: `${cellText(firstName)} ${cellText(lastName)}`.replace(/\s+/g, " ").trim(),
    filed_date_ms: filedDateMs,
    path: href,
    report_id: reportId,
    electronic: href.includes("/view/ptr/"),
    amendment: cellText(linkHtml).includes("Amendment"),
  };
}

/**
 * The transactions table is the one whose header row contains "Transaction
 * Date"; rows outside a <tbody> are headers. Cell order is fixed by the eFD
 * template: #, date, owner, ticker, asset name, asset type, type, amount,
 * comment.
 */
export function parsePtrTransactions(html: string): PtrTransactionRow[] {
  const tables = html.match(/<table[\s\S]*?<\/table>/g) ?? [];
  const transactionsTable = tables.find((table) => table.includes("Transaction Date"));
  if (transactionsTable == null) {
    return [];
  }
  const tbody = /<tbody>([\s\S]*?)<\/tbody>/.exec(transactionsTable)?.[1];
  if (tbody == null) {
    return [];
  }

  const rows: PtrTransactionRow[] = [];
  for (const rowMatch of tbody.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...rowMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((cell) =>
      cellText(cell[1]),
    );
    if (cells.length < 9) {
      continue;
    }
    rows.push({
      transaction_date: cells[1],
      owner: cells[2],
      ticker: cells[3],
      asset_name: cells[4],
      asset_type: cells[5],
      transaction_type: cells[6],
      amount: cells[7],
      comment: cells[8],
    });
  }
  return rows;
}
