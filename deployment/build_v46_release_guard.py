"""Reuse the exact proven code-only lease/readiness/rollback machinery."""
from pathlib import Path
import hashlib,sys
raw=Path(sys.argv[1]).read_bytes();assert hashlib.sha256(raw).hexdigest()=='765b7497d1fcf87ff6f3094d073a999cce9413fbf57384eaca2f9299b0147c8b','ORIGINAL_GUARD_SHA'
s=raw.decode()
s=s.replace("const OLD='99845f001c17542fbe1c5c1a7dde9beadef1881d6f31f1c1e0f7765109b9e3bb'","const OLD='f78b500927f41af3412c17bd3b47c25e3d9fba9c6d156a72302c67266a2a40cd'")
s=s.replace("const NEW='f78b500927f41af3412c17bd3b47c25e3d9fba9c6d156a72302c67266a2a40cd'","const NEW='9979d4c357cbb520c4cc8f2c68b55adf93264b53d992c9c3562c82b2e1ca8bc4'")
s=s.replace('IRYS-V45-RSI-ENTRY-CONTEXT-20261109','IRYS-V46-NATIVE-CONTEXT-QUALITY-20261110').replace('fix/irys-v45-rsi-entry-context-20261109','fix/irys-v46-full-audit-20261110').replace('v45_release','v46_release').replace('IRYS_V45_RSI_WORKER.mjs','IRYS_V46_CONTEXT_WORKER.mjs')
s=s.replace("if(a.rsiEntryContextEnabled===true&&a.rsiEntryContextVersion==='V45_RSI_ENTRY_CONTEXT_V1')return a;","if(a.rsiEntryContextEnabled===true&&a.rsiEntryContextVersion==='V45_RSI_ENTRY_CONTEXT_V1'&&a.nativeObservedRsiDisclosureEnabled===true)return a;")
s=s.replace("rsi_version:a.rsiEntryContextVersion??null,","rsi_version:a.rsiEntryContextVersion??null,native_observed_disclosure:a.nativeObservedRsiDisclosureEnabled===true,")
s=s.replace("live_rsi_context_enabled:true,forecast_policy_replaced:false,","live_rsi_context_enabled:true,native_observed_disclosure_enabled:true,forecast_policy_replaced:false,")
Path(sys.argv[2]).write_text(s);print(hashlib.sha256(s.encode()).hexdigest())
