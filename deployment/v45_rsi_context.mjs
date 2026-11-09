/** V45: distinguish observed direction from an extreme/unknown new-entry context.
 * RSI is momentum, not an automatic reversal or a calibrated future forecast.
 * Quote-implied RSI is explicitly NOT a completed candle or last-trade chart RSI.
 */
const V45_VERSION='V45_RSI_ENTRY_CONTEXT_V1';
const v45Number=x=>typeof x==='number'&&Number.isFinite(x);
const v45Clock=x=>Number.isSafeInteger(x)&&x>=0;
function v45Rsi(g,l){return g===0&&l===0?50:l===0?100:g===0?0:100-100/(1+g/l);}
function v45RsiSeries(prices,length=14){
 if(length!==14||!Array.isArray(prices)||prices.some(x=>!v45Number(x)||x<=0))throw Error('RSI_INPUT');
 if(prices.length<=length)return prices.map(()=>null);
 let g=0,l=0;for(let i=1;i<=length;i++){const d=prices[i]-prices[i-1];g+=Math.max(0,d)/length;l+=Math.max(0,-d)/length;}
 const out=Array(length).fill(null);out.push(v45Rsi(g,l));
 for(let i=length+1;i<prices.length;i++){const d=prices[i]-prices[i-1];g=(g*13+Math.max(0,d))/14;l=(l*13+Math.max(0,-d))/14;out.push(v45Rsi(g,l));}
 return out;
}
function v45ClosedBars(raw,venue,symbol,minutes,at){
 if(![1,5,15].includes(minutes)||!v45Clock(at))throw Error('BAR_CLOCK');
 let rows;if(venue==='bitget'){if(raw?.code!=='00000'||!Array.isArray(raw.data))throw Error('BAR_SOURCE');rows=raw.data;}
 else if(venue==='bithumb'){if(!Array.isArray(raw))throw Error('BAR_SOURCE');rows=raw.map(x=>{if(x?.market!==symbol)throw Error('BAR_IDENTITY');const t=Date.parse(String(x.candle_date_time_utc).replace(/Z$/,'')+'Z');return [t,x.opening_price,x.high_price,x.low_price,x.trade_price];});}
 else throw Error('BAR_IDENTITY');
 const interval=minutes*60000,by=new Map();
 for(const x of rows){if(!Array.isArray(x)||x.length<5)throw Error('BAR_SCHEMA');const b=x.slice(0,5).map(v=>v===null||v===''||typeof v==='boolean'?NaN:Number(v));
  const [t,o,h,l,c]=b;if(!v45Clock(t)||t%interval||![o,h,l,c].every(v=>v45Number(v)&&v>0)||l>Math.min(o,c)||h<Math.max(o,c)||l>h)throw Error('BAR_VALUES');
  if(t+interval>at)continue;if(by.has(t)&&JSON.stringify(by.get(t))!==JSON.stringify(b))throw Error('BAR_CONFLICT');by.set(t,b);
 }
 return [...by.values()].sort((a,b)=>a[0]-b[0]).slice(-200);
}
function v45Frame(bars,minutes,at){
 if(![1,5,15].includes(minutes)||!v45Clock(at)||!Array.isArray(bars)||bars.length<100||bars.length>200)throw Error('RSI_HISTORY_INSUFFICIENT');
 const interval=minutes*60000;for(let i=0;i<bars.length;i++){const [t,o,h,l,c]=bars[i];if(!v45Clock(t)||t%interval||![o,h,l,c].every(v=>v45Number(v)&&v>0)||l>Math.min(o,c)||h<Math.max(o,c)||t+interval>at)throw Error('RSI_BAR_VALUES');if(i&&t-bars[i-1][0]!==interval)throw Error('RSI_NATIVE_BAR_GAP');}
 const last=bars.at(-1),end=last[0]+interval;if(end!==Math.floor(at/interval)*interval)throw Error('RSI_LAST_CLOSED_BAR_STALE');
 const cs=bars.map(x=>x[4]);let g=0,l=0;for(let i=1;i<=14;i++){const d=cs[i]-cs[i-1];g+=Math.max(0,d)/14;l+=Math.max(0,-d)/14;}
 let previous=v45Rsi(g,l);for(let i=15;i<cs.length;i++){previous=v45Rsi(g,l);const d=cs[i]-cs[i-1];g=(g*13+Math.max(0,d))/14;l=(l*13+Math.max(0,-d))/14;}
 return {timeframe_minutes:minutes,length:14,smoothing:'WILDER_RMA',seed:'FIRST_14_CHANGES_SMA',seed_bars:bars.length,
  last_closed_end_ms:end,last_close:cs.at(-1),rsi:v45Rsi(g,l),previous_rsi:previous,average_gain:g,average_loss:l,flat_rsi_convention:50};
}
function v45Project(frame,quote,now){
 const q=quote;if(!v45Clock(now)||!v45Clock(q?.at_ms)||q.at_ms>now||now-q.at_ms>15000||!v45Number(q?.bid)||!v45Number(q?.ask)||q.bid<=0||q.ask<q.bid)throw Error('PROJECTION_QUOTE');
 const dt=frame.timeframe_minutes*60000;if(frame.last_closed_end_ms!==Math.floor(q.at_ms/dt)*dt||frame.last_closed_end_ms!==Math.floor(now/dt)*dt)throw Error('PROJECTION_BAR_BOUNDARY');
 const mid=(q.bid+q.ask)/2,d=mid-frame.last_close,g=(frame.average_gain*13+Math.max(0,d))/14,l=(frame.average_loss*13+Math.max(0,-d))/14;
 return {timeframe_minutes:frame.timeframe_minutes,length:14,closed_rsi:frame.rsi,previous_closed_rsi:frame.previous_rsi,
  quote_rsi:v45Rsi(g,l),quote_at_ms:q.at_ms,quote_price_basis:'BEST_BID_ASK_MID_NOT_LAST_TRADE',current_candle_closed:false,
  closed_end_ms:frame.last_closed_end_ms,history_bars:frame.seed_bars,smoothing:'WILDER_RMA',calibrated_probability:null};
}
function v45Classify(direction,frames){
 if(!['LONG','SHORT','BUY'].includes(direction))throw Error('CONTEXT_DIRECTION');
 const valid=['1','5'].every(k=>v45Number(frames?.[k]?.closed_rsi)&&v45Number(frames?.[k]?.quote_rsi)&&frames[k].closed_rsi>=0&&frames[k].closed_rsi<=100&&frames[k].quote_rsi>=0&&frames[k].quote_rsi<=100);
 const reasons=[];if(!valid)reasons.push('RSI_CONTEXT_INCOMPLETE');
 for(const k of ['1','5']){const f=frames?.[k];if(!f)continue;
  if(direction==='SHORT'&&((v45Number(f.quote_rsi)&&f.quote_rsi<=30)||(v45Number(f.closed_rsi)&&f.closed_rsi<=30)))reasons.push('OVERSOLD_SHORT_CHASE');
  if(direction!=='SHORT'&&((v45Number(f.quote_rsi)&&f.quote_rsi>=70)||(v45Number(f.closed_rsi)&&f.closed_rsi>=70)))reasons.push('OVERBOUGHT_LONG_CHASE');
 }
 return {version:V45_VERSION,direction,role:!valid?'CONTEXT_UNVERIFIED':reasons.length?'CAUTION_OBSERVATION':'DIRECTION_OBSERVATION',
  reasons:[...new Set(reasons)],entry_confirmed:false,auto_reversed:false,forecast_accuracy_proven:false,hard_entry_filter_added:false};
}
function v45AttachContext(batch,item,doc,quote,now){
 const unknown=reason=>({...v45Classify(item.candidate.direction,{}),frames:{},missing_reasons:[reason]});
 if(batch?.version!=='V421_OFFICIAL_POST_PUBLICATION_QUOTES_V1'||batch.source!=='OFFICIAL_PUBLIC_RUNNER_POST_PUBLICATION'||typeof batch.published_source_commit!=='string'||!/^[a-f0-9]{40}$/.test(batch.published_source_commit)||!v45Clock(batch.sampled_at_ms)||batch.sampled_at_ms>now||now-batch.sampled_at_ms>90000||batch.entry_context_version!==V45_VERSION||batch.source_packet_at_ms!==doc.at_ms||batch.source_model_digest!==doc.model_digest||
  batch.orders_sent!==false||batch.telegram_sent!==false||!Array.isArray(batch.entry_contexts))return unknown('CONTEXT_PACKET_MISMATCH');
 const c=item.candidate,found=batch.entry_contexts.filter(x=>x.venue===c.venue&&x.symbol===c.symbol);
 if(found.length!==1)return unknown('CONTEXT_MARKET_NOT_UNIQUE');
 const context=found[0];if(context.source!=='OFFICIAL_NATIVE_CANDLES'||!v45Clock(context.fetched_at_ms)||context.fetched_at_ms>now||now-context.fetched_at_ms>90000)return unknown('CONTEXT_CLOCK_UNVERIFIED');
 const frames={},missing=[];
 for(const k of ['1','5']){try{const source=context.frames?.[k];if(!v45Clock(source?.received_at_ms)||source.received_at_ms>context.fetched_at_ms)throw Error('CANDLE_RECEIVE_CLOCK');v45Frame(source.bars,Number(k),source.received_at_ms);frames[k]=v45Project(v45Frame(source.bars,Number(k),now),quote,now);}catch(e){missing.push(k+'m:'+String(e.message));}}
 return {...v45Classify(c.direction,frames),frames,missing_reasons:missing,source_packet_at_ms:doc.at_ms,context_fetched_at_ms:context.fetched_at_ms};
}
function v45Format(p,now,context){
 const c=context??{...v45Classify(p.direction,{}),frames:{}},dir=p.direction==='SHORT'?'하락(SHORT)':p.direction==='BUY'?'상승(BUY)':'상승(LONG)';
 const title=c.role==='CAUTION_OBSERVATION'?'⚠️ V45 추격 진입 주의':c.role==='CONTEXT_UNVERIFIED'?'⚠️ V45 진입 정보 미확인':'🔎 V45 방향 관측';
 const why=c.reasons.includes('OVERSOLD_SHORT_CHASE')?'과매도 구간: 신규 숏 진입 확인 아님':c.reasons.includes('OVERBOUGHT_LONG_CHASE')?'과매수 구간: 신규 롱·매수 진입 확인 아님':c.role==='CONTEXT_UNVERIFIED'?'RSI 자료 미확인: 진입 판단 보류':'현재 방향 근거 관측 · 진입 우위는 미검증';
 const number=x=>Number(x).toLocaleString('ko-KR',{maximumFractionDigits:10}),rsi=[];
 for(const k of ['1','5']){const f=c.frames?.[k];rsi.push(f?`${k}분 RSI14: 확정 ${f.closed_rsi.toFixed(1)} / 호가대입 ${f.quote_rsi.toFixed(1)}*`:`${k}분 RSI14: 미확인`);}
 const stamp=new Date(now+9*3600000).toISOString().slice(11,19);
 return `${title}\n${p.venue==='bithumb'?'빗썸':'비트겟'} ${p.symbol} | ${dir}\n${why}\n${rsi.join('\n')}\n기준 ${number(p.entry_reference)} · 근거 이탈 참고 ${number(p.invalidation_reference)}\n${stamp} KST | *미완성봉 호가 기준 추정, 차트 RSI와 다를 수 있음\n과매도·과매수만으로 반대 방향 전환을 뜻하지 않음. 방향·수익 보장 없음.`;
}
export {V45_VERSION,v45RsiSeries,v45ClosedBars,v45Frame,v45Project,v45Classify,v45AttachContext,v45Format};
