import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

export type TsvRecord = Record<string, string>;

export async function* readTsvRecords(filePath: string): AsyncGenerator<TsvRecord> {
  const lines = createInterface({
    input: createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  let header: string[] | null = null;
  for await (const line of lines) {
    if (line === "") {
      continue;
    }
    const fields = line.split("\t");
    if (header == null) {
      header = fields.map((field) => field.trim());
      continue;
    }
    const record: TsvRecord = {};
    for (let index = 0; index < header.length; index += 1) {
      record[header[index]] = (fields[index] ?? "").trim();
    }
    yield record;
  }
}

const secMonths: Record<string, number> = {
  JAN: 0,
  FEB: 1,
  MAR: 2,
  APR: 3,
  MAY: 4,
  JUN: 5,
  JUL: 6,
  AUG: 7,
  SEP: 8,
  OCT: 9,
  NOV: 10,
  DEC: 11,
};

/** DERA dates look like "31-JAN-2024"; returns UTC midnight of that day. */
export function parseSecDateMs(value: string): number | null {
  const match = /^(\d{1,2})-([A-Z]{3})-(\d{4})$/.exec(value.toUpperCase());
  if (!match) {
    return null;
  }
  const day = Number(match[1]);
  const month = secMonths[match[2]];
  const year = Number(match[3]);
  if (month == null || day < 1 || day > 31) {
    return null;
  }
  const timestampMs = Date.UTC(year, month, day);
  return new Date(timestampMs).getUTCDate() === day ? timestampMs : null;
}

const dayMs = 86_400_000;

export function endOfDayUtcMs(dayStartMs: number): number {
  return dayStartMs + dayMs - 1;
}
