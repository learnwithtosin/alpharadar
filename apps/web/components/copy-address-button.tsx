"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * 02 §16/§17 + 03's "never shorten the contract in the actual alert",
 * carried over to the web app: the full address is always the visible
 * text (see the monospace block this sits next to) — this button copies
 * it, it never substitutes for showing it in full.
 */
export function CopyAddressButton({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied by the browser — the address is
      // already shown in full as selectable text, so this is a lost
      // convenience, not a lost capability.
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleCopy}
      aria-label="Copy contract address"
      className="font-display shrink-0 text-xs font-bold tracking-wide"
    >
      {copied ? <Check className="text-signal" /> : <Copy />}
      {copied ? "COPIED" : "COPY"}
    </Button>
  );
}
