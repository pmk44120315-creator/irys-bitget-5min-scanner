/** V38 recorded hypotheses, never account permissions. */
const V38_LEDGER_VERSION='V38_EARLY_REACCEL_PROSPECTIVE_LEDGER_V1';
function v38Enroll(){return {status:'NOT_IMPLEMENTED',state:{events:[]},added:[]};}
function v38Settle(){return {events:[]};}
function v38Summary(){return {version:V38_LEDGER_VERSION,events:0};}
export {V38_LEDGER_VERSION,v38Enroll,v38Settle,v38Summary};
