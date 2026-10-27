# IRYS 독립 AI 감시기 — 기존 새벽 감시기와 동시에 비교

**독립 추가 설치본. 기존 `아이리스형 급등 초기 감시` ChatGPT 자동화와 Cloudflare `irys-surge-monitor` 코드를 수정하거나 중지하지 않습니다.** 기존 GitHub `.github/workflows/scan.yml` 및 `collector.py`, `spot_flow.py`, `early_candidates.py`도 수정하지 않습니다.

## 두 감시기

- **A: 기존 새벽 감시기** — ChatGPT `아이리스형 급등 초기 감시`의 기존 지시문·주기·알림 그대로 유지. 결과 성능은 사후 비교해야 함.
- **B: 새 AI 비교 감시기** — 별도 GitHub `workflow_run`에서 기존 시장 수집기가 끝날 때마다 실행. `data/latest.json`을 읽고, 확인된 암호화폐 후보만 바이낸스 공식 현물 1분봉의 taker 매수·매도 및 4시간 수급·가격 정체로 검증한 뒤, 외부 AI 모델에 반대 가설과 함께 판단하도록 요청. **출력 경로도 `data/ai_twin_latest.json`으로 분리.**

GitHub 실행 주기는 클라우드 소스 수집이 성공하는 간격에 종속되므로 정확히 매 5분 실행 및 실시간 알림 지연을 보장하지 않습니다.

## AI 인증·요금 (실제 연결 필요)

2026-07-30 GitHub Models가 공식 종료되었으므로 `models.github.ai`를 사용하지 않습니다. **OpenAI API는 ChatGPT Pro 구독과 별개로 인증·사용량 과금이 필요합니다.** API 키가 없는 상태에서는 수집과 종목 사전 검사를 수행하되 `AI_NOT_CONFIGURED`로 보고하며 **AI 판단 성공이나 텔레그램 성공을 주장하지 않습니다.**

새 GitHub 저장소의 **Settings → Secrets and variables → Actions → New repository secret**에서 다음 비밀값을 설정할 수 있습니다. 절대 코드나 공개 JSON에 쓰지 마세요.

- `AI_TWIN_OPENAI_API_KEY` — 별도로 발급한 OpenAI API 키. 배포 상태 최초 검증 전에는 없어도 안전하게 작동.
- `AI_TWIN_TELEGRAM_BOT_TOKEN` — 새로운 AI 비교 신호용 봇 토큰. 기존 봇을 사용한다면 기존 봇 토큰을 사용자 본인만 직접 안전하게 복사해야 하며 유출하지 마세요.
- `AI_TWIN_TELEGRAM_CHAT_ID` — 개인 텔레그램 수신 ID.

모델 설정 기본값 `gpt-5.5`는 실제 모델 접근 권한에 따라 변경이 필요할 수 있으며, **별도 API 비용**이 발생할 수 있습니다. 모델 호출은 공개 자료에서 수급 조건을 만족한 후보가 있을 때만 수행합니다.

기본 GitHub 워크플로는 **`AI_TWIN_SEND_ALERTS=false`** 로 고정하여 운영 초기 텔레그램 자동발송을 막아 두었습니다. 실제 모델 응답·방향의 결과 검증 후 사용자가 두 번째 알림 활성화를 승인하면 그때만 true로 바꾸세요.

## 오전 판단 복원에 대한 검증 한계

- 구현: 급등 이전 조용한 가격, 1·5·15·60분 완성봉/직전 구간 거래량, Binance 현물 taker 매수·매도와 4시간 수급, Bitget OI 증가 경과 시간·펀딩, 윗꼬리·추격 차단, 반대 근거, BUY/LONG/SHORT/WATCH/REJECT.
- 단, ChatGPT 내 원래 모델의 숨겨진 판단 흐름을 추출한 것은 아닙니다. 동일 모델·동일 내부 정보·동일 데이터시점이 보장되지 않아 **동일한 출력과 방향 적중률 100%는 보장하지 않습니다.**
- Binance 현물 taker quote는 **Binance 한 거래소** 체결 자료이지 전체 시장 CVD가 아닙니다. 자산 동일성을 계약주소로 확인하지 못한 경우 `NOT_CONTRACT_VERIFIED`를 분명히 표시합니다. 호가의 연속적인 체결흡수, 입출금 고래 기록, 계정 집중, 락업은 **미확인**으로 보류합니다.
- 관찰 신호는 **매수·롱·숏 주문 지시가 아니며 수익이나 방향의 성공을 보장하지 않습니다.** 주문 API와 거래소 API 키는 사용하지 않습니다.

## 운영 점검

`Actions → IRYS independent AI morning-style twin` 실행 기록과 `data/ai_twin_latest.json`을 확인하세요.

- `SOURCE_BLOCKED`: 기존 수집 결과가 없거나 실패·오래됨. AI 신호 없음.
- `NO_EVIDENCE`: 실제 전제 근거를 만족한 후보가 없어서 AI 미호출.
- `AI_NOT_CONFIGURED`: 근거 후보는 있으나 외부 AI API 키가 미설정.
- `AI_FAILED`: 외부 모델 응답 오류/쿼터 한도. 모의 신호로 대체하지 않음.
- `READY_RESEARCH`: 실제 모델 응답이 있고, 강한 근거로 분류한 연구용 후보가 있음. 기본 상태는 텔레그램 전송하지 않음.

결과는 **실제 관측 이후 +5m/+1h/+6h/+24h의 가격 성과**를 별도로 분석해 기존 감시기와 비교해야 합니다. 승률은 검증 전 생성하거나 확정하지 않습니다.