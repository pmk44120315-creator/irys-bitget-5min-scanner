import {writeFileSync,mkdirSync} from 'node:fs';
import {createHash,randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
const account=process.env.CF_ACCOUNT,token=process.env.CF_TOKEN;
assert(/^[a-f0-9]{32}$/.test(account)&&token.length>20,'AUTH_MISSING');
const api='https://api.cloudflare.com/client/v4/accounts/'+account+'/workers/scripts/irys-surge-monitor';
const publicURL='https://irys-surge-monitor.vhehwpfl.workers.dev';
const oldHash='d1a46e867b57d5bce542d46abbbc3b7c9ceeda762700e12dd18b56ee89ba02c7';
const auth={authorization:'Bearer '+token};
const sha=x=>createHash('sha256').update(x).digest('hex');
mkdirSync('v27_packet',{recursive:true});
const save=(n,x)=>writeFileSync('v27_packet/'+n,JSON.stringify(x,null,2));
async function fetchSafe(url,opts={}){return fetch(url,{...opts,signal:AbortSignal.timeout(35000)});}
async function readSource(){
 const r=await fetchSafe(api,{headers:auth});assert(r.ok,'SOURCE_READ_'+r.status);
 if((r.headers.get('content-type')||'').startsWith('multipart/')){
  const f=await r.formData(),m=f.get('metadata');const meta=m?JSON.parse(typeof m==='string'?m:await m.text()):{};
  const p=f.get(meta.main_module||meta.body_part||'worker.js');assert(p,'MISSING_SOURCE_PART');
  return Buffer.from(typeof p==='string'?p:await p.arrayBuffer());
 }
 return Buffer.from(await r.arrayBuffer());
}
async function config(){
 const results=await Promise.all(['/settings','/schedules'].map(async path=>{
  const r=await fetchSafe(api+path,{headers:auth});assert(r.ok,'CONFIG_READ_'+r.status);const j=await r.json();assert(j.success,'CONFIG_FAILURE');return j.result;
 }));
 return {bindings:results[0].bindings,schedules:results[1]};
}
async function upload(buf){
 const form=new FormData();form.set('metadata',JSON.stringify({main_module:'worker.js'}));
 form.set('worker.js',new Blob([buf],{type:'application/javascript+module'}),'worker.js');
 const r=await fetchSafe(api+'/content',{method:'PUT',headers:auth,body:form});
 const j=await r.json();assert(r.ok&&j.success,'SOURCE_UPLOAD_'+r.status);
}
const original=await readSource();assert.equal(sha(original),oldHash,'PRODUCTION_SOURCE_LEASE_MISMATCH');
const settings=await config();writeFileSync('v27_packet/live_worker.mjs',original);
const nonce=randomBytes(32).toString('hex');
const marker='V27_READONLY_AUDIT_'+process.env.GITHUB_RUN_ID;
const helper=`async function __v27ReadOnlyAudit(request,env){
 if(request.headers.get('authorization')!==${JSON.stringify('Bearer '+nonce)})return new Response('Not found',{status:404});
 const u=new URL(request.url),prefix='irys:fast:delivery-receipt:v12:';let data;
 if(u.pathname==='/__v27_audit/state'){
  const s=JSON.parse(await env.IRYS_KV.get('irys:fast:state:v1')||'{}');
  data={inventory:Object.fromEntries(Object.entries(s).map(([k,v])=>[k,{type:typeof v,length:Array.isArray(v)?v.length:undefined}])),market:Object.fromEntries(Object.entries(s).filter(([k])=>/receipt|outcome|v23scout|v21last|acknowledgement/i.test(k)||k==='last'))};
 }else if(u.pathname==='/__v27_audit/keys'){
  data=await env.IRYS_KV.list({prefix,limit:1000,...(u.searchParams.get('cursor')?{cursor:u.searchParams.get('cursor')}:{})});
 }else if(u.pathname==='/__v27_audit/values'&&request.method==='POST'){
  const keys=(await request.json()).keys;
  if(!Array.isArray(keys)||keys.length>20||keys.some(k=>typeof k!=='string'||!k.startsWith(prefix)))return new Response('Invalid',{status:400});
  data=await Promise.all(keys.map(async k=>({event_key:k,event_ms:Number(k.split(':').at(-1)),value:JSON.parse(await env.IRYS_KV.get(k)||'null')})));
 }else return new Response('Not found',{status:404});
 return new Response(JSON.stringify({marker:${JSON.stringify(marker)},data},(k,v)=>/secret|token|chat_id|account_id|email|authorization/i.test(k)?undefined:v),{headers:{'content-type':'application/json','cache-control':'no-store'}});
}
`;
const needle='  async fetch(_request,env){';
const text=original.toString('utf8');assert.equal(text.split(needle).length,2,'FETCH_ANCHOR_COUNT');
const patched=helper+text.replace(needle,needle+'\n    if(new URL(_request.url).pathname.startsWith("/__v27_audit/"))return __v27ReadOnlyAudit(_request,env);');
assert.equal(patched.split('  async scheduled(_controller,env){')[1],text.split('  async scheduled(_controller,env){')[1],'SCHEDULED_BODY_CHANGED');
assert(!helper.includes('.put(')&&!helper.includes('sendMessage')&&!helper.includes('scheduled('),'AUDIT_MUST_BE_READONLY');
const candidateHash=sha(patched);
// Run real patched module with a fake KV before any live upload.
const mod=await import('data:text/javascript;base64,'+Buffer.from(patched).toString('base64'));
let reads=0;const env={IRYS_KV:{get:async()=>{reads++;return '{"last":{},"chat_id":"DO_NOT_EXPORT"}'},list:async()=>({keys:[],list_complete:true})}};
assert.equal((await mod.default.fetch(new Request(publicURL+'/__v27_audit/state'),env)).status,404);assert.equal(reads,0);
const ok=await mod.default.fetch(new Request(publicURL+'/__v27_audit/state',{headers:{authorization:'Bearer '+nonce}}),env);
assert.equal(ok.status,200);assert.equal(reads,1);assert(!(await ok.text()).includes('DO_NOT_EXPORT'));
let uploaded=false,restored=false;let receiptCount=0;
try{
 assert.equal(sha(await readSource()),oldHash,'SOURCE_CHANGED_BEFORE_AUDIT');
 uploaded=true;await upload(patched);assert.equal(sha(await readSource()),candidateHash,'AUDIT_SOURCE_NOT_ACTIVE');
 assert.deepEqual(await config(),settings,'ORIGINAL_BINDINGS_OR_CRON_CHANGED');
 async function read(path,opts={}){
  const r=await fetchSafe(publicURL+'/__v27_audit/'+path,{...opts,headers:{authorization:'Bearer '+nonce,'content-type':'application/json'}});
  assert(r.ok,'AUDIT_READ_'+r.status);const j=await r.json();assert.equal(j.marker,marker,'AUDIT_MARKER_MISMATCH');return j.data;
 }
 const state=await read('state');save('state_market_only.json',state.market);save('state_inventory.json',state.inventory);
 let cursor=null;const keys=[],seen=new Set();
 do{
  const p=await read('keys'+(cursor?'?cursor='+encodeURIComponent(cursor):''));keys.push(...p.keys.map(k=>k.name));
  if(p.list_complete){cursor=null;break}
  cursor=p.cursor;assert(cursor&&!seen.has(cursor),'CURSOR_INVALID');seen.add(cursor);
 }while(cursor);
 const receipts=[];
 for(let i=0;i<keys.length;i+=20){
  const batch=await read('values',{method:'POST',body:JSON.stringify({keys:keys.slice(i,i+20)})});
  for(const r of batch)if(r.value)receipts.push({...r.value,event_ms:r.event_ms,event_key:r.event_key});
 }
 receipts.sort((a,b)=>a.event_ms-b.event_ms);receiptCount=receipts.length;
 save('telegram_receipts.json',{read_at_ms:Date.now(),keys_listed:keys.length,count:receipts.length,pagination_exhausted:true,receipts});
 console.log('V27_RECEIPTS_READ',JSON.stringify({count:receiptCount,keys_listed:keys.length,channels:[...new Set(receipts.map(x=>x.channel))],last:receipts.slice(-30)}));
}finally{
 const active=await readSource();
 if(sha(active)===candidateHash){await upload(original);}
 else assert.equal(sha(active),oldHash,'CONCURRENT_EXTERNAL_SOURCE_CHANGE_NO_OVERWRITE');
 assert.equal(sha(await readSource()),oldHash,'ORIGINAL_RESTORE_UNVERIFIED');restored=true;
 assert.deepEqual(await config(),settings,'ORIGINAL_CONFIG_RESTORE_UNVERIFIED');
 save('source_receipt.json',{original_sha256:oldHash,temporary_audit_installed:uploaded,original_restored:restored,receipt_count:receiptCount,scheduled_body_unchanged:true,no_test_messages_or_orders:true});
 console.log('V27_AUDIT_RESTORED',JSON.stringify({original_sha256:oldHash,original_restored:restored,receipt_count:receiptCount}));
}
