#!/usr/bin/env python3
"""Independent IRYS morning-analysis twin (read-only, no orders).
Does not import, change or replace the existing collectors, Workers, or alert task.
An API model is optional; without valid API access no AI decision/alert is claimed.
"""
from __future__ import annotations
import datetime as dt
import hashlib
import json
import math
import os
from pathlib import Path
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'data' / 'latest.json'
OUTPUT = ROOT / 'data' / 'ai_twin_latest.json'
STATE = ROOT / 'data' / 'ai_twin_state.json'
UTC = dt.timezone.utc
KST = dt.timezone(dt.timedelta(hours=9))
VERSION = 'IRYS_AI_TWIN_V1_20261027'
MODEL = os.getenv('AI_TWIN_MODEL', 'gpt-5.5')
MAX_SOURCE_AGE = 15 * 60
MAX_SPOT_CANDIDATES = 3
MAX_FUTURES_CANDIDATES = 4


def num(v):
    try:
        f = float(v)
        return f if math.isfinite(f) else None
    except (ValueError, TypeError, OverflowError):
        return None


def utc_stamp(value):
    if not value or not isinstance(value, str):
        return None
    try:
        x = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
        return x.astimezone(UTC) if x.tzinfo else None
    except ValueError:
        return None


def read_json(path, default):
    try:
        result = json.loads(path.read_text(encoding='utf-8'))
        return result if isinstance(result, dict) else default
    except (FileNotFoundError, ValueError):
        return default


def save_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + '.tmp')
    temp.write_text(json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(',', ':'))+'\n',encoding='utf-8')
    temp.replace(path)


def get_json(url, timeout=9):
    req = urllib.request.Request(url, headers={'Accept':'application/json','User-Agent':'IRYS-AI-Twin-ReadOnly/1.0'})
    with urllib.request.urlopen(req, timeout=timeout) as response:
        if response.status != 200:
            raise RuntimeError('REMOTE_HTTP_ERROR')
        return json.loads(response.read(3_000_000).decode('utf-8'))


def post_json(url, payload, token, timeout=30):
    request = urllib.request.Request(url, data=json.dumps(payload).encode('utf-8'), method='POST', headers={
        'Accept':'application/json','Content-Type':'application/json','Authorization':'Bearer '+token,
        'User-Agent':'IRYS-AI-Twin-ReadOnly/1.0'})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        if response.status != 200:
            raise RuntimeError('AI_HTTP_ERROR')
        return json.loads(response.read(60_000).decode('utf-8'))


def status_source(snapshot, now):
    if snapshot.get('collector_status') != 'PASS':
        return 'SOURCE_NOT_PASS'
    stats = snapshot.get('stats') or {}
    if (stats.get('candle_symbols_failed') != 0 or stats.get('oi_symbols_failed') != 0
        or not stats.get('funding_feed_ok') or (num(stats.get('instrument_verified_crypto')) or 0) < 50):
        return 'SOURCE_INCOMPLETE'
    t = utc_stamp(snapshot.get('finished_utc'))
    if t is None or not 0 <= (now-t).total_seconds() <= MAX_SOURCE_AGE:
        return 'SOURCE_STALE'
    spot = snapshot.get('spot_flow') or {}
    if spot.get('status') != 'PASS' or not isinstance(spot.get('signals'), list):
        return 'SPOT_SOURCE_NOT_PASS'
    if (num(spot.get('markets')) or 0) < 100:
        return 'SPOT_COVERAGE_LOW'
    return 'PASS'


