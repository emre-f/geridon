import type { IndicatorValueDefinition } from "@/lib/api";
import { HelpTip } from "@/components/ui/help-tip";

export function OutputHelp({ values }: { values: IndicatorValueDefinition[] }) {
  return (
    <HelpTip ariaLabel="Output descriptions">
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
    </HelpTip>
  );
}
