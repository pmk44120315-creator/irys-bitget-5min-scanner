"""V18 market evidence entrypoint. Original collector.py remains byte-identical.
Normal full market collection, Spot flow, OI, data writes and GitHub workflow
remain the same. Only the read-only Bitget 15m taker candidate selector is
opted in to the blended baseline+reversal path. No orders and no Telegram.
"""
import collector
from bitget_futures_cvd import collect_futures_flow_observations

def v18_reconciled_futures(latest, now_ms, api, limit=6, state=None):
    return collect_futures_flow_observations(
        latest, now_ms, api, limit=limit, state=state, v18_select=True)

collector.collect_futures_flow_observations=v18_reconciled_futures

if __name__=="__main__":
    raise SystemExit(collector.main())