def spot_candidates(snap):
    result=[]
    for raw in (snap.get('spot_flow') or {}).get('signals', []):
        if (not isinstance(raw,dict) or raw.get('venue')!='bithumb' or raw.get('direction')!='BUY_OBSERVATION'
            or raw.get('risk_status')!='NO_OFFICIAL_WARNING_AT_COLLECTION'
            or raw.get('official_warning_checked') is not True):
            continue
        market=raw.get('market')
        flow=raw.get('spot_taker_sample_2m') or {}
        if not isinstance(market,str) or not market.startswith('KRW-') or not flow.get('coverage'):
            continue
        if (num(flow.get('recent_net_buy_krw')) or 0) <= 0 or (num(flow.get('buy_share')) or 0) < .62:
            continue
        five=(raw.get('windows') or {}).get('5m') or {}
        result.append({'source':'BITHUMB_SPOT','market':market,'direction_candidate':'BUY',
            'price_krw':num(raw.get('price_krw')),'price5_pct':num(five.get('price_change_pct')),
            'turnover5_krw':num(five.get('quote_krw')),'volume_ratio5':num(raw.get('volume_ratio_5m')),
            'spot_flow':{'buy_share':num(flow.get('buy_share')),'recent_buy_share':num(flow.get('recent_buy_share')),
                         'net_buy_krw':num(flow.get('net_buy_krw')),'sample_count':flow.get('count')},
            'upper_wick15':num(((raw.get('windows') or {}).get('15m') or {}).get('upper_wick_ratio')),
            'risk':'OFFICIAL_NO_WARNING_AT_COLLECTION','asset_identity':'BITHUMB_KRW_LISTING',
            'limitations':['sampled spot trades, not full-market CVD','continuous orderbook absorption not proven']})
    return result[:MAX_SPOT_CANDIDATES]


def pick_futures(snapshot):
    pool = snapshot.get('early_pool') or []
    selected=[]
    for item in pool:
        if not isinstance(item,dict) or item.get('venue')!='bitget' or item.get('asset_identity')!='VERIFIED_CRYPTO':
            continue
        symbol=item.get('symbol')
        if not isinstance(symbol,str) or not symbol.endswith('USDT') or not symbol.isascii() or not symbol[:-4].isalnum():
            continue
        if item.get('baseCoin') != symbol[:-4]:
            continue
        w=item.get('windows') or {}
        five=w.get('5m') or {}; q15=w.get('15m') or {}; hour=w.get('60m') or {}
        amount=num(five.get('quote_turnover'));increase=num(five.get('adjacent_ratio'))
        change=num(five.get('price_change_pct'));daily=num(hour.get('price_change_pct'))
        if None in (amount,increase,change,daily) or amount<20_000 or increase<2.5 or abs(change)<.15 or abs(change)>3.8 or abs(daily)>8:
            continue
        if any(num(x.get('coverage'))!=1 for x in (five,q15,hour)) or num(five.get('baseline_coverage'))!=1:
            continue
        oi=item.get('oi') or {};delta=num(oi.get('change_pct_from_previous_run'))
        elapsed=num(oi.get('elapsed_min_since_previous_snapshot'));fund=num(item.get('funding_rate'))
        if (oi.get('status')!='OK' or delta is None or elapsed is None or not 3<=elapsed<=20
            or not .3<=delta<=20 or fund is None or abs(fund)>.002):
            continue
        if (change>0 and (num(q15.get('upper_wick_ratio')) or 0)>.45):continue
        if (change<0 and (num(q15.get('lower_wick_ratio')) or 0)>.45):continue
        selected.append((num(item.get('early_volume_rank')) or 0,item))
    selected.sort(key=lambda p:(-p[0],p[1]['symbol']))
    longs=[x for _,x in selected if (num(x['windows']['5m']['price_change_pct']) or 0)>0]
    shorts=[x for _,x in selected if (num(x['windows']['5m']['price_change_pct']) or 0)<0]
    return (longs[:2]+shorts[:2])[:MAX_FUTURES_CANDIDATES]


