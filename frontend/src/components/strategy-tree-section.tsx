import { XIcon } from "lucide-react";

import type { IndicatorDefinition, StrategyGroup } from "@/lib/api";
import { ConditionGroupEditor } from "@/components/strategy-condition-group-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function StrategyTreeSection({
  label,
  badgeClassName,
  hint,
  group,
  catalog,
  onChange,
  onRemove,
}: {
  label: string;
  badgeClassName: string;
  hint: string;
  group: StrategyGroup;
  catalog: IndicatorDefinition[];
  onChange: (group: StrategyGroup) => void;
  onRemove?: () => void;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Badge className={badgeClassName}>{label}</Badge>
        <span className="text-muted-foreground text-xs">{hint}</span>
        {onRemove ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-destructive ml-auto"
            onClick={onRemove}
          >
            <XIcon />
            Remove
          </Button>
        ) : null}
      </div>
      <ConditionGroupEditor group={group} catalog={catalog} depth={0} onChange={onChange} />
    </section>
  );
}
