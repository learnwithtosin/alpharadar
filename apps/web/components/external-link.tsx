"use client";

import { useEffect, useState } from "react";

/**
 * Any link this app renders that leaves AlphaRadar for a mint page,
 * project site, or explorer — never our own footer socials, which link
 * to accounts AlphaRadar itself controls and are rendered as plain `<a>`
 * tags instead. One dismissible interstitial, not a wall: a single
 * click through, showing the real destination so the user can verify it
 * themselves, and the warning itself sourced from
 * 01-PROJECT-CONSTITUTION.md §2-3 (AlphaRadar never signs transactions
 * or spends on your behalf; never touches seed phrases, private keys, or
 * wallet passwords) rather than written from impression.
 */
export function ExternalLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
        onClick={(e) => {
          e.preventDefault();
          setOpen(true);
        }}
      >
        {children}
      </a>
      {open && <LeavingDialog href={href} onDismiss={() => setOpen(false)} />}
    </>
  );
}

function LeavingDialog({ href, onDismiss }: { href: string; onDismiss: () => void }) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") onDismiss();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onDismiss]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onDismiss}
      role="presentation"
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="leaving-dialog-title"
        className="border-border bg-card w-full max-w-sm rounded-lg border p-5 shadow-lg sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          id="leaving-dialog-title"
          className="font-display text-muted-foreground mb-3 text-xs font-bold tracking-[0.14em]"
        >
          LEAVING ALPHARADAR
        </div>
        <p className="text-[15px] leading-relaxed">
          This link leaves AlphaRadar for a third-party site AlphaRadar does not operate or verify.
        </p>
        <p className="mt-3 text-[15px] leading-relaxed">
          Never enter a seed phrase, private key, or wallet password on any site. AlphaRadar never
          signs transactions or spends on your behalf, and never asks for one.{" "}
          <span className="text-muted-foreground text-xs">(01-PROJECT-CONSTITUTION.md §2-3)</span>
        </p>
        <div className="border-border bg-background mt-4 rounded-md border p-3">
          <div className="font-display text-muted-foreground mb-1 text-[13px] font-bold tracking-wide">
            VERIFY THE URL
          </div>
          <code className="block break-all font-mono text-xs">{href}</code>
        </div>
        <div className="mt-5 flex items-center justify-end gap-4">
          <button
            type="button"
            onClick={onDismiss}
            className="font-display text-muted-foreground hover:text-foreground text-xs font-bold tracking-wide"
          >
            CANCEL
          </button>
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onDismiss}
            className="font-display bg-signal text-signal-foreground rounded-lg px-5 py-2.5 text-xs font-bold tracking-wide hover:opacity-90"
          >
            CONTINUE ↗
          </a>
        </div>
      </div>
    </div>
  );
}
