#!/usr/bin/env python3
"""Read-only official exchange replay of persisted actual Telegram receipts."""
from __future__ import annotations
import argparse,collections,concurrent.futures,csv,datetime as dt,json,pathlib,sys,threading,time,urllib.request,urllib.parse,urllib.error
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
from v27_alert_audit import parse_bars,evaluate,HORIZONS,MIN
UTC=dt.timezone.utc;KST=dt.timezone(dt.timedelta(hours=9))
lock=threading.Lock();next_request=0.
def http(url):
    global next_request
    for attempt in range(5):
        with lock:
            pause=max(0,next_request-time.monotonic())
            if pause:time.sleep(pause)
            next_request=time.monotonic()+.23
        try:
            req=urllib.request.Request(url,headers={'User-Agent':'IRYS-authorized-public-outcome-audit','Accept':'application/json'})
            with urllib.request.urlopen(req,timeout=30) as res:return json.load(res)
        except urllib.error.HTTPError as exc:
            if exc.code not in (429,500,502,503,504) or attempt==4:raise RuntimeError('PUBLIC_HTTP_'+str(exc.code)) from None
            time.sleep(1+attempt*2)
        except (TimeoutError,urllib.error.URLError) as exc:
            if attempt==4:raise RuntimeError('PUBLIC_NETWORK_'+type(exc).__name__) from None
            time.sleep(1+attempt)
    raise RuntimeError('PUBLIC_READ_EXHAUSTED')
