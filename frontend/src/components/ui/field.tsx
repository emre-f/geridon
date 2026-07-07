import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function Field({
  label,
  labelExtra,
  children,
  className,
}: {
  label: string;
  labelExtra?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("flex flex-col gap-1", className)}>
      <span className="text-muted-foreground flex items-center gap-1 text-[11px] font-medium">
        {label}
        {labelExtra}
      </span>
      {children}
    </label>
  );
}
