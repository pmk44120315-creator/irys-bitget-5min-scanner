function v28BundleMessage(items,leaders,now){
 const f=(x,n=3)=>Number.isFinite(x)?new Intl.NumberFormat('ko-KR',{maximumFractionDigits:n}).format(x):'미확인';
 const at=new Date(now+9*3600000).toISOString().slice(0,16).replace('T',' ')+' KST';
 const text=['🔎 [V28 급등 형성 후보 관찰 · 매수/롱 확정 아님]',at];
 items.forEach((r,i)=>{
  const b=v28Brief(r),spot=r.venue==='bithumb',q=r.current_quote;
  text.push(`\n${i+1}. ${spot?'빗썸':'비트겟'} ${r.symbol} · ${b.stage_ko}`);
  text.push(`현재 관측 ${f(r.price,8)}${spot?'원':' USDT'} · 최근 ${f(r.interval_minutes??5,1)}분 ${f(r.move_pct)}%`);
  if(spot)text.push(`형성 기준 대비 ${f(r.build_gain_pct)}% · 비교군 대비 누적 ${f(r.relative_run_pct)}%`);
  if(spot&&Number.isFinite(r.money_share_delta))text.push(`비교군 거래대금 점유율 변화 ${f(r.money_share_delta*100,4)}%p (순매수 아님)`);
  text.push(`최우선 매수/매도호가 ${f(q?.bid,8)} / ${f(q?.ask,8)}`);
  text.push(v27ResponseText(r.response).split('\n')[0]);
 });
 const selected=new Set(items.map(r=>r.symbol));
 const context=(leaders||[]).filter(r=>!selected.has(r.symbol)).slice(0,2);
 if(context.length){text.push('\n당일 상위 후속추적 (별도 매수 후보 아님)');
  for(const r of context){const b=v28Brief(r);text.push(`${r.symbol} ${f(r.day_pct,2)}% · ${b.stage_ko}${r.risks?.length?' · ⚠️ '+r.risks.map(x=>x.type).join(','):''}`);}}
 text.push('\n⚠️ 관측된 형성 과정이며 이후 급등·지속 상승을 보장하지 않습니다. 체결 표본≠전체 CVD. 거래대금≠순매수. 자동주문 없음.');
 return text.join('\n');
}
function v28Snapshot(row,now){return {...v27AuditSnapshot(row,now),formation:v28Brief(row),interval_minutes:row.interval_minutes??null,first_detected_at:row.first_detected_at??null};}
