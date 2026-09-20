# 기억 목록의 1,000행 제한과 연속 조회

2026-09-20 KST. 기존 service.listMemories는 한 번의 REST 조회만 수행해 PostgREST의 max_rows=1000 이후 기억을 UI에 전달하지 못했다. Main이 소유한 production service 수정은 Memory[] 계약을 유지하면서 created_at DESC, id DESC 순서의 keyset 조회를 반복한다. 페이지는201행을 요청하고200행을 반환·누적하며 마지막 반환행을 다음 cursor로 사용한다. 시간의 microseconds를 그대로 보존한다.

조회 시작의 owner UID를 고정하고 모든 요청에 user_id 동등 조건을 넣는다. 매 query가 끝난 뒤 현재 SDK session UID를 다시 검사하므로, 중간 또는 마지막 짧은 페이지에서 계정이 바뀌거나 로그아웃하면 SESSION_CHANGED로 전체를 거부한다. 같은 UID의 토큰 갱신·계정 연결은 허용한다. 뒤 페이지 DB 오류도 앞부분을 정상 목록으로 반환하지 않는다.

## 독립 오프라인 검증

[새 서비스 테스트](../tests/service/memory-pagination.test.ts)는 actual service와 실제 Supabase query builder를 사용한다. 응답 대역은 직렬화된 owner/cursor/limit를 읽어 데이터를 필터하므로, 미리 정해진 페이지를 순서대로 주는 방식으로 빠진 cursor나 owner 조건을 감추지 않는다.

11개 테스트가 통과했다.

- 같은 microsecond timestamp의 소유 기억1,005개와 타인3개: 6페이지, 정확한 ID순서, 중복·누락·타인혼합0.
- timestamp 집단 전환과 ID tie-break, 빈 목록·정확히200개 종료.
- 뒤 페이지403/500 오류 및503의 SDK 기본3회 재시도 소진 뒤 부분반환 거부.
- 두 번째 페이지에서 계정 변경·로그아웃 시 SESSION_CHANGED, 모든 요청은 처음 owner로 유지.
- 마지막 짧은 페이지도 계정 검사, 같은 UID의 토큰 갱신 허용, 최초 무인증이면 REST0회.

오프라인 mock 성공은 실제 서버 검증과 구별한다. 같은 timestamp 고정 fixture는 기존1,000개 절단을 재현할 수 있고, 다중 페이지 중 계정 전환 때문에 한 계정의 앞200개를 완료 목록처럼 반환하는 별도 경계도 검사한다.

## 별도 GO 뒤에만 실행할 로컬 검증

[로컬 실행기](../tests/backend/local-memory-pagination-smoke.mjs)의 기본 명령은 plan만 출력한다. CLI·Auth·DB·네트워크를 호출하지 않는다. --run에 더해 JUMZIP_RUN_LOCAL_MEMORY_PAGINATION=LOCAL과 Main의 실행 GO가 필요하다. 명시 opt-in 없는 실행 거부와 ledger/report 미생성을 확인했다. 초기 준비에서는 실제 계정·기억을 생성하지 않았으며, 이후 각각 승인된 실제 실행 결과를 아래에 구분해 보존했다.

실행 대상은 http://127.0.0.1:54321로 고정한다. 기존 local Supabase status JSON의 URL/anon/service key만 메모리에서 읽고 출력·저장하지 않는다. hosted 환경파일은 읽지 않으며 서버·설정·container를 변경하지 않는다. 네트워크는 exact local Auth/REST만 허용하고 Edge·모델·외부 destination·redirect를 막는다.

승인된 실행은 admin으로 표시된 합성 계정2개를 생성하고, 각 ID를 즉시 cleanup ledger에 쓴 뒤 magic-link token 검증으로 소유 session을 만든다. A에 동일 시각 기억1,005개, B에3개를 seed한다. 실제 unpaginated REST의1,000개 제한과 양방향 RLS를 확인한 뒤 production service.ts를 메모리에서 TypeScript transpile해 실행한다. 최신 실행기는 production auth-identity.ts도 별도 메모리 모듈로 변환해 service의 상대 import를 연결한다. build-time public env와 모듈 import 경로만 주입하고 service/helper 함수 로직은 복제·수정하지 않는다. transpiled source나 session/key는 파일로 쓰지 않는다.

실제 검사는 A 전체1,005개/6페이지와 타인 배제, 명시적인 두 번째 page URI에 최초+SDK 재시도3회 모두 HTTP503을 유지한 대역에서 전체 거부, 실제 session을 B로 바꾼 뒤 SESSION_CHANGED, 후속 B 목록3개다. 주입한 HTTP503은 서버 자체 장애로 보고하지 않는다. 실제 session 변경 검사는 원래 A의 진행 중 응답이 도착해도 이전 계정의 부분 결과를 성공으로 노출하지 않는지 확인한다.

finally에서는 본 실행 marker/email 패턴으로 소유권이 확인된 계정만 삭제하고 Auth404와15개 소유 테이블0행을 각각 확인한다. 모두 확인한 ID만 ledger에서 제거한다. 이전 미정리 ledger가 있으면 동일한 소유권 검사를 거쳐 먼저 복구하며, 실패하면 새 계정 생성으로 넘어가지 않는다.

