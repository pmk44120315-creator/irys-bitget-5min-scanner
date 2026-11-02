import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {spawnSync} from 'node:child_process';
const root=new URL('../',import.meta.url);
function run(mode){
 const dir=mkdtempSync(join(tmpdir(),'v27-release-test-'));mkdirSync(join(dir,'deployment'));
 for(const p of ['release_v27_guarded.mjs','v27_response.mjs','IRYS_V27_RESPONSE_WORKER.mjs'])copyFileSync(new URL('deployment/'+p,root),join(dir,'deployment',p));
 copyFileSync(process.env.V27_BASE_WORKER||'/mnt/data/v27_receipts/live_worker.mjs',join(dir,'original.mjs'));
 const mock=`import {readFileSync,writeFileSync} from 'node:fs';
 const old=readFileSync('original.mjs');let active=old,puts=0,badConfig=false;
 const needed=['AI','IRYS_KV','TELEGRAM_BOT_TOKEN','TELEGRAM_CHAT_ID','GITHUB_DISPATCH_TOKEN'];
 const json=x=>new Response(JSON.stringify(x),{headers:{'content-type':'application/json'}});
 process.on('exit',()=>writeFileSync('calls.json',JSON.stringify({puts,original_restored:Buffer.compare(Buffer.from(active),old)===0})));
 globalThis.fetch=async(url,opts={})=>{
  const u=String(url),now=Date.now();
  if(u.includes('/workers/scripts/')){
   if(u.endsWith('/content')&&opts.method==='PUT'){active=Buffer.from(await opts.body.get('worker.js').arrayBuffer());puts++;return json({success:true});}
   if(u.endsWith('/settings')){
    let b=needed.map(name=>({name,type:'test'}));
    if(process.env.TEST_MODE==='rollback'&&puts===1&&!badConfig){b=b.slice(1);badConfig=true;}
    return json({success:true,result:{bindings:b}});
   }
   if(u.endsWith('/schedules'))return json({success:true,result:[{cron:'*/5 * * * *'}]});
   if(process.env.TEST_MODE==='lease'&&!puts)return new Response('different-source');
   return new Response(active,{headers:{'content-type':'application/javascript'}});
  }
  if(u.includes('workers.dev'))return json({kvConfigured:true,telegramSecretConfigured:true,githubDispatchConfigured:true,workersAIConfigured:true,last:{status:'PASS',time:'mock prior tick',codeVersion:'old'}});
  if(u.includes('raw.githubusercontent.com'))return json({version:'IRYS_V27_EXECUTABLE_RESPONSE_V1',at_ms:now-1000,parent_at_ms:now-2000,source:{at_ms:now-2000,candidates:[{baseline_price:1}]},quotes:Object.fromEntries(Array.from({length:120},(_,i)=>['T'+i,[1,1.01,now,1]])),responses:{},orders_sent:false,telegram_sent:false});
  if(u.includes('/v1/orderbook'))return json(['KRW-ETH','KRW-BTC'].map(market=>({market,timestamp:now,orderbook_units:[{bid_price:100,ask_price:101}]})));
  if(u.includes('/v1/trades/ticks'))return json(Array.from({length:4},(_,i)=>({sequential_id:i,timestamp:now-10000+i*1000,trade_price:100+i,trade_volume:1,ask_bid:'BID'})));
  throw Error('UNEXPECTED_NETWORK_'+u);
 };
 `;
 writeFileSync(join(dir,'mock.mjs'),mock);
 const p=spawnSync(process.execPath,['--import',join(dir,'mock.mjs'),'deployment/release_v27_guarded.mjs'],{cwd:dir,encoding:'utf8',env:{...process.env,TEST_MODE:mode,CF_ACCOUNT:'a'.repeat(32),CF_TOKEN:'MOCK_ONLY_NOT_A_REAL_TOKEN',GITHUB_REF:'refs/heads/deploy/irys-v27-reviewed-worker-20261102'}});
 const calls=JSON.parse(readFileSync(join(dir,'calls.json'),'utf8'));
 let receipt=null;try{receipt=JSON.parse(readFileSync(join(dir,'v27_deployment_receipt/deployment.json'),'utf8'));}catch{}
 rmSync(dir,{recursive:true,force:true});return {...p,calls,receipt};
}
test('guarded deploy uploads exact tested code once and never asserts natural runtime or future accuracy',()=>{
 const x=run('success');assert.equal(x.status,0,x.stderr);assert.equal(x.calls.puts,1);assert.equal(x.receipt.predictive_accuracy_improvement_proven,false);assert.equal(x.receipt.natural_v27_tick_verified,false);
});
test('guarded deploy refuses unexpected production hash without any write',()=>{
 const x=run('lease');assert.notEqual(x.status,0);assert.equal(x.calls.puts,0);assert.equal(x.calls.original_restored,true);
});
test('guarded deploy rolls back exact old source on post-upload binding discrepancy',()=>{
 const x=run('rollback');assert.notEqual(x.status,0);assert.equal(x.calls.puts,2);assert.equal(x.calls.original_restored,true);assert.match(x.stderr,/ROLLBACK_VERIFIED/);
});
