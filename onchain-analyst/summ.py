import json,sys,statistics as st,time
from vet import *
BUB='7AvWVST8o3EuJHAuFYhcMtqfyFb2XPXtwXvTNLGiqop'
def summarize(w,supcache):
    sigs,ev,missing,odd,P=report(w)
    need=[m for m in P if m not in supcache]
    if need: supcache.update(supplies(need))
    closed=[];openp=[]
    for m,p in P.items():
        if p['b']<=0:  # sold without buy in window
            continue
        if p['qs']>=0.9*p['qb'] or (p['s']>0 and p['qs']>=0.5*p['qb'] and False): closed.append((m,p))
        elif p['s']>0: closed.append((m,p))  # partial: realized on sold portion approx
        else: openp.append((m,p))
    res=[]
    for m,p in closed:
        cost=p['b']*min(p['qs']/p['qb'],1) if p['qb'] else p['b']
        pnl=p['s']-cost; res.append(dict(m=m,cost=cost,pnl=pnl,pct=pnl/cost*100 if cost else 0,hold=(p['fs']-p['fb'])/3600 if p['fs'] and p['fb'] else None,full=p['qs']>=0.9*p['qb'],entry_mcap=(p['fp']*supcache[m]) if supcache.get(m) else None,size=p['b']/max(p['nb'],1)))
    wins=[r for r in res if r['pnl']>0]
    b=dict(gt500=sum(r['pct']>500 for r in res),r200_500=sum(200<r['pct']<=500 for r in res),r0_200=sum(0<r['pct']<=200 for r in res),loss=sum(r['pct']<=0 for r in res))
    tot_cost=sum(r['cost'] for r in res); tot=sum(r['pnl'] for r in res)
    top2=sorted([r['pnl'] for r in res],reverse=True)[:2]
    em=[P[m]['fp']*supcache[m] for m in P if P[m]['fp'] and supcache.get(m)]
    holds=[r['hold'] for r in res if r['hold'] is not None]
    sizes=[P[m]['b']/P[m]['nb'] for m in P if P[m]['nb']]
    fast=sum(1 for r in res if r['hold'] is not None and r['hold']<5/60)
    oldest=json.load(open(f'wsigs/{w}.json'))
    return dict(w=w,sigs30=len(sigs),missing=missing,tokens_traded=len(P),closed=len(res),open=len(openp),
      winrate=round(len(wins)/len(res)*100) if res else None,pnl=round(tot),pnl_pct=round(tot/tot_cost*100) if tot_cost else None,
      spread=b,top2_share=round(sum(top2)/tot*100) if tot>0 else None,
      hold_med_h=round(st.median(holds),2) if holds else None,hold_mean_h=round(st.mean(holds),1) if holds else None,under5min=fast,
      size_med=round(st.median(sizes)) if sizes else None,size_max=round(max(sizes)) if sizes else None,
      pct_entries_u100k=round(sum(e<100000 for e in em)/len(em)*100) if em else None,entry_mcap_med=round(st.median(em)) if em else None,
      odd=dict(odd),res=res)
if __name__=='__main__':
    sc={}
    for w in sys.argv[1:]:
        s=summarize(w,sc); r=s.pop('res'); print(json.dumps(s))
