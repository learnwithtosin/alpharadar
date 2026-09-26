"""Wallet history fetcher → normalized per-transaction records.

Helius keyed: parsed-transaction API (100 tx per request), cached per page.
No key:       getSignaturesForAddress + getTransaction via public RPCs, cached per tx.

Normalized record: {sig, t, fee_payer, sol (wallet SOL delta excl. fee, incl. WSOL),
                    tok {mint: delta for tokens owned by wallet}, n_sources, err}
"""
import json, os, sys, time
from concurrent.futures import ThreadPoolExecutor
import rpc

WSOL = "So11111111111111111111111111111111111111112"
CACHE = os.environ.get("ONCHAIN_CACHE", "cache")


def _path(*p):
    d = os.path.join(CACHE, *p[:-1])
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, p[-1])


# ---------- Helius parsed-transactions path ----------
def _norm_enhanced(w, tx):
    sol = 0.0
    tok = {}
    for a in tx.get("accountData") or []:
        if a.get("account") == w:
            sol += (a.get("nativeBalanceChange") or 0) / 1e9
        for c in a.get("tokenBalanceChanges") or []:
            if c.get("userAccount") != w:
                continue
            raw = c.get("rawTokenAmount") or {}
            amt = int(raw.get("tokenAmount") or 0) / 10 ** int(raw.get("decimals") or 0)
            tok[c["mint"]] = tok.get(c["mint"], 0) + amt
    if tx.get("feePayer") == w:
        sol += (tx.get("fee") or 0) / 1e9
    sol += tok.pop(WSOL, 0)
    return dict(sig=tx["signature"], t=tx["timestamp"], fee_payer=tx.get("feePayer"),
                sol=sol, tok={k: v for k, v in tok.items() if abs(v) > 1e-12},
                type=tx.get("type"), source=tx.get("source"), err=bool(tx.get("transactionError")),
                native=[(n.get("fromUserAccount"), n.get("toUserAccount"), n.get("amount", 0) / 1e9)
                        for n in tx.get("nativeTransfers") or []])


def _helius_history(w, since, cap):
    out, before, page = [], None, 0
    while True:
        fn = _path("enh", w, f"{before or 'head'}.json")
        if os.path.exists(fn):
            txs = json.load(open(fn))
        else:
            txs, _ = rpc.enhanced_page(w, before=before)
            json.dump(txs, open(fn, "w"))
        page += 1
        if not txs:
            break
        for tx in txs:
            if tx["timestamp"] < since or len(out) >= cap:
                return out
            if not tx.get("transactionError"):
                out.append(_norm_enhanced(w, tx))
        before = txs[-1]["signature"]
    return out


# ---------- public RPC path ----------
def _norm_raw(w, sig, t):
    m = t["meta"]
    keys = [k["pubkey"] for k in t["transaction"]["message"]["accountKeys"]]
    tok = {}
    for b in m["preTokenBalances"]:
        if b.get("owner") == w:
            tok[b["mint"]] = tok.get(b["mint"], 0) - float(b["uiTokenAmount"]["uiAmount"] or 0)
    for b in m["postTokenBalances"]:
        if b.get("owner") == w:
            tok[b["mint"]] = tok.get(b["mint"], 0) + float(b["uiTokenAmount"]["uiAmount"] or 0)
    sol = 0.0
    if w in keys:
        i = keys.index(w)
        sol = (m["postBalances"][i] - m["preBalances"][i]) / 1e9
        if keys[0] == w:
            sol += m["fee"] / 1e9
    sol += tok.pop(WSOL, 0)
    native = []
    for ins in t["transaction"]["message"]["instructions"]:
        p = ins.get("parsed")
        if ins.get("program") == "system" and isinstance(p, dict) and p.get("type") == "transfer":
            native.append((p["info"]["source"], p["info"]["destination"], p["info"]["lamports"] / 1e9))
    return dict(sig=sig, t=t["blockTime"], fee_payer=keys[0], sol=sol,
                tok={k: v for k, v in tok.items() if abs(v) > 1e-12}, type=None, source=None,
                err=False, native=native)


def signatures(addr, since=0, max_n=15000):
    """All signatures for addr newer than `since` (cached per run)."""
    fn = _path("sigs", f"{addr}.json")
    if os.path.exists(fn):
        return json.load(open(fn))
    out, before = [], None
    while True:
        p = {"limit": 1000}
        if before:
            p["before"] = before
        r = rpc.rpc("getSignaturesForAddress", [addr, p])
        out += r
        if len(r) < 1000 or len(out) >= max_n or (r[-1]["blockTime"] or 0) < since:
            break
        before = r[-1]["signature"]
    json.dump(out, open(fn, "w"))
    return out