def save(path,obj):path.write_text(json.dumps(obj,ensure_ascii=False,indent=2),encoding='utf-8')
def main():
    p=argparse.ArgumentParser();p.add_argument('--input',type=pathlib.Path,required=True);p.add_argument('--output',type=pathlib.Path,required=True)
    args=p.parse_args();out=args.output;out.mkdir(parents=True,exist_ok=True)
    receipts=json.loads((args.input/'telegram_receipts.json').read_text())
    state=json.loads((args.input/'state_market_only.json').read_text())
    restore=json.loads((args.input/'source_receipt.json').read_text())
    assert restore.get('original_restored') is True,'ORIGINAL_WORKER_RESTORE_NOT_CONFIRMED'
    known={}
    for key in ('aiV16Outcomes','spotOutcomesV13','futuresOutcomesV13'):
        for r in state.get(key) or []:
            if not isinstance(r,dict):continue
            mid=r.get('telegram_message_id');sym=r.get('symbol') or r.get('market')
            direction=r.get('original_direction') or r.get('direction')
            if isinstance(mid,int) and isinstance(sym,str) and direction in ('LONG','SHORT','BUY','UP','DOWN'):
                known[(mid,sym)]={'direction':direction,'saved_outcome_key':key,'saved_record':r}
    all_receipts=receipts['receipts'];events=[];ids=set();followups=[]
    for r in all_receipts:
        if '_OUTCOME_' in str(r.get('channel','')):followups.append(r);continue
        if r.get('telegram_message_id') in ids:raise ValueError('DUPLICATE_ACTUAL_MESSAGE_ID')
        ids.add(r['telegram_message_id'])
        sym=r['symbol'];venue='bithumb' if sym.startswith('KRW-') else 'bitget' if sym.endswith('USDT') else None
        if venue is None:raise ValueError('UNRESOLVED_RECEIPT_VENUE')
        match=known.get((r['telegram_message_id'],sym),{})
        direction=match.get('direction') if 'WATCH' not in r['channel'] else None
        events.append({**r,'venue':venue,'direction':direction,'direction_provenance':match.get('saved_outcome_key') if direction else 'NOT_RECORDED_OR_NEUTRAL','message_body_preserved':False})
    now=int(time.time()*1000)
    def inspect(r):
        reference=(r['event_ms']//MIN+1)*MIN
        end=min(now//MIN*MIN,reference+61*MIN)
        if r['venue']=='bithumb':
            # Bithumb `to` is an exclusive Korea-local wall clock. Parse returned candle UTC, not epoch(+9h).
            until=dt.datetime.fromtimestamp(end/1000,KST).strftime('%Y-%m-%dT%H:%M:%S')
            url='https://api.bithumb.com/v1/candles/minutes/1?'+urllib.parse.urlencode({'market':r['symbol'],'to':until,'count':200})
        else:
            url='https://api.bitget.com/api/v2/mix/market/history-candles?'+urllib.parse.urlencode({'symbol':r['symbol'],'productType':'USDT-FUTURES','granularity':'1m','endTime':end,'limit':200})
        data={'receipt':r,'source_url':url,'fetched_at_ms':int(time.time()*1000),'error':None}
        try:
            raw=http(url)
            if r['venue']=='bitget':
                if raw.get('code')!='00000':raise RuntimeError('BITGET_API_'+str(raw.get('code')))
                raw=raw.get('data')
            if not isinstance(raw,list):raise RuntimeError('PUBLIC_SCHEMA_NOT_ARRAY')
            bars=parse_bars(raw,r['venue'],now)
            data.update({'raw':raw,'bars':bars,'horizons':{str(h):evaluate(r,bars,h,now) for h in HORIZONS}})
        except Exception as exc:
            data.update({'error':str(exc)[:150],'raw':None,'bars':[],'horizons':{str(h):{'status':'SOURCE_UNAVAILABLE'} for h in HORIZONS}})
        return data
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(inspect,events))
    groups={}
    for name,subset in [('all_market_alerts',results),('current_fast_watch',[x for x in results if x['receipt']['channel']=='V23_DIRECT_FAST_MARKET_WATCH']),('explicit_direction_recovered',[x for x in results if x['receipt'].get('direction')]),('recent_explicit_direction',[x for x in results if x['receipt'].get('direction') and x['receipt']['event_ms']>=1793462400000])]:
        summary={}
        for h in HORIZONS:
            rows=[x['horizons'][str(h)] for x in subset]
            measured=[x for x in rows if x['status']=='MEASURED']
            right=[x['direction_right'] for x in measured if x['direction_right'] is not None]
            summary[str(h)]={'events':len(subset),'statuses':dict(collections.Counter(x['status'] for x in rows)),
                'up':sum(x['actual_direction']=='UP' for x in measured),'down':sum(x['actual_direction']=='DOWN' for x in measured),'flat':sum(x['actual_direction']=='FLAT' for x in measured),
                'known_direction_right':sum(x is True for x in right),'known_direction_wrong':sum(x is False for x in right),
                'raw_price_mean_pct':sum(x['return_pct'] for x in measured)/len(measured) if measured else None,
                'signed_mean_pct':sum(x['signed_return_pct'] for x in measured if x['signed_return_pct'] is not None)/sum(x['signed_return_pct'] is not None for x in measured) if any(x['signed_return_pct'] is not None for x in measured) else None}
        groups[name]=summary
    report={'version':'V27_ACTUAL_TELEGRAM_CANDLE_AUDIT_V1','at_utc':dt.datetime.fromtimestamp(now/1000,UTC).isoformat(),
        'persisted_receipts':len(all_receipts),'excluded_followup_messages':len(followups),'market_alert_events':len(events),
        'direction_recovered':sum(bool(x.get('direction')) for x in events),'neutral_watch_count':sum('WATCH' in x['channel'] for x in events),
        'device_receipt_verified':False,'exact_original_alert_price_available':False,'actual_trade_returns':False,
        'reference_policy':'FIRST_FULL_MINUTE_AFTER_RECORDED_SEND_OPEN; horizons from reference; subminute ACK lag unavailable',
        'flat_band_pct':.15,'pagination_exhausted':receipts['pagination_exhausted'],'groups':groups,
        'source_errors':dict(collections.Counter(x['error'] for x in results if x['error'])),'records':results}
    save(out/'actual_telegram_outcomes.json',report)
    csvrows=[]
    for x in results:
        r=x['receipt'];z={'message_id':r['telegram_message_id'],'time_kst':r['accepted_at'],'symbol':r['symbol'],'venue':r['venue'],'channel':r['channel'],'direction':r.get('direction') or 'NEUTRAL_OR_UNKNOWN'}
        for h in HORIZONS:
            a=x['horizons'][str(h)]
            for k in ('status','return_pct','signed_return_pct','up_excursion_pct','down_excursion_pct','direction_right','full_path_coverage'):z[f'{h}m_{k}']=a.get(k)
        csvrows.append(z)
    with (out/'actual_telegram_outcomes.csv').open('w',encoding='utf-8-sig',newline='') as f:
        w=csv.DictWriter(f,fieldnames=list(csvrows[0]));w.writeheader();w.writerows(csvrows)
    print('V27_ACTUAL_AUDIT_SUMMARY',json.dumps({k:v for k,v in report.items() if k!='records'},ensure_ascii=False))
    for row in csvrows[-35:]:print('V27_ACTUAL_RECENT',json.dumps(row,ensure_ascii=False))
    assert not report['source_errors'],'ONE_OR_MORE_OFFICIAL_PRICE_READS_FAILED_SEE_REPORT'
if __name__=='__main__':main()
