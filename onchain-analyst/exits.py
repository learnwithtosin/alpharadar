"""Full result on ONE token for early buyers, read from each wallet's own token account
(about 2 + n credits per wallet: one signature list + one getTransaction per token-account tx).
Use it when the pool is too busy to rebuild past the launch window: the curve/early-pool
rebuild gives you WHO got in early, this gives you how each of them actually exited.

usage: python exits.py <mint> [--min-buy 50] [--max 250]     (run dir must have wallets.json + meta.json)
writes exits.json; prints wallets ranked by realized + unrealized PnL.
"""
import hashlib, json, sys, time
import rpc, history, vet

B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'
P = 2 ** 255 - 19
D = -121665 * pow(121666, P - 2, P) % P


def b58d(s):
    n = 0
    for c in s:
        n = n * 58 + B58.index(c)
    b = n.to_bytes((n.bit_length() + 7) // 8, 'big')
    return b'\0' * (len(s) - len(s.lstrip('1'))) + b


def b58e(b):
    n = int.from_bytes(b, 'big'); s = ''
    while n:
        n, r = divmod(n, 58); s = B58[r] + s
    return '1' * (len(b) - len(b.lstrip(b'\0'))) + s


def on_curve(b):
    """True if 32 bytes decode to an ed25519 point (PDAs must be off the curve)."""
    y = int.from_bytes(b, 'little') & ((1 << 255) - 1)
    if y >= P:
        return False
    u, v = (y * y - 1) % P, (D * y * y + 1) % P
    x2 = u * pow(v, P - 2, P) % P
    if x2 == 0:
        return True
    return pow(x2, (P - 1) // 2, P) == 1


def ata(owner, mint, token_program):
    seeds = [b58d(owner), b58d(token_program), b58d(mint)]
    for bump in range(255, -1, -1):
        h = hashlib.sha256(b''.join(seeds) + bytes([bump]) + b58d(ATA_PROGRAM) + b'ProgramDerivedAddress').digest()
        if not on_curve(h):
            return b58e(h)


def result(w, mint, acct, sup, now_price):
    sigs = [x for x in rpc.rpc('getSignaturesForAddress', [acct, {'limit': 1000}]) if not x['err']]
    history.get_transactions([x['signature'] for x in sigs])
    b = s = qb = qs = 0.0; first = last_sell = None; n_tx = 0; xfer_in = xfer_out = 0.0; first_mc = None
    for x in reversed(sigs):
        t = history.load_tx(x['signature'])
        if not t:
            continue
        d = history._deltas_raw(t)
        q = d.get((w, mint), 0)
        if not q:
            continue
        n_tx += 1
        sol = d.get((w, 'native'), 0) + d.get((w, vet.SOL), 0)
        if t['transaction']['message']['accountKeys'][0]['pubkey'] == w:
            sol += t['meta']['fee'] / 1e9
        usd = abs(sol) * (vet.solp(t['blockTime']) or 0)
        if q > 0 and sol < -1e-4:
            b += usd; qb += q; first = first or t['blockTime']
            first_mc = first_mc or usd / q * sup
        elif q < 0 and sol > 1e-4:
            s += usd; qs += -q; last_sell = t['blockTime']
        elif q > 0:
            xfer_in += q
        else:
            xfer_out += -q
    held = max(qb + xfer_in - qs - xfer_out, 0)
    return dict(wallet=w, buys_usd=round(b), sells_usd=round(s), unreal_usd=round(held * now_price),
                pnl=round(s + held * now_price - b), pct=round((s + held * now_price - b) / b * 100) if b else None,
                first=first, first_mcap=round(first_mc) if first_mc else None, last_sell=last_sell,
                sold_share=round(qs / qb, 2) if qb else None, tok_tx=n_tx,
                transfers_in=round(xfer_in), transfers_out=round(xfer_out), sigs=len(sigs))


def main(mint, min_buy=50, cap=250):
    W = json.load(open('wallets.json'))
    sup = json.load(open('meta.json'))['supply']
    owner_prog = rpc.rpc('getAccountInfo', [mint, {'encoding': 'base64'}])['value']['owner']
    pairs = rpc.get_json(f'https://api.dexscreener.com/latest/dex/tokens/{mint}')['pairs']
    now_price = float(max(pairs, key=lambda p: (p.get('liquidity') or {}).get('usd') or 0)['priceUsd'])
    cands = sorted([r for r in W.values() if r['b'] >= min_buy and not r['flags']], key=lambda r: r['first'])[:cap]
    print(f'{len(cands)} clean early buyers (≥${min_buy}); price now ${now_price:.6f}', file=sys.stderr)
    out = []
    for i, r in enumerate(cands):
        try:
            out.append(result(r['wallet'], mint, ata(r['wallet'], mint, owner_prog), sup, now_price))
        except Exception as e:
            print('skip', r['wallet'][:8], rpc._redact(e), file=sys.stderr)
        if i % 25 == 24:
            print(f'  {i + 1} done', file=sys.stderr, flush=True); rpc.save_usage()
    json.dump(out, open('exits.json', 'w'), indent=1)
    rpc.save_usage()
    f = lambda x: time.strftime('%m-%d %H:%M', time.gmtime(x)) if x else '-'
    print('wallet                                         bought    sold  unreal     pnl    pct  1st mcap  sold%  last sell    xfer in/out')
    for o in sorted(out, key=lambda o: -o['pnl'])[:25]:
        print(f"{o['wallet']:44} {o['buys_usd']:7} {o['sells_usd']:7} {o['unreal_usd']:7} {o['pnl']:7} {o['pct'] or 0:6} "
              f"{o['first_mcap'] or 0:9} {int((o['sold_share'] or 0) * 100):5}  {f(o['last_sell'])}  {o['transfers_in']}/{o['transfers_out']}")


if __name__ == '__main__':
    a = sys.argv[1:]
    kw = {}
    for k, cast in (('--min-buy', float), ('--max', int)):
        if k in a:
            i = a.index(k); kw[k] = cast(a[i + 1]); a = a[:i] + a[i + 2:]
    main(a[0], kw.get('--min-buy', 50), kw.get('--max', 250))
