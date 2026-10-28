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
const start='2026-10-28T00:00:00Z';
let commits=[];
for(let page=1;page<=3;page++){
 const d=await get('https://api.github.com/repos/'+repo+'/commits?path=data/latest.json&per_page=100&page='+page);
 if(!Array.isArray(d)||!d.length)break;
 commits.push(...d.filter(x=>(x.commit?.committer?.date||'')>=start));
 if(d.some(x=>(x.commit?.committer?.date||'')<start))break;
}
commits.sort((a,b)=>String(a.commit?.committer?.date).localeCompare(String(b.commit?.committer?.date)));
let state={},samples=0,checked=0,confirmed=[],counts={},gaps=0,previous=null;
for(const commit of commits){
 const sha=commit.sha;
 let snap;
 try{snap=await get('https://raw.githubusercontent.com/'+repo+'/'+sha+'/data/latest.json');}
 catch(e){console.log('HISTORICAL_SNAPSHOT_UNAVAILABLE',JSON.stringify({sha,error:String(e).slice(0,80)}));continue;}
 const finished=Date.parse(snap.finished_utc||'');
 if(!Number.isFinite(finished)||!Array.isArray(snap.watchlist))continue;
 if(previous&&finished-previous>8*60000)gaps++;
 previous=finished;
 for(const w of snap.watchlist){
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
 valid_independent_candidate_samples:samples,
 symbols_with_samples:Object.keys(counts).length,top_sample_counts:longest,
 four_step_signals:confirmed.length,signals:confirmed.slice(0,40),
 note:'Historical code replay, not future-returns backtest; no orders; no Telegram'
}));
