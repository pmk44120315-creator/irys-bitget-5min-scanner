# Public Bitget USDT-M 5-minute reader

This repo collects public, read-only market observations from Bitget every five minutes using GitHub Actions. It contains NO Telegram bot tokens, account data, API credentials or trading commands.

- Checks all officially normal USDT perpetual contract symbols, 1-minute candles (complete 1/5/15/60-min windows and preceding adjacent baseline), raw OI and changes from a previous run, funding and a sample of futures fills for up to 25 high-volume symbols.
- Output: data/latest.json and data/state.json (public market data only).
- A watchlist is a DATA ANOMALY, never a buy recommendation. Futures fills are not spot CVD. This scanner does not confirm real spot absorption, token unlocks, project identity, exchange inflows, or delisting status.
- Observed Bitget OI is an exchange raw size unit, not automatically USDT notional. IRYS and IRISnet IRIS are distinct assets.
- Error or incomplete scan must not be passed off as success.
- This repo DOES NOT send Telegram messages. A separate alert service, with protected secrets, must cross-check spot flow and risk and handle notification.
- GitHub's scheduled events may be delayed/dropped; five minutes is a target interval, not a latency SLA.
- Standard GitHub-hosted Actions runners in public repos are free subject to applicable GitHub terms and limits.

Do not add any private credentials to this repository. No orders. No trading.
