"""Expand one Telegram ACK bundle into audited symbol events, never extra sends."""
from __future__ import annotations
import re

def expand_receipts(envelopes: list[dict]) -> list[dict]:
    result=[];seen={}
    for wrapper in envelopes:
        r=wrapper.get('receipt') or wrapper
        mid=r.get('telegram_message_id')
        if not isinstance(mid,int) or isinstance(mid,bool) or mid<=0:raise ValueError('UNACKNOWLEDGED_MESSAGE')
        channel=r.get('channel','')
        if '_OUTCOME_' in channel:continue
        stamp=r.get('ack_received_at_ms') or wrapper.get('event_ms') or r.get('recorded_send_ms')
        if not isinstance(stamp,int) or isinstance(stamp,bool):raise ValueError('MISSING_ACK_REFERENCE_TIME')
        snapshot=r.get('market_snapshot') or {}
        bundled=snapshot.get('bundle_version')=='V28_ACK_BUNDLE_V1'
        entries=snapshot.get('bundle') if bundled else [dict(snapshot,symbol=r.get('symbol'))]
        if not isinstance(entries,list) or not entries:raise ValueError('EMPTY_ACK_BUNDLE')
        for entry in entries:
            if not isinstance(entry,dict):raise ValueError('INVALID_ACK_ITEM')
            symbol=entry.get('symbol')
            if not isinstance(symbol,str):raise ValueError('INVALID_ACK_SYMBOL')
            venue='bithumb' if re.fullmatch(r'KRW-[A-Z0-9]{2,25}',symbol) else 'bitget' if re.fullmatch(r'[A-Z0-9]{2,25}USDT',symbol) else None
            if venue is None or entry.get('venue',venue)!=venue:raise ValueError('INVALID_ACK_MARKET')
            direction=None if 'WATCH' in channel else entry.get('forecast_direction')
            if direction not in (None,'LONG','SHORT','BUY','UP','DOWN'):raise ValueError('INVALID_ACK_DIRECTION')
            event={'message_id':mid,'symbol':symbol,'venue':venue,'event_ms':stamp,'direction':direction,'channel':channel,
                   'market_snapshot':entry,'bundle':bundled,'device_received_verified':False,'actual_execution_verified':False}
            key=(mid,symbol)
            if key in seen:
                if seen[key]!=event:raise ValueError('CONFLICTING_ACK_ITEM')
                continue
            seen[key]=event;result.append(event)
    return sorted(result,key=lambda r:(r['event_ms'],r['message_id'],r['symbol']))
