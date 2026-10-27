# IRYS 실시간 수급 증거 수집기 — 독립 SHADOW

운영 V7과 기존 main 감시기는 교체하지 않습니다. 이 코드는 별도 서비스이며
시장 알림 발송과 주문 기능이 없습니다. 기본 설정은 중지 상태입니다.

## 2026-10-28 KST 실제 검증 결과 (운영본 대체 아님)
- Cloudflare 새 Worker `irys-realtime-evidence` 배포 및 Public `/health` 응답 확인. Workers 기존 `irys-surge-monitor`와 `coinradar-total3es`에는 코드·설정 변경 없음.
- GitHub 등록 `IRYS_REALTIME_CF_API_TOKEN` / `IRYS_REALTIME_CF_ACCOUNT_ID` 존재 및 새 Worker의 Cloudflare 설정 조회 HTTP 200 확인(인증값 본문/로그 미노출).
- 빗썸 API `/v1/market/all`, `/v1/ticker`를 Cloudflare 내부에서 HTTP 200 확인.
- 본 서비스를 처음 테스트할 때: (1) global fetch `Illegal invocation`, (2) WebSocket 바이너리 Blob 해독, (3) 업그레이드 요청의 20초 `AbortSignal.timeout`이 업그레이드 후에도 연결을 종료하던 문제를 재현/수정/재검증했다. 연결 유지용 빗썸 공식 텍스트 `PING`도 적용하고 상태 `UP`을 매매 데이터로 집계하지 않는다.
- **실제 BTC 1분 PASS:** GitHub Actions run [40569307051](https://github.com/pmk44120315-creator/irys-bitget-5min-scanner/actions/runs/40569307051): 약 79초 관측, 프레임 수신 878 / 저장 처리 871 / 오류 0 / WebSocket 끊김 0, PING 응답 7, 완성된 1분 호가 60초 관측, 체결 3건, 공식 1분봉 체결대금 대조 `MATCHED`, 평가 `verified:true`.
- **시험 종료 안전성:** 별도 Worker `POST /control/stop` HTTP 200 후 `GET /status`에서 `enabled:false`, `connection=STOPPED`, `live_trade_alerts_enabled:false` 확인. 별도의 자동 만료 프로프 리스도 적용.
- **추가 독립 검증:** 빗썸 WebSocket 75초 독립 Python 연결 끊김 0 (GitHub Actions run [40568661251](https://github.com/pmk44120315-creator/irys-bitget-5min-scanner/actions/runs/40568661251)).
- 5분·15분·30분 **연속** 시장 데이터의 완전성과 실제 24시간 안정성은 **미검증**. 프로젝트 알림 정확도, 모든 거래소의 입출금/지갑, 매집 확정, 사용자 Telegram 수신 증빙 없음.
- 무료 Durable Object SQLite 1일 쓰기 허용량 **100,000행**(공식: https://developers.cloudflare.com/durable-objects/platform/pricing/). BTC처럼 많은 초 단위 호가를 현재처럼 프레임별로 저장한 채 장시간 자동 가동하면 한도 초과 가능성이 높다. 따라서 **상시 수집 자동 시작 금지**. 통계 집계/DB 배치 기록과 실제 사용량 계측을 먼저 검증하고, 유료 비용이 필요하면 사용자에게 별도 승인 요청.
- 본 소스는 GitHub **Draft PR #2** 연구 브랜치에 있으며, 기존 메인 GitHub 감시기와 Telegram 알림 전송 경로는 유지한다. 신규 Worker는 주문·자동매매·시장 매수/숏 알림을 보내지 않는다.

## 구현한 범위
- 빗썸 공식 WebSocket 현물 체결·호가를 계속 읽고 SQLite에 체결과 초별 호가를 저장.
- 1·5·15·30분의 매수/매도 대금은 **해당 거래소 관측 구간**으로만 산출.
- 연결 단절/재시작/중복/지연/잘못된 메시지 기록, 완성 분봉 거래대금과 대조.
  한 분이라도 누락되면 검증되지 않은 상태를 유지. 과거 없는 데이터를 채우지 않음.
- 같은 가격에서 실제 매도 체결과 잔량 재보충이 동반된 경우만 `ABSORPTION_LIKE`.
  주문 취소·숨은 주문과 정확히 구별할 수 없어 흡수/매집 확정은 하지 않음.
- 출처 확인된 Ethereum ERC20 주소에 한하여 이동을 분류. 현재 등록 예시는 빗썸
  공개 핫월렛 1개이며, 전체 거래소 입출금·실제 고객 입금·매도 여부는 미확인.
- Telegram TEST는 별도 관리자 인증과 별도 비밀값, 명시적 활성화, 고유 검증번호가
  있어야만 가능. API 수락과 사용자가 실제로 읽은 것을 구분. 애매한 전송은 재시도하지 않음.

## 현재 한계
**배포 검증 완료(별도 SHADOW Worker) / 현재 수집 정지 / 장시간 5·15·30분 검증 및 새 Telegram 전달은 미완료.**
Node SQLite 단위 검사와 GitHub CI 결과는 실제 Cloudflare 배포·재시작·장기운영 검증과 다릅니다.
Bitget 실시간 선물 호가/체결 스트림은 이번 서비스에 추가하지 않았습니다.
기존 5분 수집의 OI/펀딩을 대체하거나 현물과 합산하지 않습니다.

## 연결 규약 결함 (기존 운영을 수정하지 않고 기록)
현재 main `spot_continuity.py`는 `SUSTAINED_BUY_OBSERVATION`을 출력합니다.
Library의 V7 Worker 원본 `validateSignal`은 `BUY_OBSERVATION`만 수용합니다.
따라서 전달될 자격의 신호도 거절될 수 있습니다. 새 서비스는 이를 우회해 신호를
발송하지 않습니다. 기존 경로 수정 시 두 방향 문구를 무조건 허용하지 말고
새 지속성 증거 필드까지 검사하는 버전별 계약 테스트를 함께 추가해야 합니다.
저장된 원본과 현재 배포된 코드가 동일한지는 배포 계정 확인이 필요합니다.

## 분리된 배포 준비
`wrangler.jsonc`의 이름은 **irys-realtime-evidence**입니다. 기존
`irys-surge-monitor`나 `IRYS_KV`를 재사용하지 않습니다.

새 서비스에만 설정할 값:
- `IRYS_RT_ADMIN_TOKEN`: 충분히 긴 임의 관리자 비밀값(32자 이상).
- 선택적 `IRYS_RT_TELEGRAM_BOT_TOKEN`, `IRYS_RT_TELEGRAM_CHAT_ID`.
- `ALLOW_TELEGRAM_TEST=true`는 실제 TEST 전송을 허용할 때만 설정.
- `ENABLE_ONCHAIN=true` 및 검증된 주소 배열 `KNOWN_WALLETS_JSON`은 별도 설정.
  주소 출처가 7일 이상 오래되면 제외하며 자동으로 신뢰를 연장하지 않습니다.

GitHub CI는 `IRYS_REALTIME_CF_API_TOKEN`, `IRYS_REALTIME_CF_ACCOUNT_ID`,
`IRYS_REALTIME_TELEGRAM_BOT_TOKEN`, `IRYS_REALTIME_TELEGRAM_CHAT_ID`의 **존재 여부만**
검사합니다. 값은 로그에 출력하지 않고 새 메시지도 발송하지 않습니다.
없는 경우 사용자가 안전한 계정 연결 또는 Secrets 설정을 해야 합니다.
토큰을 채팅에 붙여넣거나 저장소 코드에 넣지 마세요.

실제 배포는 승인된 계정 환경에서 `npx wrangler@4 deploy --config
realtime_research/service/wrangler.jsonc`로 수행합니다. 자동 배포 워크플로는 없습니다.
CI의 `deploy --dry-run`은 업로드/설치가 아닙니다.

배포 뒤에도 자동 시작하지 않습니다. 별도 관리자 Bearer 인증으로
`POST /control/start`에 `{"markets":["KRW-WLD"]}`를 전달해 관측을 시작합니다.
`GET /evidence`로 1·5·15·30분 검증 상태, `GET /onchain`으로 공개 지갑 부분 자료를
확인합니다. `POST /control/stop`으로 정지합니다. 알림은 계속 꺼져 있습니다.
`POST /telegram/test`의 `{"nonce":"고유-영문숫자-검증번호"}`는 설정된 개인 대화방에
비거래 TEST 한 건만 보냅니다. 같은 nonce는 중복 발송하지 않습니다.

## 운영 비용과 한계
상시 outbound WebSocket/SQLite는 유료 사용량이 발생할 수 있습니다.
최대 20종목은 안전한 구독 범위 제한이지 모든 종목 실시간 수집을 의미하지 않습니다.
우선 소수 종목으로 CPU·DB 쓰기·끊김·보관량을 실측해야 합니다.
호가 원본은 매 프레임 검사하지만 저장은 초별 마지막 상태입니다.
일반 REST 재조회는 수신하지 못한 WebSocket 구간을 복원했다고 간주하지 않습니다.
온체인 페이지 예산을 넘기면 PARTIAL과 다음 커서를 내보냅니다. 워커는 현재 새 30분
창을 재조회하므로 PARTIAL이 장기간 지속되면 별도의 커서 누적 수집이 필요합니다.

## 검증
`node --no-warnings --test realtime_research/service/test/*.test.mjs`
`node --no-warnings realtime_research/service/live_check.mjs` (공개 네트워크 필요)

실거래소 검사는 처음부터 끝까지 관측한 완성 1분을 분봉과 대조합니다.
한 번 통과해도 15·30분 연속성이나 24시간 안정성을 입증하지 않습니다.
이 코드의 검토는 작성자의 자체 재검토이며 독립 제3자 검토가 아닙니다.

공식 자료:
- https://apidocs.bithumb.com/reference/호가-orderbook
- https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/
- https://developers.cloudflare.com/changelog/post/2026-06-19-outbound-connections-keep-dos-alive/
- https://core.telegram.org/bots/api#sendmessage
