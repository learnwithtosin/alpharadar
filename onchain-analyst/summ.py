"""Stage-3 wallet vetting summary.
usage: python summ.py [--days N] [--cap N] <wallet> [<wallet> ...]  → JSON lines on stdout
"""
import json, sys, statistics as st, time
import rpc
from vet import report, supplies


def summarize(w, days=30, cap=5000):
    recs, ev, odd, P = report(w, days, cap)
    sup = supplies(list(P))
    res, openp = [], []
    for m, p in P.items():
        if p['b'] <= 0:
            continue
        if p['s'] > 0:
            cost = p['b'] * min(p['qs'] / p['qb'], 1) if p['qb'] else p['b']
            pnl = p['s'] - cost
            res.append(dict(m=m, cost=cost, pnl=pnl, pct=pnl / cost * 100 if cost else 0,
                            hold=(p['fs'] - p['fb']) / 3600 if p['fs'] and p['fb'] else None,
                            full=p['qs'] >= 0.9 * p['qb'],
                            entry_mcap=p['fp'] * sup[m] if sup.get(m) else None))
        else:
            openp.append(m)
    wins = [r for r in res if r['pnl'] > 0]
    tot_cost = sum(r['cost'] for r in res); tot = sum(r['pnl'] for r in res)
    top = sorted(res, key=lambda r: -r['pnl'])
    ex2 = sum(r['pnl'] for r in top[2:])
    em = [P[m]['fp'] * sup[m] for m in P if P[m]['fp'] and sup.get(m)]
    holds = [r['hold'] for r in res if r['hold'] is not None]
    sizes = [P[m]['b'] / P[m]['nb'] for m in P if P[m]['nb']]
    span = (recs[0]['t'] - recs[-1]['t']) / 86400 if recs else 0
    return dict(
        w=w, records=len(recs), days_covered=round(span, 1),
        tokens_traded=len(P), closed=len(res), open=len(openp),
        winrate=round(len(wins) / len(res) * 100) if res else None,
        pnl=round(tot), pnl_pct=round(tot / tot_cost * 100) if tot_cost else None,
        pnl_ex_top2=round(ex2),
        spread=dict(gt500=sum(r['pct'] > 500 for r in res), r200_500=sum(200 < r['pct'] <= 500 for r in res),
                    r0_200=sum(0 < r['pct'] <= 200 for r in res), loss=sum(r['pct'] <= 0 for r in res)),
        top2_share=round(sum(r['pnl'] for r in top[:2]) / tot * 100) if tot > 0 else None,
        hold_med_h=round(st.median(holds), 2) if holds else None,
        hold_mean_h=round(st.mean(holds), 1) if holds else None,
        under5min=sum(1 for h in holds if h < 5 / 60),
        size_med=round(st.median(sizes)) if sizes else None, size_max=round(max(sizes)) if sizes else None,
        pct_entries_u100k=round(sum(e < 100000 for e in em) / len(em) * 100) if em else None,
        entry_mcap_med=round(st.median(em)) if em else None,
        odd=dict(odd))


if __name__ == '__main__':
    a = sys.argv[1:]; days, cap = 30, 5000
    while a and a[0].startswith('--'):
        k, v = a[0], a[1]; a = a[2:]
        if k == '--days': days = int(v)
        if k == '--cap': cap = int(v)
    for w in a:
        t0 = time.time()
        s = summarize(w, days, cap)
        s['secs'] = round(time.time() - t0, 1)
        print(json.dumps(s), flush=True)
    rpc.save_usage()
    print(json.dumps(rpc.usage_report()), file=sys.stderr)
