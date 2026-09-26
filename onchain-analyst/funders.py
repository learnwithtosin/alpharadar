import json,glob,os,time,sys
for f in sorted(glob.glob('wsigs/*.json')):
    a=os.path.basename(f)[:-5]; d=json.load(open(f)); found=False
    for x in d['sigs'][::-1][:4]:
        p='txcache/%s.json'%x['signature']
        if not os.path.exists(p): continue
        t=json.load(open(p)); keys=[k['pubkey'] for k in t['transaction']['message']['accountKeys']]
        pre,post=t['meta']['preBalances'],t['meta']['postBalances']
        if a in keys:
            i=keys.index(a); dl=(post[i]-pre[i])/1e9
            if dl>0:
                src=[(keys[j],round((post[j]-pre[j])/1e9,3)) for j in range(len(keys)) if post[j]-pre[j]<0]
                print(a,'complete' if d['complete'] else 'TRUNC',time.strftime('%m-%d %H:%M',time.gmtime(t['blockTime'])),'+%.3f SOL'%dl,'from',src[:2]); found=True; break
    if not found: print(a,'no inbound SOL in oldest 4', 'complete' if d['complete'] else 'TRUNC')
