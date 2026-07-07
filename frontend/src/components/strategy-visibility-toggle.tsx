import { EyeIcon, EyeOffIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export function VisibilityToggle({
  hidden,
  subject,
  onToggle,
}: {
  hidden: boolean;
  subject: "rule" | "group";
  onToggle: () => void;
}) {
  const label = hidden ? `Show ${subject}` : `Hide ${subject} from evaluation`;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn(
        "size-8",
        hidden ? "text-muted-foreground/70 hover:text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
      aria-label={label}
      aria-pressed={hidden}
      title={label}
      onClick={onToggle}
    >
      {hidden ? <EyeOffIcon /> : <EyeIcon />}
    </Button>
  );
}
