/** Runs AFTER live packet publication. Historical provider delay cannot hold new signals. */
import {readFileSync,writeFileSync,renameSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {v31FetchHistory} from './v31_outcomes.mjs';
import {publicReader} from './v30_producer.mjs';
async function v35History(records,previous,read,clock=Date.now){
 const result=await v31FetchHistory(records,read,clock,previous?.version==='V35_NATIVE_HISTORY_CACHE_V1'&&Array.isArray(previous.pages)?previous.pages:[]);
 return {version:'V35_NATIVE_HISTORY_CACHE_V1',at_ms:clock(),pages:result.pages,errors:result.errors,source:'OFFICIAL_NATIVE_1M',live_packet_blocked:false,telegram_sent:false,orders_sent:false};
}
async function main(){
 const json=(p)=>{try{return JSON.parse(readFileSync(p,'utf8'))}catch{return {}}};
 const state=json('data/v30_state.json'),prior=json('data/v35_outcome_history.json');
 const r=await v35History(state.records||[],prior,publicReader());
 writeFileSync('data/.v35_history_tmp.json',JSON.stringify(r));renameSync('data/.v35_history_tmp.json','data/v35_outcome_history.json');
 console.log('V35_POST_PUBLICATION_HISTORY',JSON.stringify({at_ms:r.at_ms,pages:r.pages.length,errors:r.errors,live_packet_blocked:false,orders_sent:false,telegram_sent:false}));
 if(r.errors.length&&r.pages.length===0)process.exitCode=2;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error('V35_HISTORY_FAILED_WITHOUT_LIVE_PACKET_MUTATION');process.exitCode=1});
export {v35History};
