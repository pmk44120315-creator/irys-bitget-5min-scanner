/** Read-only replay of V9 futures direction gating from real historical GitHub 5m snapshots. */
import {accumulateBitgetProof,bitgetTickEvidence} from '../deployment/IRYS_V9_SPOT_BITGET_DUAL_WORKER.mjs';
const repo='pmk44120315-creator/irys-bitget-5min-scanner';
const token=process.env.GITHUB_TOKEN||'';
const headers={'accept':'application/vnd.github+json','user-agent':'IRYS-GitHub-5min-research'};
if(token)headers.authorization='Bearer '+token;
async function get(url){
  for(let attempt=0;attempt<3;attempt++){
    try{
      const r=await fetch(url,{headers,signal:AbortSignal.timeout(20000)});
      if(!r.ok)throw Error('READ_ONLY_HISTORY_HTTP_'+r.status);
      return r.json();
    }catch(e){if(attempt===2)throw e;await new Promise(ok=>setTimeout(ok,1200*(attempt+1)));}
  }
}

const funnel={};
const bump=x=>funnel[x]=(funnel[x]||0)+1;
function probe(x,finished){
  bump('total_watchlist_records');
  if(x?.asset_identity!=='VERIFIED_CRYPTO'||x.isRwa!=='NO'||
    x.contract_status!=='normal'||x.symbolType!=='perpetual')return bump('excluded_identity_or_product');
  bump('verified_crypto');
  const w=x.windows||{},f=w['5m'],q=w['15m'],h=w['60m'];
  if(!f||!q||!h||f.coverage!==1||q.coverage!==1||h.coverage!==1)return bump('coverage_missing');
  bump('coverage_pass');
  if(!(f.quote_turnover>=30000&&q.quote_turnover>=90000&&f.prior_adjacent_quote_turnover>=2000))
    return bump('turnover_or_baseline_too_low');
  bump('turnover_pass');
  const ti=x.recent_trades_sample||{},oi=x.oi||{};
  if(ti.total_trades_sampled<40||!(ti.buy_taker_quote+ti.sell_taker_quote>=12000)||
    !(ti.newest_trade_timestamp_ms>=finished-90000)||
    !(ti.oldest_trade_timestamp_ms>=finished-15*60000)||
    !(ti.newest_trade_timestamp_ms-ti.oldest_trade_timestamp_ms>=30000))
    return bump('trade_sample_stale_thin_or_too_short');
  bump('trade_sample_pass');
  if(oi.status!=='OK'||oi.change_pct_from_previous_run<-.6||oi.change_pct_from_previous_run>15||
    oi.elapsed_min_since_previous_snapshot<3||oi.elapsed_min_since_previous_snapshot>8||
    Math.abs(x.funding_rate)>.002)return bump('OI_or_funding');
  bump('oi_pass');
  const buy=ti.buy_taker_quote/(ti.buy_taker_quote+ti.sell_taker_quote),p5=f.price_change_pct,p15=q.price_change_pct;
  const aligned=(p5>=.12&&p15>=.25&&buy>=.64)||(p5<=-.12&&p15<=-.25&&buy<=.36);
  if(!aligned)return bump('direction_or_taker_conflict');
  bump('aligned_price_and_taker');
  if(bitgetTickEvidence(x,finished,finished+60000))bump('all_filters_pass');
  else bump('late_or_wick_or_other');
}

const start='2026-10-28T00:00:00Z';
let commits=[];
for(let page=1;page<=3;page++){
 const d=await get('https://api.github.com/repos/'+repo+'/commits?path=data/latest.json&per_page=100&page='+page);
 if(!Array.isArray(d)||!d.length)break;
 commits.push(...d.filter(x=>(x.commit?.committer?.date||'')>=start));
 if(d.some(x=>(x.commit?.committer?.date||'')<start))break;
}
commits.sort((a,b)=>String(a.commit?.committer?.date).localeCompare(String(b.commit?.committer?.date)));
let state={},samples=0,checked=0,confirmed=[],counts={},gaps=0,previous=null,historyRows=[];
for(const commit of commits){
 const sha=commit.sha;
 let snap;
 try{snap=await get('https://raw.githubusercontent.com/'+repo+'/'+sha+'/data/latest.json');}
 catch(e){console.log('HISTORICAL_SNAPSHOT_UNAVAILABLE',JSON.stringify({sha,error:String(e).slice(0,80)}));continue;}
 const finished=Date.parse(snap.finished_utc||'');
 if(!Number.isFinite(finished)||!Array.isArray(snap.watchlist))continue;
 historyRows.push({finished,snap});
 if(previous&&finished-previous>8*60000)gaps++;
 previous=finished;
 for(const w of snap.watchlist){
  probe(w,finished);
  const m=bitgetTickEvidence(w,finished,finished+60000);
  if(m){samples++;counts[m.symbol]=(counts[m.symbol]||0)+1;}
 }
 const x=accumulateBitgetProof(state,{snap,finished},finished+60000);
 for(const c of x.signals)confirmed.push({at_utc:snap.finished_utc,symbol:c.symbol,direction:c.direction,pct5:c.pct5,pct15:c.pct15,
   sample_share:c.sample_share,oi_change_4checks:c.oi_change_4checks});
 checked++;
}
const longest=Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,20);
console.log('BITGET_V9_HISTORICAL_REPLAY',JSON.stringify({
 start_utc:start,through_utc:commits.at(-1)?.commit?.committer?.date||null,
 commits_discovered:commits.length,snapshots_checked:checked,
 snapshot_gap_gt_8m:gaps,
 funnel,
 valid_independent_candidate_samples:samples,
 symbols_with_samples:Object.keys(counts).length,top_sample_counts:longest,
 four_step_signals:confirmed.length,signals:confirmed.slice(0,40),
 note:'Historical code replay, not future-returns backtest; no orders; no Telegram'
}));


