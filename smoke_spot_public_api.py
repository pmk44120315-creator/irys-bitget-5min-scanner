"""Safe one-off verification of Bithumb public REST schemas; no trading calls."""
import json
import time
import urllib.parse
import urllib.request

from spot_continuity import book_snapshot


def public_api(venue, path, params):
    assert venue == 'bithumb', 'unexpected venue'
    assert path in ('/v1/trades/ticks', '/v1/orderbook'), 'not a read-only data path'
    url = 'https://api.bithumb.com' + path + '?' + urllib.parse.urlencode(params)
    req = urllib.request.Request(
        url, headers={'Accept': 'application/json',
                      'User-Agent': 'IRYS-readonly-schema-verifier/1.0'})
    with urllib.request.urlopen(req, timeout=15) as response:
        return json.load(response)


def main():
    market = 'KRW-BTC'
    book = book_snapshot(market, int(time.time() * 1000), public_api)
    if book is None:
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
    if len(ids) != len(set(ids)):
        print(json.dumps({'schema_debug':'NONUNIQUE_TRADE_IDS',
                          'ids':ids[:10], 'keys':sorted(ticks[0].keys()),
                          'id_types':[type(r['sequential_id']).__name__ for r in ticks[:10]]}))
        raise RuntimeError('Duplicate IDs in one tick response')
    print(json.dumps({'result': 'PUBLIC_READONLY_SCHEMA_OK',
                      'market': market, 'book_top5_ratio': book['bid_ask_top5_ratio'],
                      'tick_count': len(ticks)}))


if __name__ == '__main__':
    main()
