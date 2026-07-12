import { TriangleAlertIcon } from "lucide-react";

export function OptimizeExperimentWarnings({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) {
    return null;
  }
  return (
    <div className="rounded-md border border-amber-500/60 bg-amber-500/5 px-3 py-2.5">
      <ul className="flex flex-col gap-1.5">
        {warnings.map((warning) => (
          <li key={warning} className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400">
            <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>{warning}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
