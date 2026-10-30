# IRYS V19 — 2026-10-30 실서버 무알림 원인 진단과 수정 기록

## 객관적 원인 (21:45 KST 읽기 전용 진단)
- Cloudflare `irys-surge-monitor` 정상 Cron `*/5 * * * *`, 원본 GitHub dispatch ACCEPTED, KV/AI/Telegram 바인딩 유지.
- V17 `aiJudgment.status=AI_QUOTA_BACKOFF_ACTIVE` → 모델 판단 중단, 당시 방향 알림 0건.
- V17 비트겟 6건 중 호가 2시점 미충족 5건, 데이터·방향 검증 미충족 1건 → 선물 방향 알림 0건.
- 빗썸 `spot_directional.signals=0`, 실제 체결 표본 부족/가격·체결 충돌/재확인 대기 → 빗썸 방향 알림 0건.
- GitHub V18 수집·모델 작업은 성공했지만 **V18 결과를 텔레그램으로 운송하지 않도록 분리되어 있었음**.
- 따라서 텔레그램 토큰 소실이나 Cron 중단이 아닌, AI 가용성과 알림 게이트 분리 결함.

## 적용한 변경
- V19은 `runMorningAi` 내의 **AI 쿼터 검사보다 먼저**, 실거래 초기 수급 탐색 및 Telegram 전송 평가를 수행.
- Bithumb: 전체 KRW 거래소 티커의 최근 5분 가격/거래대금 변화로 빠르게 후보 탐색. 표본 공격매수가 확인되면 BUY **수급 동행 관찰**만, 불충분하면 WATCH로 구분. 발송 직전 거래소 위험경보 재조회.
- Bitget: V18 공식 15분 실제 체결을 현재와 동시간 공식 가격으로 대조. 최근 5분 순매수·매도, 이전 15분과의 방향 전환, OI 보조정보와 시차를 종합. 서로 다른 호가 2회는 WATCH 탐색 필수 조건이 아니고 신원/데이터무결성은 필수. 부정합 수급은 방향 알림으로 승격하지 않음.
- AI 70B 모델은 경량 입력 2 현물+2 선물 및 45분 간격으로 유료 없는 free-neuron 사용량 압력을 완화; 5분 후보 탐색은 유지.
- 시계열 데이터 없는 경우 표본 CVD 또는 고래 매집 확정이라고 절대 말하지 않음.
- 단기 중복 알림·시간당 전송량은 운송상의 중복제어일 뿐 종목 선정 하드게이트가 아님.
- 기존 Worker Cron·AI/KV/Telegram/GitHub token 바인딩 그대로. 자동매매/계좌 API 없음.

## 실행 근거
- [V19 실제 소스 배포](https://github.com/pmk44120315-creator/irys-bitget-5min-scanner/actions/runs/41060053972): Source SHA256 `bb96c3ad13ea8e47253c610d9e3c9927e949ac762859010cdf5f786b227d70ec`; bindings/Cron preserved.
- [V19 단위·통합 테스트 10개 통과](https://github.com/pmk44120315-creator/irys-bitget-5min-scanner/actions/runs/41059648539)
- [V19 실제 자연 Cron 및 Telegram Bot API 승인](https://github.com/pmk44120315-creator/irys-bitget-5min-scanner/actions/runs/41060239492): 2026-10-30 22:05 KST, worker status PASS, V19 빠른 후보 5 futures/2 spot, 인증된 비트겟 체결 후보 5, 반전 후보 1, MAGMAUSDT 방향 관찰 1건 발송, Bot API `message_id=66`, receipt channel `V19_REAL_FLOW_DIRECTION`.

## 정확성 구분
- Telegram API ACK는 **서버가 메시지를 접수했다는 증거**. 사용자 기기 수신·읽음은 확인할 수 없음.
- 새 신호의 미래 방향 정확도/수익률은 **미검증**. 기존 V18 연구용 모델의 승률이 향상했다고 주장하지 않음.
- Worker AI의 `AI_MODEL_TEMPORARILY_AT_CAPACITY` 상태는 원인(실제 일일 무료 할당량인지 순간 용량인지) 세부 구분 추가 확인 필요. 하지만 새로운 독립 발송 경로의 성공에는 영향 주지 않음.
- 단순히 메시지 수를 강제로 늘리는 것이 아니라 WATCH와 검증된 실체결 방향 관찰을 분리하여 알림의 의미를 명확히 유지.
- 운영 성공 = V19 배포/실제 22:05 Cron/텔레그램 Bot API ACK까지. 미래 신호 개선 성능 PASS 아님.

## 원본/운영 무결성
- Cloudflare V17 원본 해시 `b2a98c8c988157866e28ea8d8c8418454c443c1c0ffd32ff6a1ee6b8c0012423`를 배포 전에 대조하고, V19 코드 외 변경 없음.
- 기존 ChatGPT 매시간 감시, Bitget/Bithumb V18 GitHub 시장 수집 및 기존 Telegram 봇/크론 모두 그대로.
- 현재 배포한 Worker 소스 사본 및 완전한 보조 모듈을 GitHub main에 보존하고, 이후 이 파일을 기준으로 검증해야 함.
