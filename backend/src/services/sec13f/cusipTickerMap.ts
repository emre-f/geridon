import { cusipKey } from "./infotableParse.ts";

/**
 * SEC fails-to-deliver files are the free CUSIP-to-ticker source: pipe-delimited
 * rows of SETTLEMENT DATE|CUSIP|SYMBOL|QUANTITY|DESCRIPTION|PRICE covering any
 * security that failed to deliver in the half-month. Merging files in
 * chronological order with latest-file-wins maps each CUSIP issue to its most
 * recent symbol, which is how the candles table identifies tickers.
 */
export function mergeFtdTextIntoMap(text: string, map: Map<string, string>): void {
  for (const line of text.split("\n")) {
    const fields = line.split("|");
    if (fields.length < 3 || fields[0] === "SETTLEMENT DATE") {
      continue;
    }
    const key = cusipKey(fields[1]);
    const symbol = fields[2].trim().toUpperCase();
    if (key != null && symbol !== "") {
      map.set(key, symbol);
    }
  }
}

/** FTD file month covering a quarter's holdings: the month right after period end. */
export function ftdMonthForQuarter(year: number, quarter: number): string {
  const month = quarter * 3 + 1;
  return month > 12 ? `${year + 1}01` : `${year}${String(month).padStart(2, "0")}`;
}
