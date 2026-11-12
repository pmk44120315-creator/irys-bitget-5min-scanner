/** Fail-closed state IO and append-only evidence preservation for research jobs only. */
import {readFileSync,writeFileSync,renameSync,rmSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';import {createHash,randomUUID} from 'node:crypto';
import {v48ArchiveSnapshot} from './v48_evidence_archive.mjs';
const names={v37:['v37_early_state.json','v37_early_latest.json'],v36:['v36_shadow_state.json','v36_shadow_latest.json']};
export function v48LoadState(path){
 let text;try{text=readFileSync(path,'utf8');}catch(e){if(e.code==='ENOENT')return {events:[]};throw e;}
 let s;try{s=JSON.parse(text);}catch{throw Error('V48_EXISTING_STATE_JSON_INVALID');}
 if(!s||typeof s!=='object'||Array.isArray(s)||!Array.isArray(s.events))throw Error('V48_EXISTING_STATE_SCHEMA_INVALID');
 return s;
}
export function v48PublishResearch({directory='data',kind,old={events:[]},state,output,now,evicted=[]}={}){
 if(!names[kind]||!Number.isSafeInteger(now)||!Array.isArray(old.events)||!Array.isArray(state?.events)||!Array.isArray(evicted))throw Error('V48_PUBLICATION_STATE_INPUT');
 if(output?.orders_sent!==false||output?.telegram_sent!==false)throw Error('V48_RESEARCH_SIDE_EFFECT_CLAIM');
 const archive=v48ArchiveSnapshot(join(directory,kind+'_archive'),[...old.events,...evicted,...state.events],{now,kind});
 const revision=createHash('sha256').update(JSON.stringify({kind,now,state,output})).digest('hex');
 const publication={revision,at_ms:now,version:'V48_HASH_BOUND_RESEARCH_PUBLICATION_V1'};
 const nextState={...structuredClone(state),publication},stateText=JSON.stringify(nextState);
 const nextOutput={...structuredClone(output),publication,archive,state_sha256:createHash('sha256').update(stateText).digest('hex')};
 mkdirSync(directory,{recursive:true});
 for(const [name,text] of [[names[kind][0],stateText],[names[kind][1],JSON.stringify(nextOutput)]]){
  const tmp=join(directory,'.'+name+'.'+randomUUID()+'.tmp');try{writeFileSync(tmp,text,{flag:'wx'});renameSync(tmp,join(directory,name));}finally{rmSync(tmp,{force:true});}
 }
 return {state:nextState,output:nextOutput,archive};
}
