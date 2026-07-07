const excludedTickers = new Set([
  "AGNCN",
  "AGNCL",
  "AGNCM",
  "AGNCO",
  "AGNCP",
  "AGNCZ",
  "APOS",
  "AQNB",
  "BIPJ",
  "BMNP",
  "BNH",
  "BNJ",
  "BPYPM",
  "BPYPN",
  "BPYPO",
  "BPYPP",
  "BRK-A",
  "BRKRP",
  "BTSGU",
  "CIB",
  "DUKB",
  "FOX",
  "FWONA",
  "GOOG",
  "GOOGM",
  "GOOGN",
  "HBANL",
  "HBANM",
  "HBANP",
  "HBANZ",
  "ITUB",
  "KKRS",
  "MCHPP",
  "NWS",
  "PPLC",
  "SLMBP",
  "SMCIP",
  "SOJC",
  "SOJD",
  "SOJE",
  "SOMN",
  "SREA",
  "STRC",
  "STRD",
  "STRF",
  "STRK",
  "TBB",
  "VLYPN",
  "VLYPO",
  "VLYPP",
]);

export function normalizeTicker(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/[./]/g, "-");
}

export function isExcludedTicker(symbol: string): boolean {
  return excludedTickers.has(normalizeTicker(symbol));
}

export function isNonChartableSecurityName(name: string): boolean {
  const normalized = ` ${name.toLowerCase().replace(/[^a-z0-9%]+/g, " ")} `;

  return [
    /\bpreferred\b/,
    /\bpreference\b/,
    /\bmandatory convertible\b/,
    /\btangible equity units?\b/,
    /\bcorporate units?\b/,
    /\bwarrants?\b/,
    /\bnotes?\b/,
    /\bdebentures?\b/,
    /\bbonds?\b/,
  ].some((pattern) => pattern.test(normalized));
}
