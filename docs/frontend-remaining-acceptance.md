# 인증 후 UI 회귀 검증 — 남은 세 작업

2026-09-20, checkpoint `b731b55`. Codex AI / contracts_audit의 **읽기 전용 준비 검토**다. 이번 검토에서는 브라우저 조작, 계정 생성, 실제 세션·토큰 접근, 모델 호출 및 제품 소스 변경을 하지 않았다. 아래 검사는 아직 실행하지 않았다.

근거는 [Engineering §20–21](https://app.notion.com/p/3df7cdef782d81d7b3a6d28b604f050f)의 M16/M17 및 Definition of Done, [Acceptance §8–11](https://app.notion.com/p/3e07cdef782d81da92ecf20053a3bff9)이다. 원본은 네 화면 크기, 모바일 사주 표, 출생정보 기본 비공개 내보내기, reduced motion에서의 기능 보존, 신뢰성·소유권 검증을 요구한다.

현재 근거는 다음처럼 구분된다.

| 확인된 근거 | 확인 범위 | 아직 연결되지 않은 부분 |
| --- | --- | --- |
| [fixture-visual-check.mjs](../tests/ui/fixture-visual-check.mjs), 로컬 `tests/ui/artifacts/fixture-visual-report.json` | 데이터가 있는 Chat/History/Tarot/Saju/Compatibility 20뷰, 실제 PNG 생성. 모든 백엔드 요청은 합성 응답 | 1280·390px의 높이가 모두 900px다. 원본의 1280×800·390×844와 다르며 모든 context가 reduced motion이다. |
| [navigation.spec.ts](../tests/e2e/navigation.spec.ts), [playwright.config.ts](../playwright.config.ts) | 3개 시나리오×2 projects: 게스트 이동, 120개 메시지의 이전 페이지·스크롤 유지, 도구 모달 키보드 초점 | 실제 PNG 실패 복구, 삭제 뒤 화면 복원, SDK 세션 변경과 캐시를 연결한 브라우저 시나리오는 없다. |
| [최신 공개 게스트 검증](evidence/frontend-deletion-guards-public.json) | public index/JS8/CSS1 해시 일치, onboarding/chat 360·1440px 4뷰의 HTTP/CSP/overflow/page 오류 없음 | 로그인 데이터가 있는 화면이나 실제 데이터 변경을 검증하지 않는다. challenge DNS 실패도 별도 기록돼 있다. |
| [실제 서비스 페이지 검사](evidence/service-pagination.json) | hosted 서비스로 1,005개 메시지·6페이지, 동률/null 커서, 검색, 상세용 전체 메시지 취득 | 실제 브라우저 다운로드·클립보드에 모든 메시지가 포함됐다는 근거는 아니다. |
| [선택 삭제 fixture](evidence/frontend-history-deletion-fixture.json), [실제 삭제 RPC](evidence/backend-history-deletion-smoke.json), [hosted 삭제 경합](evidence/backend-deletion-guards-hosted.json) | UI 합성 RPC payload, 실제 소유권·선택 삭제·404·늦은 callback 방지·정리 검증 | 실제 DB 변경 뒤 브라우저 캐시, 다른 화면 및 재진입 결과를 한 흐름으로 연결하지 않았다. |

## 1. 원본 네 화면 크기와 모션 설정에서 데이터 화면 검증

**목적:** M16의 정확한 viewport와 reduced-motion 기능 기준을 채운다. 기존 단순 게스트 화면을 다시 반복하지 않는다.

현재 production build의 별도 로컬 preview에서 모든 백엔드를 가로채는 프로젝트 Playwright fixture를 사용한다. 1440×900, 1280×800, 390×844, 360×800을 명시하고, Chat의 저장된 PARTIAL 결과, 알려진 시각의 Saju 상세, 시각 미상/경계 후보 Saju 상세, A/B 중 한쪽 시주가 미상인 Compatibility 상세를 확인한다. 입력은 기존 고정 합성 자료를 재사용한다.

통과 조건:

- 네 크기에서 수평 overflow가 없고 모바일 표·대운 날짜·미확정 표시가 잘리거나 서로 덮이지 않는다. 주요 캡처는 실제 이미지로 검토한다.
- 360×800과 1440×900에서 normal/reduced motion을 대조한다. 정상 응답 전체가 결국 표시되고, reduced motion에서도 본문·재시도·상세 이동·키보드 초점 기능이 유지된다. 합성 응답은 실제 모델 품질 근거로 집계하지 않는다.
- 배포 CSP를 로컬 preview 응답에 적용해 CSP/page 오류 0을 확인한다. 현재 `.env.local`이나 사용자 브라우저 프로필을 수정하지 않는다.

산출물 제안: 재실행 가능한 Playwright spec와 별도 `docs/evidence/frontend-authenticated-viewport-fixture.json`. 기존 20뷰 보고서는 보존한다. 이 결과는 **인증 상태 합성 UI/디자인 검증**이며 실제 인증·데이터 저장 검증이 아니다.

## 2. 긴 상담의 전체 취득·실패 복구·실제 PNG/텍스트 내보내기

**목적:** M13과 M16의 내보내기를 실제 브라우저 기능으로 확인한다. [reading.test.tsx](../tests/ui/reading.test.tsx)는 메시지 조회와 `html-to-image`를 mock하며, 기존 PNG fixture는 긴 메시지 페이지의 중간 실패를 다루지 않는다.

동일한 별도 로컬 production preview에 1,005개 메시지를 페이지별 합성 응답으로 제공한다. 처음·중간·마지막 페이지에 저장된 Draw별 해석과 같은 Draw의 이전/최신 해석을 구분하는 공개 가능한 sentinel을 넣고, 한 번은 중간 페이지를 지연한 뒤 실패시킨다. 이후 사용자의 명시적 다시 불러오기 동작으로 정상 응답을 제공한다. 실제 모델 호출이나 실제 계정 생성 없이 실행할 수 있다.

통과 조건:

- 전체 메시지가 준비되기 전과 중간 페이지 실패 뒤에는 텍스트 복사와 이미지 저장이 모두 차단된다. 실패를 부분 성공으로 표시하지 않는다.
- 다시 불러오기가 성공하면 모든 페이지를 읽어 얻은 각 Draw의 최신 해석이 복사 텍스트와 내보내기 DOM에 한 번씩 있고, 오래된 해석이 최신 해석을 덮지 않는다. Saju/Compatibility는 마지막 저장 해석을 확인한다. 결과 내보내기를 전체 대화 덤프로 바꾸는 요구는 아니다. 실제 PNG 다운로드가 성공해야 한다. PNG는 크기·파일 존재만으로 끝내지 않고 상단/중간/하단을 렌더 확인해 잘림을 점검한다.
- Tarot/Saju/Compatibility 기본 내보내기에서 구조화 출생자료에만 넣은 합성 생년월일·시각·도시·좌표 canary가 노출되지 않는다. 사용자가 직접 대화에 적은 개인정보를 자동 삭제한다는 가정은 하지 않는다. Saju의 명시적 출생정보 포함 옵션은 날짜·시각·도시만 허용하고 좌표는 계속 제외한다.
- 360×800에서 긴 결과의 버튼이 접근 가능하고, strict CSP와 이미지 생성 과정에 오류가 없다.

산출물 제안: export browser spec, 실제 생성 PNG, `docs/evidence/frontend-complete-export-fixture.json`. hosted 1,005개 서비스 검사와 **브라우저 합성 데이터 내보내기 검사**를 나란히 기록하되 둘을 실제 public end-to-end 성공으로 합치지 않는다.

## 3. 로컬 실제 DB에 연결한 선택 삭제·복원·계정 경계 UI

**목적:** M17에서 이미 통과한 RPC 소유권/삭제 검증을 실제 앱 화면·SDK·query cache·draft lifecycle와 연결한다. CAPTCHA나 Google 로그인을 기다릴 필요가 없는 테스트 계정의 인증 후 흐름이다.

실행 단계에서만 Main 소유의 기존 local Supabase test provisioner를 바탕으로 별도 합성 identity A/B와 최소 대화·상담·기억·저장된 PARTIAL 결과를 마련한다. 브라우저는 프로젝트의 별도 로컬 build와 로컬 Supabase만 사용한다. 관리자 자격 증명은 Node 측 테스트 setup에만 두며 프런트엔드에는 전달하지 않는다. 테스트 세션은 일시적으로 전달하고 로그·trace·보고서에 원문 토큰을 남기지 않는다. 현재 공개 빌드 설정을 로컬 주소로 덮어쓰지 않도록 별도 build 경로를 쓴다. 기존 local RPC/cleanup 방법은 [로컬 검증 근거](evidence/backend-local-supabase-verification.json)를 따른다.

통과 조건:

- 상담 삭제·대화 삭제 각각에서 기본 선택 0을 확인한다. 기록만 삭제하면 독립 기억을 보존하고, 개별 선택하면 정확히 선택한 기억만 사라진다. 형제 상담과 비관련 기억은 화면 재진입/새로고침 및 실제 소유자 조회에서도 남는다.
- 상담 A 삭제 후 A의 주소로 돌아왔을 때 사라진 기록이 캐시로 부활하지 않는다. draft는 보존되고, terminal NOT_FOUND 뒤 보내기/Enter/도구 재시도가 반복되지 않으며, 명시적 새 이야기 이동 뒤 새 상담으로 이어진다.
- 지연된 기존 요청이 있는 상태의 화면 이동과 A→B 세션 변경을 별도 프로젝트 fixture transport로 제어한다. 늦은 응답이 이동을 되돌리거나 B 화면/프로필/초안/기록을 A 값으로 덮지 않는다. 같은 UID의 연결 상태 변경은 다른 UID 전환과 구분한다. 이 지연·응답 분기는 **mock**이라고 따로 표시하고 실제 DB 검사 횟수에 섞지 않는다.
- `finally`에서 이번 테스트가 만든 identity만 삭제하고 Auth와 관련 소유 테이블의 잔여 0을 독립 확인한다. 모델 endpoint는 차단해 호출 0을 유지한다.

산출물 제안: local integration browser spec, 실제 DB와 mock transport 분기가 구분된 `docs/evidence/frontend-local-authenticated-lifecycle.json`. local runtime이 사용 가능하다는 전제이며, 현재 제안 단계에서 새 계정이나 세션을 만들지는 않았다.

## 실행·판정 경계

위 세 작업은 사용자 입력 없이 프로젝트 테스트로 준비·실행할 수 있다. 새 독립 테스트 context만 사용하며, 사용자 IAB/일반 브라우저 탭·기존 계정·CAPTCHA·Google 설정에는 접근하지 않는다. 일반 Windows 앱 조작으로 범위가 바뀌면 [computer-use 지침](C:/Users/nonam/.codex/plugins/cache/openai-bundled/computer-use/26.915.31029/skills/computer-use/SKILL.md)의 별도 도구·확인 절차를 적용한다. 이번 검토에서는 해당 앱 조작을 하지 않았다.

실제 public admin-created 합성 세션으로 후속 검증하더라도 그 결과는 **인증 후 데이터/UI 검사**다. 공개 anonymous signup, Turnstile 완료, Google linking 성공으로 주장할 수 없다. 위 세 검사가 통과해도 원본 full84 Persona 품질, 실제 public signup/linking, 실제 모델을 포함하는 public 상담 수용 기준을 대신하지 않는다.

## 실행 결과 — 2026-09-20 추가 검증

위의 준비 제안 뒤 세 작업을 실행했다. [정확한 네 viewport·모션 보고서](evidence/frontend-authenticated-viewport-fixture.json)는 32개 합성 인증 화면의 기능·overflow·CSP 검사를 통과했다. 대표 화면과 자연 폭으로 자른 사주/궁합 캡처를 Codex AI가 직접 검토했다. 32개 화면 모든 픽셀을 육안검사했다는 주장은 하지 않는다.

[전체 취득·내보내기 보고서](evidence/frontend-complete-export-fixture.json)는 1,005개 메시지의 중간 페이지 실패·명시적 복구, 실제 클립보드, 기본 PNG 3개 및 출생정보 포함 PNG 1개를 검증한다. 직접 PNG를 보다가 원본 화면에는 없던 이름·배지 줄바꿈과 footer 겹침을 발견했다. Reading.tsx의 `preferredFontFormat:'woff2'`는 실제 `woff2-variations` 글꼴의 src를 제거하므로 이 옵션을 제거했다. 수정 후 해당 겹침이 사라졌다. 최초 통합 실행에서 PNG가 120초 내 생성되지 않은 경우가 한 번 있었고, 이후 독립 재실행은 모두 완료됐다. 마지막 기본 PNG 생성 시간은 약 2.3–2.5초다. 최초 지연의 원인은 확정하지 않았다. 긴 제목의 일반 한국어 줄바꿈은 화면과 PNG가 동일하며 별도 변경하지 않았다.

[로컬 실제 DB lifecycle 보고서](evidence/frontend-local-authenticated-lifecycle.json)는 Main이 작성한 local-only setup/cleanup helper와 frontend 담당의 [브라우저 script](../tests/ui/local-lifecycle-check.mjs)를 Main이 독립 실행한 결과다. 실제 로컬 RLS/REST 연결 검증 6개와 명시적 mock 지연/404/SDK 전환 검증 4개가 통과했다. 브라우저의 실제 REST 요청은 51개, mock Edge 응답은 3개, 외부 요청은 0이다. 두 합성 계정은 local Auth에서만 만들어졌고, 종료 후 두 Auth 404 및 계정별 15개 소유 테이블 잔여 0을 확인했다. raw 세션·자격 증명을 산출물에 기록하지 않았다.

이 검증으로 제안한 세 가지 **로컬 frontend 회귀 작업**을 완료했다. 공개 signup·Turnstile·Google 연결, 실제 모델 응답 품질 및 전체 public E2E 완료로 확대 해석하지 않는다. 생성물은 `tests/ui/artifacts/acceptance-v1/`와 `tests/ui/artifacts/local-lifecycle/`에 있다. 재실행 명령은 `node --experimental-transform-types tests/ui/acceptance-fixture-check.mjs` 및 `node tests/ui/local-lifecycle-check.mjs`다.
