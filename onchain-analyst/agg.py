import json,datetime as dt
from collections import defaultdict
T=json.load(open('trades.json'));T0=1790129118
POOLSTART_SLOT=449562267
lastm=T[-1]['mcap']
W=defaultdict(lambda:dict(b=0,s=0,bt=0,st=0,nb=0,ns=0,first=None,fm=None,fslot=None,last=None,payers=set()))
for t in T:
    w=W[t['wallet']]; w['payers'].add(t['payer'])
    if t['side']=='buy':
        w['b']+=t['usd'];w['bt']+=t['bub'];w['nb']+=1
        if w['first'] is None: w['first']=t['t'];w['fm']=t['mcap'];w['fslot']=t['slot']
    else: w['s']+=t['usd'];w['st']+=t['bub'];w['ns']+=1
    w['last']=t['t']
rows=[]
for a,w in W.items():
    if w['b']<=0: 
        rows.append((a,w,None));continue
    held=max(w['bt']*0.98-w['st'],0)  # 2% transfer fee approx
    unreal=held/975534614*lastm
    rows.append((a,w,dict(real=w['s']-w['b'],pct=(w['s']-w['b'])/w['b']*100,unreal=unreal,tot_pct=(w['s']+unreal-w['b'])/w['b']*100,oversold=w['st']>w['bt']*1.001)))
json.dump({a:dict({k:(list(v) if isinstance(v,set) else v) for k,v in w.items()},**(r or {})) for a,w,r in rows},open('wallets.json','w'))
print('wallets',len(rows),'sell-only (no pool buy)',sum(1 for r in rows if r[2] is None))
f=lambda x:dt.datetime.utcfromtimestamp(x).strftime('%m-%d %H:%M')
R=[r for r in rows if r[2] and r[1]['b']>=20]
R.sort(key=lambda r:-r[2]['tot_pct'])
print('addr  bought sold realPnL real% unreal tot% nb ns first fm slot_after_pool oversold')
for a,w,r in R[:45]:
    print(a,round(w['b']),round(w['s']),round(r['real']),round(r['pct']),round(r['unreal']),round(r['tot_pct']),w['nb'],w['ns'],f(w['first']),round(w['fm']),w['fslot']-POOLSTART_SLOT,'OVERSOLD' if r['oversold'] else '')
print('SELL-ONLY wallets:')
for a,w,r in rows:
    if r is None and w['s']>50: print(a,round(w['s']),w['ns'],round(w['st']))
