"""Safe one-off verification of Bithumb public REST schemas; no trading calls."""
import json
import time
import urllib.parse
import urllib.request

from spot_continuity import book_snapshot, cvd_15m
from spot_flow import candles, window


def public_api(venue, path, params):
    assert venue == 'bithumb', 'unexpected venue'
    assert path in ('/v1/trades/ticks', '/v1/orderbook', '/v1/candles/minutes/1'), 'not a read-only data path'
    url = 'https://api.bithumb.com' + path + '?' + urllib.parse.urlencode(params)
    req = urllib.request.Request(
        url, headers={'Accept': 'application/json',
                      'User-Agent': 'IRYS-readonly-schema-verifier/1.0'})
    with urllib.request.urlopen(req, timeout=15) as response:
        return json.load(response)


def main():
    market = 'KRW-BTC'
    book_now = int(time.time() * 1000)
    raw_book = public_api('bithumb', '/v1/orderbook', {'markets': market})
    book = book_snapshot(market, book_now, lambda *args: raw_book)
    if book is None:
        row = raw_book[0] if isinstance(raw_book, list) and raw_book else {}
        units = row.get('orderbook_units') or []
        print(json.dumps({
            'book_debug':'BOOK_UNUSABLE',
            'market':row.get('market'),
            'age_ms': book_now - int(row.get('timestamp') or 0),
            'levels':len(units),
            'top5':[{'bid_size':x.get('bid_size'),'ask_size':x.get('ask_size'),
                     'bid_price':x.get('bid_price'),'ask_price':x.get('ask_price')}
                    for x in units[:5]],
        }))
        raise RuntimeError('Public orderbook structure/time not usable')
    ticks = public_api('bithumb', '/v1/trades/ticks',
                       {'market': market, 'count': 10})
    if not isinstance(ticks, list) or not ticks:
        raise RuntimeError('Missing public ticks')
    ids = []
    for row in ticks:
        if not isinstance(row, dict):
            raise RuntimeError('Invalid tick type')
        for key in ('sequential_id', 'timestamp', 'ask_bid',
                    'trade_price', 'trade_volume'):
            if key not in row:
                raise RuntimeError('Missing tick key: ' + key)
        if row['ask_bid'] not in ('BID', 'ASK'):
            raise RuntimeError('Unrecognized taker side')
        ids.append(str(row['sequential_id']))
    # Live Bithumb API sometimes reuses sequential_id for distinct trades.
    # Count collisions; the verifier uses a composite execution fingerprint.
    fingerprints = [(str(t['sequential_id']), str(t['timestamp']),
                     str(t['ask_bid']), str(t['trade_price']),
                     str(t['trade_volume'])) for t in ticks]
    collisions = len(ids) - len(set(ids))
    ambiguous = len(fingerprints) - len(set(fingerprints))
    print(json.dumps({'result': 'PUBLIC_READONLY_SCHEMA_OK',
                      'market': market, 'book_top5_ratio': book['bid_ask_top5_ratio'],
                      'tick_count': len(ticks), 'shared_sequential_ids':collisions,
                      'exact_duplicate_fingerprints':ambiguous}))



    # One full 15-minute public tick/candle reconciliation on the candidate market.
    # Unlike an offline fixture, this exercises the actual Bithumb paging contract.
    wld_now = int(time.time() * 1000)
    wld_raw = public_api('bithumb', '/v1/candles/minutes/1',
                         {'market':'KRW-WLD', 'count':40})
    wld_candle = window(candles(wld_raw, wld_now), wld_now, 15)
    if wld_candle is None:
        print(json.dumps({'result':'WLD_PUBLIC_15M_RECONCILIATION','verified':False,
                          'reason':'CANDLE_GAP','alert_allowed':False,
                          'note':'quiet market coverage is incomplete; schema test remains independent'}))
        return
    wld_cvd = cvd_15m('KRW-WLD', wld_now,
                       wld_candle['quote_krw'], public_api)
    print(json.dumps({'result':'WLD_PUBLIC_15M_RECONCILIATION',
                      'verified':wld_cvd.get('verified'),
                      'reason':wld_cvd.get('reason'),
                      'pages':wld_cvd.get('pages'),
                      'candle_relative_error':wld_cvd.get('candle_relative_error'),
                      'closed_15m_turnover_krw':round(wld_candle['quote_krw'])}))
    if not wld_cvd.get('verified'):
        print(json.dumps({'result':'WLD_MARKET_PROOF_UNVERIFIED',
                          'alert_allowed':False,'reason':wld_cvd.get('reason')}))
        return

if __name__ == '__main__':
    main()
