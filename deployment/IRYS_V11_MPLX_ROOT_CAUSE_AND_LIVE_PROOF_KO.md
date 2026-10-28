# IRYS MPLX 실패 원인 및 V11 복구 장부 (2026-10-28 KST)

## 실제 놓친 조기 급등
- KRW-MPLX 17:03 KST 가격 65.99원, 17:08 68.01원(+3.061%, 5분 환산 누적 거래대금 약 34,173,381원). 감시 프리스크린에서 `ELIGIBLE_FOR_DETAILED_CHECK`로 포착했으나 최근 완성된 1분봉 부족에 따라 `WAIT_RECENT_CANDLE_GAP`으로 **확정 BUY는 올바르게 차단**.
- 17:11 약 74.96원(+10.2% 대/17:08), 이전 5분 수집과 실제 간격 약 2.824분. 기존 코드 `3<=minutes<=8`이 false여서 모든 원화마켓의 `spot_fast.count`를 0으로 초기화. 17:14 67.85원·count=1, 17:18 72.15원·count=2, 17:23 79.22원·count=3으로 새 기준 준비 중 급등 지속. 이는 체결/캔들 소스 오류가 아니라 **경과시간 하한으로 인한 이력 초기화 결함**.
- 17:28 81.20원, 이후 당일 상승률 제한 때문에 `DAILY_MOVE_LIMIT`으로 정밀 매수 후보 제외.
- 종합: "가격·거래대금 조기 움직임"을 "15분 체결 완전성 검증된 현물 매수 신호"와 하나로 묶고 watch-only 후보의 Telegram 전송이 없음 → 사용자는 급등을 포착해도 알림이 없었음.

## 수집기 변경
- PR#9 https://github.com/pmk44120315-creator/irys-bitget-5min-scanner/pull/9 main 병합, SHA `95e4c048eb0bc29a6646071e6f6e0467beb71c8c`.
- 비교 구간을 실제 2~8분까지 허용해 관측 시각 차이에 맞게 5분 환산 거래대금 계산. 2분 미만 중복 수집 때 기준값/EMA/연속 관측 횟수 보존.
- 기존 `spot_flow.signals` 검증 계약/원래 BUY 알림 조건 일절 완화하지 않음. 별도 `spot_flow.early_watch_observations`에 공식 현물 시장·위험경보를 확인한 뒤, 일일 변동이 큰 경우도 `LATE_CHASE_CAUTION` 분류로 명시.
- 실제 MPLX 17:08·17:11 가격/누적액을 이용한 재현과 경보 제외·중복 구간·안전성 등 5 신규 테스트 포함 총 59 Python 수집 + 22 AI 테스트 PASS GitHub run 40697982752.

## Telegram V11 적용
- Cloudflare Worker **irys-surge-monitor V11** 코드-only 배포: `IRYS-V11-SPOT-FUTURES-EARLY-WATCH-20261028`.
- SHA256 `95d88a10010ab054c377f2a99202c2abeae860ab40c82e2beb11e003a37301d7` (실제 소스와 원격 바이트 대조 PASS). 기존 V10 원본 `5c5c2f045fe2140c2ae245f15c7f02f9320f30533cf1c6ba75777dc604c7f1b1`을 배포 전 확인. Cron `*/5 * * * *`, KV, Workers AI, GitHub, Telegram 바인딩 동일.
- 기존 V10 Bitget LONG/SHORT 15분 체결 검증 + 기존 Bithumb 지속매수 확정의 강한 알림은 변경 없음. 저근거 2분 Workers AI 직접 방향 알림 차단 유지.
- 새 **조기 가격·거래대금 관측만 알리는** 독립 경로: 실제 2~8분 가격 상승 최소 0.9%, 5분 환산 거래대금 최소 3천만원, 이전 EMA 대비 최소 2.5배, 24h 기준 규모 비교, 공식 거래 경보/상태 재확인, 최근 10분 이내만 전송. 5분 실행당 최대 1종목, 전체 1시간 최대 3건, 동일 종목 3시간 쿨다운.
- 메시지에 `매수신호 아님`, `5분 환산 추정`, `현물 CVD/호가흡수/미래 방향 미확인`을 강제 표시. 이미 급등한 경우 `늦은 추격 경고`. 주문/계좌 접근 금지.
- 실배포: https://github.com/pmk44120315-creator/irys-bitget-5min-scanner/actions/runs/40699245997 (49 Python + 22 AI + 28 JS 검사 PASS, 프리플라이트/소스 교체/기존 설정/복구 안전장치 확인).
- 첫 자동 실행: **22:45 KST**, V11 PASS/GitHub dispatch ACCEPTED, earlyMarketWatch.status=EARLY_OBSERVATION_SENT, sent=1, send_error=null. 실제 스냅샷은 **KRW-BIOT** 관측: 0.3948원, 약 2.96분 +1.884%, 5분 환산 거래대금 70,377,394원, 이전 EMA 대비 7.34배. 텔레그램 API 성공 응답 확인. 사용자의 기기 알림 수신 및 그 후 5/15/30분 가격 방향 적중은 **아직 미검증**.
- 당시 최신 22:44 데이터의 **KRW-MPLX는 OFFICIAL_WARNING** 상태라서 새 관측 알림에서도 차단됨. 추격 매수 권유 금지.
- 런타임 감사: https://github.com/pmk44120315-creator/irys-bitget-5min-scanner/actions/runs/40699448689 (Cloudflare V11 source SHA/바인딩/5분 Cron/첫실행 확인).
- 이전 V10 연구/원본은 Draft PR#7에 보존. 이 브랜치는 새 V11 코드와 release 로그를 저장하며, 의도치 않은 main 재병합/재배포를 방지하도록 Draft PR로 보관.

## 검증 한계
1. "시장 움직임 관측"이 실제 매수 기회인지 판단하는 성과는 검증되지 않음. 조기 관측 조건은 현물 공격매수 유입 확인이 아님.
2. 사용자 기기에 메시지가 나타났는지는 Telegram API 반환만으로 확정 불가능.
3. 24시간 실제 실행 안정성, 조기 후보 vs 놓친 급등, 후행 가격·거짓 알림률 등은 아직 통계화 필요. "완벽·돈 버는 신호 보장" 금지.
