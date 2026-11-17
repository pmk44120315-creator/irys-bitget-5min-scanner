# IRYS V10 — 비트겟 롱·숏 수급 관측 알림 복원 검증 장부
기준: 2026-10-28 17:00 KST / 모든 실행은 읽기·공개 시세 기반, 주문 금지.

## 적용한 실제 변경
- Cloudflare Worker `irys-surge-monitor` 코드만 V8 → `IRYS-V10-SPOT-BITGET-VERIFIED-20261028`으로 교체. 기존 `IRYS_KV`, `AI`, GitHub 토큰 바인딩, 텔레그램 토큰·채팅ID, `*/5 * * * *` Cron 유지. 독립 `irys-realtime-evidence`는 변경 없음.
- 이전 V8 SHA256 `5d31ecaee1196dfeb33c9883f46e0782271298be059e5797e28fc14e28cd075b`과 정확히 일치한 상태에서만 변경. 적용된 V10 SHA256 `5c5c2f045fe2140c2ae245f15c7f02f9320f30533cf1c6ba75777dc604c7f1b1`; 변경 후 코드/바인딩/cron 일치 확인. 실패 시 원본 V8 롤백하도록 배포 스크립트 구성.
- 기존 빗썸 지속매수 알림 계약 및 Workers AI 과도한 2분 방향 알림 차단 유지. Bitget LONG/SHORT는 **별도 증거 경로**이며 빗썸 데이터 공백으로 오차단하지 않음.

## V10 Bitget 조건
- 이미 GitHub main collector에서 생성하는 futures_flow의 전체 공개 fills-history 15분 3x5분 기록과 완성 1분봉 15개 거래대금 오차 0.5% 이하 대조, 전체 페이지 수/시간 경계/체결 ID/체결 양 방향/최소 거래량·체결수 증명.
- 실제 선물 상품/암호자산 identity 확인, 주식·ETF·RWA 표시 배제, 미검증·신규/비활성·미완결 분봉·AI 단독 판단·과도한 상승/하락·윗꼬리/아랫꼬리 위험 배제.
- 거래대금, 가격 방향, 3개 5분 순수급 동일 우위, OI 증가를 두 개의 별도 5분 데이터 시점에서 확인. 2시간 중복 억제, 실패 시 fail-closed, 하루의 단발 2분 표본이나 인접 구간 중복을 근거로 인정하지 않음.
- 메시지는 "롱/숏 수급 우위 관측"이며 진입 권유/포지션 소유주 확정/미래 방향 적중률 주장 없음. Telegram 실제 발송은 이 조건을 만족하는 종목이 발생할 때만 수행하며 AI 모델의 비검증 방향 메시지는 여전히 차단.

## 증거
- 기존+신규 코드 92검사 PASS: https://github.com/pmk44120315-creator/irys-bitget-5min-scanner/actions/runs/40653477894
- 원본 V8 대조 및 V10 드라이런 PASS: https://github.com/pmk44120315-creator/irys-bitget-5min-scanner/actions/runs/40653367906
- V10 실제 코드를 Cloudflare에 적용하고 재검증 PASS: https://github.com/pmk44120315-creator/irys-bitget-5min-scanner/actions/runs/40653477894
- 공개 실제 V10 런타임 첫 17:00 KST 실행 PASS, futuresDirection 평가 6 / qualified 0, 발송0: https://github.com/pmk44120315-creator/irys-bitget-5min-scanner/actions/runs/40653679850
- 데이터 공급 자체는 main의 futures_flow 및 spot_flow에서 계속 PASS. V10 버전부터 비트겟 알림이 자동으로 발송되는 것은 아니며, 엄격한 시장 증거가 필요.

## 여전히 미확인
- **진짜 시장 신호가 나왔을 때 신규 V10 텔레그램 발송이 사용자의 기기에 실제 도착했는지**: 17:00 기준 확인된 해당 신호0건으로 실전 전달 영수증 없음.
- 미래 5/15/30분 방향 적중률·실제 체결 수익률·24시간 재발 없는 안정성: 검증 불가 / 아직 미완료.
- 본 V10 코드에 주문·계좌 연결 없음. 사용자 계정 API 인증 불필요.

## 수명주기
- 배포된 V10 Worker는 이 브랜치에서 정확한 해시의 단일 파일로 보관. 배포 시작 marker는 1회 트리거 전용이며 의도치 않은 재배포/주기변경을 방지. 이 브랜치를 연구 원본으로 보존하고 `main`에 별도 병합하지 않음.
