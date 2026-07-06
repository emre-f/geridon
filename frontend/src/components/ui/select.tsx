import * as React from "react";
import { ChevronDownIcon } from "lucide-react";

import { cn } from "@/lib/utils";

function Select({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <div className={cn("relative", className)}>
      <select
        data-slot="select"
        className={cn(
          "border-input bg-background flex h-9 w-full min-w-0 appearance-none rounded-md border py-1 pl-3 pr-8 text-sm shadow-xs transition-[border-color,box-shadow] outline-none disabled:cursor-not-allowed disabled:opacity-50",
          "focus-visible:border-border focus-visible:shadow-[var(--input-focus-shadow)]",
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDownIcon className="text-muted-foreground pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2" />
    </div>
  );
}

export { Select };
