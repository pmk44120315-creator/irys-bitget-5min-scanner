"""Reproducible surgical source transform; refuse unknown production hash."""
import sys,pathlib,hashlib
base=pathlib.Path(sys.argv[1]).read_text(encoding='utf-8')
assert hashlib.sha256(base.encode()).hexdigest()=='d1a46e867b57d5bce542d46abbbc3b7c9ceeda762700e12dd18b56ee89ba02c7','BASE_SOURCE_LEASE_MISMATCH'
root=pathlib.Path(__file__).resolve().parent
helper=(root/'v27_response.mjs').read_text().split('\nexport {')[0]+'\n'+(root/'v27_worker_helpers.mjs').read_text()
s=base
changes=[]
def replace(a,b,label):
 global s
 assert s.count(a)==1,(label,s.count(a))
 s=s.replace(a,b);changes.append(label)
replace("IRYS-V24-BITGET-GITHUB-FAST-FALLBACK-20261101","IRYS-V27.1-EXECUTABLE-RESPONSE-IDSAFE-20261102",'version')
replace("const V23_VER='IRYS_V24_GITHUB_OFFICIAL_BITGET_FALLBACK_V1';","const V23_VER='IRYS_V27_1_EXECUTABLE_RESPONSE_V1';",'scout-version')
replace("price,move_pct:v23Round(change),turnover5_est_krw:Math.round(turn),","price,baseline_price:lastPrice,move_pct:v23Round(change),turnover5_est_krw:Math.round(turn),",'spot-baseline')
replace("price,move_pct:v23Round(change),turnover5_est_krw:null,turnover_ratio:null,","price,baseline_price:prior,current_quote:{bid,ask,at_ms:stamp},move_pct:v23Round(change),turnover5_est_krw:null,turnover_ratio:null,",'futures-baseline')
replace(' const read=options.read||requestJson;\n try{\n   const {feeds,failures,availability}=await v23ReadFeeds(read);',
''' const read=options.read||requestJson;
 const clock=options.clock||Date.now;
 try{
   const {feeds,failures,availability}=await v23ReadFeeds(read);''','clock')
replace("       const doc=await read(V24_FAST_URL+'?ts='+now,{headers:{accept:'application/json'}},8500);\n       fallback=v24FastFallback(doc,now);",
'''       const loaded=await v27ReadFresh(read,now,{clock,sleep:options.sleep,maxWaitMs:options.maxWaitMs});
       output.v27FreshSource={status:loaded.status,reads:loaded.reads,wait_ms:loaded.wait_ms};
       now=clock();
       if(loaded.status==='FRESH'){
         fallback=v27EnrichFallback(v24FastFallback(loaded.doc.source,now),loaded.doc,state,now);
       }else fallback={status:loaded.status,age_min:null,candidates:[],observed:0};''','fresh-generation')
replace("   const last=state.v23ScoutNotices||{};\n   const choices=result.observation.candidates.filter(c=>",
'''   const last=state.v23ScoutNotices||{};
   const executable=await v27ExecutableCandidates(result.observation.candidates,state,read,clock(),clock);
   output.v27ExecutableAudit={accepted:executable.accepted.length,rejected:executable.rejected,source_error:executable.source_error};
   const choices=executable.accepted.filter(c=>''','executable-price')
replace("   let sample={status:'NO_FRESH_PUBLIC_SAMPLE'};\n   try{sample=v23SampleTaker(await read(sampleUrl),target.venue,now);}\n   catch(e){output.reasons.push('TAKER_SAMPLE_UNAVAILABLE');}",
'''   let sample={status:'NO_FRESH_PUBLIC_SAMPLE'},response=target.response||null;
   if(response?.status==='SAMPLED_RESPONSE')sample={status:'SAMPLE_AVAILABLE',buy_share:response.buy_share,trades:response.sample_trades,marketwide:false};
   else try{
     const raw=await read(sampleUrl);now=clock();sample=v23SampleTaker(raw,target.venue,now);
     response=v27EffortResponse(raw,target.venue,now,target.current_quote?.spread_pct,target.symbol);
   }catch(e){output.reasons.push('TAKER_SAMPLE_UNAVAILABLE');}
   target.response=response;
   now=clock();
   if(!v27Quote(target.current_quote,now)){output.status='QUOTE_EXPIRED_BEFORE_DELIVERY';return output;}''','effort-response')
