import json,bisect
from collections import defaultdict
BUB='7AvWVST8o3EuJHAuFYhcMtqfyFb2XPXtwXvTNLGiqop';AQ='AQVcP67EpMyu4cBZZjqMu91cVsWy1aX98JmcZm1FyY9';POOL='AVcf2erAm9Xw3uhcT529Lme9aVfXT51gewcPqYWr8k74'
SUP=975534614.36
px=json.load(open('aqua_usd_min.json')); ts=sorted(int(k) for k in px); 
def aq(t):
    i=bisect.bisect_right(ts,t)-1; return px[str(ts[max(i,0)])]
sigs=[s for s in json.load(open('pool_sigs.json')) if not s['err']][::-1]
trades=[];other=[]
for s in sigs:
    t=json.load(open('txcache/%s.json'%s['signature']))
    d=defaultdict(float)
    for b in t['meta']['preTokenBalances']: d[(b['owner'],b['mint'])]-=float(b['uiTokenAmount']['uiAmount'] or 0)
    for b in t['meta']['postTokenBalances']: d[(b['owner'],b['mint'])]+=float(b['uiTokenAmount']['uiAmount'] or 0)
    pb=d.get((POOL,BUB),0); pa=d.get((POOL,AQ),0)
    keys=t['transaction']['message']['accountKeys']; payer=keys[0]['pubkey']
    signers=[k['pubkey'] for k in keys if k.get('signer')]
    if pb*pa<0:
        side='buy' if pb<0 else 'sell'
        cands=[(v,o) for (o,m),v in d.items() if m==BUB and o!=POOL]
        if side=='buy': v,o=max(cands) if cands else (0,payer)
        else: v,o=min(cands) if cands else (0,payer)
        if (side=='buy' and v<=0) or (side=='sell' and v>=0): o=payer
        p=aq(t['blockTime']); usd=abs(pa)*p
        trades.append(dict(sig=s['signature'],slot=s['slot'],idx=s.get('transactionIndex'),t=t['blockTime'],side=side,wallet=o,payer=payer,signers=signers,bub=abs(pb),aqua=abs(pa),usd=usd,mcap=abs(pa)/abs(pb)*p*SUP,wallet_bub_delta=v))
    elif pb or pa:
        other.append(dict(sig=s['signature'],t=t['blockTime'],payer=payer,pb=pb,pa=pa,logs=[l for l in t['meta']['logMessages'] if 'Instruction:' in l][:4]))
json.dump(trades,open('trades.json','w'));json.dump(other,open('other.json','w'))
print(len(trades),'trades',len(other),'other')
for o in other: print(o['t'],o['payer'][:8],round(o['pb']),round(o['pa']),o['logs'][:2])
