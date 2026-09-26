import json,sys,time,urllib.request,itertools,os
RPCS=itertools.cycle(["https://api.mainnet-beta.solana.com"])
def rpc(m,p):
    for i in range(12):
        u=next(RPCS)
        try:
            j=json.load(urllib.request.urlopen(urllib.request.Request(u,json.dumps({"jsonrpc":"2.0","id":1,"method":m,"params":p}).encode(),{"content-type":"application/json","user-agent":"curl/8"}),timeout=60))
            if 'error' in j: raise Exception(j['error'])
            return j['result']
        except Exception as e: time.sleep(0.5+i*0.5)
    raise Exception('fail')
CUT=1790370000-30*86400
os.makedirs('wsigs',exist_ok=True)
for a in sys.argv[1:]:
    fn=f'wsigs/{a}.json'
    if os.path.exists(fn): continue
    out=[];before=None;full=True
    while True:
        p={"limit":1000}
        if before:p["before"]=before
        r=rpc("getSignaturesForAddress",[a,p])
        out+=r
        if len(r)<1000: break
        before=r[-1]['signature']
        if len(out)>=15000 or (r[-1]["blockTime"] or 0)<CUT-86400*60: full=False;break
    json.dump(dict(sigs=out,complete=full),open(fn,'w'))
    s30=[x for x in out if (x['blockTime'] or 0)>=CUT]
    print(a[:10],'total',len(out),'complete' if full else 'TRUNC','30d',len(s30),'oldest',time.strftime('%Y-%m-%d',time.gmtime(out[-1]['blockTime'])),flush=True)
