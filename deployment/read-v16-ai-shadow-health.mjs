/** GET-only current AI judgment and early model diagnostic; never sends Telegram. */
const url='https://irys-surge-monitor.vhehwpfl.workers.dev/';
const response=await fetch(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(18000)});
if(!response.ok)throw Error('V16_PUBLIC_HEALTH_HTTP_'+response.status);
const data=await response.json(),last=data.last||{},ai=last.aiJudgment||{};
const result={service:data.service,now_kst:new Date(Date.now()+9*3600000).toISOString(),
  runtime: last.codeVersion||null,last_run_kst:last.time||null,
  status:last.status||null,github_dispatch:last.githubDispatchStatus||null,
  ai_binding_configured:data.workersAIConfigured===true,
  ai_direct_transport_enabled:last.aiDirectTransportEnabled,
  ai_status:ai.status||'NOT_RECORDED',
  model:ai.model||null,
  spot_preselected:ai.spot_preselected??null,
  spot_evaluated:ai.spot_evaluated??null,
  futures_preselected:ai.futures_preselected??null,
  futures_evaluated:ai.futures_evaluated??null,
  model_decisions:ai.model_decisions??null,
  directional_model_hypotheses:ai.directional_model_hypotheses??null,
  model_validated_observations:ai.suppressed_directional_model_decisions??null,
  ai_error:ai.error||null,spot_error:ai.spot_error||null,
  telegram_test:data.telegramTransportProofV15||null,
  market_telegram_sent:last.telegramApiAckedThisRun??0,
  existing_market_signals:{spot:last.spotDirectional?.sent??null,
    futures:last.futuresDirection?.sent??null}};
console.log('IRYS_V16_AI_FIRST_LIVE_SHADOW_HEALTH',JSON.stringify(result));
