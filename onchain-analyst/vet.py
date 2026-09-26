import json,os,sys,bisect,statistics as st
from collections import defaultdict
CUT=1790370000-30*86400
SOL='So11111111111111111111111111111111111111112'
STABLE={'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v','Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'}
AQ='AQVcP67EpMyu4cBZZjqMu91cVsWy1aX98JmcZm1FyY9'
sp=json.load(open('sol_usd_hour.json'));sk=sorted(int(k) for k in sp)
ap=json.load(open('aqua_usd_min.json'));ak=sorted(int(k) for k in ap)
def solp(t): return sp[str(sk[max(bisect.bisect_right(sk,t)-1,0)])]
def aqp(t): return ap[str(ak[max(bisect.bisect_right(ak,t)-1,0)])] if t>=ak[0] else None
def analyse(w,cap=5000):
    sigs=[x for x in json.load(open(f'wsigs/{w}.json'))['sigs'] if (x['blockTime'] or 0)>=CUT and not x['err']][:cap]
    ev=[];missing=0;odd=defaultdict(int)
    for x in sigs:
        p='txcache/%s.json'%x['signature']
        if not os.path.exists(p): missing+=1;continue
        t=json.load(open(p)); m=t['meta']; keys=[k['pubkey'] for k in t['transaction']['message']['accountKeys']]
        d=defaultdict(float);dec={}
        for b in m['preTokenBalances']:
            if b.get('owner')==w: d[b['mint']]-=float(b['uiTokenAmount']['uiAmount'] or 0)
        for b in m['postTokenBalances']:
            if b.get('owner')==w: d[b['mint']]+=float(b['uiTokenAmount']['uiAmount'] or 0)
        sol=0
        if w in keys:
            i=keys.index(w); sol=(m['postBalances'][i]-m['preBalances'][i])/1e9
            if keys[0]==w: sol+=m['fee']/1e9  # exclude fee from trade value
        sol+=d.pop(SOL,0)
        stab=sum(d.pop(s,0) for s in list(d) if s in STABLE)
        aq=d.pop(AQ,0) if len([k for k,v in d.items() if abs(v)>0 and k!=AQ])>=1 else 0
        toks={k:v for k,v in d.items() if abs(v)>1e-9}
        T=t['blockTime']
        quote_usd=sol*solp(T)+stab+(aq*(aqp(T) or 0))
        if len(toks)==1:
            mint,q=list(toks.items())[0]
            if q>0 and quote_usd< -0.5: ev.append((T,mint,'buy',q,-quote_usd))
            elif q<0 and quote_usd>0.5: ev.append((T,mint,'sell',-q,quote_usd))
            elif q>0 and abs(quote_usd)<=0.5: odd['token_in_no_payment']+=1
            elif q<0 and abs(quote_usd)<=0.5: odd['token_out_no_payment']+=1
            else: odd['ambiguous']+=1
        elif len(toks)==0:
            if sol>0.001 and keys[0]!=w: odd['sol_in']+=1
            if 0<sol<0.001 and keys[0]!=w: odd['dust_sol_in']+=1
            if sol< -0.001: odd['sol_out']+=1
        else: odd['multi_token_tx']+=1
    return sigs,ev,missing,odd
def supplies(mints):
    import urllib.request,time
    out={}
    ms=list(mints)
    for i in range(0,len(ms),100):
        b=json.dumps({"jsonrpc":"2.0","id":1,"method":"getMultipleAccounts","params":[ms[i:i+100],{"encoding":"jsonParsed"}]}).encode()
        for k in range(6):
            try:
                r=json.load(urllib.request.urlopen(urllib.request.Request("https://api.mainnet-beta.solana.com",b,{"content-type":"application/json"})))['result']['value'];break
            except Exception: time.sleep(3+k*3)
        for m,a in zip(ms[i:i+100],r):
            try: out[m]=float(a['data']['parsed']['info']['supply'])/10**a['data']['parsed']['info']['decimals']
            except Exception: out[m]=None
    return out
def report(w,cap=5000,SUP=None):
    sigs,ev,missing,odd=analyse(w,cap)
    P=defaultdict(lambda:dict(b=0,s=0,qb=0,qs=0,fb=None,ls=None,fs=None,nb=0,ns=0,fp=None))
    for T,mint,side,q,usd in sorted(ev):
        p=P[mint]
        if side=='buy':
            p['b']+=usd;p['qb']+=q;p['nb']+=1
            if p['fb'] is None:p['fb']=T;p['fp']=usd/q
        else:
            p['s']+=usd;p['qs']+=q;p['ns']+=1;p['ls']=T
            if p['fs'] is None:p['fs']=T
    return sigs,ev,missing,odd,P
