import json,sys,time,urllib.request
RPC="https://api.mainnet-beta.solana.com"
def rpc(m,p):
    for i in range(8):
        try:
            r=urllib.request.urlopen(urllib.request.Request(RPC,json.dumps({"jsonrpc":"2.0","id":1,"method":m,"params":p}).encode(),{"content-type":"application/json"}),timeout=60)
            j=json.load(r)
            if 'error' in j: raise Exception(j['error'])
            return j['result']
        except Exception as e:
            print('retry',e,file=sys.stderr); time.sleep(2**i)
addr=sys.argv[1]; out=[]; before=None
while True:
    p={"limit":1000}
    if before: p["before"]=before
    r=rpc("getSignaturesForAddress",[addr,p])
    if not r: break
    out+=r; before=r[-1]['signature']; print(len(out),r[-1]['blockTime'],file=sys.stderr)
    if len(r)<1000: break
json.dump(out,open(sys.argv[2],'w'))
