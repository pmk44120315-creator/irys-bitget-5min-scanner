/** Consume immutable source-side decisions without re-dating them at import time. */
import {readdirSync,readFileSync} from 'node:fs';import {join} from 'node:path';import {gunzipSync} from 'node:zlib';
import {v49ValidateCapture} from './v49_capture.mjs';
const MAX_EVENTS=3000;
export function v49ReadCaptures(directory,state={}){
 let files;try{files=readdirSync(directory);}catch(e){if(e.code==='ENOENT')return [];throw e;}
 const used=new Set(state.v49_capture_ingestion?.processed_ids||[]),rows=[];
 for(const file of files.sort()){
  if(!file.endsWith('.json.gz'))continue;
  const m=/^(\d+)-([a-f0-9]{64})\.json\.gz$/.exec(file);if(!m)throw Error('V49_CAPTURE_FILENAME_INVALID');
  if(used.has(m[2]))continue;
  const r=JSON.parse(gunzipSync(readFileSync(join(directory,file))).toString('utf8'));
  if(r.id!==m[2]||String(r.recorded_at_ms)!==m[1])throw Error('V49_CAPTURE_FILENAME_MISMATCH');rows.push(r);
 }
 return rows;
}
export function v49IngestCaptures(old={},receipts=[],now,baselineDigest){
 if(!Number.isSafeInteger(now)||now<0||!Array.isArray(receipts)||old.events!==undefined&&!Array.isArray(old.events))throw Error('V49_INGEST_INPUT');
 // Validate the entire input before changing even the working clone.
 for(const r of receipts)v49ValidateCapture(r,now,baselineDigest);
 const state=structuredClone(old),used=new Set(state.v49_capture_ingestion?.processed_ids||[]),events=[],existing=new Set((state.events||[]).map(e=>e.id));
 state.events??=[];
 const report={version:'V49_DELAYED_CAPTURE_IMPORT_V1',received:receipts.length,consumed:0,already_consumed:0,admitted:0,duplicate_episodes:0,
  capture_health:{},latest_capture_health:null,latest_capture_at_ms:null,max_capture_to_import_ms:null,actual_execution_verified:false,orders_sent:false,telegram_sent:false};
 for(const r of [...receipts].sort((a,b)=>a.recorded_at_ms-b.recorded_at_ms||a.id.localeCompare(b.id))){
  if(used.has(r.id)){report.already_consumed++;continue;}
  report.capture_health[r.admission.health]=(report.capture_health[r.admission.health]||0)+1;
  report.latest_capture_health=r.admission.health;report.latest_capture_at_ms=r.recorded_at_ms;
  report.max_capture_to_import_ms=Math.max(report.max_capture_to_import_ms??0,now-r.recorded_at_ms);
  for(const frozen of r.events){
   if(existing.has(frozen.id)){report.duplicate_episodes++;continue;}
   const e={...structuredClone(frozen),capture_receipt_id:r.id,capture_source_commit:r.source_commit,
    source_packet_sha256:r.source_packet_sha256,capture_imported_at_ms:now,capture_to_import_latency_ms:now-r.recorded_at_ms};
   state.events.push(e);events.push(e);existing.add(e.id);
  }
  used.add(r.id);report.consumed++;
  if(Number.isSafeInteger(r.source_packet_at_ms))state.last_asof_ms=Math.max(state.last_asof_ms||0,r.source_packet_at_ms);
 }
 state.events.sort((a,b)=>a.issued_at_ms-b.issued_at_ms||String(a.id).localeCompare(String(b.id)));
 const evicted=state.events.splice(0,Math.max(0,state.events.length-MAX_EVENTS));
 state.v49_capture_ingestion={version:report.version,processed_ids:[...used].sort(),last_import_at_ms:now};
 report.admitted=events.length;return {state,events,evicted,report};
}
