# Persona-v10 원본84 실행 준비

상태: **PREPARED_NOT_EXECUTED**. 실제 모델 요청0, 자격증명 읽기0. Main의 새 계정 사용량 확인과 명시적인 실행 GO 전에는 실행하지 않는다. 이 준비는 모델 전환·배포·품질 통과를 뜻하지 않는다.

현재 v10 micro8의 primary 직접 AI 평가는62/80=7.75, 확인된 의미 Hard Fail0이었다. 원본84 수용 검사를 대체하지 않는다. 다른 검토자의 점수를 이 준비의 비용이나 사례 선택에 사용하지 않았다.

## 고정 범위와 근거

- 원래 core20×3=60 뒤에 원래 사주 보충8×3=24를 실행한다. `PERSONA_BENCHMARK_CASES`, `BENCHMARK_CHARACTERS`, `SAJU_SUPPLEMENTAL_CASES`를 그대로 사용한다.
- `benchmark-runs/v7-full84-preparation/selection.json`과84개 ID·순서·입력 SHA256·reviewChecks를 완전 대조했다. 전체 selection은 SHA256 `9426ea84e6c50db265f609567ac241ff7988ff43070913f0623969ec1f844406`이다.
- 새 `benchmark-runs/v10-full84/review-template.json`은 기존5축0–2, 평균8이상·Hard Fail0 기준이며 core/supplement를 별도로 평가한다. 검토자·점수·원문은 비워 두었다. 자동 검사나 무효 응답에 의미 점수를 부여하지 않는다.
- runtime은 실제 micro8에 쓰인 **JumZipPersona-v10 / JumZipIntent-v5**와 같다. domain/persona/llm(별도 background memory 제외), 원본 corpus, 독립 동결 기대값, 실행기·회계 helper를 포함한34개 source hash를 기록했다.
- 원본 corpus·기대값·v10 micro 결과·이전 버전 산출물·운영 소스는 수정하지 않았다.

새 파일은 `tests/persona/v10-full84-preflight.mts`, `tests/persona/v10-full84-runner.mts`, `tests/persona/benchmark-runs/v10-full84/{preflight,selection,review-template}.json`이다. 이전 full84 실행기와 공통 `runPersonaBenchmark` / `runSajuSupplement`를 재사용하며, 새 실행기는 최신 미전송 회계를 적용한다.

## 요청 계약과 비용

모델은 기존 비교 후보 `@cf/google/gemma-4-26b-a4b-it`이며 production 기본 Qwen 설정을 바꾸지 않는다. 실제 provider가 설정한 `chat_template_kwargs.enable_thinking=false`를 assertion으로 확인한다. JSON object, 출력900토큰, 초기60초/수리30초, 정확히 최대1회 수리, 응답128000bytes를 유지한다. 초기84개와 수리 최대84개로 **최대168HTTP**다.

