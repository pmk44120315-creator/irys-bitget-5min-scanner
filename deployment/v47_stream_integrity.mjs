/** Subscription epochs and honest merged coverage. Never a trading signal. */
import {marketKey} from './v43_stream_core.mjs';
const clock=x=>Number.isSafeInteger(x)&&x>=0;
const venue=v=>{if(!['bitget','bithumb'].includes(v))throw Error('VENUE_IDENTITY');};
export class WatchEpochs{
 constructor(){this.active=new Map();this.retired=new Map();this.times=new Map();this.counter=0;}
 replace(v,symbols,at){
  venue(v);if(!clock(at)||at<(this.times.get(v)??0)||!Array.isArray(symbols))throw Error('WATCH_CLOCK_OR_SCHEMA');
  for(const s of symbols)marketKey(v,s);
  const next=new Set(symbols),old=this.active.get(v)||new Map(),result=new Map();
  for(const [s,epoch] of old)if(!next.has(s))this.retired.set(v+':'+s,{epoch,at});
  for(const s of next)result.set(s,old.get(s)??++this.counter);
  this.active.set(v,result);this.times.set(v,at);
  for(const [k,r] of this.retired)if(at-r.at>60000)this.retired.delete(k);
 }
 capture(v){venue(v);return {venue:v,epochs:new Map(this.active.get(v)||[])};}
 classify(v,s,received,snapshot){
  venue(v);if(!clock(received)||snapshot?.venue!==v||!(snapshot.epochs instanceof Map))return {accept:false,error:true,reason:'UNEXPECTED_MARKET_MESSAGE'};
  const seen=snapshot.epochs.get(s),current=this.active.get(v)?.get(s);
  if(seen!==undefined&&current===seen)return {accept:true,error:false,reason:'CURRENT_WATCH_EPOCH'};
  if(seen!==undefined)return {accept:false,error:false,reason:'WATCH_CHANGED_AFTER_RECEIVE'};
  const r=this.retired.get(v+':'+s);
  if(r&&received>=r.at&&received-r.at<=5000)return {accept:false,error:false,reason:'UNSUBSCRIBE_IN_FLIGHT'};
  return {accept:false,error:true,reason:'UNEXPECTED_MARKET_MESSAGE'};
 }
}
function union(intervals){
 const a=intervals.map(x=>[...x]).sort((x,y)=>x[0]-y[0]||x[1]-y[1]),merged=[];
 for(const x of a){const p=merged.at(-1);if(p&&x[0]<=p[1])p[1]=Math.max(p[1],x[1]);else merged.push(x);}
 const gaps=merged.slice(1).map((x,i)=>({start_ms:merged[i][1],end_ms:x[0],duration_ms:x[0]-merged[i][1]}));
 return {intervals:merged,covered_ms:merged.reduce((n,x)=>n+x[1]-x[0],0),gap_ms:gaps.reduce((n,x)=>n+x.duration_ms,0),gaps};
}
export function summarizeSessions(sessions){
 if(!Array.isArray(sessions))throw Error('SESSION_LIST');
 const by=new Map();
 for(const s of sessions){
  if(s?.version!=='V43_PUBLIC_CONTINUOUS_SESSION_V1'||typeof s.session!=='string'||!clock(s.started_at_ms)||!clock(s.ended_at_ms)||s.ended_at_ms<s.started_at_ms)throw Error('SESSION_INTERVAL');
  const old=by.get(s.session);if(old&&JSON.stringify(old)!==JSON.stringify(s))throw Error('CONFLICTING_SESSION');by.set(s.session,s);
 }
 const rows=[...by.values()],books={bitget:[],bithumb:[]};
 for(const s of rows)for(const c of s.connections||[]){
  if(!Object.hasOwn(books,c.venue))throw Error('COVERAGE_VENUE');
  if(c.first_book_received_ms===undefined||c.first_book_received_ms===null)continue;
  const a=c.first_book_received_ms,b=c.last_book_received_ms;
  if(!clock(a)||!clock(b)||b<a||a<s.started_at_ms||b>s.ended_at_ms)throw Error('QUOTE_ENVELOPE_CLOCK');
  books[c.venue].push([a,b]);
 }
 return {version:'V47_PERSISTED_SESSION_COVERAGE_V1',sessions:rows.length,
  execution_intervals:union(rows.map(s=>[s.started_at_ms,s.ended_at_ms])),
  observed_book_envelopes:Object.fromEntries(Object.entries(books).map(([v,a])=>[v,union(a)])),
  market_tape_completeness_verified:false,all_symbols_continuous_verified:false,
  scope:'PERSISTED_SESSIONS_ONLY;BOOK_ENVELOPES_DO_NOT_PROVE_EVERY_TICK_OR_EVERY_SYMBOL'};
}
