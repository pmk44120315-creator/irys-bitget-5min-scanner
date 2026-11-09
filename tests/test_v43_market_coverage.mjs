import test from 'node:test';import assert from 'node:assert/strict';
import {StreamState} from '../deployment/v43_stream_core.mjs';
const T=1794180000000;
function q(at){return {kind:'book',venue:'bitget',symbol:'AAAUSDT',at_ms:at,at_us:at*1000,received_at_ms:at+1,bid:100,ask:101,bid_size:2,ask_size:1,bids:[[100,2]],asks:[[101,1]],sequence:String(at),snapshot:true}}
test('newly watched market cannot inherit a minute of evidence from an older venue connection',()=>{const s=new StreamState();s.open('bitget','c',T-120000);s.accept(q(T),'c');const f=s.snapshot('bitget','AAAUSDT',T+10000);assert.equal(f.unbroken_window,false);assert.equal(f.market_observation_span_ms,9999)});
test('market removed and later re-added starts a new observable window without old CVD',()=>{const s=new StreamState();s.open('bitget','c',T-120000);s.accept(q(T-90000),'c');assert.equal(typeof s.forgetMarket,'function');s.forgetMarket('bitget','AAAUSDT');s.accept(q(T),'c');const f=s.snapshot('bitget','AAAUSDT',T+10000);assert.equal(f.unbroken_window,false);assert.equal(f.book_count,1)});
test('genuinely observed market can complete its window without adding any live signal gate',()=>{const s=new StreamState();s.open('bitget','c',T-120000);s.accept(q(T-61000),'c');s.accept(q(T),'c');const f=s.snapshot('bitget','AAAUSDT',T+1000);assert.equal(f.unbroken_window,true);assert.equal(f.trade_permission,false)});
