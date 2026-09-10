import { Github } from "lucide-react";
import { GITHUB_URL, X_URL } from "@/lib/socials";

/**
 * Real brand marks, not text labels standing in for them, and not a
 * generic lucide glyph mistaken for one — lucide-react's own "X" export
 * is its generic close/cross icon (two crossing lines), not the X
 * (formerly Twitter) brand mark; lucide ships no actual X logo. GitHub's
 * lucide icon is the genuine mark, so it's used as-is; X's is a
 * hand-rolled inline SVG of the real wordmark instead. Sized to match
 * each other (h-5 w-5) and given real contrast (icon-sized +
 * hover:text-foreground) — the previous plain-text "GITHUB"/"X" labels
 * at text-xs were too small and too dim to read as a real social link.
 */
function XLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

export function Footer() {
  return (
    <footer className="border-border border-t px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4">
        <p className="font-display text-muted-foreground text-[0.65rem] tracking-wide">
          ALPHARADAR — INFORMATIONAL ONLY, NOT FINANCIAL ADVICE
        </p>
        <div className="flex items-center gap-4">
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="AlphaRadar on GitHub"
            className="text-muted-foreground hover:text-foreground"
          >
            <Github className="h-5 w-5" />
          </a>
          {X_URL ? (
            <a
              href={X_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="AlphaRadar on X"
              className="text-muted-foreground hover:text-foreground"
            >
              <XLogo className="h-5 w-5" />
            </a>
          ) : (
            <span
              className="text-muted-foreground/40 cursor-not-allowed"
              title="Not live yet"
              aria-disabled="true"
              aria-label="AlphaRadar on X — not live yet"
            >
              <XLogo className="h-5 w-5" />
            </span>
          )}
        </div>
      </div>
    </footer>
  );
}
