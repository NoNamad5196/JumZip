# Cloudflare 우선·OpenAI Luna 보조 전환

상태: **`DEPLOYED_AND_ENABLED` — 서버 배포·보조 활성화 완료.** 사용자에게 실제 대화 맥락의 OpenAI 전달과 활성화를 확인한 뒤 2026-09-20 **18:28 KST**에 `LLM_FALLBACK_ENABLED=true`를 적용했다. 서버 5개 함수 배포와 기본·보조 제공자 설정 7개 항목의 원격 일치를 확인했다. 모델 키는 서버에만 저장한다. 적용 릴리스는 `JumZipPersona-v4.2 / JumZipIntent-v1`이며, Gemini 보조를 Luna로 교체하고 반복 질문·공감 순서를 줄이는 제한된 변경이다. [서버 릴리스 기록](evidence/edge-openai-fallback-release.json)

## 호출 범위

- 기본 모델은 Cloudflare Workers AI `@cf/qwen/qwen3-30b-a3b-fp8`이다.
- **사용자에게 보이는 답변에서 Cloudflare가 HTTP 429를 반환할 때만** `gpt-5.6-luna`를 호출한다. 일반 대화와 타로·사주·궁합 해석이 이 범위에 해당한다.
- 의도 분류, 상담 제목 생성, 기억 추출·요약은 Cloudflare만 사용한다. 이 부가 작업에 유료 대체 모델을 연결하지 않는다.
- 인증 오류, 타임아웃, 네트워크 오류, 잘못된 응답 구조 또는 내용 검증 실패 자체는 전환 사유가 아니다.
- 최초 응답과 수리는 기존 제한을 유지한다. 한 답변의 수리는 최대 한 번이며, 전환한 provider 인스턴스의 후속 수리는 Luna에서 진행한다. 따라서 기본 호출의 429 후 Luna 응답·수리가 모두 필요하면 최대 CF 1회 + Luna 2회다. 수리도 별도 예산 예약을 거친다.
- CF→Luna 전환은 같은 요청의 AbortController와 남은 시간 안에서 실행한다. 새 60초를 부여하거나 제공자 간 재시도 루프를 만들지 않는다.

