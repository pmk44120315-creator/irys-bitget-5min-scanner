/** Verify and merge a public observation session into an isolated data worktree.
 * No HTTP, trading, Telegram or production code writes. Caller owns non-force
 * Git publication and byte-for-byte remote readback.
 */
import {readFileSync,writeFileSync,mkdirSync,renameSync} from 'node:fs';
import {join,resolve} from 'node:path';import {createHash} from 'node:crypto';import {pathToFileURL} from 'node:url';
import {mergeQuoteLedgers} from './v43_collection_state.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
function read(path,missing=false){try{return JSON.parse(readFileSync(path,'utf8'))}catch(e){if(missing&&e.code==='ENOENT')return null;throw e}}
function put(path,x){writeFileSync(path+'.tmp',JSON.stringify(x,null,2)+'\n');renameSync(path+'.tmp',path);}
export function publishSnapshot({sessionDir,targetDir}){
 const source=resolve(sessionDir),target=resolve(targetDir);if(source===target)throw Error('ISOLATED_TARGET_REQUIRED');
 const s=read(join(source,'session.json')),l=read(join(source,'latest.json')),q=read(join(source,'quote_outcomes.json'));
 if(s.version!=='V43_PUBLIC_CONTINUOUS_SESSION_V1'||!['OBSERVED','OBSERVED_WITH_DIAGNOSTICS'].includes(s.status)||
  typeof s.session!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(s.session)||!Number.isSafeInteger(s.started_at_ms)||!Number.isSafeInteger(s.ended_at_ms)||
  s.ended_at_ms<s.started_at_ms||s.orders_sent!==false||s.telegram_sent!==false||s.live_alert_engine_modified!==false||
  !Number.isSafeInteger(s.frames)||s.frames<=0||!Number.isSafeInteger(s.quotes_observed)||s.quotes_observed<=0)throw Error('SESSION_NOT_VERIFIED');
 for(const [name,sha] of [['raw_frames.jsonl.gz',s.raw_sha256],['frozen_features.jsonl.gz',s.features_sha256]]){
  if(typeof sha!=='string'||!/^[a-f0-9]{64}$/.test(sha)||hash(readFileSync(join(source,name)))!==sha)throw Error('RAW_ARTIFACT_HASH_MISMATCH');
 }
 if(l.version!==s.version||l.session!==s.session||l.ended_at_ms!==s.ended_at_ms||l.started_at_ms!==s.started_at_ms||
  l.frames!==s.frames||l.raw_sha256!==s.raw_sha256||l.features_sha256!==s.features_sha256||
  l.forecast_accuracy_proven!==false||l.live_entry_enabled!==false||l.orders_sent!==false||l.telegram_sent!==false)throw Error('LATEST_OR_LIVE_CONTRACT');
 if(q.asof_ms!==s.ended_at_ms||q.orders_sent!==false||q.telegram_sent!==false||q.actual_execution_verified!==false)throw Error('SESSION_QUOTE_CONTRACT');
 const data=join(target,'data'),oldQuotes=read(join(data,'v43_actual_quote_outcomes.json'),true),oldLatest=read(join(data,'v43_stream_latest.json'),true);
 const sessionFile=join(data,'v43_sessions',s.session+'.json'),oldSession=read(sessionFile,true);
 if(oldSession&&JSON.stringify(oldSession)!==JSON.stringify(s))throw Error('IMMUTABLE_SESSION_CONFLICT');
 if(oldLatest&&(oldLatest.version!==s.version||!Number.isSafeInteger(oldLatest.ended_at_ms)||oldLatest.live_entry_enabled!==false))throw Error('EXISTING_LATEST_SCHEMA');
 const merged=mergeQuoteLedgers(oldQuotes,q);
 const latestChanged=!oldLatest||s.ended_at_ms>oldLatest.ended_at_ms||(s.ended_at_ms===oldLatest.ended_at_ms&&s.session===oldLatest.session);
 mkdirSync(join(data,'v43_sessions'),{recursive:true});
 put(join(data,'v43_actual_quote_outcomes.json'),merged);
 if(latestChanged)put(join(data,'v43_stream_latest.json'),l);
 if(!oldSession)put(sessionFile,s);
 return {version:'V43_PUBLIC_EVIDENCE_PUBLICATION_RECEIPT_V1',session:s.session,session_ended_ms:s.ended_at_ms,
  latest_changed:latestChanged,quote_summary:merged.summary,raw_sha256:s.raw_sha256,features_sha256:s.features_sha256,
  target_files:['data/v43_actual_quote_outcomes.json','data/v43_stream_latest.json','data/v43_sessions/'+s.session+'.json'],
  published_remote_verified:false,orders_sent:false,telegram_sent:false,live_model_modified:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){try{
 const args=process.argv.slice(2),val=k=>{const i=args.indexOf(k);if(i<0||!args[i+1])throw Error('MISSING_ARGUMENT_'+k);return args[i+1]};
 const s=val('--session'),t=val('--target'),r=publishSnapshot({sessionDir:s,targetDir:t});
 put(join(s,'publication_receipt.json'),r);console.log('V43_PUBLIC_EVIDENCE_PREPARED',JSON.stringify(r));
}catch(e){console.error('V43_PUBLICATION_FAILED',e.name,String(e.message).slice(0,160));process.exitCode=1}}
