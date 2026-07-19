import assert from "node:assert/strict";
import test from "node:test";

import { mergeFtdTextIntoMap, ftdMonthForQuarter } from "../src/services/sec13f/cusipTickerMap.ts";
import { buildQuarterManifest } from "../src/services/sec13f/filingManifest.ts";
import { cusipKey, parseInfotable } from "../src/services/sec13f/infotableParse.ts";
import { valueUnitMultiplier } from "../src/services/sec13f/managers.ts";
import { closedQuartersInRange } from "../src/services/sec13f/thirteenFIngest.ts";
import { periodEndOfDayMs } from "../src/services/sec13f/thirteenFNormalize.ts";

test("cusipKey normalizes to the 8-character issue", () => {
  assert.equal(cusipKey("023135106"), "02313510");
  assert.equal(cusipKey(" 02313510 "), "02313510");
  assert.equal(cusipKey("02313510"), "02313510");
  assert.equal(cusipKey("1234"), null);
});

test("parseInfotable aggregates duplicate CUSIP rows and applies the unit multiplier", () => {
  const xml = `
    <informationTable>
      <infoTable>
        <nameOfIssuer>Acme</nameOfIssuer><cusip>111111119</cusip><value>100</value>
        <shrsOrPrnAmt><sshPrnamt>10</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt>
      </infoTable>
      <infoTable>
        <nameOfIssuer>Acme</nameOfIssuer><cusip>111111119</cusip><value>50</value>
        <shrsOrPrnAmt><sshPrnamt>5</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt>
      </infoTable>
    </informationTable>`;
  const parsed = parseInfotable(xml, 1000);
  assert.equal(parsed.holdings.size, 1);
  const holding = parsed.holdings.get("11111111")!;
  assert.equal(holding.value_usd, 150_000);
  assert.equal(holding.shares, 15);
  assert.equal(parsed.total_value_usd, 150_000);
});

test("parseInfotable skips option, principal, and malformed rows", () => {
  const xml = `
    <informationTable>
      <infoTable>
        <nameOfIssuer>Puts</nameOfIssuer><cusip>111111119</cusip><value>100</value>
        <shrsOrPrnAmt><sshPrnamt>10</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt>
        <putCall>Put</putCall>
      </infoTable>
      <infoTable>
        <nameOfIssuer>Bond</nameOfIssuer><cusip>222222229</cusip><value>100</value>
        <shrsOrPrnAmt><sshPrnamt>100</sshPrnamt><sshPrnamtType>PRN</sshPrnamtType></shrsOrPrnAmt>
      </infoTable>
      <infoTable>
        <nameOfIssuer>NoValue</nameOfIssuer><cusip>333333339</cusip><value></value>
        <shrsOrPrnAmt><sshPrnamt>10</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt>
      </infoTable>
    </informationTable>`;
  const parsed = parseInfotable(xml, 1);
  assert.equal(parsed.holdings.size, 0);
  assert.equal(parsed.option_rows, 1);
  assert.equal(parsed.principal_rows, 1);
  assert.equal(parsed.malformed_rows, 1);
});

test("mergeFtdTextIntoMap skips headers and junk, later files win", () => {
  const map = new Map<string, string>();
  mergeFtdTextIntoMap(
    "SETTLEMENT DATE|CUSIP|SYMBOL|QUANTITY (FAILS)|DESCRIPTION|PRICE\n" +
      "20240102|111111119|OLDT|10|ACME|1.00\n20240102|badline\n",
    map,
  );
  mergeFtdTextIntoMap("20240701|111111119|NEWT|10|ACME RENAMED|1.00\n", map);
  assert.equal(map.size, 1);
  assert.equal(map.get("11111111"), "NEWT");
});

test("ftdMonthForQuarter picks the month after period end", () => {
  assert.equal(ftdMonthForQuarter(2024, 1), "202404");
  assert.equal(ftdMonthForQuarter(2024, 3), "202410");
  assert.equal(ftdMonthForQuarter(2024, 4), "202501");
});

test("valueUnitMultiplier flips from thousands to dollars on 2023-01-03", () => {
  assert.equal(valueUnitMultiplier(Date.UTC(2023, 0, 2, 23, 59)), 1000);
  assert.equal(valueUnitMultiplier(Date.UTC(2023, 0, 3)), 1);
});

test("periodEndOfDayMs is the last millisecond of the period date", () => {
  assert.equal(periodEndOfDayMs("2024-06-30"), Date.UTC(2024, 6, 1) - 1);
});

test("closedQuartersInRange respects the close lag and the XML era start", () => {
  const nowMs = Date.UTC(2024, 9, 15);
  assert.deepEqual(closedQuartersInRange(2024, 2024, nowMs), [
    { year: 2024, quarter: 1 },
    { year: 2024, quarter: 2 },
  ]);
  const early = closedQuartersInRange(2012, 2013, Date.UTC(2020, 0, 1));
  assert.deepEqual(early[0], { year: 2013, quarter: 3 });
});

test("buildQuarterManifest keeps the earliest original and counts amendments", async () => {
  const filings = [
    { form: "13F-HR", period: "2024-06-30", accession: "a-late", acceptance_ms: 2_000 },
    { form: "13F-HR", period: "2024-06-30", accession: "a-first", acceptance_ms: 1_000 },
    { form: "13F-HR/A", period: "2024-06-30", accession: "a-amend", acceptance_ms: 3_000 },
    { form: "13F-HR", period: "2024-03-31", accession: "a-prior", acceptance_ms: 500 },
  ];
  const manifest = await buildQuarterManifest(
    async () => filings,
    { year: 2024, quarter: 2 },
    [{ cik: 42, name: "Fake Fund" }],
  );
  assert.equal(manifest.length, 1);
  assert.equal(manifest[0].current?.accession, "a-first");
  assert.equal(manifest[0].prior?.accession, "a-prior");
  assert.equal(manifest[0].amendments, 1);
});
