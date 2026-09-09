/**
 * Telegram rejects an inline-keyboard button URL that isn't a genuinely
 * public https address — confirmed live: `http://localhost:3000/...`
 * (WEB_URL's own default) got "Wrong HTTP URL" back from sendMessage,
 * which without a guard fails the *entire* alert, button and all. This
 * is a pattern check, not a live reachability probe — it can't tell a
 * real public host from one that's merely publicly *routable*, only rule
 * out the well-known classes of address that are never reachable from
 * outside the machine that named them (loopback, unspecified, private,
 * link-local) and anything not on https.
 */
export function looksLikePubliclyReachableHttpsUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol !== "https:") return false;

  // `new URL(...).hostname` always brackets an IPv6 literal (confirmed:
  // "https://[::1]:3000/x" -> "[::1]"), never returns the bare form.
  const hostname = parsed.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return false;
  if (hostname === "0.0.0.0" || hostname === "[::]" || hostname === "[::1]") return false;
  if (hostname.startsWith("[fe80:")) return false; // IPv6 link-local

  const ipv4Octets = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (ipv4Octets) {
    const [a, b] = ipv4Octets.slice(1).map(Number);
    if (a === 127) return false; // loopback: 127.0.0.0/8
    if (a === 10) return false; // private: 10.0.0.0/8
    if (a === 172 && b !== undefined && b >= 16 && b <= 31) return false; // private: 172.16.0.0/12
    if (a === 192 && b === 168) return false; // private: 192.168.0.0/16
    if (a === 169 && b === 254) return false; // link-local: 169.254.0.0/16
  }

  return true;
}
