import test from 'node:test';import assert from 'node:assert/strict';import {existsSync,readFileSync} from 'node:fs';
const url=new URL('../deployment/release_v421_guarded.mjs',import.meta.url);
const old=()=>readFileSync(new URL('../deployment/IRYS_V42_DISPATCH_WORKER.mjs',import.meta.url));
const candidate=()=>readFileSync(new URL('../deployment/IRYS_V421_DISPATCH_WORKER.mjs',import.meta.url));
async function execute(mode){
 assert(existsSync(url),'V42 source-lease deployment guard must exist');const m=await import(url);
 let current=old(),puts=0,broken=false;const saved={};
 const settings=()=>({bindings:['AI','IRYS_KV','TELEGRAM_BOT_TOKEN','TELEGRAM_CHAT_ID','GITHUB_DISPATCH_TOKEN'].map(name=>({name,type:'MOCK'})),schedules:[{cron:'*/5 * * * *'}]});
 const io={source:async()=>mode==='lease'&&!puts?Buffer.from('external'):current,
  config:async()=>{const c=settings();if(mode==='config'&&puts===1&&!broken){broken=true;c.bindings.pop()}return c},
  health:async()=>({kvConfigured:true,telegramSecretConfigured:true,githubDispatchConfigured:true,workersAIConfigured:true,marketNotificationsEnabled:true,marketRiskWarningsEnabled:true,
    trustedRunnerDispatchQuoteEnabled:puts>0,dispatchQuoteRevalidationEnabled:puts>0&&mode!=='flag',completeAckEvidenceEnabled:puts>0,
    last:{status:mode==='unhealthy'?'ERROR':'PASS'}}),
  feed:async()=>({version:'IRYS_V30_PUBLIC_PAIRED_DIRECTION_V1',model_digest:mode==='old-model'?'OLD':m.MODEL,at_ms:1000000,orders_sent:false,telegram_sent:false,timing:{history_reads_in_live_path:false},followups:[],summary:{listed_spot:488,listed_futures:475,selected:12,evaluated:12,unreviewed:0}}),
  transport:async()=>({version:'V421_OFFICIAL_POST_PUBLICATION_QUOTES_V1',source_model_digest:m.MODEL,quote_count:12,errors:0,source_verified:true}),
  upload:async b=>{current=Buffer.from(b);puts++},save:(k,v)=>saved[k]=v,clock:()=>1001000,
  natural:async()=>{if(mode==='natural')throw Error('NATURAL_TICK_NOT_VERIFIED');return {code_version:m.VERSION,status:'PASS',dispatch_version:'V42_DISPATCH_QUOTE_AND_COMPLETE_ACK_V1',transport_version:'V421_OFFICIAL_POST_PUBLICATION_QUOTES_V1',retained_ack_records:69,errors:0,no_manual_scans:true};}
 };
 let result,error;try{result=await m.release(io,mode==='candidate'?Buffer.from('unreviewed'):candidate())}catch(e){error=e}
 return {result,error,puts,restored:current.equals(old()),saved};
}
test('exact code-only upgrade requires a natural scheduled tick and never claims improved forecasting',async()=>{
 const x=await execute('ok');assert.equal(x.error,undefined);assert.equal(x.puts,1);assert.equal(x.result.natural_tick_verified,true);assert.equal(x.result.forecast_accuracy_proven,false);assert.equal(x.result.orders_sent,false);
});
test('source change, bad candidate or unhealthy prior runtime prevents any live write',async()=>{
 for(const mode of ['lease','candidate','unhealthy','old-model']){const x=await execute(mode);assert(x.error,mode);assert.equal(x.puts,0,mode);}
});
test('binding drift, missing upgrade flags or unverified natural tick rolls back exactly',async()=>{
 for(const mode of ['config','flag','natural']){const x=await execute(mode);assert(x.error,mode);assert.equal(x.puts,2,mode);assert(x.restored,mode);assert.equal(x.saved['rollback.json'].restored,true);}
});
