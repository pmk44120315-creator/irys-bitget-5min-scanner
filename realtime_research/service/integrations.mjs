/** Public-chain subset research and one-time TEST transport. No market alerts. */
const ADDRESS=/^0x[0-9a-fA-F]{40}$/,HASH=/^0x[0-9a-fA-F]{64}$/;
const lower=x=>typeof x==='string'?x.toLowerCase():'';
function trusted(label,chain,now){return label&&String(label.chain_id)===String(chain)&&ADDRESS.test(label.address||'')&&label.status==='KNOWN_PUBLIC_LABEL'&&Number.isFinite(label.checked_at)&&label.checked_at<=now&&now-label.checked_at<=7*86400000&&Array.isArray(label.sources)&&label.sources.some(s=>/^https:\/\/(?:eth\.blockscout\.com|etherscan\.io)\//.test(s));}
export function classifyTransfer(t,labels,chain,tip,now){
  if(!t||t.removed===true||!Number.isSafeInteger(tip)||!Number.isSafeInteger(t.block_number)||tip-t.block_number<12||t.token?.type!=='ERC-20')return null;
  const at=Date.parse(t.timestamp),contract=lower(t.token?.address_hash),from=lower(t.from?.hash),to=lower(t.to?.hash),raw=t.total?.value;
  if(!Number.isFinite(at)||at>now||!ADDRESS.test(contract)||!ADDRESS.test(from)||!ADDRESS.test(to)||!HASH.test(t.transaction_hash||'')||!Number.isSafeInteger(t.log_index)||t.log_index<0||typeof raw!=='string'||!/^\d+$/.test(raw))return null;
  const allowed=labels.filter(l=>trusted(l,chain,now)),a=allowed.find(l=>lower(l.address)===from),b=allowed.find(l=>lower(l.address)===to);
  if(!a&&!b)return null;
  const direction=a&&b?(a.exchange===b.exchange?'KNOWN_INTERNAL_TRANSFER':'KNOWN_EXCHANGE_TO_EXCHANGE'):(b?'INTO_KNOWN_EXCHANGE_WALLET':'OUT_OF_KNOWN_EXCHANGE_WALLET');
  return {chain_id:String(chain),contract,transaction_hash:t.transaction_hash,block_number:t.block_number,log_index:t.log_index,timestamp_ms:at,from,to,raw_amount:raw,decimals:t.total?.decimals??t.token?.decimals??null,direction,from_exchange:a?.exchange??null,to_exchange:b?.exchange??null,label_sources:[...(a?.sources||[]),...(b?.sources||[])],confirmation_depth:tip-t.block_number,finalized_verified:false,customer_deposit_verified:false,sale_verified:false,all_exchange_coverage:false};
}
async function json(fetcher,url,init={}){const r=await fetcher(url,{...init,signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('UPSTREAM_HTTP_'+r.status);return r.json();}
export async function fetchWalletWindow(labels,now,fetcher=fetch,options={}){
  const selected=labels.filter(l=>trusted(l,'1',now)),result={status:'NO_VERIFIED_WALLETS',all_exchange_coverage:false,coverage_complete:false,scope:'CONFIGURED_ETHEREUM_ERC20_ADDRESSES_ONLY',observed_ms:now,transfers:[],wallets:selected.length,resume:null};
  if(!selected.length)return result;
  const start=options.startMs??now-30*60000,pageBudget=options.pageBudget??5;
  if(!Number.isSafeInteger(start)||start>=now||!Number.isSafeInteger(pageBudget)||pageBudget<1)throw Error('INVALID_CHAIN_WINDOW');
  try{
    const blocks=await json(fetcher,'https://eth.blockscout.com/api/v2/blocks?type=block');
    const head=blocks.items?.[0],tip=Number(head?.height),headAt=Date.parse(head?.timestamp);
    if(!Number.isSafeInteger(tip)||!Number.isFinite(headAt)||headAt>now+60000||now-headAt>180000)throw Error('CHAIN_TIP_STALE');
    let complete=true;const seen=new Set(),resume={};
    for(const label of selected){let cursor=options.resume?.[lower(label.address)]??null,done=false,pages=0,visited=new Set();
      while(pages<pageBudget){
        const url=new URL('https://eth.blockscout.com/api/v2/addresses/'+lower(label.address)+'/token-transfers');url.searchParams.set('type','ERC-20');
        if(cursor)for(const [k,v]of Object.entries(cursor)){if(typeof v!=='object'&&v!==null)url.searchParams.set(k,String(v));}
        const key=url.toString();if(visited.has(key))throw Error('CHAIN_CURSOR_STALLED');visited.add(key);
        const page=await json(fetcher,key);if(!Array.isArray(page.items))throw Error('CHAIN_SCHEMA_INVALID');pages++;
        let crossed=false;
        for(const t of page.items){const at=Date.parse(t.timestamp);if(!Number.isFinite(at))throw Error('CHAIN_TIMESTAMP_INVALID');if(at<start){crossed=true;continue;}if(at>now)continue;
          const item=classifyTransfer(t,selected,'1',tip,now);if(!item)continue;
          const id=[item.chain_id,item.transaction_hash,item.log_index,item.contract].join(':');if(seen.has(id))continue;seen.add(id);result.transfers.push(item);
        }
        cursor=page.next_page_params??null;if(crossed||!cursor){done=true;break;}
      }
      if(!done){complete=false;resume[lower(label.address)]=cursor;}
    }
    return {...result,status:complete?'INDEXED_SUBSET_READ':'PARTIAL',coverage_complete:complete,start_ms:start,end_ms:now,tip,transfers:result.transfers,resume:complete?null:resume};
  }catch(error){const code=/^(?:UPSTREAM_HTTP_[0-9]{3}|CHAIN_[A-Z_]+)$/.test(error?.message||'')?error.message:'CHAIN_READ_NOT_VERIFIED';return {...result,status:'UPSTREAM_UNAVAILABLE',coverage_complete:false,transfers:[],error_code:code};}
}
export async function telegramTest(env,storage,nonce,fetcher=fetch){
  if(env.ALLOW_TELEGRAM_TEST!=='true')return {status:'NOT_CONFIGURED',user_read_verified:false};
  const token=env.TELEGRAM_BOT_TOKEN,chat=String(env.TELEGRAM_CHAT_ID||'');
  if(typeof token!=='string'||!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)||!/^\d{5,18}$/.test(chat))return {status:'NOT_CONFIGURED',user_read_verified:false};
  if(typeof nonce!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(nonce))throw Error('INVALID_TEST_NONCE');
  const key='rt:test:'+nonce;
  const reservation=await storage.transaction(async tx=>{const old=await tx.get(key);if(old)return {existing:old};const state={status:'ATTEMPT_RESERVED',user_read_verified:false,at_ms:Date.now()};await tx.put(key,state);return {created:state};});
  if(reservation.existing)return reservation.existing;
  const base='https://api.telegram.org/bot'+token;
  let me;
  try{me=await json(fetcher,base+'/getMe');if(me?.ok!==true||me.result?.is_bot!==true)throw Error('BOT_NOT_VERIFIED');}
  catch{const r={status:'BOT_AUTH_NOT_VERIFIED',user_read_verified:false};await storage.put(key,r);return r;}
  let receipt;
  try{
    const response=await json(fetcher,base+'/sendMessage',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:chat,text:'[TEST] IRYS 실시간 수집기 연결 확인\n매수·매도 신호가 아닙니다. 주문은 실행하지 않습니다.\n검증번호: '+nonce,disable_notification:true,link_preview_options:{is_disabled:true}})});
    const msg=response.result;
    if(response.ok!==true)receipt={status:'API_REJECTED',user_read_verified:false};
    else if(!Number.isSafeInteger(msg?.message_id)||msg.message_id<=0||String(msg?.chat?.id)!==chat)receipt={status:'API_RECEIPT_UNVERIFIED',user_read_verified:false};
    else receipt={status:'SENT_API_ACCEPTED',message_id:msg.message_id,recipient_matches:true,user_read_verified:false,at_ms:Date.now()};
  }catch{receipt={status:'UNKNOWN_DELIVERY',user_read_verified:false};}
  // No automatic retry after ambiguous transmission or storage failure.
  await storage.put(key,receipt);return receipt;
}
