"use client";
import { createContext, useCallback, useContext, useEffect, useSyncExternalStore } from "react";
import { useSettingsStore } from "@/lib/store/settingsStore";

export type Theme = "light" | "dark";
export type ThemePreference = Theme | "system";

interface ThemeContextValue {
  theme: Theme;
  preference: ThemePreference;
  toggle: () => void;
  setTheme: (t: ThemePreference) => void;
}

const ThemeCtx = createContext<ThemeContextValue>({
  theme: "dark",
  preference: "dark",
  toggle: () => {},
  setTheme: () => {},
});

const darkQuery = "(prefers-color-scheme: dark)";

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(darkQuery);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

const getSnapshot = () => window.matchMedia(darkQuery).matches;
const getServerSnapshot = () => true; // matches the pre-paint default applied by the inline script

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const preference = useSettingsStore((s) => s.theme);
  const setPreference = useSettingsStore((s) => s.setTheme);
  const systemDark = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const theme: Theme = preference === "system" ? (systemDark ? "dark" : "light") : preference;

  // Single place that mutates <html>, so React renders stay pure.
  useEffect(() => {
    const el = document.documentElement;
    el.classList.toggle("dark", theme === "dark");
    el.classList.toggle("light", theme === "light");
    el.setAttribute("data-theme", theme);
    el.style.colorScheme = theme;
  }, [theme]);

  const setTheme = useCallback((t: ThemePreference) => setPreference(t), [setPreference]);
  const toggle = useCallback(() => setPreference(theme === "dark" ? "light" : "dark"), [setPreference, theme]);

  return <ThemeCtx.Provider value={{ theme, preference, toggle, setTheme }}>{children}</ThemeCtx.Provider>;
}

export const useTheme = () => useContext(ThemeCtx);
