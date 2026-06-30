import { useCallback, useLayoutEffect, useState } from "react";

export function useElementSize<T extends HTMLElement>() {
  const [element, setElement] = useState<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const ref = useCallback((node: T | null) => {
    setElement(node);
  }, []);

  useLayoutEffect(() => {
    if (!element) {
      return;
    }

    const setElementSize = () => {
      const rect = element.getBoundingClientRect();
      setSize({ width: rect.width, height: rect.height });
    };

    setElementSize();

    const observer = new ResizeObserver(setElementSize);
    observer.observe(element);

    window.addEventListener("resize", setElementSize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", setElementSize);
    };
  }, [element]);

  return [ref, size] as const;
}
