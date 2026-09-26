"""Per-wallet trade reconstruction from normalized history records (history.py)."""
import json, os, bisect, time, urllib.request
from collections import defaultdict
import rpc, history

SOL = 'So11111111111111111111111111111111111111112'
STABLE = {'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'}
SOL_USDC_POOL = 'Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE'
# Extra quote tokens valued via a per-minute USD price file: {mint: path}
EXTRA_QUOTES = {}


def _gt_ohlcv(pool, tf, token, pages, fn):
    fn = history._path('prices', fn)
    if os.path.exists(fn):
        return json.load(open(fn))
    out, before = {}, int(time.time())
    for _ in range(pages):
        u = (f"https://api.geckoterminal.com/api/v2/networks/solana/pools/{pool}/ohlcv/{tf}"
             f"?aggregate=1&limit=1000&currency=usd&token={token}&before_timestamp={before}")
        l = rpc.get_json(u, label='geckoterminal')['data']['attributes']['ohlcv_list']
        if not l:
            break
        for c in l:
            out[str(c[0])] = c[4]
        before = min(c[0] for c in l)
        time.sleep(2.2)
    json.dump(out, open(fn, 'w'))
    return out


class Series:
    def __init__(self, d):
        self.d = d; self.k = sorted(int(x) for x in d)
    def at(self, t):
        if not self.k or t < self.k[0] - 3600:
            return None
        return self.d[str(self.k[max(bisect.bisect_right(self.k, t) - 1, 0)])]


_sol = None
def solp(t):
    global _sol
    if _sol is None:
        _sol = Series(_gt_ohlcv(SOL_USDC_POOL, 'hour', SOL, 2, 'sol_usd_hour.json'))
    return _sol.at(t) or 0


_extra = {}
def add_quote(mint, pool, token_side_mint, pages=4):
    """Register an extra quote token (e.g. AQUA) priced per minute from a GT pool."""
    _extra[mint] = Series(_gt_ohlcv(pool, 'minute', token_side_mint, pages, f'{mint}_usd_min.json'))


def classify(w, recs):
    """Turn records into swap events + odd-activity counts."""
    ev, odd = [], defaultdict(int)
    for r in recs:
        tok = dict(r['tok']); T = r['t']
        stab = sum(tok.pop(s, 0) for s in list(tok) if s in STABLE)
        ex_usd = 0
        others = [k for k in tok if k not in _extra]
        if others:
            for m in list(tok):
                if m in _extra:
                    ex_usd += tok.pop(m) * (_extra[m].at(T) or 0)
        quote_usd = r['sol'] * solp(T) + stab + ex_usd
        if len(tok) == 1:
            mint, q = next(iter(tok.items()))
            if q > 0 and quote_usd < -0.5: ev.append((T, mint, 'buy', q, -quote_usd))
            elif q < 0 and quote_usd > 0.5: ev.append((T, mint, 'sell', -q, quote_usd))
            elif q > 0 and abs(quote_usd) <= 0.5: odd['token_in_no_payment'] += 1
            elif q < 0 and abs(quote_usd) <= 0.5: odd['token_out_no_payment'] += 1
            else: odd['ambiguous'] += 1
        elif not tok:
            ext = r['fee_payer'] != w
            if r['sol'] > 0.001 and ext: odd['sol_in'] += 1
            if 0 < r['sol'] < 0.001 and ext: odd['dust_sol_in'] += 1
            if r['sol'] < -0.001: odd['sol_out'] += 1
        else:
            odd['multi_token_tx'] += 1
    return ev, odd


def positions(ev):
    P = defaultdict(lambda: dict(b=0, s=0, qb=0, qs=0, fb=None, ls=None, fs=None, nb=0, ns=0, fp=None))
    for T, mint, side, q, usd in sorted(ev):
        p = P[mint]
        if side == 'buy':
            p['b'] += usd; p['qb'] += q; p['nb'] += 1
            if p['fb'] is None: p['fb'] = T; p['fp'] = usd / q
        else:
            p['s'] += usd; p['qs'] += q; p['ns'] += 1; p['ls'] = T
            if p['fs'] is None: p['fs'] = T
    return P


def supplies(mints, cache={}):
    need = [m for m in mints if m not in cache]
    fn = history._path('prices', 'supplies.json')
    if os.path.exists(fn):
        cache.update(json.load(open(fn))); need = [m for m in need if m not in cache]
    for i in range(0, len(need), 100):
        r = rpc.rpc('getMultipleAccounts', [need[i:i + 100], {'encoding': 'jsonParsed'}])['value']
        for m, a in zip(need[i:i + 100], r):
            try:
                inf = a['data']['parsed']['info']; cache[m] = float(inf['supply']) / 10 ** inf['decimals']
            except Exception:
                cache[m] = None
    json.dump(cache, open(fn, 'w'))
    return cache


def report(w, days=30, cap=5000):
    recs = history.wallet_history(w, days, cap)
    ev, odd = classify(w, recs)
    return recs, ev, odd, positions(ev)
