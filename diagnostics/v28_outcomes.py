"""Today's real ACK aftermath. No shadow-forecast substitution, orders or fills."""
from pathlib import Path
import sys,json,time,datetime as dt,collections,csv,urllib.request,urllib.parse
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from v27_alert_audit import parse_bars,evaluate,HORIZONS,MIN
KST=dt.timezone(dt.timedelta(hours=9))
def http(url):
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'IRYS-public-outcome-audit'}),timeout=20) as r:return json.load(r)
        except Exception:
            if attempt==3:raise
            time.sleep(attempt+1)
def main():
    p=Path('v28_evidence');doc=json.loads((p/'today_receipts.json').read_text());s=json.loads((p/'state.json').read_text())['state'];now=int(time.time()*1000)
    known={}
    for key in ('aiV16Outcomes','spotOutcomesV13','futuresOutcomesV13'):
        for r in s.get(key,[]):
            if isinstance(r,dict):known[(r.get('telegram_message_id'),r.get('symbol') or r.get('market'))]=r.get('original_direction') or r.get('direction')
    results=[]
    for envelope in doc['receipts']:
        r=envelope.get('receipt') or {};ch=r.get('channel','');sym=r.get('symbol','')
        if '_OUTCOME_' in ch:continue
        venue='bithumb' if sym.startswith('KRW-') else 'bitget' if sym.endswith('USDT') else None
        if venue is None:continue
        stamp=r.get('ack_received_at_ms') or envelope['event_ms'];snap=r.get('market_snapshot') or {}
        side=snap.get('forecast_direction') or known.get((r.get('telegram_message_id'),sym))
        if 'WATCH' in ch:side=None
        receipt=dict(r,event_ms=stamp,direction=side,venue=venue)
        ref=(stamp//MIN+1)*MIN;end=min(now//MIN*MIN,ref+61*MIN)
        if venue=='bithumb':
            until=dt.datetime.fromtimestamp(end/1000,KST).strftime('%Y-%m-%dT%H:%M:%S')
            url='https://api.bithumb.com/v1/candles/minutes/1?'+urllib.parse.urlencode({'market':sym,'to':until,'count':200})
        else:url='https://api.bitget.com/api/v2/mix/market/history-candles?'+urllib.parse.urlencode({'symbol':sym,'productType':'USDT-FUTURES','granularity':'1m','endTime':end,'limit':200})
        error=None;raw=[]
        try:
            raw=http(url)
            if venue=='bitget':
                assert raw.get('code')=='00000'
                raw=raw['data']
            bars=parse_bars(raw,venue,now);horizons={str(h):evaluate(receipt,bars,h,now) for h in HORIZONS}
        except Exception as exc:
            error=type(exc).__name__;horizons={str(h):{'status':'SOURCE_UNAVAILABLE'} for h in HORIZONS}
        results.append({'receipt':receipt,'source_url':url,'raw':raw,'horizons':horizons,'error':error});time.sleep(.21)
    deployment=int(dt.datetime(2026,11,2,12,8,7,tzinfo=KST).timestamp()*1000)
    screenshot=int(dt.datetime(2026,11,2,15,46,tzinfo=KST).timestamp()*1000)
    summary={}
    for key,rows in [('all_today',results),('v27_since_deployment',[x for x in results if x['receipt']['event_ms']>=deployment]),('since_user_screenshot',[x for x in results if x['receipt']['event_ms']>=screenshot])]:
        summary[key]={}
        for h in HORIZONS:
            a=[r['horizons'][str(h)] for r in rows];m=[x for x in a if x['status']=='MEASURED'];direction=[x for x in m if x['direction_right'] is not None]
            summary[key][str(h)]={'events':len(rows),'statuses':dict(collections.Counter(x['status'] for x in a)),
                'up':sum(x['actual_direction']=='UP' for x in m),'down':sum(x['actual_direction']=='DOWN' for x in m),'flat':sum(x['actual_direction']=='FLAT' for x in m),
                'known_direction_correct':sum(x['direction_right'] for x in direction),'known_direction_wrong':sum(not x['direction_right'] for x in direction),
                'mean_raw_return_pct':sum(x['return_pct'] for x in m)/len(m) if m else None}
    report={'observed_at_utc':dt.datetime.now(dt.timezone.utc).isoformat(),'receipt_count':len(doc['receipts']),'events':len(results),
        'method':'first full post-ACK minute open; official same-venue candles; not fills or profit','summary':summary,'records':results}
    (p/'actual_today_outcomes.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    rows=[]
    for x in results:
        r=x['receipt'];row={'time_kst':r['accepted_at'],'symbol':r['symbol'],'channel':r['channel'],'direction':r.get('direction') or 'WATCH_OR_UNKNOWN','message_id':r['telegram_message_id']}
        for h in HORIZONS:
            z=x['horizons'][str(h)]
            for k in ('status','return_pct','direction_right','up_excursion_pct','down_excursion_pct'):row[f'{h}m_{k}']=z.get(k)
        rows.append(row)
    if rows:
        with (p/'actual_today_outcomes.csv').open('w',encoding='utf-8-sig',newline='') as f:
            w=csv.DictWriter(f,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
    print('V28_TODAY_OUTCOME_SUMMARY',json.dumps(summary,ensure_ascii=False))
    for row in rows[-20:]:print('V28_LAST_ACTUAL_ALERT',json.dumps(row,ensure_ascii=False))
    if any(x['error'] for x in results):raise SystemExit('SOURCE_READ_ERRORS: see saved report')
if __name__=='__main__':main()
