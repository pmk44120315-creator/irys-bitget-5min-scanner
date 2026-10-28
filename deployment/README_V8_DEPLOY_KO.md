# IRYS V8 증거 우선 알림 수정 — 배포 전 확인

**기준 소스**: `deployment/IRYS_V8_PROOF_GATED_WORKER.mjs` (V7 보관본에서 수정한 *전체* Worker, 부분 패치 아님)

## 발견한 실제 문제
1. 실제 운영 `irys-surge-monitor` V7 공개 상태 조회에서 2026-10-28 13:25 KST:
   `AI_INFERENCE_FAILED`, 오류 코드 `4006`, Cloudflare Workers AI 무료 하루 10,000 neurons 사용량 소진. GitHub/5분 수집/PASS/Telegram 설정 자체는 정상.
2. main `spot_continuity.py`의 검증된 종목은 `SUSTAINED_BUY_OBSERVATION`이고, 구 V7 `validateSignal`은 `BUY_OBSERVATION`만 수용.
3. V7 독립 Workers AI 경로는 2분 공격적 체결 표본과 선물 관측값만으로 `UP`/`DOWN` 알림을 직접 전송할 수 있어, 새 4x5분+15분 현물 검증을 우회.
4. 5분 수집기는 운영되며 05:33~13:08 KST 92개 원본 모두 PASS/신호0. 현물 캔들 공백은 일부 종목의 실제 무체결 분에서 확인됨. 임의 보간은 금지.

## V8에서 달라지는 점
- 새 `SUSTAINED_BUY_OBSERVATION` 신호와 4회 독립 5분 관측·15분 완성봉 체결금액 대조·3개 연속 5분 순매수·4개 유효 호가·경보 없음 등의 근거가 **동시에 존재**해야만 원래의 현물 이상징후 알림을 보낼 자격이 생김.
- **`BUY_OBSERVATION` 2분 단발 신호 거절**. 종목명만 같은 오인 신호, CVD 오차, 매도 누적, 데이터 부족도 거절.
- 독립 Workers AI의 `UP/DOWN` **직접 텔레그램 발송 중지**. AI 분석은 검증된 지속현물 신호가 있을 때만 참고용으로 호출, 사용량 초과 4006 재발 시 6시간 호출 휴지. AI 분석만으로 추가 알림을 보낼 수 없음.
- 원본 V7의 `IRYS_KV` / Telegram secrets / GitHub dispatch secret / Workers AI binding / 기존 5분 cron 설정은 소스에서 그대로 참조. 주문·거래소 계정 API 없음.
- 애초 신호가 없으면 무알림이 **정상**. `AI` 분석 유무가 현물 검증 신호를 자동매매/확정으로 바꾸지 않음.

## 배포 안전 규칙
- 사용자가 GitHub에 등록한 `IRYS_REALTIME_CF_API_TOKEN`은 **새 Worker `irys-realtime-evidence` 전용**이고 V7 수정 권한이 없음. 이 토큰으로 V7 업데이트 불가.
- 실제 배포 전에 현재 배포된 **V7 스크립트 소스의 버전/해시와 KV·AI·Secret bindings 및 5분 Cron**을 읽기 전용으로 확인해야 함. 보관본과 다를 경우 자동 교체 금지, 수동 비교.
- 현재 V8 파일은 **GitHub 연구 브랜치**의 수정본이지, 현재 Cloudflare V7에 배포된 코드가 아님.
- 수동 배포 또는 V7 한정 API 토큰으로 배포한 경우, Worker /health에서 새 V8 코드를 확인한 후 **다음 정규 5분 cron**의 `last.codeVersion`, `githubDispatchStatus`, `aiJudgment.status`, Telegram 구성 상태를 확인할 것. 기존 V7 배포 버전을 롤백 가능하도록 보존.
- Cloudflare 설정 중 `IRYS_KV`, AI, Telegram 관련 secrets, GitHub dispatch, 기존 cron을 삭제/재설정하지 말 것. 자동실거래/주문 금지.

## 검증
- GitHub Actions: `IRYS V8 alert contract regression`에서 Python 기존 수집 33개, 기존 AI 별도 경로 22개, V8 Node 계약 검사 7개 = **62개** 통과, Node 문법 통과.
- **미확인**: 현재 실제 V7 소스와 보관본의 바이트 동일성, V8 실제 Cloudflare 배포, V8 첫 정규 5분 실행 결과, V8 알림 수신/정확도, 미래 5·15·30분 수익성.

## 사용자가 할 수 있는 최단 단계
기존 Cloudflare Worker에 대한 별도 **Individual Workers Editor** 토큰(`irys-surge-monitor` 한 개 한정)을 만든 뒤 GitHub repository secrets에 `IRYS_V7_CF_API_TOKEN`으로 저장하면, 읽기 전용 배포 전 정합성 검증을 자동 실행할 수 있다. 토큰을 채팅이나 소스 코드에 붙여넣지 말 것. 배포 방식은 **현재 서버에 배포된 실제 소스/바인딩 구조 확인 후 결정**하며, 검증 실패 시 교체를 수행하지 않는다.
