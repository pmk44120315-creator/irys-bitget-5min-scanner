import test from 'node:test';
import assert from 'node:assert/strict';
import {telegramTransportProofOnce}
  from '../deployment/IRYS_V15_TELEGRAM_TRANSPORT_PROOF_WORKER.mjs';

const AT=Date.parse('2026-10-30T00:20:00Z');
const token='123456789:FAKE_TELEGRAM_SECRET_NEVER_LOG_123456';
function harness(){
  let state=new Map(),sends=[],writes=0;
  const env={
    IRYS_KV:{
      get:async k=>state.get(k)??null,
      put:async(k,v,options)=>{assert.equal(options.expirationTtl,7*86400);
        state.set(k,v);writes++}
    },
    TELEGRAM_BOT_TOKEN:token,
    TELEGRAM_CHAT_ID:'123456789'
  };
  return {env,state,sends,writes:()=>writes};
}
test('One real-context scheduled transport proof sends clearly NONTRADING Telegram once only',async()=>{
  const saved=globalThis.fetch,h=harness();
  globalThis.fetch=async(url,opts)=>{
    assert.ok(String(url).startsWith('https://api.telegram.org/bot'));
    const msg=JSON.parse(opts.body).text;
    h.sends.push(msg);
    return new Response(JSON.stringify({ok:true,result:{message_id:731,chat:{id:123456789}}}),{status:200});
  };
  try{
    const a=await telegramTransportProofOnce(h.env,AT);
    assert.equal(a.status,'TELEGRAM_API_ACK');
    assert.equal(a.message_id,731);
    assert.equal(h.sends.length,1);
    assert.match(h.sends[0],/연결 시험/);
    assert.match(h.sends[0],/매수·롱·숏 신호 또는 진입 추천이 아닙니다/);
    assert.ok(h.sends[0].includes('\n'));
    const b=await telegramTransportProofOnce(h.env,AT+300000);
    assert.equal(b.status,'ALREADY_ACKED');
    assert.equal(h.sends.length,1);
    assert.equal(h.writes(),2);
    assert.equal(h.state.size,2,'claim and acknowledgement must use DIFFERENT Cloudflare KV keys');
    const entries=[...h.state.entries()];
    assert.equal(new Set(entries.map(([k])=>k)).size,2);
    assert.ok(entries.some(([k,v])=>k.endsWith(':result')&&JSON.parse(v).message_id===731));
    assert.ok(JSON.stringify(a).indexOf(token)===-1);
  }finally{globalThis.fetch=saved}
});
test('Unauthorized Telegram API error is redacted; failed attempts never loop into spam',async()=>{
  const saved=globalThis.fetch,h=harness();
  let sends=0;
  globalThis.fetch=async()=>{sends++;return new Response(JSON.stringify({ok:false}),{status:401})};
  try{
    const a=await telegramTransportProofOnce(h.env,AT);
    assert.equal(a.status,'SEND_FAILED');
    assert.match(a.error,/HTTP_401/);
    assert.doesNotMatch(JSON.stringify(a),/FAKE_TELEGRAM_SECRET/);
    assert.match(a.error,/bot\[REDACTED\]/);
    assert.equal((await telegramTransportProofOnce(h.env,AT+300000)).status,'SEND_FAILED');
    assert.equal(sends,1);
  }finally{globalThis.fetch=saved}
});
test('Missing KV or failed idempotency reservation prevents all sends',async()=>{
  const saved=globalThis.fetch;
  let calls=0;globalThis.fetch=async()=>{calls++;throw Error('must not send')};
  try{
    assert.equal((await telegramTransportProofOnce({},AT)).status,'KV_UNAVAILABLE');
    const env={IRYS_KV:{get:async()=>null,put:async()=>{throw Error('KV_FAIL')}}};
    assert.equal((await telegramTransportProofOnce(env,AT)).status,'KV_RESERVATION_FAILED_NO_SEND');
    assert.equal(calls,0);
  }finally{globalThis.fetch=saved}
});