def parse_binance(raw, now_ms):
    cutoff=now_ms//60000*60000
    bars={}
    for x in raw if isinstance(raw,list) else []:
        if not isinstance(x,list) or len(x)<11:continue
        ts=num(x[0]);close_at=num(x[6]);op=num(x[1]);hi=num(x[2]);lo=num(x[3]);cl=num(x[4]);q=num(x[7]);buy=num(x[10])
        if (None in (ts,close_at,op,hi,lo,cl,q,buy) or op<=0 or cl<=0 or q<0 or not 0<=buy<=q
            or int(ts)%60000!=0 or ts>=cutoff or close_at >= now_ms+60_000):continue
        bars[int(ts)]={'o':op,'h':hi,'l':lo,'c':cl,'q':q,'buy':buy}
    def interval(length):
        vals=[bars.get(cutoff-i*60000) for i in range(length,0,-1)]
        if any(x is None for x in vals):return None
        q=sum(x['q'] for x in vals); buy=sum(x['buy'] for x in vals)
        return {'turnover_usdt':round(q,2),'taker_buy_ratio':buy/q if q else None,
                'taker_net_usdt':round(2*buy-q,2),'open':vals[0]['o'],'close':vals[-1]['c']}
    two=interval(2);five=interval(5);hour=interval(60);four=interval(240)
    prior=[bars.get(cutoff-i*60000) for i in range(60,5,-1)]
    if not (two and five and hour and four) or any(v is None for v in prior):
        return {'status':'INSUFFICIENT_BARS'}
    first=bars[cutoff-120000];second=bars[cutoff-60000]
    ratios=[first['buy']/first['q'] if first['q'] else None,second['buy']/second['q'] if second['q'] else None]
    return {'status':'PASS','last2m':two,'last5m':five,'last60m':hour,'last4h':four,
            'two_one_min_buy_shares':ratios,
            'quiet_55m':{'range_pct':100*(max(v['h'] for v in prior)-min(v['l'] for v in prior))/prior[0]['o'],
                         'drift_pct':100*(prior[-1]['c']/prior[0]['o']-1)},
            'taker_not_global_cvd':True,'source':'Binance official SPOT 1m klines'}


