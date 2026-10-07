"""Stage 1a: rebuild every swap in a pool from RPC.
usage: python pool.py <token_mint> <pool_address> [<pool_address> ...] [--from <unix ts>] [--until <unix ts>]
(pass the pump.fun bonding curve and the post-migration pool together)
--from/--until: rebuild only that window, oldest first (Helius). Use it on busy tokens: fetch
the launch-to-first-pump window instead of paging back through every later swap.
writes trades.json / other.json / meta.json in the current (run) directory.
"""
import json, sys, time, urllib.request
from collections import defaultdict
import rpc, history, vet


def dexscreener(mint):
    u = f"https://api.dexscreener.com/latest/dex/tokens/{mint}"
    return rpc.get_json(u, label='dexscreener')['pairs'] or []


def biggest_gt_pool(mint):
    u = f"https://api.geckoterminal.com/api/v2/networks/solana/tokens/{mint}/pools"
    d = rpc.get_json(u, label='geckoterminal')['data']
    return d[0]['id'].split('_', 1)[1] if d else None


def quote_price_fn(quote):
    if quote == vet.SOL:
        return vet.solp
    if quote in vet.STABLE:
        return lambda t: 1.0
    gp = biggest_gt_pool(quote)
    vet.add_quote(quote, gp, quote, pages=15)
    return lambda t: vet._extra[quote].at(t) or 0


def main(mint, pools, w0=None, w1=None):
    allpairs = {x['pairAddress']: x for x in dexscreener(mint)}
    supply = rpc.rpc('getTokenSupply', [mint])['value']['uiAmount']
    t0 = time.time()
    trades, other, recs_all, info = [], [], [], []
    for pool in pools:
        pr = allpairs.get(pool)
        if not pr:  # not listed: treat as the pump.fun bonding curve (native SOL quote)
            print(f'{pool[:8]} not on DexScreener: treating it as a pump.fun bonding curve', file=sys.stderr)
            pr = dict(dexId='pumpfun-curve', quoteToken=dict(address=vet.SOL), baseToken=dict(address=mint))
        quote = pr['quoteToken']['address'] if pr['baseToken']['address'] == mint else pr['baseToken']['address']
        qp = quote_price_fn(quote)
        recs = history.window_txs(pool, w0 or 0, w1 or int(time.time()) + 60) if (w0 or w1) else history.address_txs(pool)
        recs_all += recs
        info.append(dict(pool=pool, dex=pr['dexId'], quote=quote, txs=len(recs), liquidity_usd=pr.get('liquidity', {}).get('usd'),
                         created_t=recs[0]['t'] if recs else None, created_slot=recs[0]['slot'] if recs else None))
        print(f'{pool[:8]} {pr["dexId"]}: {len(recs)} txs', file=sys.stderr)
        for r in recs:
            d = r['deltas']; payer = r['payer']
            pb = d.get((pool, mint), 0)
            pq = d.get((pool, quote), 0) + (d.get((pool, 'native'), 0) if quote == vet.SOL else 0)
            if pb * pq < 0:
                side = 'buy' if pb < 0 else 'sell'
                cands = [(v, o) for (o, m), v in d.items() if m == mint and o != pool]
                v, o = (max(cands) if side == 'buy' else min(cands)) if cands else (0, payer)
                if (side == 'buy' and v <= 0) or (side == 'sell' and v >= 0):
                    o = payer
                usd = abs(pq) * qp(r['t'])
                trades.append(dict(sig=r['sig'], slot=r['slot'], t=r['t'], side=side, wallet=o, payer=payer, pool=pool,
                                   tok=abs(pb), quote=abs(pq), usd=usd, mcap=usd / abs(pb) * supply))
            elif pb:
                other.append(dict(sig=r['sig'], t=r['t'], payer=payer, pool=pool, d_tok=pb, d_quote=pq, note=r['note']))
    trades.sort(key=lambda x: (x['slot'], x['t']))
    first = min((i for i in info if i['created_slot']), key=lambda i: i['created_slot'], default={})
    json.dump(trades, open('trades.json', 'w')); json.dump(other, open('other.json', 'w'))
    meta = dict(mint=mint, supply=supply, pools=info, pool_created_slot=first.get('created_slot'),
                pool_created_t=first.get('created_t'),
                vol24=sum((allpairs.get(p, {}).get('volume') or {}).get('h24') or 0 for p in pools))
    json.dump(meta, open('meta.json', 'w'))
    rpc.save_usage()
    print(json.dumps(dict(trades=len(trades), other=len(other), secs=round(time.time() - t0),
                          rebuilt_vol24=round(sum(x['usd'] for x in trades if x['t'] > trades[-1]['t'] - 86400)) if trades else 0,
                          dexscreener_vol24=meta['vol24'])))
    for o in other[:15]:
        print(o['t'], o['payer'][:8], round(o['d_tok']), round(o['d_quote']), o['note'])


if __name__ == '__main__':
    a = sys.argv[1:]
    opt = {}
    for k in ('--from', '--until'):
        if k in a:
            i = a.index(k); opt[k] = int(a[i + 1]); a = a[:i] + a[i + 2:]
    main(a[0], a[1:], opt.get('--from'), opt.get('--until'))
