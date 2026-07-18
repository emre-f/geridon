import type { EventCoverageRow, EventIngestionRecord } from "@/lib/api-client-signals";
import { formatCompact } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const ingestionBadgeVariant: Record<string, "default" | "secondary" | "destructive"> = {
  completed: "secondary",
  running: "default",
  failed: "destructive",
};

function kindLabel(kind: string) {
  const words = kind.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function quarterLabel(startMs: number) {
  const date = new Date(startMs);
  return `${date.getUTCFullYear()} Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
}

function CoverageTable({ coverage }: { coverage: EventCoverageRow[] }) {
  const years = [...new Set(coverage.map((row) => row.year))].sort((a, b) => a - b);
  const kinds = [...new Set(coverage.map((row) => row.event_kind))].sort();
  const counts = new Map(coverage.map((row) => [`${row.event_kind}:${row.year}`, row.events]));
  const totals = new Map(
    kinds.map((kind) => [
      kind,
      coverage.filter((row) => row.event_kind === kind).reduce((sum, row) => sum + row.events, 0),
    ]),
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-muted-foreground border-b text-xs">
            <th className="py-1.5 pr-3 text-left font-medium">Event kind</th>
            {years.map((year) => (
              <th key={year} className="px-2 py-1.5 text-right font-medium">
                {year}
              </th>
            ))}
            <th className="py-1.5 pl-3 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {kinds.map((kind) => (
            <tr key={kind} className="border-b last:border-b-0">
              <td className="whitespace-nowrap py-1.5 pr-3 font-medium">{kindLabel(kind)}</td>
              {years.map((year) => {
                const events = counts.get(`${kind}:${year}`);
                return (
                  <td
                    key={year}
                    className="text-muted-foreground px-2 py-1.5 text-right tabular-nums"
                    title={events?.toLocaleString()}
                  >
                    {events == null ? "" : formatCompact(events)}
                  </td>
                );
              })}
              <td className="py-1.5 pl-3 text-right font-semibold tabular-nums">
                {(totals.get(kind) ?? 0).toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function IngestionRow({ ingestion }: { ingestion: EventIngestionRecord }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-sm">
      <span className="w-20 font-medium">{quarterLabel(ingestion.start_ms)}</span>
      <Badge variant={ingestionBadgeVariant[ingestion.status] ?? "default"}>
        {ingestion.status}
      </Badge>
      <span className="text-muted-foreground text-xs tabular-nums">
        {ingestion.inserted_rows.toLocaleString()} inserted, {ingestion.skipped_rows.toLocaleString()}{" "}
        skipped
      </span>
      {ingestion.error ? (
        <span className="text-destructive min-w-0 flex-1 truncate text-xs" title={ingestion.error}>
          {ingestion.error}
        </span>
      ) : null}
    </li>
  );
}

function RunIngestionHint() {
  return (
    <div className="text-muted-foreground space-y-1.5 text-sm">
      <p className="text-foreground font-medium">Run ingestion</p>
      <p>
        Ingestion runs from the backend CLI. It is idempotent and resumable, so rerunning it only
        fetches quarters that are missing or previously failed:
      </p>
      <code className="bg-muted block w-fit rounded px-2 py-1 font-mono text-xs">
        npm run ingest -- form4 --from=2006 --to=now
      </code>
      <p>
        Requires <code className="font-mono text-xs">SEC_USER_AGENT</code> in{" "}
        <code className="font-mono text-xs">backend/.env</code>. Refresh this view when it finishes.
      </p>
    </div>
  );
}

export function SignalCoverageView({
  coverage,
  ingestions,
}: {
  coverage: EventCoverageRow[];
  ingestions: EventIngestionRecord[];
}) {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Event coverage</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {coverage.length > 0 ? (
            <CoverageTable coverage={coverage} />
          ) : (
            <p className="text-muted-foreground text-sm">
              No events ingested yet. Run the Form 4 ingestion below to populate the events table.
            </p>
          )}
          <RunIngestionHint />
        </CardContent>
      </Card>

      {ingestions.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Recent ingestions</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {ingestions.map((ingestion) => (
                <IngestionRow key={ingestion.id} ingestion={ingestion} />
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
