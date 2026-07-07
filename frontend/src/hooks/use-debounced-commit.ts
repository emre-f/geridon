import { useCallback, useEffect, useRef } from "react";

export function useDebouncedCommit<T>(commit: (value: T) => void, delayMs: number) {
  const timeoutRef = useRef<number | undefined>(undefined);
  const pendingRef = useRef<{ value: T } | null>(null);
  const commitRef = useRef(commit);
  commitRef.current = commit;

  const flush = useCallback(() => {
    window.clearTimeout(timeoutRef.current);
    if (pendingRef.current != null) {
      const { value } = pendingRef.current;
      pendingRef.current = null;
      commitRef.current(value);
    }
  }, []);

  const schedule = useCallback(
    (value: T) => {
      pendingRef.current = { value };
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = window.setTimeout(flush, delayMs);
    },
    [delayMs, flush],
  );

  useEffect(() => flush, [flush]);

  return { schedule, flush };
}
