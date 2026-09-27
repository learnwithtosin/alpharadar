"""Stage 1b + 2: rank wallets by %PnL from trades.json and flag cheap exclusions.
usage: python agg.py [--min-buy 50] [--pump-ts <unix ts when the pump started>] [--last-mcap <current mcap>]
writes wallets.json and candidates.json.
"""
import json, sys, datetime as dt
from collections import defaultdict

args = dict(zip(sys.argv[1::2], sys.argv[2::2]))
MIN_BUY = float(args.get('--min-buy', 50))
T = json.load(open('trades.json')); meta = json.load(open('meta.json'))
PUMP = int(args.get('--pump-ts', 0)) or None
last_mcap = float(args.get('--last-mcap', 0)) or T[-1]['mcap']; sup = meta['supply']; slot0 = meta['pool_created_slot']
f = lambda x: dt.datetime.utcfromtimestamp(x).strftime('%m-%d %H:%M')

W = defaultdict(lambda: dict(b=0, s=0, qb=0, qs=0, nb=0, ns=0, first=None, fm=None, fslot=None, first_usd=0))
for t in T:
    w = W[t['wallet']]
    if t['side'] == 'buy':
        w['b'] += t['usd']; w['qb'] += t['tok']; w['nb'] += 1
        if w['first'] is None:
            w['first'], w['fm'], w['fslot'], w['first_usd'] = t['t'], t['mcap'], t['slot'], t['usd']
    else:
        w['s'] += t['usd']; w['qs'] += t['tok']; w['ns'] += 1

rows = {}
for a, w in W.items():
    r = dict(w, wallet=a, flags=[])
    if w['b'] <= 0:
        if w['s'] > 0: r['flags'].append('sold_never_bought')
    else:
        held = max(w['qb'] - w['qs'], 0)
        r['unreal'] = held / sup * last_mcap
        r['real_pct'] = (w['s'] - w['b']) / w['b'] * 100
        r['tot_pct'] = (w['s'] + r['unreal'] - w['b']) / w['b'] * 100
        if w['qs'] > w['qb'] * 1.02: r['flags'].append('sold_more_than_bought')
        if slot0 and w['fslot'] - slot0 <= 20: r['flags'].append('first_blocks_buyer')
    rows[a] = r

# same-minute clusters: ≥2 wallets whose FIRST buy is in the same minute, sizes within 2x, with
# no other wallet's buy in that minute window (i.e. quiet market)
by_min = defaultdict(list)
for r in rows.values():
    if r['first']: by_min[r['first'] // 60].append(r)
buys_per_min = defaultdict(int)
for t in T:
    if t['side'] == 'buy': buys_per_min[t['t'] // 60] += 1
for m, g in by_min.items():
    grp = [r for mm in (m - 1, m, m + 1) for r in by_min.get(mm, [])]
    if len(grp) >= 2:
        sizes = sorted(r['first_usd'] for r in grp)
        quiet = sum(buys_per_min.get(mm, 0) for mm in range(m - 10, m + 11)) <= len(grp) + 3
        if sizes[-1] <= 2 * max(sizes[0], 1) and quiet:
            for r in grp:
                if 'same_minute_cluster' not in r['flags']: r['flags'].append('same_minute_cluster')

# same-slot groups: wallets whose first buy lands in the same slot at similar size (bundle signal)
by_slot = defaultdict(list)
for r in rows.values():
    if r['first']: by_slot[r['fslot']].append(r)
for s, g in by_slot.items():
    if len(g) >= 2:
        sizes = sorted(r['first_usd'] for r in g)
        if sizes[-1] <= 1.5 * max(sizes[0], 1):
            for r in g: r['flags'].append(f'same_slot_x{len(g)}')

json.dump(rows, open('wallets.json', 'w'))
elig = [r for r in rows.values() if r['b'] >= MIN_BUY]
top = sorted(elig, key=lambda r: -r['tot_pct'])[:10]
pre = []
if PUMP:
    pre = sorted([r for r in elig if r['first'] < PUMP and r['tot_pct'] > 0 and r not in top and not r['flags']],
                 key=lambda r: -r['tot_pct'])[:3]
cands = top + pre
json.dump([r['wallet'] for r in cands], open('candidates.json', 'w'))
print(f"wallets {len(rows)}; eligible (≥${MIN_BUY:.0f} bought) {len(elig)}")
print('wallet                                        bought   sold  real%  tot%  nb ns first       mcap@1st  slot+  flags')
for r in cands:
    print(f"{r['wallet']:44} {r['b']:7.0f} {r['s']:6.0f} {r['real_pct']:6.0f} {r['tot_pct']:5.0f} {r['nb']:3} {r['ns']:2} "
          f"{f(r['first'])} {r['fm']:9.0f} {r['fslot'] - slot0:6} {','.join(r['flags']) or '-'}{'  [pre-pump]' if r in pre else ''}")
print('sold without buying (infrastructure?):')
for r in sorted(rows.values(), key=lambda r: -r['s']):
    if 'sold_never_bought' in r['flags'] and r['s'] > 50:
        print(f"  {r['wallet']} sold ${r['s']:.0f} in {r['ns']} sells ({r['qs'] / sup * 100:.1f}% of supply)")
