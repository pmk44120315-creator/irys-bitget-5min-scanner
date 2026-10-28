import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('V7 preflight without scoped token must BLOCK, not report green PASS',()=>{
  const p=spawnSync('node',['deployment/preflight-v7.mjs'],{
    encoding:'utf8',timeout:8000,
    env:{...process.env,IRYS_V7_CF_API_TOKEN:'',IRYS_REALTIME_CF_ACCOUNT_ID:''}
  });
  assert.equal(p.status,2,'missing V7 token must fail closed');
  assert.match(p.stderr,/V7_SCOPED_TOKEN_MISSING/);
  assert.doesNotMatch(p.stdout+p.stderr,/V7_READ_ONLY_PREFLIGHT_PASS/);
});
