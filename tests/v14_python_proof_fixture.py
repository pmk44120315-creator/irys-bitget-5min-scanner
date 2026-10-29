"""Offline, genuine Python V14 native proof -> JSON for Node contract test."""
import json
import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from test_spot_direction_v13 import NOW, M, feed, flow, book, cvd, early
from spot_direction import evaluate_market

at=NOW+5*M
previous={'sample':{
    'time_ms':at-5*M,
    'book':book(at-5*M),
    'buy_share':.72,'net_buy_krw':8_000_000,
    'recent_net_buy_krw':3_000_000,'trades':80,'close':101.0,
}}
trade_cvd=cvd()
trade_cvd.update({'start_ms':at-15*M,'end_ms':at,
                  'candle_relative_error':.001})
with patch('spot_direction.trade_sample',return_value=flow()), \
     patch('spot_direction.book_snapshot',return_value=book(at)), \
     patch('spot_direction.cvd_15m',return_value=trade_cvd):
    result=evaluate_market(early(),previous,at,feed(gap=2))
assert result['validated_direction'] is True,result
assert result['structure']['closed_20m_candles'] is False,result
assert result['structure']['source']=='BITHUMB_OFFICIAL_COMPLETED_NATIVE_5M_AND_TRADE_1M'
print(json.dumps(result['proof'],ensure_ascii=False,separators=(',',':')))