def get_transactions(sigs, threads=5):
    """Fetch raw txs into cache/tx/<sig>.json; batched on Helius, threaded on public."""
    todo = [s for s in sigs if not os.path.exists(_path("tx", f"{s}.json"))]
    params = [[s, {"encoding": "jsonParsed", "maxSupportedTransactionVersion": 1}] for s in todo]
    if rpc.using_helius():
        for i in range(0, len(todo), 100):
            res = rpc.rpc_batch("getTransaction", params[i:i + 100], chunk=50)
            for s, r in zip(todo[i:i + 100], res):
                if r is not None:
                    json.dump(r, open(_path("tx", f"{s}.json"), "w"))
    else:
        def one(k):
            try:
                r = rpc.rpc("getTransaction", params[k], quiet=True)
                if r:
                    json.dump(r, open(_path("tx", f"{todo[k]}.json"), "w"))
            except Exception:
                pass
        with ThreadPoolExecutor(threads) as ex:
            list(ex.map(one, range(len(todo))))
    return sum(os.path.exists(_path("tx", f"{s}.json")) for s in sigs)


def load_tx(sig):
    fn = _path("tx", f"{sig}.json")
    return json.load(open(fn)) if os.path.exists(fn) else None


def _public_history(w, since, cap):
    sigs = [x for x in signatures(w, since) if (x["blockTime"] or 0) >= since and not x["err"]][:cap]
    get_transactions([x["signature"] for x in sigs])
    out = []
    for x in sigs:
        t = load_tx(x["signature"])
        if t:
            out.append(_norm_raw(w, x["signature"], t))
    return out


def _deltas_enhanced(tx):
    d = {}
    for a in tx.get("accountData") or []:
        for c in a.get("tokenBalanceChanges") or []:
            raw = c.get("rawTokenAmount") or {}
            k = (c.get("userAccount"), c["mint"])
            d[k] = d.get(k, 0) + int(raw.get("tokenAmount") or 0) / 10 ** int(raw.get("decimals") or 0)
    return d


def _deltas_raw(t):
    d = {}
    for b in t["meta"]["preTokenBalances"]:
        k = (b.get("owner"), b["mint"]); d[k] = d.get(k, 0) - float(b["uiTokenAmount"]["uiAmount"] or 0)
    for b in t["meta"]["postTokenBalances"]:
        k = (b.get("owner"), b["mint"]); d[k] = d.get(k, 0) + float(b["uiTokenAmount"]["uiAmount"] or 0)
    return d


def address_txs(addr, since=0):
    """Every successful tx touching addr (oldest first) as generic records:
    {sig, t, slot, payer, deltas {(owner, mint): delta}, note}. Used for pool rebuilds."""
    out = []
    if rpc.using_helius():
        before = None
        while True:
            fn = _path("enh", addr, f"{before or 'head'}.json")
            if os.path.exists(fn):
                txs = json.load(open(fn))
            else:
                txs, _ = rpc.enhanced_page(addr, before=before)
                json.dump(txs, open(fn, "w"))
            if not txs:
                break
            for tx in txs:
                if not tx.get("transactionError"):
                    out.append(dict(sig=tx["signature"], t=tx["timestamp"], slot=tx["slot"], payer=tx.get("feePayer"),
                                    deltas=_deltas_enhanced(tx), note=f'{tx.get("type")}/{tx.get("source")}'))
            if txs[-1]["timestamp"] < since:
                break
            before = txs[-1]["signature"]
    else:
        sigs = [x for x in signatures(addr) if not x["err"]]
        get_transactions([x["signature"] for x in sigs])
        for x in sigs:
            t = load_tx(x["signature"])
            if t:
                out.append(dict(sig=x["signature"], t=t["blockTime"], slot=x["slot"],
                                payer=t["transaction"]["message"]["accountKeys"][0]["pubkey"], deltas=_deltas_raw(t),
                                note=" | ".join(l for l in t["meta"]["logMessages"] if "Instruction:" in l)[:120]))
    return [r for r in out if r["t"] >= since][::-1]


def wallet_history(w, days=30, cap=5000, now=None):
    """Normalized records for wallet w over the last `days` (newest first, ≤cap)."""
    since = int(now or time.time()) - days * 86400
    if rpc.using_helius():
        return _helius_history(w, since, cap)
    return _public_history(w, since, cap)


if __name__ == "__main__":
    # usage: python history.py <wallet> [days] [cap]
    w = sys.argv[1]
    d = int(sys.argv[2]) if len(sys.argv) > 2 else 30
    c = int(sys.argv[3]) if len(sys.argv) > 3 else 5000
    t0 = time.time()
    h = wallet_history(w, d, c)
    rpc.save_usage()
    print(len(h), "records in %.1fs" % (time.time() - t0), file=sys.stderr)