요금은 기존 공식 근거의 입력9091 / 출력27273 neurons per million tokens를 사용한다. 가격을 새로 조회하거나 계정 잔액을 실행기에서 읽지는 않았다. [Workers AI 가격표](https://developers.cloudflare.com/workers-ai/platform/pricing/), [Gemma thinking 옵션 근거](https://developers.cloudflare.com/workers-ai/get-started/workers-wrangler/).

| 사전 시나리오 | neurons |
| --- | ---: |
| 이전 v4 동일 사례 입력 비율·출력 기준 | 2791.31 |
| v10 micro 동일 ID 또는 동일 응답 계약 관측으로 초기84 추정 | 2924.97 |
| v10 관측 계약별 최대 입력 비율·최대 출력으로 초기84 추정 | 3044.43 |
| 초기 추정 + Tarot micro의2/6 수리율·수리비 외삽 | 3194.54 |
| 관측 계약별 최대 입력 비율 + 모두900출력(수리 제외) | 4725.81 |
| 제안된 실행 hard cap | **4000** |

비용 추정은 tokenizer 상한이 아니다. v4는 evidence 출력 이전 관측이고, v10은 초기8개·수리2개 표본이다. 사례와 출력 길이, 수리율은 달라질 수 있다. 가장 큰 초기 요청 예약은294.52neurons이고, 초기 사용량 추정으로 계산한 순차 예약 peak는3066.85다(수리 제외). 모든 초기 예약을 단순 합하면13530.68이지만 실제로는 한 요청씩 예약·정산하므로 동시에 예약하는 합계가 아니다.

각 실제 요청 전에 현재 직렬화한 UTF-8 bytes 전체를 입력 토큰으로 간주하고 출력900토큰까지 더해 보수적으로 예약한다. 실제 usage가 있으면 정산하고, 미정산·실패·알 수 없는 usage는 예약액 전부를 유지한다. `accounted + nextReserve > 4000`이면 보내지 않는다. 예약보다 큰 실제 usage가 관측되면 추가 요청을 중단한다. 이 방식도 미래 provider usage가 예약액보다 작다고 증명하는 것은 아니며, 관측 초과는 그대로 보고한다.

## 중단·보존·검토 경계

- 기본 실행은 `PLAN_ONLY`이며 외부 요청이 없다. live에는 `--execute`, `JUMZIP_RUN_V10_FULL84=LIVE`, `JUMZIP_V10_FULL84_USAGE_GO=FRESH_USAGE_CONFIRMED`가 모두 필요하다. 이 환경값은 Main의 실제 승인을 대신하지 않는다.
- 목적지는 기존 설정의 정확한 Cloudflare account AI `/v1/chat/completions`로 제한한다. redirect는 `error`, 다른 호스트·경로·query는 거부한다. 토큰·인증 헤더·계정 원문·오류 응답 body는 산출물에 저장하지 않는다.
- 저장된 사전 점검의 source/selection/rubric hash와 모든 초기 provider body SHA256가 실행 시 일치해야 한다. Persona/Intent 버전도 고정한다.
- 실행 시작 파일은 `wx`로 배타 생성한다. 기존 실행 산출물이 있으면 시작하지 않는다. provider raw와 progress는 새 append-only ledger에 쓴다. 최종 결과·manifest도 `wx`여서 과거 실행을 덮어쓰지 않는다.
- 요청 준비와 실제 HTTP 시도를 구분한다. 최초 전송 전 차단된 항목은 entries/attempts에 넣지 않고 `notSentRequests`, `pendingIds`, `neverAttemptedIds`에 남긴다. 수리 전 차단은 실제 초기 시도1개와 `INTERRUPTED`로 남고 pending에 포함한다.
-429는 즉시 중단한다. provider timeout/transport 실패도 추가 사례 실행을 중단한다. 확인된 raw JSON, usage, latency, request hash를 보존한다. 무효 JSON/HTTP 오류의 임의 body는 출력하지 않는다.
- 원본 두 평가 runner의 실제 결과 구조와 자동 flag를 유지한다. 실제 생성 완료와 의미 품질 통과는 분리한다. 실행만 끝나도 `NEEDS_REVIEW`이며 원문 직접 검토 없이 PASS가 되지 않는다.

## 로컬 검사

`node --experimental-transform-types tests/persona/v10-full84-preflight.mts`에서84개 실제 provider 요청 body를 injected transport로 만들었으며 global fetch는 금지했다. networkRequests0, sourceFrozen=true, 원본 입력·rubric 불일치0이었다. 전체 TypeScript와 새 두 `.mts` 파일의 scoped ESLint가 통과했다. 기본 실행 PLAN_ONLY 역시 요청0을 확인했다. 예기치 않은 인자·중복 인자·live opt-in 누락3종 거부, 기존 preflight 덮어쓰기 거부,34개 source hash 재대조, 새 파일 마지막 한 줄바꿈 검사도 통과했고 산출물 변화0이었다.

`node node_modules/vitest/vitest.mjs run tests/persona/v9-run-accounting.test.ts tests/persona/benchmark.test.ts tests/persona/saju-benchmark.test.ts`의19개 테스트가 통과했다. 이는 공통 미전송 회계와 기존 평가 runner의 자동/직접 평가 경계에 관한 로컬 회귀이며 실제 생성 품질 결과가 아니다.

해시(LF): preflight source `eb001d940144ba66b3b2ebf3279948d85dee393e7511000a635c1943a4fca397`, runner source `522bf2f55169e1c99a1a2ecc2fcd65d4126ad12b4160abebe8554a63a619d0ec`. 새 파일은 EOF 한 줄바꿈으로 고정했다. 현재 준비 파일의 생성·검사는 실제 모델 품질 검증이 아니다.
