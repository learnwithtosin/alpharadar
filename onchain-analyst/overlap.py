"""Main-runner + alt-runner overlap: wallets that got in EARLY on both.
Run it in the ALT token's run directory, after pool.py + agg.py (needs trades.json, wallets.json).
usage: python overlap.py <main_mint> <main_max_mcap> <alt_max_mcap> [--main-pool <pool for main price history>]
e.g.   python overlap.py AQVc...FyY9 180000 15000
Cost: ~1 credit per alt wallet (token-account check) + ~2-5 per match (first-buy lookup).
Writes both_early.json; vet the survivors with summ.py.
"""
import json, sys, time
import rpc, history, vet, pool as poolmod


def main(main_mint, main_max, alt_max, main_pool=None):
    W = json.load(open('wallets.json'))
    main_pool = main_pool or poolmod.biggest_gt_pool(main_mint)
    sup = rpc.rpc('getTokenSupply', [main_mint])['value']['uiAmount']
    price = vet.Series(vet._gt_ohlcv(main_pool, 'hour', main_mint, 2, f'{main_mint}_usd_hour.json'))
    cands = [r for r in W.values() if r.get('first') and r['b'] >= 50 and r['fm'] < alt_max
             and not {'same_minute_cluster', 'first_blocks_buyer', 'sold_more_than_bought'} & set(r['flags'])
             and not any(f.startswith('same_slot') for f in r['flags'])]
    print(f'{len(cands)} alt buyers under ${alt_max:,.0f} (≥$50, unflagged)', file=sys.stderr)
    out = []
    for r in cands:
        w = r['wallet']
        try:
            accts = rpc.rpc('getTokenAccountsByOwner', [w, {'mint': main_mint}, {'encoding': 'jsonParsed'}])['value']
        except Exception:
            continue
        if not accts:
            continue
        held = sum(float(a['account']['data']['parsed']['info']['tokenAmount']['uiAmount'] or 0) for a in accts)
        ata = accts[0]['pubkey']
        oldest = [x for x in history.signatures(ata) if not x['err']][-4:][::-1]
        history.get_transactions([x['signature'] for x in oldest])
        for x in oldest:
            t = history.load_tx(x['signature'])
            q = history._deltas_raw(t).get((w, main_mint), 0) if t else 0
            if q > 0:
                px = price.at(t['blockTime'])
                if px and px * sup < main_max:
                    out.append(dict(wallet=w, main_t=t['blockTime'], main_mcap=px * sup, main_usd=q * px,
                                    alt_t=r['first'], alt_mcap=r['fm'], alt_usd=r['b'],
                                    main_held_usd=held * (price.at(int(time.time())) or 0)))
                break
    out.sort(key=lambda o: o['main_t'])
    json.dump(out, open('both_early.json', 'w'), indent=1)
    f = lambda x: time.strftime('%m-%d %H:%M', time.gmtime(x))
    print(f'{len(out)} wallets early on BOTH (main < ${main_max:,.0f}, alt < ${alt_max:,.0f}):')
    for o in out:
        print(f"{o['wallet']}  main {f(o['main_t'])} @ ${o['main_mcap']/1e3:.0f}K (${o['main_usd']:.0f})  "
              f"alt {f(o['alt_t'])} @ ${o['alt_mcap']/1e3:.1f}K (${o['alt_usd']:.0f})  main still held ${o['main_held_usd']:.0f}")
    rpc.save_usage()


if __name__ == '__main__':
    a = sys.argv[1:]
    mp = None
    if '--main-pool' in a:
        i = a.index('--main-pool'); mp = a[i + 1]; a = a[:i] + a[i + 2:]
    main(a[0], float(a[1]), float(a[2]), mp)
