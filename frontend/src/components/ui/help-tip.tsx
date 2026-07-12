import type { ReactNode } from "react";

/**
 * A small "(?)" badge that reveals a hover/focus tooltip. Meant to sit next to
 * a field label via Field's `labelExtra`.
 */
export function HelpTip({ ariaLabel, children }: { ariaLabel: string; children: ReactNode }) {
  return (
    <span className="group relative inline-flex">
      <span
        tabIndex={0}
        aria-label={ariaLabel}
        onClick={(event) => event.preventDefault()}
        className="border-border text-muted-foreground inline-flex size-3.5 cursor-help items-center justify-center rounded-full border text-[10px] leading-none outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[2px]"
      >
        ?
      </span>
      <span className="border-border bg-popover text-popover-foreground invisible absolute left-0 top-[calc(100%+0.375rem)] z-50 w-72 rounded-md border p-2.5 text-[11px] font-normal opacity-0 shadow-md transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
        {children}
      </span>
    </span>
  );
}
