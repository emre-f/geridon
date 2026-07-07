import { MoonIcon, RefreshCwIcon, SunIcon } from "lucide-react";

import type { AppTab } from "@/lib/app-types";
import { Button } from "@/components/ui/button";
import { SlashTabs } from "@/components/ui/slash-tabs";

const tabOptions = [
  { value: "charts", label: "Charts" },
  { value: "strategies", label: "Strategies" },
  { value: "backtest", label: "Backtest" },
];

export function AppHeader({
  activeTab,
  isDark,
  onRefresh,
  onTabChange,
  onThemeChange,
}: {
  activeTab: AppTab;
  isDark: boolean;
  onRefresh: () => void;
  onTabChange: (value: string) => void;
  onThemeChange: () => void;
}) {
  const themeLabel = isDark ? "Switch to light mode" : "Switch to dark mode";

  return (
    <header className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
        <div className="group/title flex min-w-0 items-center whitespace-nowrap">
          <h1 className="text-lg font-semibold leading-none">geridon</h1>
          <span className="max-w-0 overflow-hidden opacity-0 transition-all duration-200 ease-in-out group-hover/title:max-w-72 group-hover/title:opacity-100">
            <span className="text-muted-foreground pl-2 text-sm leading-none">
              / backtest your trading strategies
            </span>
          </span>
        </div>
        <SlashTabs
          options={tabOptions}
          value={activeTab}
          onValueChange={onTabChange}
          aria-label="Workspace tab"
        />
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-8"
          aria-label="Refresh chart"
          onClick={onRefresh}
        >
          <RefreshCwIcon />
        </Button>

        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-8"
          aria-label={themeLabel}
          title={themeLabel}
          onClick={onThemeChange}
        >
          {isDark ? <SunIcon /> : <MoonIcon />}
        </Button>
      </div>
    </header>
  );
}
