# V45 중단 작업 재개 및 실제 배포 확인

확인 기준: 2026-11-09 14:06:43 KST. 실제 운영 버전은 IRYS-V45-RSI-ENTRY-CONTEXT-20261109이다.

## 이전 실패와 이번 재개
첫 배포 run42560732712는 RSI_CONTEXT_FLAG_MISSING 검증 실패로 중단됐고, 기존 V42.1 SHA99845f001c17542fbe1c5c1a7dde9beadef1881d6f31f1c1e0f7765109b9e3bb로 복구된 기록이 있다. 당시 V45 적용 완료 상태가 아니었다. ChatGPT 화면의 생각 실패와 외부 배포 오류가 같은 원인이라고 확인된 것은 아니다.

이번에는 새 방향 연구나 원본 분석을 처음부터 반복하지 않았다. 미완료 배포검사의 소스 일치 및 공개 응답 확인 절차만 이어서 수정했다. 업로드한 파일이 같더라도 공개 응답이 아직 이전 상태인 상황을 별도 재현했다. 수정 전 새2검사실패, 수정후통과. 동일한 검증 소스가 유지될 때만 공개 응답을 재조회한다. 새 RSI 기능/버전이 끝내 확인되지 않으면 실패하고 기존 소스로 복구한다. 이전 실패의 Cloudflare 내부 원인이 전파 지연이었다고 확정하지 않는다.

## 실제 검증 및 배포
- 검증 소스: f6f8588751386a3b0a87e80bd2d4587310d37913.
- 로컬과 원격 Python222 + 관련Node153 =375검사 통과. 모든 과거검사를 전체 재실행했다는 뜻은 아니다.
- 원격 검증 run42564769336 성공. Bitget/Bithumb BTC의1분/5분 확정봉 RSI계산4개도 실제 공식응답으로 확인.
- 실제 재배포 run42564939375 성공. 배포소스 ba836c3f0bf995e5aa7e9fae24e51bebc6a26c04.
- 실제 Worker SHA f78b500927f41af3412c17bd3b47c25e3d9fba9c6d156a72302c67266a2a40cd. API에서 다시 읽은 코드와 일치.
- 새 배포가드 SHA765b7497d1fcf87ff6f3094d073a999cce9413fbf57384eaca2f9299b0147c8b.
- 14:05 자연 정기실행의 V45 버전/PASS/RSI 기능 활성 확인. 진입알림·위험알림 활성, source/risk feed 정상, 기존 Cron 및 bindings 유지.
- PR58 병합 완료:16a0c886edf8f166b69e6925068ef90abf39a881. 병합은 추가 재배포를 실행하지 않는다.

원격 검증 ZIP SHA437296b21f32630f1e80fa0a21465a16bed98a1550662ca3bb98bef585e223b5: 다운로드 후 CRC 및 manifest8파일 SHA검증.
실제 배포 ZIP SHA012906ea00fb3e6d09734adedfaf44acacf89b366f9bd8fbc46f0430636ea508: 다운로드 후 CRC 및 manifest13파일 SHA검증.

## 실제로 바뀐 기능
발송 코드가1분/5분 Wilder RSI14의 마지막 확정값과 현재 bid/ask 중간값을 대입한 미완성봉 추정치를 구분한다. 추정치는 사용자 차트의 마지막 체결가 RSI와 같다고 보장하지 않는다.

과매도 SHORT 및 과매수 LONG/BUY는 추격 진입 주의(CAUTION_OBSERVATION), 자료미확인은 CONTEXT_UNVERIFIED, 그 외는 DIRECTION_OBSERVATION으로 표시한다. 확정 진입 또는 검증된 미래 확률이라고 표시하지 않는다. RSI만으로 자동 반전하거나 과매도 숏을 무조건 차단하는 기능을 넣지 않았다. 원래 방향판정식·위험알림·중복방지·원래 신선도 조건은 그대로다.

## 아직 미확인
14:05회차의 확정후보0,발송직전재검사시도0,신규V45ACK0이었다. 새형식 Telegram 메시지의 실제 발송/사용자기기수신은 해당회차로 입증되지 않는다. 실제 송신코드 경로는 모의 Telegram 응답으로 검사했으나 이를 실제 발송으로 표현하지 않는다.

미래 방향 정확도 향상, 초기 역행 감소, 실제 거래수익은 미확인이다. V45 배포 완료와 방향성능 문제 해결은 다른 판정이다. 장시간 무오류나 모든 시장에서의 정상동작도 보장하지 않는다.

## 증거
- 검증: https://github.com/pmk44120315-creator/irys-bitget-5min-scanner/actions/runs/42564769336
- 실제 배포: https://github.com/pmk44120315-creator/irys-bitget-5min-scanner/actions/runs/42564939375
- 병합: https://github.com/pmk44120315-creator/irys-bitget-5min-scanner/pull/58

다음 재개는 이 체크포인트와 실제 V45 서버 상태부터 확인한다. 이미 끝난 과거자료복원과 V39~V44 실험을 반복하거나, 이번 표시 개선을 검증된 방향모델 교체로 잘못 보고하지 않는다.
