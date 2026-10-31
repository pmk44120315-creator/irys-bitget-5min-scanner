# IRYS V21.1 실제 운영 검증 영수증

## 실제 실행 증거
- GitHub Actions 실행: 41195433063, job 124520531518. 최종 결론 success.
- 로그: https://github.com/pmk44120315-creator/irys-bitget-5min-scanner/actions/runs/41195433063
- 2026-10-31 20:06:15 KST: Cloudflare `irys-surge-monitor`의 소스만 V21 → V21.1로 교체하고 원격 원본을 다시 읽어 SHA256 일치를 확인했다.
- 실제 배포 버전: `IRYS-V21.1-LEARNED-FORECAST-EXPIRY-ALIGNED-20261031`.
- 실제 배포 SHA256: `d05577405be21f4a2c72f076ac5dd3b334b62c4cc52886eb4d69fb7e01ef016d`.
- 기존 `*/5 * * * *` Cron 및 AI/IRYS_KV/GITHUB_DISPATCH_TOKEN/TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID 바인딩은 보존되었다. 값·토큰·채팅 ID는 이 문서에 기록하지 않는다.
- 기존 테스트와 새 모델/시간/전송 테스트를 합쳐 Python 133개 및 JavaScript 15개가 통과했다. 테스트 통과는 실전 예측 성공 또는 수익성 검증과 다르다.

## 20:10 KST 자연 예약 실행의 실제 상태
- Worker 실행: PASS.
- 기존 GitHub 시장 수집 dispatch: ACCEPTED.
- V21 전송 경로: `LEARNING_NO_ELIGIBLE_FORWARD_EVIDENCE`.
- 이전에 확인된 과잉 시간 차단 `STALE_REPORT`는 이 실행에서 발생하지 않았다.
- 영구 차단 스위치: false (`permanent_disable_switch=false`는 영구 OFF가 없다는 뜻이며, 모든 후보를 보낸다는 뜻이 아님).
- 이번 실행 V21 텔레그램 발송: 0건. 새 V21 발송 영수증: 없음.
- 전체 과거 채널 누적 Bot API ACK: 191건. 이 숫자를 새 V21 메시지 수 또는 사용자 기기 수신 건수로 해석하면 안 된다.
- 기존 V19의 부정확한 반응형 실험 알림은 재활성화하지 않았다.

## 실제 정기 예측 프로그램
- `data/v21_latest.json` 2026-10-31 20:10:32 KST 보고서: runtime ACTIVE / source PASS / 모델 무결성 오류 없음.
- 고정된 비트겟 5분 학습 모델이 실제 예측 1건을 생성하고 당시 최우선 매수·매도호가를 저장했다. 미래 정답은 아직 미확인이고 사후평가 대기 1건이다.
- 당시 `completed_quote_outcomes=0`, `delivery_candidates=[]`였다. 따라서 실제 예측 적중률 개선이나 새 Telegram 방향 알림 발송을 완료했다고 주장하지 않는다.
- 비트겟 15분 모델은 표본 부족, 빗썸 5분 모델은 매수 선택 근거 부족, 빗썸 15분 모델은 검증 구간 순손실 때문에 채택하지 않았다. 빗썸의 정확한 BUY 예측 문제는 해결 완료가 아니다.

## 새로운 방식과 남은 한계
실제 학습 데이터와 이후 가격을 사용한 조건부 지도학습, 별도 5/15분 목표, 가격·체결 불일치 특징, 누락 데이터 구분, 비용 가정, 호가 스프레드, 종목·방향·모델별 미래 평가를 구현했다. 학습과 모델 선택에 쓰지 않은 최종 시간 구간에서 비트겟 5분 모델은 선택39건 중23건의 가격 방향을 맞혔다(약59%). 하지만 선택 표본이6개 시간대에 몰렸고 전체 비트겟 연구 자료가 약24.7시간이므로, 실전 미래 방향 정확도를 입증한 것은 아니다.
새 전송 경로는 실제 미래 호가 성과와 자료 수집률, 남은 예측시간, 현재 호가, 중복 발송 여부로 자격을 평가한다. 소스 코드가 정상 실행된다는 사실만으로 자격을 주지 않는다. 합법적인 공개 데이터와 소유자가 연결한 배포 권한만 사용했으며, 자동 주문·계좌 접근·비공개 내부정보 취득은 수행하지 않았다.

## 운영 저장 기록
- PR20 병합: `95c9c40316b28baaaaf8aea252af6702434afcca` — 학습 모델·실제 호가 평가·기존 정기 실행 연결.
- PR21 병합: `d3509f2099f7cb6cb983660596033650c956a960` — 실제 확인된 시간 차단 결함의 재현·수정 및 배포 소스 보존.
- 현재 canonical 소스: `deployment/IRYS_V21_LEARNED_FORECAST_WORKER.mjs` (버전21.1), SHA파일 `deployment/v21_candidate.sha256`.
- 학습 상세: `deployment/IRYS_V21_MODEL_AND_VALIDATION_KO.md`, 실제 결과 `research/v21_results/report.json`.
- 최근 실시간 결과: `data/v21_latest.json`, 별도 상태: `data/v21_state.json`.

**확인된 결론: 구현·운영 반영·소스 무결성·자연 예약 실행 성공. 미확인 결론: 지속적인 방향 정확도 향상, 실전 수익성, 새 V21 Telegram 실제 발송 및 기기 수신.**
