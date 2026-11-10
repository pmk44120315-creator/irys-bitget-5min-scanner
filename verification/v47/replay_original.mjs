import {readFileSync,writeFileSync} from 'node:fs';import {gunzipSync} from 'node:zlib';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {normalizeFrame} from '../../deployment/v43_stream_core.mjs';import {WatchEpochs} from '../../deployment/v47_stream_integrity.mjs';
const dir=process.argv[2],out=process.argv[3];assert(dir&&out);
const s=JSON.parse(readFileSync(dir+'/session.json')),raw=readFileSync(dir+'/raw_frames.jsonl.gz'),f=readFileSync(dir+'/frozen_features.jsonl.gz');
assert.equal(s.session,'42791465821-1');assert.equal(createHash('sha256').update(raw).digest('hex'),s.raw_sha256);assert.equal(createHash('sha256').update(f).digest('hex'),s.features_sha256);
const features=gunzipSync(f).toString().trim().split('\n').map(JSON.parse),first=Math.min(...features.map(r=>r.feature.asof_ms));
const initial={bitget:[],bithumb:[]};for(const r of features)if(r.feature.asof_ms===first)initial[r.feature.venue].push(r.feature.symbol);
const w=new WatchEpochs();for(const v of ['bitget','bithumb'])w.replace(v,initial[v],s.started_at_ms);
let changed=false,total=0,events=0,discarded=0,errors=0,maxDelay=0;
for(const line of gunzipSync(raw).toString().trim().split('\n')){
 const r=JSON.parse(line);total++;
 if(!changed&&r.received_at_ms>=s.watchlist.asof_ms){for(const v of ['bitget','bithumb'])w.replace(v,s.watchlist[v],s.watchlist.asof_ms);changed=true;}
 const epoch=w.capture(r.venue);
 for(const e of normalizeFrame(r.venue,r.raw,r.received_at_ms)){
  events++;const check=w.classify(r.venue,e.symbol,r.received_at_ms,epoch);
  if(check.error)errors++;else if(!check.accept){discarded++;maxDelay=Math.max(maxDelay,r.received_at_ms-s.watchlist.asof_ms);}
 }
}
assert.equal(errors,0);assert.equal(discarded,31);assert.equal(total,46998);
const result={source_session:s.session,raw_sha256:s.raw_sha256,total_raw_frames:total,events,expected_retired_events:discarded,max_retirement_delay_ms:maxDelay,unexpected_identity_errors:errors,production_modified:false,telegram_sent:false,orders_sent:false};
writeFileSync(out,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
