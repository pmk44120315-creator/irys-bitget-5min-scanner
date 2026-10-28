/** Public read-only Cloudflare V7 health. No controls, keys or Telegram. */
const url='https://irys-surge-monitor.vhehwpfl.workers.dev/';
const r=await fetch(url,{signal:AbortSignal.timeout(18000),headers:{accept:'application/json'}});
const j=await r.json(),last=j.last??{},a=last.aiJudgment??{};
const output={
  http:r.status,worker_version:last.codeVersion??null,scan_at_kst:last.time??null,
  scan_status:last.status??null,github_dispatch_status:last.githubDispatchStatus??null,
  spot_signals:last.spotEarlyAlerts??null,spot_confirmed:last.confirmed??null,
  direct_spot_messages:last.sent??null,telegram_configured:last.telegramConfigured??null,
  telegram_transport_previously_verified:last.telegramSendVerified??null,
  ai_status:a.status??null,ai_preselected_spot:a.spot_preselected??null,
  ai_preselected_futures:a.futures_preselected??null,
  ai_model_decisions:a.model_decisions??null,ai_passed_evidence:a.passed_evidence??null,
  ai_sent:a.alerts_sent??null,
  ai_error:a.error??null,ai_spot_error:a.spot_error??null,
  source_time:last.githubBitgetFinishedUtc??null,
  bgError:last.bgError??null,telegram_send_error:last.sendError??null
};
console.log('V7_PUBLIC_READONLY_HEALTH',JSON.stringify(output));
if(r.status!==200||!j.service)process.exitCode=2;
