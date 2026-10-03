"""Patient-trader screen: find wallets that trade a few times a day, win often, and win across
many trades (not one lucky hit). Works on any list of wallets (e.g. profitable buyers pooled from
earlier runs).

usage:
  python screen.py activity <pool.json>        # stage A: 1 credit/wallet, keeps quiet-but-active wallets
  python screen.py score    <activity.json>    # stage B: 30d history for survivors, applies the bar
pool.json = {wallet: [...source labels]} or [wallet, ...]
"""
import json, sys, time, statistics as st
import rpc, history, vet

NOW = int(time.time())
D30, D7 = NOW - 30 * 86400, NOW - 7 * 86400

# --- the bar (tune here) ---
MAX_TX_30D = 700        # stage A: more than this = hyperactive / bot-like
MIN_TX_30D = 30         # too few to judge
MIN_CLOSED_30D = 12     # closed trades needed over 30 days
MIN_WR_30D = 55         # % (user target ~60)
MIN_WR_7D = 50          # % over last 7 days, needs >= 4 closed
MAX_NEW_TOKENS_PER_DAY = 6
MIN_HOLD_MED_H = 0.5    # median hold >= 30 minutes (copyable)
MAX_QUICK_SHARE = 0.25  # exits under 5 min
MAX_TOP3_SHARE = 0.6    # top 3 trades < 60% of profit
MAX_MED_SIZE = 2500     # median buy $ (not a whale)


def activity(pool_path):
    pool = json.load(open(pool_path))
    ws = list(pool) if isinstance(pool, dict) else pool
    out = {}
    for i, w in enumerate(ws):
        try:
            r = rpc.rpc('getSignaturesForAddress', [w, {'limit': 1000}])
        except Exception:
            continue
        n30 = sum(1 for x in r if (x['blockTime'] or 0) >= D30)
        n7 = sum(1 for x in r if (x['blockTime'] or 0) >= D7)
        capped = len(r) == 1000 and (r[-1]['blockTime'] or 0) >= D30
        out[w] = dict(n30=n30 if not capped else 99999, n7=n7, src=pool[w] if isinstance(pool, dict) else [])
        if i % 100 == 99:
            print(i + 1, 'checked', file=sys.stderr, flush=True)
    keep = {w: v for w, v in out.items() if MIN_TX_30D <= v['n30'] <= MAX_TX_30D}
    json.dump(keep, open('activity.json', 'w'), indent=1)
    rpc.save_usage()
    print(f'{len(out)} checked; {len(keep)} quiet-but-active (30d txs {MIN_TX_30D}-{MAX_TX_30D}); '
          f'est. stage-B cost ~{sum(v["n30"] for v in keep.values())} credits')


def metrics(w):
    recs, ev, odd, P = vet.report(w, 30, 5000)
    sup = vet.supplies(list(P))
    trades = []
    for m, p in P.items():
        if p['b'] <= 0 or p['s'] <= 0:
            continue
        cost = p['b'] * min(p['qs'] / p['qb'], 1) if p['qb'] else p['b']
        trades.append(dict(m=m, pnl=p['s'] - cost, pct=(p['s'] - cost) / cost * 100 if cost else 0,
                           hold=(p['fs'] - p['fb']) / 3600, t=p['fb'],
                           mc=p['fp'] * sup[m] if sup.get(m) else None))
    if not trades:
        return None
    t7 = [t for t in trades if t['t'] >= D7]
    pos = sorted([t['pnl'] for t in trades if t['pnl'] > 0], reverse=True)
    tot = sum(t['pnl'] for t in trades)
    first_buys = [p['fb'] for p in P.values() if p['fb']]
    days_active = max(1, len({int(t // 86400) for t in first_buys}))
    sizes = [p['b'] / p['nb'] for p in P.values() if p['nb']]
    holds = [t['hold'] for t in trades]
    return dict(
        w=w, closed=len(trades), wr30=round(sum(t['pnl'] > 0 for t in trades) / len(trades) * 100),
        closed7=len(t7), wr7=round(sum(t['pnl'] > 0 for t in t7) / len(t7) * 100) if t7 else None,
        pnl=round(tot), pnl7=round(sum(t['pnl'] for t in t7)),
        ex_top2=round(tot - sum(pos[:2])), top3_share=round(sum(pos[:3]) / tot, 2) if tot > 0 else None,
        winners=len(pos), med_win_pct=round(st.median([t['pct'] for t in trades if t['pnl'] > 0])) if pos else None,
        med_loss_pct=round(st.median([t['pct'] for t in trades if t['pnl'] <= 0])) if len(pos) < len(trades) else None,
        new_per_day=round(len(first_buys) / days_active, 1), hold_med=round(st.median(holds), 2),
        quick=round(sum(h < 1 / 12 for h in holds) / len(holds), 2),
        size_med=round(st.median(sizes)) if sizes else None,
        pct_u100k=round(sum(1 for t in trades if t['mc'] and t['mc'] < 1e5) / len(trades) * 100))


def passes(m):
    why = []
    if m['closed'] < MIN_CLOSED_30D: why.append(f"only {m['closed']} closed")
    if m['wr30'] < MIN_WR_30D: why.append(f"30d WR {m['wr30']}%")
    if m['closed7'] >= 4 and (m['wr7'] or 0) < MIN_WR_7D: why.append(f"7d WR {m['wr7']}%")
    if m['pnl'] <= 0: why.append('30d PnL negative')
    if m['ex_top2'] <= 0: why.append('negative without top 2')
    if m['top3_share'] is not None and m['top3_share'] > MAX_TOP3_SHARE: why.append(f"top3 = {int(m['top3_share']*100)}% of profit")
    if m['new_per_day'] > MAX_NEW_TOKENS_PER_DAY: why.append(f"{m['new_per_day']} new tokens/day")
    if m['hold_med'] < MIN_HOLD_MED_H: why.append(f"median hold {int(m['hold_med']*60)} min")
    if m['quick'] > MAX_QUICK_SHARE: why.append(f"{int(m['quick']*100)}% exits <5 min")
    if (m['size_med'] or 0) > MAX_MED_SIZE: why.append(f"median size ${m['size_med']}")
    return why


def score(act_path):
    act = json.load(open(act_path))
    res = []
    for i, w in enumerate(sorted(act, key=lambda w: act[w]['n30'])):
        try:
            m = metrics(w)
        except Exception as e:
            print('skip', w[:8], rpc._redact(e), file=sys.stderr)
            continue
        if not m:
            continue
        m['src'] = act[w].get('src'); m['fails'] = passes(m)
        res.append(m)
        print(json.dumps(m), flush=True)
        if i % 20 == 19:
            rpc.save_usage()
    json.dump(res, open('screen_results.json', 'w'), indent=1)
    rpc.save_usage()
    ok = [m for m in res if not m['fails']]
    print(f'\n{len(res)} scored, {len(ok)} pass the patient-trader bar', file=sys.stderr)


if __name__ == '__main__':
    {'activity': activity, 'score': score}[sys.argv[1]](sys.argv[2])
