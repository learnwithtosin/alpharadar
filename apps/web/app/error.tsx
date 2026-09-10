"use client";

/**
 * The catch-all error boundary for any route under app/ that doesn't
 * define a more specific one (Next.js App Router convention) — currently
 * /opportunities and /opportunities/[id], whose own queries are each
 * page's reason for existing (unlike AppHeader's scan indicator or the
 * landing page's stats, which degrade quietly instead of ever reaching
 * this). AppHeader/Footer render normally around this — only the failed
 * segment's content is replaced.
 *
 * Deliberately doesn't render `error.message` or `error.stack`: Next.js
 * already strips both from production error objects delivered to a
 * client component (only `digest` survives), so this stays honest
 * ("something failed") without ever risking a leaked stack trace even in
 * dev, where the message is still present but not something a stranger
 * hitting a blip needs to see.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex max-w-5xl flex-col items-start px-4 py-24 sm:px-6 lg:px-8">
      <div className="font-display text-muted-foreground mb-4 text-xs font-bold tracking-[0.14em]">
        SIGNAL LOST
      </div>
      <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
        This page couldn&apos;t load.
      </h1>
      <p className="text-muted-foreground mt-3 max-w-md text-sm leading-relaxed">
        That&apos;s usually a brief database connection blip, not a broken page — it typically
        resolves on retry.
      </p>
      {error.digest && (
        <p className="text-muted-foreground/60 mt-4 font-mono text-xs">Ref: {error.digest}</p>
      )}
      <div className="mt-8 flex items-center gap-4">
        <button
          type="button"
          onClick={reset}
          className="font-display bg-signal text-signal-foreground inline-block rounded-lg px-6 py-3 text-sm font-bold tracking-wide hover:opacity-90"
        >
          TRY AGAIN
        </button>
        <a
          href="/"
          className="font-display text-muted-foreground hover:text-foreground text-xs font-bold tracking-wide"
        >
          ‹ HOME
        </a>
      </div>
    </main>
  );
}
