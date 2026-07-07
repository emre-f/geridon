import type { IndicatorValueDefinition } from "@/lib/api";

export function OutputHelp({ values }: { values: IndicatorValueDefinition[] }) {
  return (
    <span className="group relative inline-flex">
      <span
        tabIndex={0}
        aria-label="Output descriptions"
        onClick={(event) => event.preventDefault()}
        className="border-border text-muted-foreground inline-flex size-3.5 cursor-help items-center justify-center rounded-full border text-[10px] leading-none outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[2px]"
      >
        ?
      </span>
      <span className="border-border bg-popover text-popover-foreground invisible absolute left-0 top-[calc(100%+0.375rem)] z-50 w-64 rounded-md border p-2 text-[11px] font-normal opacity-0 shadow-md transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
        {values.map((value) => {
          const description = value.description?.trim();

          return (
            <span key={value.key} className="block leading-snug">
              <span className="font-medium">{value.label}</span>
              {": "}
              {description ? (
                <span className="text-muted-foreground">{description}</span>
              ) : (
                <span className="text-muted-foreground italic">
                  {"<no description provided>"}
                </span>
              )}
            </span>
          );
        })}
      </span>
    </span>
  );
}