function calibrated(row,cfg){
 const r=row, w=r.windows||{},f=w['5m'],q=w['15m'],h=w['60m'],t=r.recent_trades_sample||{},oi=r.oi||{};
 if(r.venue!=='bitget'||r.asset_identity!=='VERIFIED_CRYPTO'||r.isRwa!=='NO'||
    r.symbolType!=='perpetual'||r.contract_status!=='normal'||
    f?.coverage!==1||q?.coverage!==1||h?.coverage!==1)return null;
 const vol=f.quote_turnover,qvol=q.quote_turnover,buy=t.buy_taker_quote,sell=t.sell_taker_quote,
    share=buy/(buy+sell);
 if(!(vol>=cfg.vol&&qvol>=cfg.qvol&&buy+sell>=cfg.flow&&t.total_trades_sampled>=30))return null;
 if(!(t.newest_trade_timestamp_ms>=r._at-cfg.fresh&&t.newest_trade_timestamp_ms<=r._at+60000))return null;
 if(!(oi.status==='OK'&&oi.elapsed_min_since_previous_snapshot>=3&&oi.elapsed_min_since_previous_snapshot<=8&&
    oi.change_pct_from_previous_run>=-1.5&&oi.change_pct_from_previous_run<=20&&
    Math.abs(r.funding_rate)<=.002))return null;
 const fp=f.price_change_pct,qp=q.price_change_pct,hp=h.price_change_pct;
 if(Math.abs(hp)>10||Math.abs(qp)>5.5)return null;
 let d=null;
 if(fp>=cfg.p5&&qp>=cfg.p15&&share>=cfg.share&&f.upper_wick_ratio<=cfg.wick)d='LONG';
 if(fp<=-cfg.p5&&qp<=-cfg.p15&&share<=1-cfg.share)d='SHORT';
 return d?{symbol:r.symbol,dir:d,at:r._at,close:f.close,
   newest:t.newest_trade_timestamp_ms,quote5:vol,pct5:fp,pct15:qp,
   buy_share:share,oi_delta:oi.change_pct_from_previous_run}:null;
}
const scenarios=[
 {name:'balanced',vol:15000,qvol:40000,flow:6000,fresh:120000,p5:.10,p15:.15,share:.65,wick:.48},
 {name:'early',vol:8000,qvol:20000,flow:3500,fresh:150000,p5:.08,p15:.12,share:.62,wick:.58},
 {name:'broad',vol:6000,qvol:14000,flow:2500,fresh:180000,p5:.07,p15:.10,share:.60,wick:.65},
];
for(const cfg of scenarios){
 let raw=0,found=[],lastObs=new Map(),earlySeen=[];
 for(const row of historyRows){
  const finished=row.finished;
  for(const w of (row.snap.watchlist||[])){
   const k=calibrated({...w,_at:finished},cfg);
   if(!k)continue;
   raw++;const old=lastObs.get(k.symbol);
   if(old&&old.dir===k.dir&&k.at-old.at<=6*60000&&k.at>old.at&&
      k.newest>old.newest+30000){
     const prev=found.find(y=>y.symbol===k.symbol&&y.dir===k.dir&&k.at-y.at<2*3600000);
     if(!prev)found.push({symbol:k.symbol,dir:k.dir,at:k.at,pct5:k.pct5,pct15:k.pct15});
   }
   lastObs.set(k.symbol,k);
   earlySeen.push({symbol:k.symbol,dir:k.dir});
  }
 }
 console.log('BITGET_V9_CALIBRATION',JSON.stringify({scenario:cfg.name,raw_single_events:raw,
    distinct_single_symbols:new Set(earlySeen.map(x=>x.symbol)).size,
    consecutive_two_independent_scenarios:found.length,events:found.slice(0,25)}));
}