def augment_binance(item, now, getter=get_json):
    base=item['baseCoin'];symbol=item['symbol']
    params=urllib.parse.urlencode({'symbol':symbol})
    info=getter('https://data-api.binance.vision/api/v3/exchangeInfo?'+params)
    matches=[x for x in info.get('symbols',[]) if isinstance(x,dict) and x.get('symbol')==symbol and x.get('status')=='TRADING' and x.get('baseAsset')==base and x.get('quoteAsset')=='USDT']
    if len(matches)!=1:
        return {'status':'NO_SPOT_MATCH'}
    end_ms=(int(now.timestamp()*1000)//60000)*60000-1
    query=urllib.parse.urlencode({'symbol':symbol,'interval':'1m','limit':260,'endTime':end_ms})
    raw=getter('https://data-api.binance.vision/api/v3/klines?'+query)
    return parse_binance(raw,int(now.timestamp()*1000))


def evidence_candidates(snapshot,now,getter=get_json):
    candidates=spot_candidates(snapshot);diagnostics={'pool':len(snapshot.get('early_pool') or []),'futures_preselected':0,'binance_verified':0,'binance_unavailable':0,'price_conflict':0,'spot_signals':len(candidates)}
    chosen=pick_futures(snapshot);diagnostics['futures_preselected']=len(chosen)
    for market in chosen:
        try:
            spot=augment_binance(market,now,getter)
        except (Exception,):
            diagnostics['binance_unavailable']+=1
            continue
        if spot.get('status')!='PASS':continue
        diagnostics['binance_verified']+=1
        quiet=spot['quiet_55m'];five=market['windows']['5m'];recent=spot['last2m'];four=spot['last4h'];ratio=spot['two_one_min_buy_shares']
        if quiet['range_pct']>6 or abs(quiet['drift_pct'])>4 or abs(five['close']/spot['last5m']['close']-1)>.025:
            diagnostics['price_conflict']+=1
            continue
        direction='LONG' if (num(five['price_change_pct']) or 0)>0 else 'SHORT'
        if (None in ratio or recent['taker_buy_ratio'] is None or four['taker_net_usdt'] is None):continue
        if direction=='LONG' and not (recent['taker_buy_ratio']>=.62 and min(ratio)>=.55 and recent['taker_net_usdt']>3000 and four['taker_net_usdt']>=0):continue
        if direction=='SHORT' and not (recent['taker_buy_ratio']<=.38 and max(ratio)<=.45 and recent['taker_net_usdt'] < -3000 and four['taker_net_usdt']<=0):continue
        if direction=='LONG' and (num(market.get('funding_rate')) or 0)>.001:continue
        if direction=='SHORT' and (num(market.get('funding_rate')) or 0)<-.001:continue
        candidates.append({'source':'BITGET_FUTURES_WITH_BINANCE_SPOT','market':market['symbol'],
            'direction_candidate':direction,'price_usdt':num(five.get('close')),
            'price5_pct':num(five.get('price_change_pct')),
            'turnover5_usdt':num(five.get('quote_turnover')),
            'volume_ratio5':num(five.get('adjacent_ratio')),
            'oi_pct':num(market['oi'].get('change_pct_from_previous_run')),
            'oi_elapsed_min':num(market['oi'].get('elapsed_min_since_previous_snapshot')),
            'funding_rate':num(market.get('funding_rate')),
            'binance_spot':spot,
            'asset_identity':'BINANCE_BASE_TICKER_AND_PRICE_MATCH_ONLY_NOT_CONTRACT_VERIFIED',
            'risk':'OFFICIAL_CRYPTO_FUTURES_ACTIVE_OTHER_RISKS_UNVERIFIED',
            'limitations':['Binance spot taker volume is not global CVD','exchange deposits/unlocks not verified','orderbook absorption not verified']})
    return candidates,diagnostics


AI_SCHEMA={'type':'object','properties':{
    'assessments':{'type':'array','items':{'type':'object','properties':{
        'market':{'type':'string'},'decision':{'type':'string','enum':['BUY','LONG','SHORT','WATCH','REJECT']},
        'confidence':{'type':'string','enum':['LOW','MEDIUM','HIGH']},
        'reasons':{'type':'array','items':{'type':'string'}},
        'counter_evidence':{'type':'array','items':{'type':'string'}},
        'explanation_ko':{'type':'string'},'send_alert':{'type':'boolean'}
    },'required':['market','decision','confidence','reasons','counter_evidence','explanation_ko','send_alert'],
    'additionalProperties':False}}},'required':['assessments'],'additionalProperties':False}

SYSTEM_PROMPT='''너는 2026-10-27 새벽 IRYS형 감시와 독립 비교할 5분 AI 시장분석가다.
반드시 공개 숫자와 그 반대 근거를 비교해 BUY, LONG, SHORT, WATCH, REJECT 중 판단한다.
UNI 예시: 1분 현물 공격매수 140.9배가 나와도 이후 매수가 식고 OI가 -0.47%면 LONG을 확정하지 않는다.
실제 현물 공격 매수·매도 지속, 1m/5m/15m/1h 거래량 및 전구간 비교, 55분 정체,
4시간 현물 수급, 가격 방어와 긴 윗꼬리, OI·펀딩과 청산 여부를 같이 고려한다.
OI 크기만으로 방향 확정 불가. 청산·호가 흡수·온체인 입출금·락업 자료가 없으면 미확인이다.
IRYS != IRIS, 종목 티커가 같아도 서로 다른 토큰일 수 있다. 사용자에게 과거 급등 종목을 신규 초입이라 추천하지 않는다.
주어진 후보에 없는 종목, 가격, 성공률, 거래소·시간·수치를 만들어내면 안 된다.
BUY/LONG/SHORT도 매매 확정이 아니라 관찰이다. 불충분하거나 충돌하면 WATCH 또는 REJECT.
JSON 스키마로만 답하라. 객관적 근거와 반증 근거를 간결한 한국어로 서술하라.'''


def call_ai(candidates,token,model=MODEL,poster=post_json):
    user_payload={'event':'morning-style-independent-AI-comparison','candidates':candidates,
        'rule':'Consider opposite evidence; alert only when independent spot flow and price/OI are consistent. No guessing missing data.'}
    body={'model':model,'instructions':SYSTEM_PROMPT,'input':json.dumps(user_payload,ensure_ascii=False,separators=(',',':')),
          'reasoning':{'effort':'medium'},'max_output_tokens':2400,
          'text':{'format':{'type':'json_schema','name':'ai_twin_assessments','strict':True,'schema':AI_SCHEMA}}}
    raw=poster('https://api.openai.com/v1/responses',body,token,timeout=90)
    output=[]
    for block in raw.get('output',[]):
        if block.get('type')!='message':continue
        for content in block.get('content',[]):
            if content.get('type')=='output_text' and isinstance(content.get('text'),str):output.append(content['text'])
    if not output:raise RuntimeError('AI_NO_COMPLETED_OUTPUT')
    payload=json.loads(''.join(output))
    if not isinstance(payload.get('assessments'),list):raise RuntimeError('AI_INVALID_SCHEMA')
    return payload['assessments'],str(raw.get('model',model))


def confirm_assessments(candidates,assessments):
    lookup={c['market']:c for c in candidates}
    seen=set();out=[]
    for a in assessments:
        if not isinstance(a,dict):continue
        market=a.get('market');direction=a.get('decision')
        if market not in lookup or market in seen:continue
        seen.add(market);c=lookup[market]
        valid=(direction==c['direction_candidate'] and a.get('confidence')=='HIGH' and a.get('send_alert') is True)
        if not valid:continue
        if c['source']=='BITHUMB_SPOT' and direction!='BUY':continue
        if c['source']=='BITGET_FUTURES_WITH_BINANCE_SPOT' and direction not in ('LONG','SHORT'):continue
        out.append({'market':market,'direction':direction,'confidence':'HIGH','evidence':c,
                    'reasons':[str(x)[:150] for x in a.get('reasons',[])[:4]],
                    'counter_evidence':[str(x)[:150] for x in a.get('counter_evidence',[])[:4]],
                    'explanation_ko':str(a.get('explanation_ko',''))[:250]})
    return out


def bot_message(item,stamp):
    e=item['evidence'];label={'BUY':'🟢 BUY','LONG':'🟢 LONG','SHORT':'🔴 SHORT'}[item['direction']]
    price=f"{e['price_krw']} KRW" if e.get('price_krw') is not None else f"{e.get('price_usdt')} USDT"
    return (f"[새 AI 비교 감시기 / 기존 새벽 감시 아님] {label} 관찰\n"
            f"{item['market']} · {stamp.astimezone(KST).strftime('%Y-%m-%d %H:%M KST')}\n"
            f"가격: {price} | 5분 거래량/기준 배수: {e.get('volume_ratio5')}\n"
            f"핵심 근거: {'; '.join(item['reasons'][:2])}\n"
            f"반대 근거: {'; '.join(item['counter_evidence'][:2]) or '현재 자료에 없거나 미확인'}\n"
            "확정 진입/수익 보장 아님. 자동매매·주문 없음.")


def telegram_send(token,chat_id,text,poster=None):
    if not (isinstance(chat_id,str) and chat_id.lstrip('-').isdigit()):raise RuntimeError('TELEGRAM_RECIPIENT_INVALID')
    url='https://api.telegram.org/bot'+token+'/sendMessage'
    payload={'chat_id':chat_id,'text':text,'disable_web_page_preview':True}
    body=json.dumps(payload).encode('utf-8')
    req=urllib.request.Request(url,data=body,headers={'Content-Type':'application/json'},method='POST')
    if poster:return poster(req)
    with urllib.request.urlopen(req,timeout=12) as response:
        data=json.loads(response.read(4000).decode('utf-8'))
        if not data.get('ok'):raise RuntimeError('TELEGRAM_SEND_REJECTED')
        return True


def run(now=None,source=None,state=None,fetch_binance=get_json,model_caller=call_ai,send=None):
    now=now or dt.datetime.now(UTC)
    source=source if source is not None else read_json(SOURCE,{})
    state=state if state is not None else read_json(STATE,{})
    fingerprint=hashlib.sha256(json.dumps({'collector_utc':source.get('collector_utc'),
                     'finished_utc':source.get('finished_utc')},sort_keys=True).encode('utf-8')).hexdigest()[:16]
    report={'version':VERSION,'created_utc':now.isoformat(),'created_kst':now.astimezone(KST).isoformat(),
       'source_finished_utc':source.get('finished_utc'),'source_fingerprint':fingerprint,
       'status':'WAIT','ai_status':'NOT_RUN','candidate_count':0,'confirmed_count':0,
       'telegram_status':'DISABLED','alerts_sent':0,'candidates':[],'assessments':[],
       'confirmed_observations':[],'comparison_note':'Original ChatGPT morning watcher untouched; independent AI twin.',
       'limitations':['Not identical GPT-6 ChatGPT runtime','No full-market CVD or continuous orderbook',
                      'Missing deposits/whale/unlock data are unknown','AI model uses external paid API only if user configures a key']}
    if status_source(source,now)!='PASS':
        report['status']='SOURCE_BLOCKED';report['block_reason']=status_source(source,now)
        return report,state
    # Exchange snapshots and Binance klines must refer to the SAME observation time.
    observed=utc_stamp(source.get('collector_utc'))
    if observed is None or (now-observed).total_seconds()>MAX_SOURCE_AGE or observed>now:
        report['status']='SOURCE_BLOCKED';report['block_reason']='OBSERVATION_CLOCK_UNVERIFIED'
        return report,state
    candidates,diags=evidence_candidates(source,observed,fetch_binance)
    report['diagnostics']=diags
    report['candidate_count']=len(candidates)
    report['candidates']=candidates
    if not candidates:
        report['status']='NO_EVIDENCE';report['ai_status']='SKIPPED_NO_CANDIDATES'
        return report,state
    token=os.getenv('AI_TWIN_OPENAI_API_KEY','').strip()
    if not token:
        report['status']='AI_NOT_CONFIGURED';report['ai_status']='MISSING_API_KEY'
        return report,state
    try:
        assessments,model_name=model_caller(candidates,token)
        report['ai_status']='CALLED';report['model']=model_name
    except Exception as exc:
        report['status']='AI_FAILED';report['ai_status']='UNAVAILABLE'
        report['ai_error_code']=type(exc).__name__
        return report,state
    report['assessments']=assessments
    confirmed=confirm_assessments(candidates,assessments)
    report['confirmed_count']=len(confirmed);report['confirmed_observations']=confirmed
    report['status']='READY_RESEARCH'
    allowed=(os.getenv('AI_TWIN_SEND_ALERTS','false').lower()=='true')
    bot=os.getenv('AI_TWIN_TELEGRAM_BOT_TOKEN','').strip();chat=os.getenv('AI_TWIN_TELEGRAM_CHAT_ID','').strip()
    if not (allowed and bot and chat):
        report['telegram_status']='SHADOW_NO_DELIVERY'
        return report,state
    historical=state.get('alerts') if isinstance(state.get('alerts'),dict) else {}
    for item in confirmed:
        key=item['direction']+':'+item['market']
        past=utc_stamp(historical.get(key))
        if past is not None and (now-past).total_seconds()<2*3600:continue
        try:
            (send or telegram_send)(bot,chat,bot_message(item,now))
            historical[key]=now.isoformat();report['alerts_sent']+=1
        except Exception as exc:
            report['telegram_status']='SEND_FAILED';report['telegram_error_code']=type(exc).__name__
            break
    state['alerts']=historical
    if report['telegram_status']!='SEND_FAILED':report['telegram_status']='SENT' if report['alerts_sent'] else 'NO_NEW_SIGNAL'
    return report,state


def main():
    report,state=run()
    save_json(OUTPUT,report)
    save_json(STATE,state)
    print(json.dumps({'ai_twin_status':report['status'],'ai':report['ai_status'],
        'candidates':report['candidate_count'],'confirmed':report['confirmed_count'],
        'alerts_sent':report['alerts_sent'],'telegram':report['telegram_status']},ensure_ascii=False))
    return 0

if __name__=='__main__':raise SystemExit(main())