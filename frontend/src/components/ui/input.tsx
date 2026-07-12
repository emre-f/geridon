import * as React from "react";

import { cn } from "@/lib/utils";
import { fieldControlClassName } from "@/components/ui/field-control";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        fieldControlClassName,
        "ring-offset-background placeholder:text-muted-foreground flex w-full px-3 py-1",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
