"""Exact-source repair of native RSI context; no directional rule replacement."""
from pathlib import Path
import hashlib,json,sys
OLD='f78b500927f41af3412c17bd3b47c25e3d9fba9c6d156a72302c67266a2a40cd'
VERSION='IRYS-V46-NATIVE-CONTEXT-QUALITY-20261110'
raw=Path(sys.argv[1]).read_bytes();assert hashlib.sha256(raw).hexdigest()==OLD,'EXACT_DEPLOYED_V45_REQUIRED'
a=raw.decode();s=a;root=Path(__file__).resolve().parent
unit='\n'.join(x for x in (root/'v45_rsi_context.mjs').read_text().splitlines() if not x.startswith('export '))
st=s.index('/** V45: distinguish observed direction');en=s.index('const V421_VERSION=',st)
s=s[:st]+unit+'\n'+s[en:]
assert s.count('IRYS-V45-RSI-ENTRY-CONTEXT-20261109')==1;s=s.replace('IRYS-V45-RSI-ENTRY-CONTEXT-20261109',VERSION)
s=s.replace('⚠️ V45 추격 진입 주의','⚠️ V46 추격 진입 주의').replace('⚠️ V45 진입 정보 미확인','⚠️ V46 진입 정보 미확인').replace('🔎 V45 방향 관측','🔎 V46 방향 관측')
needle="rsiEntryContextEnabled:true,rsiEntryContextVersion:V45_VERSION,"
assert s.count(needle)==1;s=s.replace(needle,needle+"nativeObservedRsiDisclosureEnabled:true,")
needle="x.entry_context_v45={version:V45_VERSION,role:"
assert s.count(needle)==1;s=s.replace(needle,"x.entry_context_v45={version:V45_VERSION,source_context_revision:c.source_context_revision==='V46_SPARSE_SOURCE_DISCLOSED'?c.source_context_revision:null,role:")
needle="quote_at_ms:f.quote_at_ms,closed_end_ms:f.closed_end_ms,current_candle_closed:false};"
assert s.count(needle)==1;s=s.replace(needle,"quote_at_ms:f.quote_at_ms,closed_end_ms:f.closed_end_ms,current_candle_closed:false,series_basis:['NATIVE_OBSERVED_CANDLES','UNIFORM_CLOSED_CANDLES'].includes(f.series_basis)?f.series_basis:null,missing_interval_count:Number.isSafeInteger(f.missing_interval_count)?f.missing_interval_count:null,uniform_time_rsi_verified:f.uniform_time_rsi_verified===true,synthetic_bars:0};")
for start,end in [('function v30Qualify(','function v30FuturesCandidates('),('function v29CheckPair(','function v29DeliveryPolicy('),('function v31EntryBudget(','function v31ShouldRecord('),('async function v34WorkerReview(','const V30_PRODUCER_DIGEST='),('async function v30ReviewAndDeliver(','/** V42.1:')]:
 assert a[a.index(start):a.index(end)]==s[s.index(start):s.index(end)],start
assert a.split('  async scheduled(_controller,env){')[1]==s.split('  async scheduled(_controller,env){')[1],'SCHEDULED_HANDLER_CHANGED'
out=Path(sys.argv[2]);out.write_text(s)
m={'version':VERSION,'old_sha256':OLD,'new_sha256':hashlib.sha256(s.encode()).hexdigest(),'native_gap_metadata_preserved':True,'synthetic_gap_bars':0,'direction_risk_pacing_and_cron_unchanged':True,'forecast_accuracy_improvement_proven':False}
out.with_suffix('.manifest.json').write_text(json.dumps(m,indent=2));print('V46_EXACT_BUILD',json.dumps(m))
