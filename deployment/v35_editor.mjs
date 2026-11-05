/** Edits only an internally authorized original signal. Never sends a new message. */
import {v35ConsumeEditPermit} from './v35_lifecycle.mjs';
async function v35EditOwnSignal(env,permit,request=fetch){
 if(!v35ConsumeEditPermit(permit))throw Error('V35_EDIT_PERMIT_REQUIRED');
 if(!env?.TELEGRAM_BOT_TOKEN||!env?.TELEGRAM_CHAT_ID)throw Error('V35_EDITOR_NOT_CONFIGURED');
 const response=await request('https://api.telegram.org/bot'+env.TELEGRAM_BOT_TOKEN+'/editMessageText',{
  method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:env.TELEGRAM_CHAT_ID,message_id:permit.message_id,text:permit.text}),signal:AbortSignal.timeout(12000)});
 let result;try{result=await response.json()}catch{throw Error('V35_EDIT_RESPONSE_INVALID')}
 if(response.ok&&result.ok===true&&result.result?.message_id===permit.message_id&&String(result.result?.chat?.id)===String(env.TELEGRAM_CHAT_ID))return {verified:true};
 if(result.error_code===400&&typeof result.description==='string'&&/message is not modified/i.test(result.description))return {verified:true,already_applied:true};
 throw Error('V35_EDIT_NOT_VERIFIED');
}
export {v35EditOwnSignal};
