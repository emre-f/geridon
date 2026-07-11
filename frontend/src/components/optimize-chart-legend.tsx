export interface LegendItem {
  label: string;
  color: string;
  mark: "dot" | "hollow" | "line" | "dashed" | "rect";
}

function LegendMark({ item }: { item: LegendItem }) {
  return (
    <svg width={16} height={10} aria-hidden="true" className="shrink-0">
      {item.mark === "dot" ? <circle cx={8} cy={5} r={3.5} fill={item.color} /> : null}
      {item.mark === "hollow" ? (
        <circle cx={8} cy={5} r={3} fill="none" stroke={item.color} strokeWidth={1.5} />
      ) : null}
      {item.mark === "line" ? (
        <line x1={1} x2={15} y1={5} y2={5} stroke={item.color} strokeWidth={2} />
      ) : null}
      {item.mark === "dashed" ? (
        <line x1={1} x2={15} y1={5} y2={5} stroke={item.color} strokeWidth={1.5} strokeDasharray="3 2.5" />
      ) : null}
      {item.mark === "rect" ? <rect x={3} y={1} width={10} height={8} rx={2} fill={item.color} /> : null}
    </svg>
  );
}

export function ChartLegend({ items }: { items: LegendItem[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1">
      {items.map((item) => (
        <span key={item.label} className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <LegendMark item={item} />
          {item.label}
        </span>
      ))}
    </div>
  );
}
