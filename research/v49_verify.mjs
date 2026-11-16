/** Isolated validation: public GET data only; never commit state, deploy Workers, or message users. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,readdirSync,cpSync,existsSync} from 'node:fs';import {join,resolve} from 'node:path';
import {spawnSync,execFileSync} from 'node:child_process';import {createHash} from 'node:crypto';
import {v30Produce,v30ModelDigest,publicReader} from '../deployment/v30_producer.mjs';
import {v36Process,officialReader} from '../deployment/v36_runner.mjs';
import {v49CreateCapture,v49WriteCapture} from '../deployment/v49_capture.mjs';
import {v49ReadCaptures} from '../deployment/v49_ingest.mjs';
import {v49VerifyPriorState} from './v49_verification_input.mjs';
import {v48PublishResearch,v48LoadState} from '../deployment/v48_persistence.mjs';
import {v48ReadArchive} from '../deployment/v48_evidence_archive.mjs';
const out='v49_evidence';mkdirSync(out,{recursive:true});
const sha=x=>createHash('sha256').update(x).digest('hex');
const save=(name,obj)=>writeFileSync(join(out,name),JSON.stringify(obj,null,2));
const read=p=>JSON.parse(readFileSync(p,'utf8'));
const mode=process.argv[2];
if(mode==='regression'){
 const baseline=process.argv[3];assert(baseline,'baseline worktree is required');
 function suite(cwd,label){const files=readdirSync(join(cwd,'tests')).filter(x=>x.endsWith('.mjs')).sort().map(x=>'tests/'+x);
  const run=spawnSync(process.execPath,['--test',...files],{cwd,encoding:'utf8',maxBuffer:32*1024*1024});
  if(run.error)throw run.error;const log=run.stdout+'\n'+run.stderr;writeFileSync(join(out,label+'.log'),log);
  const failures=[...log.matchAll(/^not ok \d+ - (.+)$/gm)].map(m=>m[1].replaceAll(resolve(cwd)+'/',''));
  const count=k=>Number(new RegExp('^# '+k+' (\\d+)$','m').exec(log)?.[1]??NaN);
  return {exit_code:run.status,tests:count('tests'),pass:count('pass'),fail:count('fail'),failures};
 }
 const before=suite(baseline,'full_node_baseline'),after=suite('.', 'full_node_candidate');
 const unexpected=after.failures.filter(x=>!before.failures.includes(x));
 save('full_regression_comparison.json',{before,after,unexpected,
  whole_suite_pass:after.exit_code===0,scope:after.exit_code===0?'FULL_PASS':'INHERITED_HISTORICAL_FIXTURE_FAILURES_NOT_A_FULL_PASS'});
 assert(Number.isFinite(before.tests)&&Number.isFinite(after.tests),'both suites must really execute');
 assert.equal(unexpected.length,0,'new regressions: '+unexpected.join('; '));
 console.log('V49_REGRESSION_COMPARISON',JSON.stringify({before_tests:before.tests,before_failed:before.fail,after_tests:after.tests,after_failed:after.fail,new_failures:unexpected.length,whole_suite_pass:after.exit_code===0}));
}else if(mode==='live'){
 const digest=v30ModelDigest();assert.equal(digest,'baea9920208c677a338827a451cd8e0e5bf8a45d0600f84812b33aa743b4d9b9');
 // Choose an actually published comparison baseline at least three minutes old.
 // This fixes the verification environment only; production discovery rules are unchanged.
 const cutoff=new Date(Date.now()-180000).toISOString();
 const url='https://api.github.com/repos/pmk44120315-creator/irys-bitget-5min-scanner/commits?'+new URLSearchParams({sha:'main',path:'data/v30_state.json',until:cutoff,per_page:'1'});
 const headers={accept:'application/vnd.github+json','User-Agent':'IRYS-V49-ReadOnlyVerification'};
 if(process.env.GITHUB_TOKEN)headers.authorization='Bearer '+process.env.GITHUB_TOKEN;
 const response=await fetch(url,{headers,signal:AbortSignal.timeout(15000)});assert(response.ok,'V49_VERIFY_PUBLIC_COMMIT_LOOKUP_'+response.status);
 const commits=await response.json(),inputCommit=commits?.[0]?.sha;assert(/^[a-f0-9]{40}$/.test(inputCommit||''),'V49_VERIFY_COMMIT_MISSING');
 execFileSync('git',['fetch','--quiet','--depth=1','origin',inputCommit]);
 const inputBytes=execFileSync('git',['show',inputCommit+':data/v30_state.json'],{maxBuffer:64*1024*1024});
 const previous=JSON.parse(inputBytes),inputContract=v49VerifyPriorState(previous,Date.now());
 writeFileSync(join(out,'live_input_v30_state.json'),inputBytes);
 save('live_input_provenance.json',{source_commit:inputCommit,sha256:sha(inputBytes),lookup_cutoff:cutoff,read_at_ms:Date.now(),...inputContract});
 const fresh=await v30Produce({read:publicReader(),historyMode:'cached',previous,modelDigest:digest});
 save('isolated_v30_packet.json',fresh.report);
 const capture=v49CreateCapture({packet:fresh.report,now:Date.now(),baselineDigest:digest,sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()});
 const stored=v49WriteCapture(capture,out);assert.equal(stored.id,capture.id);assert(readFileSync(stored.path).length>0);
 assert.equal(capture.status,'OBSERVED');assert(capture.events.length>0,'actual current official data must produce fresh research candidates');
 const old=read('data/v36_shadow_state.json'),before=JSON.stringify(old),history=[],reader=officialReader();
 const result=await v36Process({old,packet:fresh.report,now:Date.now(),baselineDigest:digest,captures:v49ReadCaptures(join(out,'v49_captures'),old),
  readHistory:async url=>{const raw=await reader(url);history.push({url,received_at_ms:Date.now(),raw});return raw;},maxSymbols:40});
 assert.equal(JSON.stringify(old),before,'input state mutated');
 const originals=new Map(old.events.map(e=>[e.id,e]));let preserved=0;
 for(const e of result.state.events){const p=originals.get(e.id);if(!p)continue;preserved++;
  for(const k of ['id','venue','symbol','direction','issued_at_ms','entry_price','source_observed_at_ms','source_quote_at_ms','target_price','stop_price','original_bid','original_ask'])assert.deepEqual(e[k],p[k],`frozen ${k} changed`);
  for(const [h,v]of Object.entries(p.direction_outcomes||{}))if(v.status==='MEASURED_DIRECTION')assert.deepEqual(e.direction_outcomes[h],v,'previous accepted direction outcome overwritten');
 }
 assert(result.public_output.new_events>0,'capture imported but no actual new episode; current test cannot prove recovery');
 assert.equal(result.public_output.capture_ingestion.consumed,1);assert.equal(result.public_output.operating_health.enrollment,'CAPTURE_IMPORTED');
 for(const f of ['orders_sent','telegram_sent','auto_promotion','future_accuracy_proven'])assert.equal(result.public_output[f],false);
 assert.equal(result.public_output.release_gate.promote,false);
 assert.equal(new Set(result.state.events.map(e=>e.id)).size,result.state.events.length);
 const ages=capture.events.map(e=>e.issued_at_ms-e.source_quote_at_ms);assert(ages.every(x=>x>=0&&x<=45000));
 save('history_responses.json',history);save('isolated_v36_latest.json',result.public_output);save('isolated_v36_state.json',result.state);
 // Exercise the actual persistence boundary against a private copy of original archives.
 const persistence=join(out,'persistence_check');mkdirSync(persistence,{recursive:true});
 if(existsSync('data/v36_archive'))cpSync('data/v36_archive',join(persistence,'v36_archive'),{recursive:true});
 const preservedArchive=existsSync('data/v36_archive')?Object.fromEntries(readdirSync('data/v36_archive').filter(n=>n.endsWith('.jsonl')).map(n=>[n,readFileSync(join('data/v36_archive',n),'utf8')])):{};
 const published=v48PublishResearch({directory:persistence,kind:'v36',old,state:result.state,output:result.public_output,now:Date.now(),evicted:result.evicted});
 const publishedBytes=readFileSync(join(persistence,'v36_shadow_state.json'));assert.equal(sha(publishedBytes),published.output.state_sha256);
 const loaded=v48LoadState(join(persistence,'v36_shadow_state.json'));assert.equal(loaded.publication.revision,published.output.publication.revision);
 for(const [name,bytes]of Object.entries(preservedArchive))assert(readFileSync(join(persistence,'v36_archive',name),'utf8').startsWith(bytes),'historical archive rewritten');
 const archived=v48ReadArchive(join(persistence,'v36_archive'));assert(archived.unique_events>=old.events.length);
 save('publication_verification.json',{state_hash_verified:true,revision_verified:true,prior_archive_bytes_preserved:true,archive_revisions:archived.revisions,archived_unique_events:archived.unique_events,production_state_unchanged:true});
 const report={source_commit:capture.source_commit,verification_input_commit:inputCommit,verification_input_contract:inputContract,baseline_model_digest:digest,decision_at_ms:capture.recorded_at_ms,
  source_packet_at_ms:capture.source_packet_at_ms,source_to_decision_ms:capture.recorded_at_ms-capture.source_packet_at_ms,
  captured_candidates:capture.events.length,imported_new_candidates:result.public_output.new_events,retained_originals_preserved:preserved,
  evicted_originals_archivable:result.evicted.length,max_quote_age_ms:Math.max(...ages),min_quote_age_ms:Math.min(...ages),
  history_pages:result.public_output.successful_native_histories,history_errors:result.public_output.source_errors,
  recovery:result.public_output.recovery,new_cohorts:Object.fromEntries(['bithumb:BUY','bitget:LONG','bitget:SHORT'].map(k=>[k,capture.events.filter(e=>e.venue+':'+e.direction===k).length])),
  input_state_sha256:sha(before),input_state_unchanged:true,existing_measured_outcomes_unchanged:true,publication_hash_and_archive_verified:true,
  official_public_data_used:true,isolated_only:true,orders_sent:false,telegram_sent:false,production_deployed:false,performance_improvement_proven:false};
 save('live_readonly_verification.json',report);console.log('V49_LIVE_READONLY_VERIFIED',JSON.stringify(report));
}else throw Error('choose regression or live verification mode');
