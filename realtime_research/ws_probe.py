"""Public Bithumb live WebSocket probe, independent of production scanners.

Proof of technical feasibility, NOT a 24x7 deployed collector.
No tokens, account API calls, notifications, or orders.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import math
import time
import uuid

WS = "wss://ws-api.bithumb.com/websocket/v1"


def numeric(v):
    try:
        n = float(v)
        return n if math.isfinite(n) else None
    except (TypeError, ValueError, OverflowError):
        return None


class Metrics:
    def __init__(self, market):
        self.market = market
        self.first_seen = None
        self.last_seen = None
        self.trade_count = 0
        self.book_count = 0
        self.other_count = 0
        self.buy_krw = 0.0
        self.sell_krw = 0.0
        self.book_bid_sizes = []
        self.book_ask_sizes = []
        self.orderbook_sample_seconds = []
        self.last_book_monotonic = None
        self.gaps_over_two_s = 0

    def add(self, obj, received_monotonic=None):
        received_monotonic = time.monotonic() if received_monotonic is None else received_monotonic
        if not isinstance(obj, dict):
            self.other_count += 1
            return
        if obj.get("error") or obj.get("status") in ("ERROR", "FAILED"):
            raise ValueError("market_websocket_error: " + str(obj)[:200])
        typ = obj.get("type")
        if obj.get("code") != self.market:
            self.other_count += 1
            return
        if self.first_seen is None:
            self.first_seen = received_monotonic
        self.last_seen = received_monotonic
        if typ == "trade":
            price, qty = numeric(obj.get("trade_price")), numeric(obj.get("trade_volume"))
            side = obj.get("ask_bid")
            if None in (price, qty) or price <= 0 or qty <= 0 or side not in ("BID", "ASK"):
                self.other_count += 1
                return
            self.trade_count += 1
            if side == "BID":
                self.buy_krw += price * qty
            else:
                self.sell_krw += price * qty
        elif typ == "orderbook":
            units = obj.get("orderbook_units")
            if not isinstance(units, list) or not units:
                self.other_count += 1
                return
            bid = sum((numeric(x.get("bid_size")) or 0) for x in units if isinstance(x, dict))
            ask = sum((numeric(x.get("ask_size")) or 0) for x in units if isinstance(x, dict))
            self.book_bid_sizes.append(round(bid, 8))
            self.book_ask_sizes.append(round(ask, 8))
            self.book_count += 1
            if self.last_book_monotonic is not None:
                delta = received_monotonic - self.last_book_monotonic
                if delta > 2:
                    self.gaps_over_two_s += 1
                self.orderbook_sample_seconds.append(round(delta, 3))
            self.last_book_monotonic = received_monotonic
        else:
            self.other_count += 1

    def report(self):
        return {
            "market": self.market,
            "trade_updates": self.trade_count,
            "orderbook_updates": self.book_count,
            "aggressive_buy_krw_sample": round(self.buy_krw, 0),
            "aggressive_sell_krw_sample": round(self.sell_krw, 0),
            "taker_net_krw_sample": round(self.buy_krw - self.sell_krw, 0),
            "max_book_gap_seconds": max(self.orderbook_sample_seconds, default=None),
            "book_intervals_over_two_s": self.gaps_over_two_s,
            "first_to_last_update_seconds": round(self.last_seen - self.first_seen, 3)
            if self.first_seen is not None else 0,
            "orderbook_absorption_verified": False,
            "complete_continuous_cvd_verified": False,
            "note": "Live public samples only; no cross-exchange/whale verification.",
        }


async def run_probe(market="KRW-BTC", duration_sec=12):
    # Keep this probe short and within a strict maximum.
    if not isinstance(market, str) or not market.startswith("KRW-"):
        raise ValueError("invalid Bithumb market")
    if not 3 <= duration_sec <= 20:
        raise ValueError("3..20 seconds only in one-shot probe")
    import websockets
    stats = Metrics(market)
    request = [
        {"ticket": "irys-readonly-probe-" + uuid.uuid4().hex},
        {"type": "trade", "codes": [market], "is_only_realtime": True},
        {"type": "orderbook", "codes": [market], "is_only_realtime": True},
        {"format": "DEFAULT"},
    ]
    async with websockets.connect(WS, ping_interval=15, ping_timeout=15,
                                  open_timeout=10, close_timeout=3,
                                  max_size=2_000_000) as socket:
        await socket.send(json.dumps(request))
        deadline = time.monotonic() + duration_sec
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            try:
                raw = await asyncio.wait_for(socket.recv(), timeout=remaining)
            except asyncio.TimeoutError:
                break
            payload = json.loads(raw)
            stats.add(payload)
    report = stats.report()
    print(json.dumps({"result": "PUBLIC_WS_STREAM_PROBE", **report}, ensure_ascii=False))
    if stats.trade_count < 2 or stats.book_count < 2:
        raise RuntimeError("PUBLIC_WS_INCOMPLETE: both channels require multiple live updates")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--market", default="KRW-BTC")
    parser.add_argument("--duration-sec", type=int, default=12)
    args = parser.parse_args()
    asyncio.run(run_probe(args.market, args.duration_sec))
