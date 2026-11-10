"""Apply the reviewed minimal V47 collector delta to exact existing source."""
from pathlib import Path
import hashlib,json
ROOT=Path(__file__).resolve().parents[2]
EXPECTED={'deployment/v43_stream_runner.mjs':'239d849b48856ece5209515affddcae0df2b8ec7','deployment/v43_publish_snapshot.mjs':'fc1de7b4751e8791a02e32b9abbd79974193269c'}
for name,sha in EXPECTED.items():
 b=(ROOT/name).read_bytes();actual=hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()
 if actual!=sha:raise ValueError('BASE_SOURCE_CHANGED: '+name)
def change(name,pairs):
 p=ROOT/name;s=p.read_text()
 for a,b in pairs:
  if s.count(a)!=1:raise ValueError('PATCH_ANCHOR: '+name+' '+a[:60])
  s=s.replace(a,b,1)
 p.write_text(s)
change('deployment/v43_stream_runner.mjs',[
("import {assessDirectionAndEntry} from './v43_direction_entry.mjs';","import {assessDirectionAndEntry} from './v43_direction_entry.mjs';\nimport {WatchEpochs} from './v47_stream_integrity.mjs';"),
('tracker=new QuoteOutcomeTracker(old),core=new StreamState();','tracker=new QuoteOutcomeTracker(old),core=new StreamState(),epochs=new WatchEpochs();'),
('previous_session_end_ms:prior?.ended_at_ms??null,inter_session_gap_ms:prior?.ended_at_ms?Math.max(0,start-prior.ended_at_ms):null,','previous_session_end_ms:prior?.ended_at_ms??null,inter_session_gap_ms:null,\n  publication_reference_age_ms:prior?.ended_at_ms?Math.max(0,start-prior.ended_at_ms):null,\n  inter_session_gap_verified:false,collector_revision:"V47_RECEIVE_EPOCH_COVERAGE",'),
('source_errors:{},frame_errors:{},watch_changes:0,','source_errors:{},frame_errors:{},transition_discards:{},watch_changes:0,'),
('const received=Date.now();c.last_receive_ms=received;','const received=Date.now(),receivedWatch=epochs.capture(venue);c.last_receive_ms=received;'),
("info.normalized_events++;if(!(watch[venue]||[]).includes(e.symbol)){count(info.frame_errors,venue+':UNWATCHED_IDENTITY');continue;}","info.normalized_events++;const membership=epochs.classify(venue,e.symbol,received,receivedWatch);\n     if(!membership.accept){count(membership.error?info.frame_errors:info.transition_discards,venue+':'+membership.reason);continue;}"),
("if(e.kind==='book'){info.quotes_observed++;tracker.observe(","if(e.kind==='book'){info.quotes_observed++;record.first_book_received_ms??=received;record.last_book_received_ms=received;tracker.observe("),
("for(const v of ['bitget','bithumb'])for(const symbol of watch[v]||[])","for(const v of ['bitget','bithumb'])epochs.replace(v,next[v],at);\n    for(const v of ['bitget','bithumb'])for(const symbol of watch[v]||[])"),
("info.ended_at_ms=Date.now();info.stop_reason??=", "info.ended_at_ms=Date.now();for(const c of info.connections)if(c.closed_at_ms===null){c.closed_at_ms=info.ended_at_ms;c.reason='SESSION_SHUTDOWN';}\n info.stop_reason??=")])
change('deployment/v43_publish_snapshot.mjs',[
("import {readFileSync,writeFileSync,mkdirSync,renameSync} from 'node:fs';","import {readFileSync,writeFileSync,mkdirSync,renameSync,readdirSync} from 'node:fs';"),
("import {mergeQuoteLedgers} from './v43_collection_state.mjs';","import {mergeQuoteLedgers} from './v43_collection_state.mjs';\nimport {summarizeSessions} from './v47_stream_integrity.mjs';"),
("const merged=mergeQuoteLedgers(oldQuotes,q);","const merged=mergeQuoteLedgers(oldQuotes,q);\n const historical=[];try{for(const n of readdirSync(join(data,'v43_sessions'))){if(!/^[A-Za-z0-9_-]+\\.json$/.test(n))continue;const x=read(join(data,'v43_sessions',n));if(x.ended_at_ms>=s.ended_at_ms-86400000&&x.session!==s.session)historical.push(x);}}catch(e){if(e.code!=='ENOENT')throw e;}\n const coverage=summarizeSessions([...historical,s]);\n const preceding=historical.filter(x=>x.started_at_ms<s.started_at_ms);\n const predecessorEnd=preceding.length?Math.max(...preceding.map(x=>x.ended_at_ms)):null;\n l.coverage_v47={...coverage,publication_predecessor_gap_ms:predecessorEnd===null?null:Math.max(0,s.started_at_ms-predecessorEnd),\n  current_session_overlap_ms:predecessorEnd===null?null:Math.max(0,predecessorEnd-s.started_at_ms),\n  publication_cutoff_ms:s.ended_at_ms,complete_data_history_verified:false};")])
# Production timing and its explicit test contract change together.
workflow=ROOT/'.github/workflows/v43-observation.yml'
if '--duration-ms 300000' in workflow.read_text():
 change('.github/workflows/v43-observation.yml',[('--duration-ms 300000','--duration-ms 360000')])
else:
 assert '--duration-ms 360000' in workflow.read_text(),'WORKFLOW_DURATION_CONTRACT'
change('verification/workflows/test_v43_observation_workflow.py',[('--duration-ms 300000','--duration-ms 360000')])
p=ROOT/'.github/v43_source_lease.json';lease=json.loads(p.read_text())
for name in [*EXPECTED,'deployment/v47_stream_integrity.mjs','tests/test_v47_stream_integrity.mjs','.github/workflows/v43-observation.yml','verification/workflows/test_v43_observation_workflow.py']:
 b=(ROOT/name).read_bytes();lease[name]=hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()
p.write_text(json.dumps(lease,indent=2)+'\n')
print('V47_PATCH_APPLIED')
