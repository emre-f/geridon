import { useEffect, useMemo, useState } from "react";

import { listIndicatorCatalog, type IndicatorDefinition } from "@/lib/api";

/** Loads the backend indicator catalog once and indexes it by kind. */
export function useIndicatorCatalog(onError: (message: string) => void) {
  const [catalog, setCatalog] = useState<IndicatorDefinition[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function loadIndicatorCatalog() {
      try {
        const nextCatalog = await listIndicatorCatalog();
        if (!cancelled) {
          setCatalog(nextCatalog);
        }
      } catch (loadError) {
        if (!cancelled) {
          onError(loadError instanceof Error ? loadError.message : "Could not load indicators.");
        }
      }
    }

    loadIndicatorCatalog();
    return () => {
      cancelled = true;
    };
  }, [onError]);

  const definitionsByKind = useMemo(
    () => new Map(catalog.map((definition) => [definition.kind, definition])),
    [catalog],
  );

  return { catalog, definitionsByKind };
}
