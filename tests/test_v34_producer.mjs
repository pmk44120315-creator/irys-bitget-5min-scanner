import test from 'node:test';import assert from 'node:assert/strict';import {existsSync} from 'node:fs';
import {packet,NOW} from './fixtures/v34_risk.mjs';import {v34Evaluate} from '../deployment/v34_crash.mjs';
const path=new URL('../deployment/v34_producer.mjs',import.meta.url);
async function mod(){assert(existsSync(path),'fresh independent risk producer absent');return import(path)}
function reader(){const p=packet(),calls=[];const read=async url=>{calls.push(url);const u=new URL(url),s=u.searchParams.get('symbol')||u.searchParams.get('market');
 if(url.includes('/history-candles')){const x=p.items.find(x=>x.symbol===s);return {code:'00000',data:x.bars.map(b=>[String(b.start_ms),b.open,b.high,b.low,b.close,'1'])}}
 if(url.includes('/candles/minutes/5')){const x=p.items.find(x=>x.symbol===s);return x.bars.map(b=>({market:s,candle_date_time_utc:new Date(b.start_ms).toISOString().slice(0,19),opening_price:b.open,high_price:b.high,low_price:b.low,trade_price:b.close}))}
 if(url.includes('/tickers'))return {code:'00000',data:p.items.filter(x=>x.venue==='bitget').map(x=>({symbol:x.symbol,bidPr:x.quote.bid,askPr:x.quote.ask,ts:x.quote.at_ms}))};
 if(url.includes('/orderbook'))return p.items.filter(x=>x.venue==='bithumb').map(x=>({market:x.symbol,timestamp:x.quote.at_ms,orderbook_units:[{bid_price:x.quote.bid,ask_price:x.quote.ask}]}));
 throw Error('UNEXPECTED_URL');};return {read,calls};}
test('independent producer reads only public major-market candles then fresh quotes',async()=>{const m=await mod(),x=reader();const d=await m.v34Produce({read:x.read,clock:()=>NOW,modelDigest:'MODEL'});assert.equal(d.items.length,6);assert.equal(d.telegram_sent,false);assert.equal(d.orders_sent,false);assert.equal(v34Evaluate(d,NOW,'MODEL').status,'OBSERVED_DROP');assert(x.calls.slice(0,6).every(u=>u.includes('candles')));assert(x.calls.every(u=>!u.includes('/order/')))});
test('one missing venue is explicit and cannot fabricate corroborating data',async()=>{const m=await mod(),x=reader();const d=await m.v34Produce({read:async u=>{if(u.includes('api.bithumb.com'))throw Error('HTTP_503');return x.read(u)},clock:()=>NOW,modelDigest:'MODEL'});assert(d.provider_errors.length>0);assert.equal(v34Evaluate(d,NOW,'MODEL').status,'INCOMPLETE_SOURCES');assert(d.items.length===3)});
test('malformed provider success is not a complete source',async()=>{const m=await mod();const d=await m.v34Produce({read:async()=>({code:'00000',data:null}),clock:()=>NOW,modelDigest:'MODEL'});assert(d.provider_errors.length>0);assert.equal(d.items.length,0)});
