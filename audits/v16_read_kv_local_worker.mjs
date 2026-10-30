/** Read-only LOCAL audit Worker. Never deploy or write KV. */
export default {
  async fetch(_request,env){
    try{
      const raw=await env.IRYS_KV.get('irys:fast:state:v1');
      if(!raw)return Response.json({status:'STATE_NOT_FOUND'});
      const j=JSON.parse(raw);
      return Response.json({
        status:'ACTUAL_STATE_FOUND',version:j.last?.codeVersion??null,
        last_kst:j.last?.time??null,
        ai_alert_records:(j.aiV16Outcomes||[]).length,
        receipt_records:(j.deliveryReceiptsV12||[]).length,
        spot_outcomes:(j.spotOutcomesV13||[]).length,
        futures_outcomes:(j.futuresOutcomesV13||[]).length
      });
    }catch(e){return Response.json({
      status:'KV_READ_FAILED',error_type:e?.name||'UNKNOWN',
      message:String(e?.message||'').slice(0,150)
    },{status:503})}
  }
};
