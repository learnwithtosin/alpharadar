"""Stage 1a: rebuild every swap in a pool from RPC.
usage: python pool.py <pool_address> <token_mint>
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
    vet.add_quote(quote, gp, quote, pages=6)
    return lambda t: vet._extra[quote].at(t) or 0


def main(pool, mint):
    pairs = [p for p in dexscreener(mint) if p['pairAddress'] == pool]
    if not pairs:
        sys.exit('pool not found on DexScreener for this mint')
    pr = pairs[0]
    quote = pr['quoteToken']['address'] if pr['baseToken']['address'] == mint else pr['baseToken']['address']
    supply = rpc.rpc('getTokenSupply', [mint])['value']['uiAmount']
    qp = quote_price_fn(quote)
    t0 = time.time()
    recs = history.address_txs(pool)
    print(f'{len(recs)} pool txs', file=sys.stderr)
    trades, other = [], []
    for r in recs:
        d = r['deltas']; payer = r['payer']
        pb, pq = d.get((pool, mint), 0), d.get((pool, quote), 0)
        if pb * pq < 0:
            side = 'buy' if pb < 0 else 'sell'
            cands = [(v, o) for (o, m), v in d.items() if m == mint and o != pool]
            v, o = (max(cands) if side == 'buy' else min(cands)) if cands else (0, payer)
            if (side == 'buy' and v <= 0) or (side == 'sell' and v >= 0):
                o = payer
            usd = abs(pq) * qp(r['t'])
            trades.append(dict(sig=r['sig'], slot=r['slot'], t=r['t'], side=side, wallet=o, payer=payer,
                               tok=abs(pb), quote=abs(pq), usd=usd, mcap=usd / abs(pb) * supply))
        elif pb or pq:
            other.append(dict(sig=r['sig'], t=r['t'], payer=payer, d_tok=pb, d_quote=pq, note=r['note']))
    json.dump(trades, open('trades.json', 'w')); json.dump(other, open('other.json', 'w'))
    meta = dict(pool=pool, mint=mint, quote=quote, supply=supply, pool_created_slot=recs[0]['slot'] if recs else None,
                pool_created_t=recs[0]['t'] if recs else None, dex=pr['dexId'],
                liquidity_usd=pr.get('liquidity', {}).get('usd'), mcap=pr.get('marketCap'),
                vol24=pr.get('volume', {}).get('h24'))
    json.dump(meta, open('meta.json', 'w'))
    rpc.save_usage()
    print(json.dumps(dict(trades=len(trades), other=len(other), secs=round(time.time() - t0),
                          rebuilt_vol24=round(sum(x['usd'] for x in trades if x['t'] > trades[-1]['t'] - 86400)) if trades else 0,
                          dexscreener_vol24=meta['vol24'])))
    for o in other[:15]:
        print(o['t'], o['payer'][:8], round(o['d_tok']), round(o['d_quote']), o['note'])


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