replace('const ack=await send(env,v23Message(target,sample,now));','const ack=await send(env,v27WatchMessage(target,response,now));','message')
replace("     const rc=options.receipt||recordReceipt;\n     const row=rc(state,'V23_DIRECT_FAST_MARKET_WATCH',", "     ack.market_snapshot=v27AuditSnapshot(target,now);\n     const rc=options.receipt||recordReceipt;\n     const row=rc(state,'V23_DIRECT_FAST_MARKET_WATCH',",'watch-receipt')
replace('return {message_id:response.result.message_id};',
'''return {message_id:response.result.message_id,ack_received_at_ms:Date.now(),
    bot_accepted_at_ms:Number.isSafeInteger(response.result.date)?response.result.date*1000:null,
    message_text:messageText};''','actual-ack-clock')
replace("  const row={channel,symbol,telegram_message_id:ack.message_id,accepted_at:kst(at),",
'''  const row={channel,symbol,telegram_message_id:ack.message_id,accepted_at:kst(at),
    recorded_send_ms:at,ack_received_at_ms:ack.ack_received_at_ms??null,
    bot_accepted_at_ms:ack.bot_accepted_at_ms??null,message_text:ack.message_text??null,
    market_snapshot:ack.market_snapshot??null,''','exact-receipt-evidence')
replace("      const ack=await telegram(env,futuresMessage(proof,now));", """      const check=v27DirectionCheck(proof,state.v27Quotes?.[proof.symbol],Date.now());
      if(check.status!=='CURRENT_QUOTE_CHECKED'){
        futuresRun.reasons[check.status]=(futuresRun.reasons[check.status]||0)+1;continue;
      }
      proof.v27_current_check=check;
      const ack=await telegram(env,futuresMessage(proof,now)+'\\nV27 발송 직전 최우선 호가 '+fmt(check.quote.bid,7)+' / '+fmt(check.quote.ask,7)+' USDT · 근거 이후 역행 여부 재확인');
      ack.market_snapshot=v27AuditSnapshot(proof,Date.now());""",'directional-pre-send-invalidation')
replace("      const ack=await telegram(env,directionalMessage(p,now));", "      const ack=await telegram(env,directionalMessage(p,now));\n      ack.market_snapshot=v27AuditSnapshot({...p,venue:'bithumb'},Date.now());",'spot-direction-receipt')
replace("if(!choices.length){output.status='DUPLICATE_EPISODE_PACED';return output;}",
 "if(!choices.length){output.status=executable.accepted.length?'DUPLICATE_EPISODE_PACED':'NO_EXECUTABLE_PRICE_PROGRESS';return output;}",'truthful-no-alert-reason')
replace("telegramLastApiReceipt:(state.deliveryReceiptsV12||[]).at(-1)||null,",
 "telegramLastApiReceipt:v27PublicReceipt((state.deliveryReceiptsV12||[]).at(-1)),",'private-receipt-public-redaction')
replace("   output.venue_availability=availability;",
 """   output.venue_availability=availability;
   if(availability.bitget){
     const crypto=new Set(feeds.bitget_instruments.filter(x=>String(x.symbolType).toLowerCase()==='crypto'&&String(x.instrumentType).toLowerCase()==='crypto').map(x=>x.symbol));
     const quotes={};for(const t of feeds.bitget_tickers){if(!crypto.has(t.symbol))continue;
       const q=v27Quote({bid:t.bidPr,ask:t.askPr,at_ms:Number(t.ts)},clock());if(q)quotes[t.symbol]=q;}
     if(Object.keys(quotes).length>=100){state.v27Quotes=quotes;state.v27QuoteSourceMs=clock();}
   }""",'direct-bitget-recovery-quotes')
replace('elapsed_min:null,actual_taker:null,original_directional_channels_untouched:true};',
 'elapsed_min:null,actual_taker:null,original_directional_channels_untouched:false,original_directional_proofs_preserved:true,v27_pre_send_quote_check:true};','honest-protection-status')
# Preserve original live scheduling/export handlers and all legacy proof logic.
assert s.split('  async scheduled(_controller,env){')[1]==base.split('  async scheduled(_controller,env){')[1]
for start,end in [('function futuresSnapshotProof(','function evaluateFutures('),('function validDirectionalProof(','async function officialDirectionalRiskCheck(')]:
 assert s[s.index(start):s.index(end)]==base[base.index(start):base.index(end)]
s=helper+'\n'+s+'\nexport {v23ScoutTick,v23TickerBundle,v27LoadQuotes,v27ExecutableCandidates,v27DirectionCheck,recordReceipt,v27EffortResponse,v27PublicReceipt,v27SafeResponse};\n'
out=pathlib.Path(sys.argv[2]);out.write_text(s,encoding='utf-8')
print('V27_BUILD',hashlib.sha256(s.encode()).hexdigest(),len(s.encode()),'changes',','.join(changes))
