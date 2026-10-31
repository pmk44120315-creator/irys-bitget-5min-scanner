"""Align a slightly early existing 5m job with a pending quote target.
This is quote sampling, not a test/run limit or an extra scheduled task.
No waiting for distant targets, and no use of an early price as a future label.
"""
import time
MIN=60000

def align_validation_clock(pending,now,clock=None,sleeper=None):
    clock=clock or time.time
    sleeper=sleeper or time.sleep
    targets=[]
    for r in pending:
        issued=r.get('issued_ms');h=r.get('horizon_min')
        if isinstance(issued,int) and issued<=now and h in (5,15):
            targets.append(issued+h*MIN)
    if any(now-150000<=t<=now for t in targets):
        return max(now,int(clock()*1000)),0
    upcoming=[t for t in targets if now<t<=now+90000]
    if not upcoming:return max(now,int(clock()*1000)),0
    due=min(upcoming)
    sleeper((due-now+50)/1000)
    sampled=max(now,int(clock()*1000))
    return sampled,max(0,sampled-now)
