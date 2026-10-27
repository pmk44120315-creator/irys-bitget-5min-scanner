# IRYS 실시간 수급·온체인·Telegram 개선 설계 (연구용, 운영 미적용)

## 현재까지 실제 검증
- GitHub Actions 40545080206에서 Bithumb `wss://ws-api.bithumb.com/websocket/v1` 거래·호가 12초 읽기 전용 연결 SUCCESS
- KRW-BTC 호가 업데이트 135건, 체결 2건, 최대 관측 호가 업데이트 간격 0.179초
- 오프라인 테스트 3개 성공; 수집 코드만 별도 PR에 보관, 기존 V7 Cloudflare Worker / GitHub main / Telegram 설정 미수정
- 12초 표본은 연속 매집 또는 호가 흡수 증거가 아니며 정밀 예측 성능도 미검증

## 제안하는 기존 운영 보호형 구조
1. **기존 GitHub 전체 종목 5분 수집은 계속 유지.** 종목 신원·상장상태·가격 조용한 구간·분봉/거래대금으로 관측 우선순위만 생산.
2. **새 Cloudflare Worker + SQLite Durable Object를 기존 V7과 별도 이름으로 준비.** 관측 우선순위 중 신원 일치가 검증된 소수 종목부터 Bithumb public WebSocket의 trade+orderbook 및 Bitget publicTrade+books 스트림을 수집. 무조건 전체 종목 초단위 구독하지 말고 데이터 속도·허용량·비용을 실측한 뒤 범위 확장.
3. **데이터 무결성:** 이벤트 수신시각과 거래소 시각 분리, 정상 시퀀스 확인(제공 시), 수신 중단·재연결·중복 제거, 1초 타임버킷 생성, 1·5·15·30분 윈도우 생성. 갭/연결해제/가격-계약 신원 불일치 시 `UNVERIFIED` 전환, 매수 신호 차단.
4. **현물 CVD:** 체결 사이드·가격·수량을 거래소 단위로 기록해 1·5·15·30분 공격적 매수/매도 대금·누적 차이를 출력. 이는 *해당 거래소의 관측된 체결 자료*이고 '전체 시장 CVD'는 아님. 종종 공개 스트림 이벤트가 지연/누락될 수 있으므로 완성 분봉 거래대금과 교차검증.
5. **호가 흡수 유사징후:** 시간에 따라 동일 가격대의 대기 잔량 변동과 그 가격대에 체결된 공격적 매도를 함께 추적; 실제 체결로 잔량이 소모되고 재보충되는 증거가 여러 차례 반복되는지 평가. 주문 취소·스푸핑·빙산주문·비공개 체결을 완벽히 식별할 수 없으므로 `ABSORPTION_LIKE` 등 확률성 이름만 허용; **`ABSORPTION_CONFIRMED` 금지**.
6. **연속성 최종 판단:** 15~30분간 5분별 비중첩 양(+) 현물 순매수, 거래대금 지속, 고점 대비 이탈/윗꼬리 반례, 비트겟 펀딩·OI 교차검증. 이전 징후만으로 Telegram 급등초기 알림을 송신하지 않음.
7. **공식 위험·온체인 결합:** Bithumb 경보/유의/거래중단을 우선. Arkham 등 출처가 명시된 거래소 소유/수탁주소 레이블과 해당 체인의 확인된 token transfer를 API로 조회, 체인·계약주소·지갑 레이블 버전·트랜잭션 해시·확정 블록·타임스탬프 저장. 내부 전송 및 타 거래소 이동과 사용자 입금 구별 미확인 시 `EXCHANGE_WALLET_ACTIVITY_UNKNOWN`으로 처리. 전체 거래소 모든 지갑/입출금 100% 파악은 외부 공개 데이터로 불가능.
8. **Telegram 단계 검증:** 실계좌 주문 API 전혀 사용 금지. 기존 V7 secret은 노출하지 않고 연결된 운영 서비스 안에서 `getMe` 점검, 별도 `TEST` 태그의 1회 `sendMessage` 에서 응답 `ok=true`/ `message_id` 기록, 사용자 실제 수신과 시각 대조. 그 후 새로운 고신뢰 후보에 대해서만 실제 알림. 중복/쿨다운 필수.
9. **운영 전 승인 게이트:** 새 독립 Worker와 DB/선택적 온체인 데이터 공급자 연결, 24시간 shadow 검증(수집갭, 누락, 재시작, 비용), 이상징후 정확도·실제 후행 결과 검토 후 단계적 알림 적용. 기존 V7, GitHub main, Telegram 봇 중지·재배포·교체 금지.

## 아직 갖춰지지 않은 필수 조건
- 현재 이 ChatGPT 연결은 GitHub 파일을 수정할 수 있으나 기존 Cloudflare Worker의 계정/바인딩/시크릿/배포에 직접 접근하는 커넥터가 없다. **따라서 신규 Worker와 Durable Object의 실제 설치·24시간 실행·텔레그램 테스트 송신은 미완료**.
- Arkham 등 거래소 지갑 레이블/온체인 공급자 API 이용 권한과 갱신 정책, 계약 주소 신원 확인이 아직 연결되지 않았다. 공시/경보는 일부만 대체 가능.
- 24시간 운영 및 알림 도달률 PASS는 실제 실행 원본·서버 로그·텔레그램 API 응답·사용자 수신이 연결된 이후에만 판정.

공개 출처:
- https://apidocs.bithumb.com/reference/%EA%B8%B0%EB%B3%B8-%EC%A0%95%EB%B3%B4
- https://www.bitget.com/docs/uta/best-practices-guide
- https://developers.cloudflare.com/durable-objects/best-practices/websockets/
- https://developers.cloudflare.com/changelog/post/2026-06-19-outbound-connections-keep-dos-alive/
- https://info.arkm.com/announcements/arkham-api-upgrade-real-time-intel
- https://docs.glassnode.com/further-information/exchange-data-transparency-notice
