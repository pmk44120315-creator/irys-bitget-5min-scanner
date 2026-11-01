# IRYS V23 — 직접 급변 탐색 운영 개선 기록 (2026-11-01)

## 실제 원인과 목표
- 사용자 핵심 요구: 빗썸 원화 현물 급등 초입, 비트겟 USDT 선물 빠른 발견, 실제 체결·호가와 이후 방향 근거, 텔레그램 알림이 계속 0건이거나 부정확하게 대량 발송되는 악순환 방지.
- GitHub 전 종목 선물 1m 봉 및 OI 수집은 실제 한 실행에 약 3–4분 걸린 사례가 있음. 기존 Worker의 감시 주기는 5분이었지만, GitHub 완료 자료만으로 최신 급등 초입을 판단하는 것은 늦을 수 있음.
- 기존 Worker의 빗썸 빠른 WATCH 경로는 `earlyRun={status:'PRICE_TURNOVER_ONLY_INTERNAL_WATCH_NOT_TELEGRAM'}`로 명시적으로 보내지 않았음.
- 기존 비트겟 방향 경로는 두 개의 별도 호가 스냅샷, 실제 15분 체결 등 추가 증거 요구. 호가 미충족 로그만으로 방향이 맞았을 것이라 주장할 수 없음.
- V21 동결 예측 모델은 새로운 5분 호가 사후 검증에서 양방향 비용 차감 평균이 마이너스였음. 모델 성적을 높였다는 근거 없이 방향 알림 조건을 완화하면 이전 대량 오답을 되풀이할 위험이 큼.

## V23 구현 방식
1. 기존 Cloudflare `irys-surge-monitor` 5분 Cron이 GitHub 전체 수집을 dispatch한 즉시, **별도의 실제 시세 API를 직접 확인**하고 이전 Cloudflare KV 시세 스냅샷과 비교. 3–9분 간격 시세의 첫 움직임을 탐지하며 과거 15분 동일방향, 20개 연속 1분봉, 3000만 원 고정 유동성 하드게이트가 없음.
2. 비트겟 공식 V3 `/api/v3/market/instruments?category=USDT-FUTURES`에서 crypto/crypto로 검증된 계약만 포함. 공식 V2 전체 선물 ticker의 현재가/매수·매도호가/24시간 거래대금 조회. **24시간 거래대금 차분을 5분 매수 수급으로 오해하지 않음**.
3. 빗썸 공식 원화마켓/거래유의/전체 ticker 조회. KST 0시 기준 누적 거래대금의 **같은 거래일 시차 차이**로 관측 5분 거래대금 계산. 거래유의·상장폐지·거래정지 종목 제외.
4. 실거래소 Bithumb ticker의 `timestamp`/`trade_timestamp`는 약 **9시간 미래**로 보였지만, UTC 날짜·시간 필드 `trade_date`+`trade_time`은 올바름. 이 실제 자료를 사용해 UTC 타임스탬프 재구성. Bithumb `/v1/trades/ticks`는 `timestamp`가 실제 UTC이고 `trade_timestamp`가 없었음. 두 API를 구분해 신선도를 판단하도록 수정.
5. 급격한 가격 상승 후보 중 실제 직전 가격·거래대금·현재 호가를 확인한 종목의 공개 최근 체결 100/500개를 참고. **부분 체결 표본을 전체 시장 CVD/큰손 매집 증거라고 주장하지 않음**.
6. V23 텔레그램은 `V23_DIRECT_FAST_MARKET_WATCH` 채널. '급등 초기 포착, **미래 LONG/SHORT/BUY 확정 아님**'으로 명확히 표기하며 한 번에 최대 1개, 시간당 2개, 동일 종목 90분 알림 중복 억제. 이는 전달 페이싱으로 시장 후보선정/미래 모델 실험과 독립.
7. V21 동결 모델·방향 검증, 기존 V17/V19 과다 알림 차단, 공식 거래유의 보호, GitHub V18/V22 수집, ChatGPT 매시간 감시는 원본 그대로 유지. 실제 주문·자동매매·계좌 API·개인키 접근 없음.

## 실제 검증
- 단위/회귀: [V23 full Worker 테스트](https://github.com/pmk44120315-creator/irys-bitget-5min-scanner/actions/runs/41279781832) — JS 30개(새 15+기존 15), Python 144개 PASS.
- 빗썸·비트겟 공식 원본 실조회: [V23 live source smoke](https://github.com/pmk44120315-creator/irys-bitget-5min-scanner/actions/runs/41279377407). 비트겟 crypto USDT 선물 465개, 빗썸 KRW 시장 489개/실제 조회 479개. 공식 전체 ticker 조회 1.2초 (GitHub Actions 실행환경 수치이지 Cloudflare 배포 시간 아님).
- 실제 거래소 9시간 시각 차 검증: [Bithumb clock diagnostic](https://github.com/pmk44120315-creator/irys-bitget-5min-scanner/actions/runs/41279550861), 2026-11-01 06:07:50 UTC. ticker 원시 timestamp ≈ UTC+9h, trade_date/time는 UTC; public trades/ticks timestamp는 실제 UTC. 오류 재현 후 수정·테스트 통과.
- Cloudflare 운영 코드 배포: [V23 guarded live release](https://github.com/pmk44120315-creator/irys-bitget-5min-scanner/actions/runs/41279985483) 2026-11-01 15:14 KST. 실제 Worker SHA-256 `f53ced30287544784d92bf74bb644177add46379781cdb7e3874a9ec1ee2c182`, Cron `*/5 * * * *` 및 AI/IRYS_KV/GitHub/Telegram 연결 보존 확인.
- 자연 예약 실행 및 Bot API 알림 실적은 **배포 성공과 다르게 별도 확인**해야 하며, 실제 미래 방향 적중률 향상도 아직 미검증. 휴대전화 기기 수신 여부 역시 미확인.

## 사용자 목표 대비 정직한 상태
- 빠른 시세 탐색 경로 구현·서버 코드 배포: **검증 완료**.
- 빠른 탐색 신규 자연 Cron 실행/새 텔레그램 Bot API ACK: 별도 실제 기록 확인 전 **미확인**.
- V23 WATCH는 움직임을 빠르게 찾는 정보 경보이며, 모델의 5–15분 이후 방향 정확도가 향상됐다는 증거가 아님.
- 실전으로 정확한 LONG/SHORT/BUY 방향을 자동 통보하는 목표는 **아직 미달성**. V22 미래 검증 결과를 기반으로 개선하되, 승률이 마이너스인 V21 모델을 방향 신호로 재활성화해서는 안 됨.
