import assert from "node:assert/strict";
import test from "node:test";

import {
  addWeekdaysMs,
  cycleBoundsMs,
  cycleLabel,
  cycleSettlementCandidatesMs,
  cyclesInRange,
  normalizeShortInterestRow,
  parseShortInterestHeader,
  parseShortInterestRow,
  publicationAvailableTsMs,
  SPIKE_MIN_CHANGE_PERCENT,
} from "../src/services/finra/shortInterestNormalize.ts";

const dayMs = 86_400_000;

function endOfDayMs(year: number, month: number, day: number): number {
  return Date.UTC(year, month, day) + dayMs - 1;
}

const baseRow = {
  accountingYearMonthNumber: "20240112",
  symbolCode: "BBB",
  issueName: "Beta Brands Corp.",
  issuerServicesGroupExchangeCode: "Q",
  marketClassCode: "NNM",
  currentShortPositionQuantity: "3000000",
  previousShortPositionQuantity: "1500000",
  stockSplitFlag: "",
  averageDailyVolumeQuantity: "500000",
  daysToCoverQuantity: "6.00",
  revisionFlag: "",
  changePercent: "100.00",
  changePreviousNumber: "1500000",
  settlementDate: "2024-01-12",
};

test("a large jump with real days-to-cover yields report and spike events", () => {
  const result = normalizeShortInterestRow(baseRow);
  assert.ok("events" in result);
  assert.equal(result.events.length, 2);

  const [report, spike] = result.events;
  assert.equal(report.event_kind, "short_interest_report");
  assert.equal(report.ticker, "BBB");
  assert.equal(report.score, 6);
  assert.equal(report.event_ts_ms, endOfDayMs(2024, 0, 12));
  assert.equal(report.available_ts_ms, endOfDayMs(2024, 0, 24));
  assert.equal(report.dedupe_key, "finra_si:report:BBB:2024-01-12");
  assert.deepEqual(report.payload, {
    settlement_date: "2024-01-12",
    short_interest: 3_000_000,
    previous_short_interest: 1_500_000,
    change_percent: 100,
    average_daily_volume: 500_000,
    days_to_cover: 6,
    market_class: "NNM",
  });

  assert.equal(spike.event_kind, "short_interest_spike");
  assert.equal(spike.score, 100);
  assert.equal(spike.dedupe_key, "finra_si:spike:BBB:2024-01-12");
  assert.deepEqual(spike.payload, report.payload);
});

test("spike requires the change threshold, a prior position, and days-to-cover above FINRA's floor", () => {
  const cases = [
    { ...baseRow, changePercent: String(SPIKE_MIN_CHANGE_PERCENT - 1) },
    { ...baseRow, previousShortPositionQuantity: "0" },
    { ...baseRow, previousShortPositionQuantity: "" },
    { ...baseRow, daysToCoverQuantity: "1.00" },
    { ...baseRow, daysToCoverQuantity: "" },
    { ...baseRow, changePercent: "" },
  ];
  for (const row of cases) {
    const result = normalizeShortInterestRow(row);
    assert.ok("events" in result);
    assert.deepEqual(
      result.events.map((event) => event.event_kind),
      ["short_interest_report"],
    );
  }
});

test("unparseable rows are skipped with a reason", () => {
  assert.deepEqual(normalizeShortInterestRow({ ...baseRow, symbolCode: " " }), {
    skip: "missing_symbol",
  });
  assert.deepEqual(normalizeShortInterestRow({ ...baseRow, settlementDate: "01/12/2024" }), {
    skip: "invalid_settlement_date",
  });
  assert.deepEqual(normalizeShortInterestRow({ ...baseRow, settlementDate: "" }), {
    skip: "invalid_settlement_date",
  });
  assert.deepEqual(
    normalizeShortInterestRow({ ...baseRow, currentShortPositionQuantity: "" }),
    { skip: "invalid_short_interest" },
  );
  assert.deepEqual(
    normalizeShortInterestRow({ ...baseRow, currentShortPositionQuantity: "-5" }),
    { skip: "invalid_short_interest" },
  );
});

test("missing optional fields become nulls, not zeros", () => {
  const result = normalizeShortInterestRow({
    ...baseRow,
    previousShortPositionQuantity: "",
    changePercent: "",
    averageDailyVolumeQuantity: "",
    daysToCoverQuantity: "",
  });
  assert.ok("events" in result);
  const [report] = result.events;
  assert.equal(report.score, null);
  assert.equal(report.payload.previous_short_interest, null);
  assert.equal(report.payload.change_percent, null);
  assert.equal(report.payload.average_daily_volume, null);
  assert.equal(report.payload.days_to_cover, null);
});

test("pipe-delimited parsing maps header names to fields", () => {
  const header = parseShortInterestHeader("a|b|c");
  assert.deepEqual(parseShortInterestRow(header, "1| 2 |"), { a: "1", b: "2", c: "" });
});

test("publication is settlement plus eight weekdays, end of day", () => {
  assert.equal(publicationAvailableTsMs(Date.UTC(2024, 0, 12)), endOfDayMs(2024, 0, 24));
  assert.equal(publicationAvailableTsMs(Date.UTC(2026, 5, 30)), endOfDayMs(2026, 6, 10));
  assert.equal(addWeekdaysMs(Date.UTC(2024, 0, 12), 1), Date.UTC(2024, 0, 15));
});

test("settlement candidates walk back from the nominal date over weekdays only", () => {
  assert.deepEqual(
    cycleSettlementCandidatesMs({ year: 2024, month: 1, half: "mid" }),
    [Date.UTC(2024, 0, 15), Date.UTC(2024, 0, 12), Date.UTC(2024, 0, 11), Date.UTC(2024, 0, 10)],
  );
  assert.deepEqual(
    cycleSettlementCandidatesMs({ year: 2023, month: 4, half: "mid" }),
    [Date.UTC(2023, 3, 14), Date.UTC(2023, 3, 13), Date.UTC(2023, 3, 12), Date.UTC(2023, 3, 11)],
  );
  assert.deepEqual(
    cycleSettlementCandidatesMs({ year: 2024, month: 2, half: "eom" }),
    [Date.UTC(2024, 1, 29), Date.UTC(2024, 1, 28), Date.UTC(2024, 1, 27), Date.UTC(2024, 1, 26)],
  );
});

test("cycle bounds split each month into halves and enumeration stops at now", () => {
  assert.deepEqual(cycleBoundsMs({ year: 2024, month: 1, half: "mid" }), {
    startMs: Date.UTC(2024, 0, 1),
    endMs: endOfDayMs(2024, 0, 15),
  });
  assert.deepEqual(cycleBoundsMs({ year: 2024, month: 1, half: "eom" }), {
    startMs: Date.UTC(2024, 0, 16),
    endMs: Date.UTC(2024, 1, 1) - 1,
  });
  assert.equal(cycleLabel({ year: 2024, month: 1, half: "mid" }), "2024-01-mid");

  assert.deepEqual(cyclesInRange(2024, 2024, Date.UTC(2024, 1, 2)), [
    { year: 2024, month: 1, half: "mid" },
    { year: 2024, month: 1, half: "eom" },
  ]);
  assert.deepEqual(cyclesInRange(2024, 2024, Date.UTC(2024, 0, 10)), []);
});
