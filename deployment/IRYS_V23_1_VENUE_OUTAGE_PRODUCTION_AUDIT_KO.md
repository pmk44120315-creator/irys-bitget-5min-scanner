# IRYS V23.1 — 거래소 장애 격리 실서버 긴급 수정 (2026-11-01)

## 현장에서 직접 확인한 장애
- 2026-11-01 20:20 KST 자연 Cloudflare Cron: V23 Worker PASS, GitHub dispatch ACCEPTED, Telegram Bot ACK 총192회로 변화 없음.
- Direct scout status `PUBLIC_TICKER_FEED_PARTIAL`, 원인 `bitget_instruments_FAILED`, `bitget_tickers_FAILED`, `BITGET_UNIVERSE_UNAVAILABLE`.
- 비트겟 두 공개 API 장애 때문에 **정상 반환한 빗썸 원화마켓 시세 비교와 텔레그램 발송까지 일괄 중단**한 V23 코드 오류를 확정함.
- 구버전 V21 미래 방향 모델은 공개 호가 실제 사후 평가에 평균 손실: Telegram 방향 알림 자격 미통과. 비트겟 기존 15분 체결+2호가 조건도 빈번히 신호0건. 이들 기존 독립 전략의 결함을 V23.1로 해결했다고 주장하지 않는다.

## 적용한 수정
- `v23ReadFeeds`는 네 개 공식 원천의 결과·실패 유형을 확인하고 **venue별** `availability.bithumb / availability.bitget`으로 격리한다.
- `v23ScoutTick`: 양쪽이 모두 실패하면 원래 KV 시세기준을 보존하고 알림 0, 한쪽만 정상이면 정상 거래소의 5분 실제 시세 비교와 시세 후보 판정·알림 계속.
- 거래소별 독립 `spot_at_ms`, `futures_at_ms`; 한쪽 API가 실패한 사이 타 거래소의 기존 시세와 기준시각을 덮어쓰지 않음. 복구 후 10분 이상 차이를 억지로 5분 가격 수익률이라고 오해하지 않음.
- 기존 Bitget V3 crypto 전용 분류, Bithumb 공식 경보, 현재가 시간 교정, Telegram Bot API ACK/중복 제어(1회/틱, 2회/시간, 90분/종목), V21/AI 방향 신호 비활성 검증 경로 보존.
- 간결한 Telegram `V23_DIRECT_FAST_MARKET_WATCH`는 현재 급등 관측 정보다. **미래 LONG/SHORT/BUY 진입 방향 적중을 뜻하지 않는다.**

## 검증과 진실성
- 2026-11-01 20:24 KST [V23.1 실제 코드만 Cloudflare 배포](https://github.com/pmk44120315-creator/irys-bitget-5min-scanner/actions/runs/41301710446).
- 실제 Worker SHA-256 `26f72a82351480c14ef1361c7ee38ced0189ccf6b307bfca57ade3f8cfb3926e`. 이전 V23 SHA-256 `f53ced30287544784d92bf74bb644177add46379781cdb7e3874a9ec1ee2c182`를 배포 전에 확인.
- GitHub Actions 17 신규/기존 V23 1차 테스트 + V21 JS 15 + Python 144 통과. 단일 거래소 장애양쪽 방향, 양쪽 장애, 이전 시세 보존, Telegram 확인 영수증 실증 모의 포함.
- 기존 Cloudflare 5분 Cron `*/5 * * * *`, AI/IRYS_KV/Github-dispatch/Telegram 기존 binding 이름·값 유지. 원본 GitHub collector 및 매시간 ChatGPT 감시는 수정 없음.
- **Cloudflare 실예약 자연 실행에서 발송된 Bot API 확인 건수**, 사용자 휴대전화 메시지 실제 수신 개수, 새 장치에서 미래 방향 정확도는 별도 검증하지 않았다면 미확인. 알림이 안 왔다고 완료 보고하지 않는다.

## 확인 우선순위
1. 최근 Cron `v23DirectFastScout.status`, `venue_availability`, `compared_venues`, `read_errors`, `candidate_count`, `sent`, `send_error`.
2. `telegramApiAcknowledgementsTotal` 및 `telegramLastApiReceipt`로 실발송 여부 확인.
3. Bitget 공식 Cloudflare API 불가가 유지된다면 위 예외 분리로 빗썸은 계속; Bitget 공개 API HTTP 상태별 합법적 거래소 원본 데이터 복구를 독립 확인.
4. V22 prospective 실증 5/15분 평균 순성과·데이터 커버리지 향상 없이 조건만 완화해 LONG/SHORT 오답 메시지를 쏟아내지 않는다.
