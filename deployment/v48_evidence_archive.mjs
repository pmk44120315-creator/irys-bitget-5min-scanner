/** Append-only public research revisions. Original decisions and prior labels remain auditable. */
import {mkdirSync,readdirSync,readFileSync,writeFileSync,renameSync,existsSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
const VERSION='V48_PUBLIC_RESEARCH_ARCHIVE_V1';
const MUTABLE=new Set(['outcomes','direction_outcomes','legacy_outcomes_v37','legacy_direction_outcomes_v36','direction_measurement_version','native_history_last_attempt_at_ms']);
function canonical(x){
 if(typeof x==='number'&&!Number.isFinite(x))throw Error('V48_ARCHIVE_NONFINITE');
 if(x===null||typeof x!=='object')return JSON.stringify(x);
 if(Array.isArray(x))return '['+x.map(v=>canonical(v)??'null').join(',')+']';
 return '{'+Object.keys(x).sort().filter(k=>x[k]!==undefined).map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}';
}
const hash=x=>createHash('sha256').update(canonical(x)).digest('hex');
function cleanEvent(e){
 if(!e||typeof e!=='object'||typeof e.id!=='string'||!e.id.length)throw Error('V48_ARCHIVE_EVENT_ID');
 canonical(e);const out=JSON.parse(JSON.stringify(e));delete out.native_history_last_attempt_at_ms;return out;
}
function immutable(e){return Object.fromEntries(Object.entries(e).filter(([k])=>!MUTABLE.has(k)));}
function load(root){
 const latest=new Map(),identities=new Map(),seen=new Map(),files=new Map();let revisions=0;
 if(!existsSync(root))return {latest,identities,seen,files,revisions};
 for(const name of readdirSync(root).filter(n=>/^\d{4}-\d\d-\d\d\.jsonl$/.test(n)).sort()){
  const text=readFileSync(join(root,name),'utf8');files.set(name,text);
  if(text&&!text.endsWith('\n'))throw Error('V48_ARCHIVE_TRUNCATED');
  for(const line of text.split('\n').filter(Boolean)){
   let row;try{row=JSON.parse(line);}catch{throw Error('V48_ARCHIVE_INVALID_JSON');}
   const e=cleanEvent(row.event),id=e.id;
   if(row.version!==VERSION||!['v36','v37'].includes(row.kind)||row.event_id!==id||row.record_sha256!==hash(e)||row.identity_sha256!==hash(immutable(e)))throw Error('V48_ARCHIVE_HASH_OR_SCHEMA_MISMATCH');
   if(identities.has(id)&&identities.get(id)!==row.identity_sha256)throw Error('V48_ARCHIVE_IMMUTABLE_CONFLICT');
   if((latest.get(id)?.record_sha256??null)!==row.previous_record_sha256)throw Error('V48_ARCHIVE_REVISION_CHAIN_BROKEN');
   const previous=seen.get(id)||new Set();if(previous.has(row.record_sha256))throw Error('V48_ARCHIVE_DUPLICATE_REVISION');
   previous.add(row.record_sha256);seen.set(id,previous);identities.set(id,row.identity_sha256);latest.set(id,row);revisions++;
  }
 }
 return {latest,identities,seen,files,revisions};
}
export function v48ReadArchive(root){const a=load(root);return {version:VERSION,events:[...a.latest.values()].map(r=>r.event),revisions:a.revisions,unique_events:a.latest.size};}
export function v48ArchiveSnapshot(root,events,{now,kind}={}){
 if(!['v36','v37'].includes(kind))throw Error('V48_ARCHIVE_KIND');
 if(!Number.isSafeInteger(now)||now<0||!Array.isArray(events))throw Error('V48_ARCHIVE_CLOCK_OR_INPUT');
 const a=load(root),writes=new Map();let appended=0;
 // Validate the entire batch before changing any existing archive file.
 for(const raw of events){
  const e=cleanEvent(raw),id=e.id;
  if(!Number.isSafeInteger(e.issued_at_ms)||e.issued_at_ms<0||e.issued_at_ms>now)throw Error('V48_ARCHIVE_EVENT_CLOCK');
  const identity=hash(immutable(e)),digest=hash(e);
  if(a.identities.has(id)&&a.identities.get(id)!==identity)throw Error('V48_ARCHIVE_IMMUTABLE_CONFLICT');
  if(a.latest.has(id)&&a.latest.get(id).kind!==kind)throw Error('V48_ARCHIVE_KIND_CONFLICT');
  if(a.seen.get(id)?.has(digest))continue;
  const row={version:VERSION,kind,event_id:id,identity_sha256:identity,record_sha256:digest,
   previous_record_sha256:a.latest.get(id)?.record_sha256??null,archived_at_ms:now,event:e};
  const name=new Date(e.issued_at_ms).toISOString().slice(0,10)+'.jsonl';
  writes.set(name,(writes.get(name)??a.files.get(name)??'')+canonical(row)+'\n');
  a.identities.set(id,identity);a.latest.set(id,row);const set=a.seen.get(id)||new Set();set.add(digest);a.seen.set(id,set);appended++;
 }
 if(writes.size)mkdirSync(root,{recursive:true});
 for(const [name,text] of writes){const tmp=join(root,'.'+name+'.'+randomUUID()+'.tmp');try{writeFileSync(tmp,text,{flag:'wx'});renameSync(tmp,join(root,name));}finally{rmSync(tmp,{force:true});}}
 return {version:VERSION,kind,appended,unique_events:a.latest.size,revisions:a.revisions+appended,
  immutable_decisions_preserved:true,prior_measurements_preserved:true,statistical_independence_proven:false};
}
