export interface CuratedManager {
  cik: number;
  name: string;
}

/**
 * Constant, not tunable: concentrated, high-conviction fundamental managers
 * with long 13F histories, verified against EDGAR on 2026-07-20. Managers that
 * migrated filing entities appear once per CIK; the consecutive-quarter diff
 * never crosses entities, so a migration creates a coverage gap, not fake
 * new-stake/exit events.
 */
export const curatedManagers: CuratedManager[] = [
  { cik: 1067983, name: "Berkshire Hathaway" },
  { cik: 1061768, name: "Baupost Group" },
  { cik: 1336528, name: "Pershing Square" },
  { cik: 1006438, name: "Appaloosa Management LP" },
  { cik: 1656456, name: "Appaloosa LP" },
  { cik: 1040273, name: "Third Point" },
  { cik: 1079114, name: "Greenlight Capital" },
  { cik: 1061165, name: "Lone Pine Capital" },
  { cik: 1103804, name: "Viking Global" },
  { cik: 1167483, name: "Tiger Global" },
  { cik: 1418814, name: "ValueAct Holdings" },
  { cik: 921669, name: "Carl Icahn" },
  { cik: 1536411, name: "Duquesne Family Office" },
  { cik: 1135730, name: "Coatue Management" },
  { cik: 1649339, name: "Scion Asset Management" },
  { cik: 1048445, name: "Elliott Management Corp" },
  { cik: 1791786, name: "Elliott Investment Management" },
];

/** XML information tables are mandatory from 2013 Q2; earlier filings are free text. */
export const firstPeriodYear = 2013;

/**
 * A quarter is processed only once its filing deadline (45 days after period
 * end) plus a late-filer buffer has passed; before that it is never marked
 * ingested, so re-runs pick it up later.
 */
export const quarterCloseLagDays = 90;

/** EDGAR switched 13F values from thousands to whole dollars on 2023-01-03. */
export const valueInDollarsSinceMs = Date.UTC(2023, 0, 3);

export function valueUnitMultiplier(acceptanceMs: number): number {
  return acceptanceMs >= valueInDollarsSinceMs ? 1 : 1000;
}
