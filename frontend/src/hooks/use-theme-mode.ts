import { useEffect, useState } from "react";

const themeStorageKey = "geridon-theme";

export type Theme = "light" | "dark";

function storedTheme(): Theme {
  try {
    return localStorage.getItem(themeStorageKey) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function useThemeMode() {
  const [theme, setTheme] = useState<Theme>(storedTheme);
  const isDark = theme === "dark";

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", isDark);
    root.style.colorScheme = theme;

    try {
      localStorage.setItem(themeStorageKey, theme);
    } catch {
      // Ignore storage failures so the toggle still works for the current session.
    }
  }, [isDark, theme]);

  return { theme, setTheme, isDark };
}
