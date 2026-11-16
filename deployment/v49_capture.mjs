/** Freeze public research decisions beside the fresh producer, never beside a delayed consumer.
 * This module has no network, Telegram, Worker or trading capability.
 */
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync,renameSync,rmSync,linkSync} from 'node:fs';
import {join} from 'node:path';import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';import {gzipSync,gunzipSync} from 'node:zlib';
import {v36Observe} from './v36_shadow.mjs';
import {v48ValidIdentity,v48ValidEvent} from './v48_measurement.mjs';
export const V49_CAPTURE_VERSION='V49_FRESH_SOURCE_DECISION_CAPTURE_V1';
const clock=x=>Number.isSafeInteger(x)&&x>=0;
const positive=x=>typeof x==='number'&&Number.isFinite(x)&&x>0;
const stable=x=>x===null||typeof x!=='object'?JSON.stringify(x):Array.isArray(x)?'['+x.map(stable).join(',')+']':'{'+Object.keys(x).sort().filter(k=>x[k]!==undefined).map(k=>JSON.stringify(k)+':'+stable(x[k])).join(',')+'}';
const sha=x=>createHash('sha256').update(x).digest('hex');
export function v49CaptureHash(record){const {id,...body}=record;return sha(stable(body));}
export function v49CreateCapture({packet,now,baselineDigest,sourceCommit}={}){
 if(!clock(now)||typeof baselineDigest!=='string'||!baselineDigest||!/^[a-f0-9]{40}$/.test(sourceCommit||''))throw Error('V49_CAPTURE_INPUT');
 const observed=v36Observe({events:[]},{packet,now,baselineDigest});
 const r={version:V49_CAPTURE_VERSION,recorded_at_ms:now,source_commit:sourceCommit,
  source_packet_at_ms:packet?.at_ms??null,source_packet_sha256:sha(stable(packet??null)),baseline_model_digest:baselineDigest,
  status:observed.status,admission:observed.admission,events:observed.events,
  clock_scope:'ACTUAL_SOURCE_SIDE_RESEARCH_DECISION',orders_sent:false,telegram_sent:false,auto_promotion:false};
 r.id=v49CaptureHash(r);return r;
}
export function v49ValidateCapture(r,now,baselineDigest){
 if(!r||r.version!==V49_CAPTURE_VERSION||!/^[a-f0-9]{64}$/.test(r.id||'')||v49CaptureHash(r)!==r.id)throw Error('V49_CAPTURE_HASH_INVALID');
 if(!clock(now)||!clock(r.recorded_at_ms)||r.recorded_at_ms>now)throw Error('V49_CAPTURE_CLOCK_INVALID');
 if(r.baseline_model_digest!==baselineDigest)throw Error('V49_CAPTURE_MODEL_MISMATCH');
 if(!/^[a-f0-9]{40}$/.test(r.source_commit||'')||!/^[a-f0-9]{64}$/.test(r.source_packet_sha256||'')||!Array.isArray(r.events)
  ||r.orders_sent!==false||r.telegram_sent!==false||r.auto_promotion!==false||r.clock_scope!=='ACTUAL_SOURCE_SIDE_RESEARCH_DECISION')throw Error('V49_CAPTURE_ENVELOPE_INVALID');
 const a=r.admission;
 if(!a||a.accepted!==r.events.length||!Number.isInteger(a.evaluated)||a.evaluated<0||!Number.isInteger(a.rejected)||a.rejected<0
  ||!Number.isInteger(a.duplicate_episodes)||a.duplicate_episodes<0||a.accepted+a.rejected+a.duplicate_episodes!==a.evaluated)throw Error('V49_CAPTURE_ACCOUNTING_INVALID');
 if(r.events.length&&(r.status!=='OBSERVED'||!clock(r.source_packet_at_ms)||r.source_packet_at_ms>r.recorded_at_ms||r.recorded_at_ms-r.source_packet_at_ms>90000))throw Error('V49_CAPTURE_EVENT_SOURCE_INVALID');
 const ids=new Set();
 for(const e of r.events){
  const short=e.direction==='SHORT',id=`${e.venue}:${e.symbol}:${e.direction}:${Math.floor(e.issued_at_ms/1800000)}`;
  const risk=e.barriers_locked===true?positive(e.risk_price)&&positive(e.target_price)&&positive(e.stop_price)
   &&e.label_source==='FROZEN_PRIOR_MARKET'&&(short?e.target_price<e.entry_price&&e.stop_price>e.entry_price:e.target_price>e.entry_price&&e.stop_price<e.entry_price):
   e.barriers_locked===false&&e.label_source==='FROZEN_QUOTE_ONLY'&&e.target_price===null&&e.stop_price===null&&e.risk_price===null;
  if(!v48ValidIdentity(e)||!v48ValidEvent(e,r.recorded_at_ms)||e.version!=='V36_FROZEN_BARRIERS_V1'||e.id!==id||ids.has(id)
   ||e.issued_at_ms!==r.recorded_at_ms||e.time_basis!=='ACTUAL_EVALUATOR_DECISION_CLOCK'
   ||e.source_observed_at_ms!==r.source_packet_at_ms||e.created_from_public_packet_at_ms!==r.source_packet_at_ms
   ||e.source_to_decision_latency_ms!==r.recorded_at_ms-r.source_packet_at_ms||e.baseline_model_digest!==baselineDigest
   ||!clock(e.source_quote_at_ms)||e.source_quote_at_ms>r.source_packet_at_ms||r.recorded_at_ms-e.source_quote_at_ms>45000
   ||!positive(e.original_bid)||!positive(e.original_ask)||e.original_ask<e.original_bid||e.entry_price!==(short?e.original_bid:e.original_ask)
   ||!risk||e.execution_verified!==false||e.entry_reference_is_live_executable!==false
   ||e.observed_hypothesis?.future_direction_proven!==false||e.observed_hypothesis?.trade_permission!==false
   ||e.direction_response?.trade_permission!==false||e.direction_response?.prediction_accuracy_proven!==false
   ||!e.outcomes||Object.keys(e.outcomes).length||!e.direction_outcomes||Object.keys(e.direction_outcomes).length)throw Error('V49_CAPTURE_EVENT_INVALID');
  ids.add(id);
 }
 return true;
}
function atomic(path,text){const tmp=path+'.'+randomUUID()+'.tmp';try{writeFileSync(tmp,text,{flag:'wx'});renameSync(tmp,path);}finally{rmSync(tmp,{force:true});}}
export function v49WriteCapture(r,directory='data'){
 v49ValidateCapture(r,r.recorded_at_ms,r.baseline_model_digest);
 const dir=join(directory,'v49_captures');mkdirSync(dir,{recursive:true});
 const path=join(dir,`${r.recorded_at_ms}-${r.id}.json.gz`),text=JSON.stringify(r),bytes=gzipSync(text,{level:9});let created=true;
 // Stage outside the published directory. A complete file becomes visible by an
 // exclusive atomic hard link; an interrupted write never leaves a partial receipt.
 const staging=join(directory,'.v49_capture_tmp');mkdirSync(staging,{recursive:true});
 const tmp=join(staging,randomUUID()+'.tmp');
 try{
  writeFileSync(tmp,bytes,{flag:'wx'});
  try{linkSync(tmp,path);}catch(e){
   if(e.code!=='EEXIST')throw e;
   try{if(gunzipSync(readFileSync(path)).toString('utf8')!==text)throw Error('different');}catch{throw Error('V49_IMMUTABLE_CAPTURE_CONFLICT');}
   created=false;
  }
 }finally{rmSync(tmp,{force:true});}
 atomic(join(directory,'v49_capture_latest.json'),JSON.stringify({version:V49_CAPTURE_VERSION,id:r.id,recorded_at_ms:r.recorded_at_ms,
  source_packet_at_ms:r.source_packet_at_ms,source_commit:r.source_commit,status:r.status,admission:r.admission,
  source_to_decision_latency_ms:clock(r.source_packet_at_ms)?r.recorded_at_ms-r.source_packet_at_ms:null,
  receipt_file:`v49_captures/${r.recorded_at_ms}-${r.id}.json.gz`,orders_sent:false,telegram_sent:false,auto_promotion:false}));
 return {path,created,id:r.id};
}
function main(){
 const packet=JSON.parse(readFileSync('data/v30_direction_latest.json','utf8'));
 const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 const baselineDigest=process.env.V36_BASELINE_DIGEST||'baea9920208c677a338827a451cd8e0e5bf8a45d0600f84812b33aa743b4d9b9';
 const now=Date.now(),receipt=v49CreateCapture({packet,now,baselineDigest,sourceCommit});
 v49WriteCapture(receipt);
 console.log('V49_FRESH_CAPTURE',JSON.stringify({id:receipt.id,recorded_at_ms:now,source_packet_at_ms:packet.at_ms,
  source_to_decision_latency_ms:now-packet.at_ms,admission:receipt.admission,orders_sent:false,telegram_sent:false}));
 // Caller isolates this research step from the successful live producer/quote transport.
 if(receipt.status!=='OBSERVED'||['BLOCKED_QUOTE_FRESHNESS','CANDIDATES_REJECTED'].includes(receipt.admission.health))process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)try{main();}catch(e){console.error('V49_CAPTURE_FAILED',String(e?.message||e));process.exitCode=1;}
