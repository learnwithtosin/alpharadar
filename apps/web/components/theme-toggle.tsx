"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "ar-theme";

/**
 * Reads the class layout.tsx's inline init script already applied
 * (no-flash) rather than guessing a starting value — this component
 * only takes over from there, it doesn't decide the initial theme.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light" | null>(null);

  useEffect(() => {
    setTheme(document.documentElement.classList.contains("light") ? "light" : "dark");
  }, []);

  function toggle(): void {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.classList.remove("dark", "light");
    document.documentElement.classList.add(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage can be unavailable (private mode, disabled) — the toggle
      // still works for this page view, it just won't persist.
    }
    setTheme(next);
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={toggle}
      className="font-display h-7 px-2.5 text-[0.65rem] tracking-wider"
      aria-label="Toggle theme"
    >
      {/* Rendered only once mounted — avoids claiming a theme before we've read it, without needing a hydration-mismatch suppression here too. */}
      {theme ? theme.toUpperCase() : "THEME"}
    </Button>
  );
}
