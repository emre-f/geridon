export interface Holding {
  cusip: string;
  issuer_name: string;
  value_usd: number;
  shares: number;
}

export interface FilingHoldings {
  /** Keyed by the 8-character CUSIP issue (check digit dropped: filers get it wrong). */
  holdings: Map<string, Holding>;
  total_value_usd: number;
  option_rows: number;
  principal_rows: number;
  malformed_rows: number;
}

const infoTablePattern = /<(?:\w+:)?infoTable[\s>][\s\S]*?<\/(?:\w+:)?infoTable>/g;

function tagValue(block: string, tag: string): string | null {
  const match = block.match(new RegExp(`<(?:\\w+:)?${tag}>\\s*([^<]*?)\\s*<`));
  return match ? match[1] : null;
}

function numeric(raw: string | null): number | null {
  if (raw == null || raw === "") {
    return null;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function cusipKey(raw: string): string | null {
  const cleaned = raw.replaceAll(/[\s-]/g, "").toUpperCase();
  return cleaned.length >= 8 ? cleaned.slice(0, 8) : null;
}

/**
 * Parses a 13F information table XML into holdings aggregated per CUSIP issue.
 * Only long equity rows count: put/call rows and principal-amount (PRN) rows
 * are excluded from both the holdings and the portfolio total, so
 * portfolio-share scores mean "share of reported long equity book".
 */
export function parseInfotable(xml: string, valueMultiplier: number): FilingHoldings {
  const result: FilingHoldings = {
    holdings: new Map(),
    total_value_usd: 0,
    option_rows: 0,
    principal_rows: 0,
    malformed_rows: 0,
  };

  for (const block of xml.match(infoTablePattern) ?? []) {
    if (tagValue(block, "putCall")) {
      result.option_rows += 1;
      continue;
    }
    const amountType = tagValue(block, "sshPrnamtType");
    if (amountType !== null && amountType.toUpperCase() !== "SH") {
      result.principal_rows += 1;
      continue;
    }

    const key = cusipKey(tagValue(block, "cusip") ?? "");
    const value = numeric(tagValue(block, "value"));
    const shares = numeric(tagValue(block, "sshPrnamt"));
    if (key == null || value == null || value < 0 || shares == null) {
      result.malformed_rows += 1;
      continue;
    }

    const valueUsd = value * valueMultiplier;
    result.total_value_usd += valueUsd;
    const existing = result.holdings.get(key);
    if (existing) {
      existing.value_usd += valueUsd;
      existing.shares += shares;
    } else {
      result.holdings.set(key, {
        cusip: key,
        issuer_name: tagValue(block, "nameOfIssuer") ?? "",
        value_usd: valueUsd,
        shares,
      });
    }
  }
  return result;
}