Luna 연결은 `https://api.openai.com/v1/chat/completions`와 정확한 모델 이름으로 제한된다. 요청은 `reasoning_effort: none`, `max_completion_tokens` 최대 900, `store: false`, `service_tier: default`를 사용한다. Cloudflare 전용 옵션과 키는 전송하지 않는다. `store: false`는 응답 저장 설정이며 모든 처리·보관 정책이 없다는 뜻은 아니다. 요청 필드는 [OpenAI Chat Completions 문서](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create), 모델 지원과 가격은 [Luna 공식 문서](https://developers.openai.com/api/docs/models/gpt-5.6-luna)를 기준으로 한다.

## 비용 제한과 정산

필수 마이그레이션 [`202609200016_openai_budget.sql`](../supabase/migrations/202609200016_openai_budget.sql)은 원격 DB에 적용됐고, 실제 RPC를 호출한 뒤 롤백하는 예산 검증이 통과했다. 예산은 사용자별이 아닌 이 JumZip 배포 전체의 공용 한도다. 현재 정책의 만료는 **2026-10-20 18:12:35.300928 KST** (`2026-10-20T09:12:35.300928Z`)다.

| 항목 | 제한 |
|---|---|
| 하루 | $0.10, `Asia/Seoul` 달력 날짜 기준 |
| 한 달 | $1.00, `Asia/Seoul` 달력 월 기준 |
| 전체 사용 기간 | 총 $1.00 |
| 만료 | 마이그레이션에서 정책 행이 생성된 시점부터 30일 |
| 실제 유료 요청의 입력 | 전체 직렬화 JSON의 UTF-8 크기 최대 64,000바이트 |
| 실제 유료 요청의 출력 | 최대 900토큰 |

날짜나 월이 바뀌어도 총 $1 한도와 만료 시각은 초기화되지 않는다. 서버를 재시작하거나 키를 바꾸어도 DB 기록은 유지된다. 예산 테이블은 브라우저 역할에서 접근할 수 없고, 서비스 역할 RPC의 단일 정책 행 잠금으로 여러 Edge 인스턴스의 예약·정산을 직렬화한다.

금액은 부동소수점 달러 대신 **1 USD = 1,000,000 micro-USD** 정수 단위로 저장한다. 매 유료 요청 직전에 다음 금액을 먼저 예약한다.

```text
예약 micro-USD = ceil((inputBytes + 1024) × 0.25 + maxOutputTokens × 1.2)
```

`inputBytes`는 스키마와 대화까지 포함한 실제 OpenAI 요청 본문 전체의 UTF-8 바이트 수다. 입력 토큰 수를 미리 확정하지 않고 바이트 수와 1,024의 여유분으로 보수적으로 예약한다. 최대 입력 64,000바이트와 출력 900토큰이면 예약액은 **17,336 micro-USD = $0.017336**이다. 이 금액을 예약할 잔액이 없으면 실제 출력이 짧을 것으로 예상되더라도 전송하지 않는다.

성공한 응답의 `usage.prompt_tokens`, `usage.completion_tokens`가 유효한 정수·범위이면 다음 금액으로 한 번 정산하고 차액을 돌려준다.

```text
정산 micro-USD = ceil(promptTokens × 0.25 + completionTokens × 1.2)
```

DB는 입력 1~`inputBytes + 1024`, 출력 0~요청 상한만 인정하며, 예약액보다 큰 정산이나 중복 환급을 허용하지 않는다. 0 입력처럼 DB 정산 조건을 충족하지 않는 값도 예약액을 유지한다. 정산은 실제 응답에서 보고된 토큰 수를 쓰지만, 내부 한도 계산에는 보수적인 입력 단가를 적용하므로 OpenAI 청구서 자체가 아니다.

Luna 공식 일반 입력 가격은 100만 토큰당 **$0.20**, 출력은 **$1.20**이다. 내부 예약·정산은 입력에 캐시 쓰기 상한을 고려한 **$0.25/100만 토큰**을 사용한다. 예를 들어 입력 1,000·출력 300토큰이면 내부 정산은 **$0.000610**, 일반 입력 공식 단가로 계산한 금액은 **$0.000560**이다. 실제 요청 길이와 수리 여부에 따라 사용 가능한 횟수는 달라진다. [공식 모델 가격](https://developers.openai.com/api/docs/models/gpt-5.6-luna)

사용량 누락·잘못된 값·실패한 HTTP·결과가 불명확한 타임아웃은 전체 예약액을 유지한다. 정산 실패도 예약을 유지하며, 이미 받은 답변을 다시 요청하지 않는다. 예약 실패, 만료, 한도 도달 또는 DB 연결 실패는 유료 전송을 막고 `LLM_BUDGET_EXCEEDED`로 처리한다. 이 제한은 JumZip의 예약 RPC를 거치는 호출에 적용된다. 같은 계정이나 키를 사용하는 다른 앱의 사용량까지 제한하지는 않는다.

## 반복 말투 수정

v4.2는 캐릭터별 말투를 유지하면서 다음 지시만 정리한다.

- 모든 답변을 질문으로 끝내거나 공감→요약→질문 순서로 작성하라는 요구를 제거한다.
- 사용자의 현재 요청에 필요한 길이로 답하고, 정보가 꼭 부족할 때만 질문하도록 한다.
- 실제 최근 assistant 메시지를 참고해 같은 도입·마무리·이미 답한 질문을 반복하지 않도록 한다. 이력이 없으면 이전 대화를 추측하지 않는다.
- 가상 말투 예시는 어조 참고로만 쓰고 문장 순서나 질문 수를 복제하지 않도록 한다.

보미·산이·아랑을 같은 말투로 통일하거나 도구 원자료·점술 규칙을 바꾸지 않는다. 이는 프롬프트 수정 내용이며, 반복이 완전히 사라졌거나 의미 정확성 검증을 통과했다는 주장은 아니다.

## 릴리스 구성과 실행 준비

현재 개발 소스의 Persona-v12 / Intent-v6 또는 별도 v4.1 실험본을 통째로 배포하지 않는다. [`prepare-openai-fallback-release.mjs`](../scripts/prepare-openai-fallback-release.mjs)는 이전 배포의 v4 Gemini 파일 목록을 정확히 재구성하고, 승인된 Luna·말투 변경만 적용한다. 새 릴리스에는 Gemini 호출 경로가 없으며, 기존 Gemini 문서·실행 증거·overlay는 이력으로 보존한다.

Edge 파일 목록은 **54개: 기존 파일 수정 6개, 신규 1개, 동일한 파일 47개**다.

| 종류 | 파일 |
|---|---|
| 수정 | `llm/provider.ts`, `llm/reply.ts`, `persona/config.ts`, `persona/prompt.ts`, `orchestration/execute.ts`, `http/errors.ts` |
| 신규 | `llm/budget.ts` |
| 별도 DB 변경 | `202609200016_openai_budget.sql` — 54개 Edge 목록에 포함되지 않음 |

타로·사주 응답 계약, validator, 저장된 카드·계산 결과는 기존 v4를 유지한다. 새로운 Tarot evidence나 TEXT_ONLY 계약은 이 릴리스에 포함하지 않는다.

```powershell
node scripts/prepare-openai-fallback-release.mjs --check
node scripts/prepare-openai-fallback-release.mjs
node --experimental-transform-types scripts/openai-fallback-release/check-stage.mjs <stage> --save-report
```

준비 스크립트는 새로운 ignored `supabase/.temp/openai-fallback-v4-2-*` 디렉터리에 파일별 SHA-256이 포함된 `release-manifest.json`을 기록한다. [`check-stage.mjs`](../scripts/openai-fallback-release/check-stage.mjs)는 실제 스테이지의 타입 검사와 mock transport 검증을 수행하고 `offline-verification.json`을 한 번만 작성한다. 이 명령에는 외부 요청·모델 호출·배포가 없다.

서버 설정은 `LLM_FALLBACK_ENABLED`, `LLM_FALLBACK_BASE_URL=https://api.openai.com/v1`, `LLM_FALLBACK_MODEL=gpt-5.6-luna`, 별도의 `LLM_FALLBACK_API_KEY`다. Gemini 키를 재사용하지 않고 새 키는 Supabase Secrets 등 서버에만 저장한다. 브라우저에는 OpenAI 제공자 안내 필드만 배포하고, 키에 `VITE_` 접두사를 붙이지 않는다. 보조 호출을 끄려면 `LLM_FALLBACK_ENABLED=false`로 설정하고 CF 기본 설정은 유지한다.

## 검증 기록과 남은 확인

현재 로컬 통합 게이트는 **1,233개 테스트 통과·실제 서비스 테스트 3개 생략**, TypeScript·린트·빌드 통과로 보고됐다. 이후 수정의 관련 테스트 11개도 별도로 통과했다. 이를 전체 테스트를 다시 실행한 수치로 합산하지 않는다. 관련 재현 검사는 다음 파일에 있다.

- [provider 전환·예약·정산·시간 제한 테스트](../tests/persona/provider-openai-fallback.test.ts)
- [DB 예산 테스트](../tests/db/openai-budget.test.ts), [서버 budget helper 테스트](../tests/backend/openai-budget.test.ts)
- [릴리스 범위 테스트](../tests/persona/openai-release.test.ts), [말투 지시 회귀 테스트](../tests/persona/openai-persona-variety.test.ts)

실제 실행 결과는 다음처럼 구분한다.

| 검사 | 확인한 결과 | 확인하지 않은 범위 |
|---|---|---|
| 첫 합성 응답 검사 | 실제 Luna 7회 응답. 보미·산이 후속 응답 2건은 원치 않는 질문을 붙여 말투 목표에 실패했다. 원본 `test-results/openai-fallback-live.json`을 보존했다. | 파일의 transport `passed`는 이 말투 실패를 없애지 않는다. |
| 수정 후 재검사 | [실제 합성 응답 기록](../test-results/openai-fallback-variety-recheck.json)의 7개 모두 HTTP 200, 수리 0회. 캐릭터별 후속 대화 3개 모두 원치 않는 질문이 없었고, 타로 한 장도 응답했다. | 전체 Persona 벤치마크·모든 타로 방향·사주 의미 정확성은 평가하지 않았다. |
| 예산·데이터 | 두 검사 총 실제 Luna 14회. 실제 예약·정산 RPC를 사용했고 보수적 장부 누계는 **11,887 micro-USD = $0.011887**이다. 사용자 계정·대화 쓰기는 0건이다. | Cloudflare의 429는 두 검사 모두 mock이었다. 실제 CF 장애→hosted Edge→Luna 전환을 통째로 재현한 검사가 아니다. |
| 공개 프런트엔드 | [공개 파일 증거](evidence/frontend-openai-fallback-public.json): 18:22 KST HTML·JS·CSS 10개 해시가 새 빌드와 일치했다. | 공개 가입·로그인 또는 인증된 사용자 전체 흐름 검증을 뜻하지 않는다. |
| 서버 배포 | 스테이지 `supabase/.temp/openai-fallback-v4-2-qjtA9h`, manifest SHA-256 `535278a18113ef4b8832e142815e534643eda014c3f4cc0744a97112a338005c`로 5개 함수 배포 성공을 CLI에서 확인했다. [서버 릴리스 기록](evidence/edge-openai-fallback-release.json)에 배포와 활성화를 따로 기록한다. | 18:28 KST 원격 활성화와 설정 일치를 확인했다. 5개 함수 모두 OPTIONS 204·미인증 POST 401을 반환했다. 이는 시작·인증 경계 확인이며 인증된 사용자 전체 AI 흐름 검증은 별도다. |

첫 실패와 재검사는 서로 다른 실행·manifest로 보존한다. 두 번째 소규모 검사의 개선은 확인됐지만, 이 결과가 원래 전체 Persona 품질 벤치마크를 대신하지 않는다. 위 비용은 이 앱의 보수적 장부 값이며 OpenAI 청구서 확정액이 아니다.
