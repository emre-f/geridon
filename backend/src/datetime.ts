export function parseDatetimeMs(value: string): number {
  const normalized = value.trim();
  if (/^\d+$/.test(normalized)) {
    return Number(normalized);
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return Date.parse(`${normalized}T00:00:00.000Z`);
  }

  const parsed = Date.parse(normalized);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid datetime '${value}'.`);
  }
  return parsed;
}

export function toIsoUtc(timestampMs: number): string {
  return new Date(timestampMs).toISOString().replace(".000Z", "Z");
}
