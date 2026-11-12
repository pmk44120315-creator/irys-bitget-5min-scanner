/** Full available frozen cohort; all raw responses preserved. This script never publishes or sends. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';import {join} from 'node:path';import {createHash} from 'node:crypto';import {gzipSync} from 'node:zlib';
import {v48PlanHistory,v48RepairFrozen} from '../../deployment/v48_backfill.mjs';
import {v36NativeHistory,officialReader} from '../../deployment/v36_runner.mjs';
import {v48Audit,v48MatchAcks} from '../../deployment/v48_readiness_report.mjs';
const outdir=process.argv[2]||'v48_verified/backfill';mkdirSync(outdir,{recursive:true});
const statePath=process.argv[3]||'data/v37_early_state.json',state=JSON.parse(readFileSync(statePath,'utf8'));
const ackPath=process.argv[4]||'data/v42_actual_ack_evaluation.json';const rawAck=JSON.parse(readFileSync(ackPath,'utf8'));const acks=rawAck.events||rawAck.records||[];
if(!Array.isArray(state.events)||!Array.isArray(acks))throw Error('V48_FROZEN_INPUT_SCHEMA');
const now=Date.now(),requests=v48PlanHistory(state.events,now),reader=officialReader(),raw=[];
const read=async url=>{const started=Date.now();try{const body=await reader(url);const text=JSON.stringify(body);raw.push({url,request_started_at_ms:started,response_received_at_ms:Date.now(),sha256:createHash('sha256').update(text).digest('hex'),body});return body;}catch(e){raw.push({url,request_started_at_ms:started,response_received_at_ms:Date.now(),error:String(e.message)});throw e;}};
console.log('V48_FROZEN_REEVALUATION_START',JSON.stringify({cohort:state.events.length,requests:requests.length,acks:acks.length}));
const data=await v36NativeHistory(requests,read,now),repaired=v48RepairFrozen(state,data.pages,now),audit=v48Audit(repaired.events,now),matches=v48MatchAcks(repaired.events,acks,{now});
const legacy={};for(const h of [5,15,30,60]){const rows=state.events.filter(e=>e.outcomes?.[h]?.status==='MEASURED_DIRECTION');legacy[h]={measured:rows.length,positive:rows.filter(e=>e.outcomes[h].direction_positive).length};}
const report={version:'V48_FROZEN_COHORT_OFFICIAL_REEVALUATION_V1',at_ms:now,cohort_sha256:createHash('sha256').update(readFileSync(statePath)).digest('hex'),ack_sha256:createHash('sha256').update(readFileSync(ackPath)).digest('hex'),requested_windows:requests.length,returned_pages:data.pages.length,source_errors:data.errors,legacy_semantics_not_comparable:legacy,corrected:audit,actual_ack_matching:matches,all_original_decisions_preserved:true,orders_sent:false,telegram_sent:false,production_modified:false};
writeFileSync(join(outdir,'original_cohort.json.gz'),gzipSync(JSON.stringify(state)));
writeFileSync(join(outdir,'corrected_cohort.json.gz'),gzipSync(JSON.stringify(repaired)));
writeFileSync(join(outdir,'official_responses.jsonl.gz'),gzipSync(raw.map(x=>JSON.stringify(x)).join('\n')+'\n'));
writeFileSync(join(outdir,'official_pages.json.gz'),gzipSync(JSON.stringify(data)));
writeFileSync(join(outdir,'report.json'),JSON.stringify(report,null,2));
console.log('V48_FROZEN_REEVALUATION_FINISHED',JSON.stringify({requests:requests.length,pages:data.pages.length,errors:data.errors.length,measured5:audit.horizons[5].measured,missing5:audit.horizons[5].missing_due,ack_matches:matches.matched_ack_events}));
if(data.pages.length===0)throw Error('NO_OFFICIAL_HISTORY_RECOVERED');
