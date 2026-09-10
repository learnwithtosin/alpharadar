"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "ar-theme";

/**
 * Initial state is "dark" — matching layout.tsx's server-rendered
 * default on <html>, so the server-rendered and first-client-render
 * output are identical (no hydration mismatch, no empty button before
 * mount). The no-flash inline script may have already switched <html>
 * to "light" before this component ever mounts; useEffect below reads
 * that real value and corrects the icon — the only moment this can be
 * wrong is a possible one-frame icon swap on a light-preferring visit,
 * never a blank control.
 *
 * Icon-only (not a "DARK"/"LIGHT" text button) — at 380px the header
 * already carries the wordmark, an Opportunities nav link, and the scan
 * indicator; an icon keeps this from being the thing that forces a wrap.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");

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
      size="icon"
      onClick={toggle}
      className="h-7 w-7"
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
    >
      {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
    </Button>
  );
}
