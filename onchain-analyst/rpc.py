"""Shared RPC / Helius client for the onchain-analyst scripts.

- Uses Helius when HELIUS_API_KEY is set, else falls back to public RPCs.
- The key is read only from the environment and is redacted from every
  error message; it is never printed, logged, or written to disk.
- Every call is counted in usage.json (per run dir) so each run can report
  how many requests / estimated credits it used.
- 429s back off (honouring Retry-After); callers cache results on disk.
"""
import json, os, sys, time, threading, urllib.request, urllib.error, itertools

KEY = os.environ.get("HELIUS_API_KEY", "").strip()
HELIUS_RPC = f"https://mainnet.helius-rpc.com/?api-key={KEY}" if KEY else None
HELIUS_API = "https://api.helius.xyz/v0"
PUBLIC_RPCS = ["https://api.mainnet-beta.solana.com",
               "https://solana-mainnet.gateway.tatum.io",
               "https://api.mainnet-beta.solana.com"]
_pub = itertools.cycle(PUBLIC_RPCS)
_lock = threading.Lock()
UA = {"content-type": "application/json", "user-agent": "curl/8.5.0"}

# Approximate Helius credit costs; check the Helius dashboard for the truth.
CREDITS = {"getSignaturesForAddress": 10, "getTransaction": 10,
           "enhanced_transactions": 100, "default": 1}

USAGE_FILE = os.environ.get("ONCHAIN_USAGE_FILE", "usage.json")
_usage = {}


def using_helius():
    return bool(KEY)


def _redact(s):
    s = str(s)
    return s.replace(KEY, "***") if KEY else s


def _count(provider, method, n=1):
    with _lock:
        k = f"{provider}:{method}"
        _usage[k] = _usage.get(k, 0) + n


def save_usage():
    """Merge this process's counts into USAGE_FILE."""
    with _lock:
        old = {}
        if os.path.exists(USAGE_FILE):
            try:
                old = json.load(open(USAGE_FILE))
            except Exception:
                old = {}
        for k, v in _usage.items():
            old[k] = old.get(k, 0) + v
        _usage.clear()
        json.dump(old, open(USAGE_FILE, "w"), indent=1)
        return old


def usage_report(u=None):
    u = u if u is not None else (json.load(open(USAGE_FILE)) if os.path.exists(USAGE_FILE) else {})
    hel = {k.split(":", 1)[1]: v for k, v in u.items() if k.startswith("helius:")}
    pub = sum(v for k, v in u.items() if not k.startswith("helius:"))
    credits = sum(v * CREDITS.get(m, CREDITS["default"]) for m, v in hel.items())
    return dict(helius_requests=sum(hel.values()), helius_by_method=hel,
                est_helius_credits=credits, public_requests=pub)


def _post(url, body, timeout=60):
    req = urllib.request.Request(url, json.dumps(body).encode(), UA)
    return json.load(urllib.request.urlopen(req, timeout=timeout))


def _get(url, timeout=60):
    req = urllib.request.Request(url, headers={"user-agent": "curl/8.5.0"})
    return json.load(urllib.request.urlopen(req, timeout=timeout))


def _sleep_for(e, attempt):
    if isinstance(e, urllib.error.HTTPError) and e.code == 429:
        ra = e.headers.get("Retry-After")
        try:
            return min(float(ra), 30) if ra else min(1.5 * 2 ** attempt, 30)
        except ValueError:
            return min(1.5 * 2 ** attempt, 30)
    return min(0.5 + attempt * 0.5, 10)


def rpc(method, params, tries=10, quiet=False):
    """Single JSON-RPC call. Helius first (if keyed), public RPCs as fallback."""
    last = None
    for i in range(tries):
        use_h = HELIUS_RPC and i < tries - 3  # last few tries fall back to public
        url = HELIUS_RPC if use_h else next(_pub)
        prov = "helius" if use_h else "public"
        try:
            _count(prov, method)
            j = _post(url, {"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
            if "error" in j:
                raise RuntimeError(j["error"])
            return j["result"]
        except Exception as e:
            last = e
            time.sleep(_sleep_for(e, i))
    if not quiet:
        print("rpc fail", method, _redact(last), file=sys.stderr)
    raise RuntimeError(_redact(last))


def rpc_batch(method, param_list, chunk=50, tries=8):
    """JSON-RPC batch (Helius). Returns results aligned with param_list;
    None for items that errored. Falls back to single calls if batching is refused."""
    out = [None] * len(param_list)
    if not HELIUS_RPC:
        for i, p in enumerate(param_list):
            try:
                out[i] = rpc(method, p)
            except Exception:
                pass
        return out
    for s in range(0, len(param_list), chunk):
        part = param_list[s:s + chunk]
        body = [{"jsonrpc": "2.0", "id": s + k, "method": method, "params": p} for k, p in enumerate(part)]
        for i in range(tries):
            try:
                _count("helius", method, len(part))
                res = _post(HELIUS_RPC, body, timeout=120)
                if isinstance(res, dict):  # batch refused → single calls
                    raise TypeError(_redact(res.get("error", res)))
                for r in res:
                    if "result" in r:
                        out[r["id"]] = r["result"]
                break
            except TypeError:
                for k, p in enumerate(part):
                    try:
                        out[s + k] = rpc(method, p)
                    except Exception:
                        pass
                break
            except Exception as e:
                time.sleep(_sleep_for(e, i))
    return out


def get_json(url, tries=8, label="http"):
    """GET JSON from a public API (GeckoTerminal, DexScreener) with 429 backoff."""
    last = None
    for i in range(tries):
        try:
            _count("public", label)
            return _get(url)
        except Exception as e:
            last = e
            time.sleep(max(_sleep_for(e, i), 3 if isinstance(e, urllib.error.HTTPError) and e.code == 429 else 0))
    raise RuntimeError(_redact(last))


def enhanced_page(address, before=None, tx_type=None, limit=100, tries=8):
    """One page of Helius parsed transactions for an address (newest first).
    Returns (list, next_before). Raises if no key."""
    if not KEY:
        raise RuntimeError("HELIUS_API_KEY not set")
    q = f"api-key={KEY}&limit={limit}"
    if before:
        q += f"&before={before}"
    if tx_type:
        q += f"&type={tx_type}"
    url = f"{HELIUS_API}/addresses/{address}/transactions?{q}"
    last = None
    for i in range(tries):
        try:
            _count("helius", "enhanced_transactions")
            r = _get(url)
            return r, (r[-1]["signature"] if r else None)
        except urllib.error.HTTPError as e:
            body = ""
            try:
                body = e.read().decode()[:400]
            except Exception:
                pass
            # With a type filter Helius may return 404 + a continuation signature
            if e.code == 404 and "before" in body:
                import re
                m = re.search(r"before[^A-Za-z0-9]+([1-9A-HJ-NP-Za-km-z]{60,90})", body)
                if m:
                    return [], m.group(1)
            last = f"HTTP {e.code} {body}"
            time.sleep(_sleep_for(e, i))
        except Exception as e:
            last = e
            time.sleep(_sleep_for(e, i))
    raise RuntimeError(_redact(last))
