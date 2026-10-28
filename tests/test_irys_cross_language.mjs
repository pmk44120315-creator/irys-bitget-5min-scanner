import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {validateSignal} from '../deployment/IRYS_V8_PROOF_GATED_WORKER.mjs';

test('actual Python spot_continuity generated proof passes V8 without invented fields',()=>{
  const p=spawnSync('python',['tests/generate_spot_proof_bridge.py'],{encoding:'utf8',timeout:6000});
  assert.equal(p.status,0,p.stderr);
  const x=JSON.parse(p.stdout);
  assert.deepEqual(x.history.slice(0,3),[
    'WAIT_4_CONSECUTIVE_5M_CHECKS',
    'WAIT_4_CONSECUTIVE_5M_CHECKS',
    'WAIT_4_CONSECUTIVE_5M_CHECKS'
  ]);
  assert.equal(x.history[3],'SUSTAINED_SPOT_FLOW_VERIFIED');
  const proof=x.signal.verification;
  assert.ok(proof.candle_reconciled_15m_spot_taker.verified);
  assert.equal(proof.candle_reconciled_15m_spot_taker.blocks.length,3);
  assert.equal('start_ms' in proof.candle_reconciled_15m_spot_taker.blocks[0],false);
  assert.equal(validateSignal(x.signal,x.now),true,'actual source schema should pass');
  const outdated={...x.signal,direction:'BUY_OBSERVATION'};
  assert.equal(validateSignal(outdated,x.now),false);
});
