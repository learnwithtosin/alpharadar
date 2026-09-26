"""Stage 2/3: first SOL funder, tx rate (bot check) and shared-tx links for wallets.
usage: python funders.py <wallet> [<wallet> ...]
"""
import json, sys, time, itertools
import rpc, history

NOISE = {'AgmLJBMD', 'HckQ93Xq'}  # known relayer / pump.fun reward distributor prefixes


def first_funder(w, sigs):
    oldest = [x['signature'] for x in sigs[::-1][:4] if not x['err']]
    history.get_transactions(oldest)
    for s in oldest:
        t = history.load_tx(s)
        if not t:
            continue
        keys = [k['pubkey'] for k in t['transaction']['message']['accountKeys']]
        if w not in keys:
            continue
        pre, post = t['meta']['preBalances'], t['meta']['postBalances']
        i = keys.index(w)
        if post[i] > pre[i]:
            src = [(keys[j], round((post[j] - pre[j]) / 1e9, 3)) for j in range(len(keys)) if post[j] < pre[j]]
            return dict(t=t['blockTime'], sol=round((post[i] - pre[i]) / 1e9, 3), from_=src[:2])
    return None


def main(ws):
    S = {}
    for w in ws:
        sigs = history.signatures(w, since=0, max_n=20000)
        S[w] = sigs
        span = max((sigs[0]['blockTime'] - sigs[-1]['blockTime']) / 86400, 1 / 24) if sigs else 0
        complete = len(sigs) < 20000
        fund = first_funder(w, sigs) if complete else None
        print(json.dumps(dict(w=w, sigs=len(sigs), complete=complete,
                              oldest=time.strftime('%Y-%m-%d', time.gmtime(sigs[-1]['blockTime'])) if sigs else None,
                              tx_per_day=round(len(sigs) / span) if span else None, first_funder=fund)))
    sets = {w: set(x['signature'] for x in s) for w, s in S.items()}
    for a, b in itertools.combinations(ws, 2):
        n = len(sets[a] & sets[b])
        if n:
            print(f'shared txs {a[:8]} {b[:8]}: {n} (inspect before calling it a link: spam airdrops/relayers are noise)')
    rpc.save_usage()


if __name__ == '__main__':
    main(sys.argv[1:])
