"use client";

import { useEffect, useState } from "react";

export type Theme = "system" | "light" | "dark";

/** Class on <html> for a theme. The root layout sets it from the cookie, so the first paint is right. */
export const themeClass = (t: Theme) => (t === "dark" ? "dark" : t === "light" ? "light" : "system");

const prefersDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;

function apply(theme: Theme) {
  const el = document.documentElement;
  el.classList.remove("dark", "light", "system");
  el.classList.add(themeClass(theme));
  // the server reads this on the next request, so no script is needed to avoid a flash
  // biome-ignore lint/suspicious/noDocumentCookie: the Cookie Store API isn't in Firefox yet
  document.cookie = `theme=${theme}; path=/; max-age=31536000; samesite=lax`;
  return theme === "dark" || (theme === "system" && prefersDark()) ? "dark" : "light";
}

function stored(): Theme {
  const m = document.cookie.match(/(?:^|; )theme=(light|dark|system)/);
  if (m) return m[1] as Theme;
  try {
    // carried over from the localStorage setting used before the cookie
    return (localStorage.getItem("theme") as Theme) || "system";
  } catch {
    return "system";
  }
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>("system");
  const [resolvedTheme, setResolved] = useState<"light" | "dark">("light");
  useEffect(() => {
    const t = stored();
    setThemeState(t);
    setResolved(apply(t));
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setResolved(apply(stored()));
    mq.addEventListener("change", onChange);
    window.addEventListener("op-theme", onChange);
    return () => {
      mq.removeEventListener("change", onChange);
      window.removeEventListener("op-theme", onChange);
    };
  }, []);
  const setTheme = (t: Theme) => {
    try {
      localStorage.setItem("theme", t);
    } catch {}
    setThemeState(t);
    setResolved(apply(t));
    window.dispatchEvent(new Event("op-theme"));
  };
  return { theme, resolvedTheme, setTheme };
}
