"""Read-only real 5-minute GitHub collector rejection funnel; no alerts or source changes."""
from __future__ import annotations
import collections
import datetime as dt
import json
import subprocess

KST=dt.timezone(dt.timedelta(hours=9))
START=dt.datetime(2026,10,29,0,0,tzinfo=KST)

def git(*args):
    return subprocess.run(["git",*args],check=True,capture_output=True,text=True).stdout

def main():
    shas=git("log","--format=%H","--","data/latest.json").splitlines()
    frames={}
    invalid=0
    for sha in shas:
        try:j=json.loads(git("show",sha+":data/latest.json"))
        except (subprocess.CalledProcessError,json.JSONDecodeError,UnicodeDecodeError):
            invalid+=1;continue
        raw=j.get("collector_kst")
        try:t=dt.datetime.fromisoformat(raw)
        except (ValueError,TypeError):
            invalid+=1;continue
        if t<START:continue
        key=raw
        frames.setdefault(key,(sha,j))
    byreason=collections.Counter()
    futureclass=collections.Counter()
    futurebook=collections.Counter()
    futureproof=collections.Counter()
    directions=collections.Counter()
    totals=collections.Counter()
    qualified=[]
    for t,(sha,j) in sorted(frames.items()):
        if j.get("collector_status")=="PASS":totals["collector_pass"]+=1
        else:totals["collector_nonpass"]+=1
        sf=j.get("spot_flow") or {}
        sd=j.get("spot_directional") or {}
        fu=j.get("futures_flow") or {}
        align=j.get("futures_price_time_alignment") or {}
        totals["spot_prescreen_shortlisted"]+=sf.get("shortlisted") or 0
        totals["spot_early_watch"]+=sf.get("early_watch_total") or 0
        totals["spot_reviewed"]+=sd.get("reviewed") or 0
        totals["spot_qualified"]+=sd.get("qualified") or 0
        totals["spot_queued"]+=sd.get("queued_for_next_scan") or 0
        if sd.get("status")!="EVALUATED":totals["spot_no_evaluation"]+=1
        for d in sd.get("diagnostics") or []:
            byreason[d.get("status") or "UNKNOWN"]+=1
        for o in fu.get("observations") or []:
            totals["futures_selected"]+=1
            futureclass[o.get("flow_class") or "UNKNOWN"]+=1
            futurebook[(o.get("book_proof_v13") or {}).get("status") or "UNKNOWN"]+=1
            futureproof[o.get("price_context_status") or "UNAVAILABLE"]+=1
            if (o.get("flow_class") or "").startswith("SUSTAINED_") and (o.get("book_proof_v13") or {}).get("status")=="TWO_DISTINCT_BOOK_SNAPSHOTS":
                qualified.append({"asof_kst":t,"symbol":o.get("symbol"),
                    "side":o.get("flow_class"),"price_align":o.get("price_context_status"),
                    "flow_end":(o.get("taker_flow_15m") or {}).get("end_ms")})
        totals["futures_verified_fills"]+=fu.get("verified_count") or 0
        totals["futures_aligned_real_price"]+=align.get("aligned") or 0
        totals["futures_price_align_failed"]+=align.get("failed") or 0
        if sd.get("signals"):
            directions["spot"]+=len(sd["signals"])
    report={"status":"READ_ONLY_ALL_COLLECTOR_COMMIT_FUNNEL",
            "history_commits_read":len(shas),"snapshots_since_20261029":len(frames),
            "invalid_history":invalid,"from_kst":min(frames) if frames else None,
            "to_kst":max(frames) if frames else None,
            "totals":dict(totals),"spot_reject_reason_counts":dict(byreason),
            "futures_flow_classes":dict(futureclass),
            "futures_book_status":dict(futurebook),
            "futures_price_context":dict(futureproof),
            "verified_flow_and_two_book_overlap_count":len(qualified),
            "verified_flow_and_two_book_examples":qualified[:15],
            "spot_directional_signals_recorded":directions["spot"],
            "notes":["This is a collector-level funnel, not live Telegram send receipts.",
                     "Candidate counts across scans are not unique trade opportunities.",
                     "Futures market classifications include observation-only data and do not guarantee direction accuracy."]}
    print("IRYS_V15_ZERO_ALERT_CAUSAL_FUNNEL "+json.dumps(report,ensure_ascii=False,separators=(",",":")))

if __name__=="__main__":main()
