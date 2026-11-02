"""Exact V27.2 transformation; preserve legacy directional proofs and Cron."""
import sys,pathlib,hashlib
source=pathlib.Path(sys.argv[1]).read_text(encoding='utf8')
assert hashlib.sha256(source.encode()).hexdigest()=='f9213445d95a1c52e4d72eb47961e8d63188d3d99ed7876894d69907b3e00b1f','V27_2_SOURCE_LEASE_MISMATCH'
root=pathlib.Path(__file__).resolve().parent
s=source
changes=[]
def rep(a,b,name):
 global s
 assert s.count(a)==1,(name,s.count(a))
 s=s.replace(a,b);changes.append(name)
rep('IRYS-V27.2-EXECUTABLE-RESPONSE-AUTHFRESH-20261102','IRYS-V28-MARKET-RELATIVE-BUILDUP-20261102','version')
rep("const V23_VER='IRYS_V27_2_EXECUTABLE_RESPONSE_V1';","const V23_VER='IRYS_V28_BUILDUP_V1';",'scout-version')
rep('   const {feeds,failures,availability}=await v23ReadFeeds(read);', '''   const {feeds,failures,availability}=await v23ReadFeeds(read);
   const v28Scan=availability.bithumb?
     v28Discover(state.v28Ledger||{},feeds,clock(),state.v23ScoutTape||{}):
     {summary:{status:'SOURCE_UNAVAILABLE'},leaders:[],rows:[],candidates:[]};
   if(v28Scan.summary.status==='OBSERVED'){
     state.v28Ledger=v28Scan.next;
     state.v28CoverageRows=v28Scan.rows;
   }
   output.v28Discovery={...v28Scan.summary,day_leaders:v28Scan.leaders.map(v28Brief),
     selected:v28Scan.candidates.map(v28Brief),delivery_is_not_detection:true};''','all-market-ledger-before-delivery-cap')
rep('   state.v23ScoutTape=result.next;', '''   state.v23ScoutTape=result.next;
   if(v28Scan.summary.status==='OBSERVED'){
     result.observation.candidates=[...result.observation.candidates.filter(c=>c.venue!=='bithumb'),...v28Scan.candidates];
     if(v28Scan.summary.compared>0)result.observation.status='MARKET_COMPARISON_PASS';
   }''','remove-spot-single-step-admission-floor')
rep('     result.observation.candidates=result.observation.candidates.slice(0,12);','     result.observation.candidates=v28ChooseBundle(result.observation.candidates,24);','preserve-spot-and-futures-opportunities')
rep('   const target=choices[0];', '   let bundle=v28ChooseBundle(choices,3),target=bundle[0];','one-message-multiple-candidates')
start=s.index('   const sampleUrl=target.venue',s.index('async function v23ScoutTick('))
end=s.index('   if(options.sendEnabled===false)',start)
s=s[:start]+'''   for(const item of bundle){
     let response=v27SafeResponse(item.response,clock());
     if(response.status!=='SAMPLED_RESPONSE'){
       const url=item.venue==='bitget'?
         'https://api.bitget.com/api/v2/mix/market/fills?symbol='+encodeURIComponent(item.symbol)+'&productType=USDT-FUTURES&limit=100':
         'https://api.bithumb.com/v1/trades/ticks?market='+encodeURIComponent(item.symbol)+'&count=500';
       try{response=v27EffortResponse(await read(url),item.venue,clock(),item.current_quote?.spread_pct,item.symbol);}
       catch(_e){response={status:'PUBLIC_SAMPLE_UNAVAILABLE',future_direction_proven:false};}
     }
     item.response=response;
   }
   now=clock();
   bundle=bundle.filter(item=>v27Quote(item.current_quote,now));
   if(!bundle.length){output.status='QUOTE_EXPIRED_BEFORE_DELIVERY';return output;}
   target=bundle[0];
   output.actual_taker={status:target.response?.status||'UNKNOWN',buy_share:target.response?.buy_share??null,sampled_trades:target.response?.sample_trades??null};
   output.v28Bundle=bundle.map(v28Brief);
''' + s[end:]
changes.append('sample-each-selected-symbol')
rep('const ack=await send(env,v27WatchMessage(target,response,now));','const ack=await send(env,v28BundleMessage(bundle,v28Scan.leaders,now));','batch-message')
rep('if(!ack||!Number.isSafeInteger(ack.message_id))','if(!ack||!Number.isSafeInteger(ack.message_id)||ack.message_id<=0)','positive-actual-ACK')
rep("     last[target.venue+':'+target.symbol]=now;", "     for(const item of bundle)last[item.venue+':'+item.symbol]=now;",'per-symbol-ack-dedupe')
rep('     ack.market_snapshot=v27AuditSnapshot(target,now);',"     ack.market_snapshot={...v28Snapshot(target,now),bundle_version:'V28_ACK_BUNDLE_V1',bundle:bundle.map(item=>v28Snapshot(item,now))};",'per-symbol-evidence-receipt')
rep('     output.sent_symbol=target.symbol;', '     output.sent_symbol=target.symbol;\n     output.sent_symbols=bundle.map(item=>item.symbol);','accurate-bundle-telemetry')
for a,b in [('function futuresSnapshotProof(','function evaluateFutures('),('function validDirectionalProof(','async function officialDirectionalRiskCheck(')]:assert s[s.index(a):s.index(b)]==source[source.index(a):source.index(b)]
assert s.split('  async scheduled(_controller,env){')[1]==source.split('  async scheduled(_controller,env){')[1]
helper=(root/'v28_discovery.mjs').read_text().split('\nexport {')[0]+'\n'+(root/'v28_messages.mjs').read_text()
s=helper+'\n'+s+'\nexport {v28Discover,v28ChooseBundle,v28Brief,v28BundleMessage};\n'
pathlib.Path(sys.argv[2]).write_text(s,encoding='utf8')
print('V28_BUILD_SHA256',hashlib.sha256(s.encode()).hexdigest(),'bytes',len(s.encode()),'changes',changes)
