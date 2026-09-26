import json,sys,time,urllib.request,os
from concurrent.futures import ThreadPoolExecutor
import itertools,threading
RPCS=itertools.cycle(["https://api.mainnet-beta.solana.com","https://solana-mainnet.gateway.tatum.io","https://api.mainnet-beta.solana.com"]);L=threading.Lock()
def nxt():
    with L: return next(RPCS)
sigs=[s['signature'] for s in json.load(open(sys.argv[1])) if not s['err']]
cache=sys.argv[2]; os.makedirs(cache,exist_ok=True)
todo=[s for s in sigs if not os.path.exists(f"{cache}/{s}.json")]
print(len(sigs),'todo',len(todo),file=sys.stderr)
def get(s):
    for i in range(10):
        try:
            body=json.dumps({"jsonrpc":"2.0","id":1,"method":"getTransaction","params":[s,{"encoding":"jsonParsed","maxSupportedTransactionVersion":1}]}).encode()
            j=json.load(urllib.request.urlopen(urllib.request.Request(nxt(),body,{"content-type":"application/json","user-agent":"curl/8.5.0"}),timeout=60))
            if j.get('result') is None: raise Exception(str(j)[:200])
            json.dump(j['result'],open(f"{cache}/{s}.json",'w')); return 1
        except Exception as e:
            time.sleep(0.5+i*0.5)
    print('FAIL',s,file=sys.stderr); return 0
with ThreadPoolExecutor(int(sys.argv[3]) if len(sys.argv)>3 else 4) as ex:
    n=0
    for r in ex.map(get,todo):
        n+=1
        if n%250==0: print(n,file=sys.stderr)