산출물은 test-results/local-memory-pagination-report.json과 runId별 별도 JSON이며 실패도 보존한다. secret/session/raw 기억은 기록하지 않고, 체크 결과·네트워크 집계·source hash·cleanup 상태만 남긴다. 이는 admin 생성 session을 쓰는 local DB/서비스 검증이며 공개 signup/CAPTCHA/OAuth 또는 실제 LLM 품질 검증이 아니다.

## 첫 실제 실행과 fixture 수정

Main의 첫 실제 로컬 run은96fc3467-d65c-4b76-95a7-8142dbe5543b이며, 원본은 test-results/local-memory-pagination-runs/96fc3467-d65c-4b76-95a7-8142dbe5543b.json에 보존했다. 정상1,005개/6페이지·microsecond·양방향RLS 등12개 체크는 통과했다. 단일503 뒤 거부를 기대한13번째 체크가 실패했고, 두 계정 모두 Auth404/15개 테이블0행으로 정리됐다. 이것을 production 서비스의 부분반환 버그로 판정하지 않는다.

설치된 @supabase/postgrest-js2.116.0의 PostgrestBuilder.ts는 기본 retry=true이고, fetchWithRetry.ts 및 types/common/common.ts는 GET/HEAD/OPTIONS의503·520을 최대3회 재시도한다. 첫 fixture는 전체 HTTP 중2번째 요청에만503을 주었으므로, 같은URI의 재시도가 정상 DB 응답을 받아 성공한 것이 원인이다.

수정 fixture는 두 번째 page URI에 최초+재시도3회 모두503을 반환한다. X-Retry-Count의 [null,1,2,3]과 동일URI를 확인·기록하며 production의 retry 설정을 끄지 않는다. Retry-After:0은 합성 장애에서 기다리는 시간만 줄인다. SDK가 계속 재시도하면 별도 상한으로 테스트를 실패시킨다. 페이지 개수와 HTTP 시도 횟수를 구분하고 실패 원본은 변경하지 않았다.

수정 후 오프라인11 tests·문법·scoped lint·전체 TypeScript가 통과했다. Main 재실행 GO 뒤 실제 local run f464f158-f987-490b-913a-d00933a1b844가 **31/31 PASS**했다. actual Auth17회/REST52회, 합성503은 동일 pageURI에4회(최초+SDK재시도3회)였다. X-Retry-Count=[null,1,2,3], 실제 sourceFrozen=true를 확인했다.

실제 service의 전체1,005개/6페이지와 RLS, 재시도 소진 뒤 전체거부, 조회 도중 실제 B session전환에 SESSION_CHANGED, 후속B기억3개가 모두 통과했다. 두 계정은 각각 Auth404와15개 소유 테이블0행으로 독립확인했고 ledger pending0이다. LLM·Edge·외부 요청은0회다. 성공 JSON은 test-results/local-memory-pagination-runs/f464f158-f987-490b-913a-d00933a1b844.json에 별도 보존했으며 첫 실패 JSON은 그대로 남겼다.

공유 가능한 정리본도 추적한다: [최초 fixture 실패](evidence/backend-local-memory-pagination-initial.json), [수정 fixture31개 통과](evidence/backend-local-memory-pagination.json). 이 실행은 이후 추가된 Auth identity coordination 전 소스를 검증한 것이며, 새 helper 도입 이후 실행과 혼동하지 않는다.

## Auth helper 연결 이후 실제 재검증

2026-09-20 10:43 KST의 run `3cc7dc4c-5ab5-4327-b6a8-7ad631ac4547`은 최신 service와 auth-identity helper를 연결한 상태에서 **31/31 PASS**했다. [추적된 실제 보고서](evidence/backend-local-memory-pagination-auth-gate.json)에 두 production 파일과 실행기·설정·migration의 source hash 및 `sourceFrozen=true`가 기록돼 있다. 이전 실패와 helper 도입 전 통과 보고서는 그대로 보존한다.

실제 local Auth17회·REST52회로 전체1,005개/6페이지, microsecond cursor, 양방향 RLS, 같은 page URI의 합성503 최초+SDK 재시도3회 소진 뒤 전체 거부, 조회 도중 B session으로 전환했을 때 SESSION_CHANGED, 후속 B 목록3개를 다시 확인했다. 합성 HTTP 오류4회는 의도한 장애 주입이며 실제 서버 오류로 집계하지 않는다.

두 합성 계정은 각각 Auth404와15개 소유 테이블0행으로 정리했고 ledger pending0이다. 모델·Edge·외부 호출은0회다. 이 실행의 helper는 Node queue fallback을 사용하므로 브라우저 다중 탭 보증으로 확대하지 않는다. 실제 브라우저 Web Locks 경계는 별도의 [17개 회귀 보고서](evidence/frontend-local-auth-identity-race.json)로 검증했다. 공개 signup/CAPTCHA/hosted OAuth 성공이나 모델 품질을 검증한 실행은 아니다.
