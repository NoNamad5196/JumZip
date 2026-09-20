# Persona-v10: 대표 근거 항목과 원래 요청을 보존하는 수리

상태: **런타임·로컬 테스트·오프라인 micro8 준비 동결, 실제 모델 호출 및 배포 없음.** 후보는 `JumZipPersona-v10` / `JumZipIntent-v5`다. 기존 v9의 미해결 계약 실패와 원본 84개 의미 품질 실패를 그대로 보존한다. 이번 변경만으로 개선 또는 합격을 주장하지 않는다.

## Tarot의 대표 keyword 항목 하나

Tarot 출력 및 Tarot 수리 안내는 해석한 카드마다 선택 방향 `activeMeaning` 배열에서 대표 항목 하나를 **모델이 직접 선택**하도록 한다. 그 항목의 원문 표현을 본문에 자연스럽게 포함하고, `keywordIndices`에는 해당 index 하나, `textEvidence`에는 본문에 사용한 그 항목 전체를 그대로 쓰게 한다. 공백이 있는 구절도 배열 항목 하나이며, 단어 단위로 자르거나 쉼표 목록을 새로 만들지 않는다. 특정 카드·사례의 정답이나 고정 index를 지시하지 않는다.

이는 생성 지침이다. schema와 validator는 기존 **1–5개 index** 및 최대200자 연속 span을 그대로 허용한다. 기존 다중 keyword의 올바른 span도 계속 유효하다. 서버가 index나 근거를 선택·생성하거나 실패한 출력의 필드를 채우지 않는다. 한 카드만 묻는 후속 질문에는 그 카드만 해석하며, 비점술 응답의 빈 evidence 배열도 기존처럼 허용한다. 문장마다 keyword를 나열하거나 인용부호·동일 문장 형식을 강제하지 않는다.

선택한 keyword가 본문에 있어도 잘못된 원인·반대 의미가 함께 있을 수 있다. 빈 배열로 실제 해석의 근거를 생략하는 경우도 구조 검사만으로 모두 탐지하지 못한다. 기존 의미 Hard Fail 반례와 최종 rubric은 그대로다.

## 수리 요청 순서

`llm/provider.ts`의 공통 helper를 Chat/Tarot 및 `generateStructured`에 동일하게 사용한다.

1. 원본 message 객체를 복제한다. 호출자가 가진 객체와 순서는 수정하지 않는다.
2. 첫 message가 system이면 서버 수리 지침을 그 끝에 추가한다. 없으면 새로운 선두 system을 추가한다. 뒤쪽 system role을 새로 추가하지 않는다.
3. 모든 원래 context를 유지한다.
4. 무효 출력 전체를 assistant role로 추가한다.
5. 원래 마지막 user message를 **content byte동일**하게 마지막에 다시 붙인다. 수리 메타 지침을 새로운 user 발화로 보내지 않으며 새 데이터 envelope를 만들지 않는다.

수리 system에는 고정 서버 안내, 알려진 validator 오류 코드, 기존의 제한된 `{path, reason}` 진단만 추가한다. 임의 issue 문자열은 고정 `RESPONSE_VALIDATION_FAILED`로 치환해 system 지침으로 승격하지 않는다. 무효 출력·사용자 본문·기억·도구 데이터의 임의 값은 새로운 system 안내에 넣지 않는다. 원래 system에 있던 자료나 원래 context는 재구성하지 않고 보존한다. 구조화 수리의 오류 코드는 계속 `STRUCTURED_VALIDATION_FAILED`다.

명시적인 비표준 입력 처리: **원래 마지막 message.role이 user가 아니면 수리 전에 `LLM_INVALID_RESPONSE`, retryable=false로 실패**한다. user가 전혀 없거나 assistant/system으로 끝나는 경우에 과거 user를 임의로 현재 요청으로 승격하거나 가짜 질문을 생성하지 않는다. 이때 추가 repair HTTP는 0이다. schema-only 최초 요청이 이미 유효한 경우에는 수리가 필요 없으므로 기존처럼 성공할 수 있다.

실제 호출부는 모두 마지막 user payload가 있다. Persona는 `persona/prompt.ts`의 `context.currentMessage`, Intent는 `llm/intent.ts`의 최소화한 현재 입력 JSON, 기억 추출·요약은 `persona/memory.ts`의 각 입력 JSON, 제목은 `orchestration/titles.ts`의 messages JSON이다. 독립 `structured-repair-context.test.ts`도 실제 호출 경로에서 이를 검증한다.

## 유지한 경계

공개 API·schema·validator·카드 데이터·방향·위치·사주 수치 및 규칙은 바꾸지 않았다. provider 모델 선택도 바꾸지 않았다. Chat output900, Intent350 등 각 호출자의 출력 한도, initial/repair timeout, 최대한 번의 수리, 128,000-byte 응답 상한을 유지한다. 반환값의 근거 필드를 공개 응답에 추가하지 않는다. DEFAULT Chat/Saju의 최초 출력 지침에는 대표 keyword 안내가 들어가지 않는다.

변경 production 범위는 `llm/provider.ts`, `persona/prompt.ts`, `llm/reply.ts`다. 별도 소유자인 Backend의 Intent-v5 설명 변경은 이번 통합 후보의 별도 변경이며, 여기에 섞어 수정하지 않았다.

## 로컬 검증

- 관련 provider/v8-evidence/v8-runtime-provider/v9-repair/v10-repair **79개 통과**. 새 v10 테스트 안에서 22카드×2방향×5항목×3위치 = **660개 대표 항목 조합**을 확인했다. 여러 단어 중 일부만 인용하면 기존 validator가 거부한다.
- 전체 Persona **283개 통과, 실모델2개 skip**. TypeScript 및 수정 파일 ESLint 통과. `v10-micro8-runner.mts`도 TypeScript stdin 경로로 ESLint 통과했다.
- 기존 테스트의 사용자 없는 repair mock은 실제 user payload를 가진 fixture로 바꿨다. no-user 실패/초기 성공은 별도 테스트로 명시했다. 벤치마크 원본 input·expected·결과·manifest는 수정하지 않았다.
- Frontend 소유의 독립 `structured-repair-context.test.ts` **9개 통과**가 전체 집계에 포함된다. frozen originals, leading system 경계, 원본 user byte일치, 실제 Intent/Memory/summary/title/Chat의 수리 context를 확인한다. 상세 독립 검토는 `docs/provider-repair-context-review.md`에 있다.
- 실제 의미 품질 평가는 수행하지 않았다. 로컬 mock 또는 schema 통과를 모델 품질 합격으로 계산하지 않는다.

## 새 micro8 준비

실행기는 `tests/persona/v10-micro8-runner.mts`, 산출물은 `tests/persona/benchmark-runs/v10-micro8/`다. v9 selection과 같은 8개 입력 hash·순서·reviewChecks를 정확히 대조한다. `v9-run-accounting.ts`의 순수 회계 helper를 수정 없이 재사용하여 전송 전 차단과 실제 호출을 구분한다. 실제 요청은 `redirect:'error'`로 다른 목적지로 따라가지 않는다. 새 runner는 최종 개행 하나로 정리한 뒤 hash를 고정했다. 실행된 v9 runner의 공백과 모든 역사적 증거는 보존했다.

오프라인 preflight는 전역 fetch 금지와 주입 transport만 사용했다. 8개 initial 요청과 v9에 실제 있었던 2개 repair의 현재 직렬화 크기를 별도로 캡처했으며, 네트워크0 / sourceFrozen=true다. 두 repair 크기 계산은 과거 합성 무효 원문을 사용한 시나리오이지 새 모델 응답 생성이나 채택이 아니다. 마지막 user 및 Gemma의 실제 provider `enable_thinking:false` 설정도 캡처에서 검증한다.

모델은 비교 후보 Gemma4, 공식 요율 input9,091/output27,273 neurons per million tokens로 기존과 같다. **cap800은 준비값이며 실행 허가가 아니다.** 실제 실행에는 별도 Main 사용량 확인과 GO/opt-in이 필요하다. 매 요청 전 현재 full serialized bytes를 input token 수로 간주하고 최대 output900을 더한 보수 예약을 적용하며, 미정산 호출은 전액 차감 상태를 유지한다. provider429 또는 cap 초과가 예상되면 전송하지 않고 중단한다.

| 오프라인 시나리오 | neurons | 범위 |
|---|---:|---|
| v9 관측 token/byte 비율·출력 길이로 추정한 초기8회 | 342.63 | 수리 제외, 상한 아님 |
| v9와 같은 두 사례에 수리가 생기는 시나리오 | 443.96 | 현재 수리 직렬화 크기 반영, 성공·수리 수 예측 아님 |
| 같은 시나리오의 누적 추정사용량+다음 요청 보수예약 최대 | 579.37 | 관측 기반 추정으로 cap800 완주 보장 아님 |
| 최대 initial 보수예약 | 205.80 | A/B 첫 사례 |
| 과거 두 repair를 현재 방식으로 직렬화한 보수예약 | 208.69 / 207.72 | 새로운 출력이면 달라짐 |
| 초기8회 보수예약 합 | 1,471.80 | 순차 정산하므로 동시 예약액 아님 |

원본 full84는 그대로 남아 있으며 micro8로 대체할 수 없다.

최종 후보 LF SHA256:

```text
llm/provider.ts   ff694aaf8c69c2cde1c9d25c76ba64c22c0f4dd0bf28c5bb2a963ec9e58b9eb9
llm/reply.ts      6c090292a7b3df0e34da3ce4dff0920f7669d2c8aea101da84dc4043cba9c578
persona/prompt.ts c1f6ea17c5b0c4dfcbe5ba8eaa79fb2f661df100127e1c04dddfd028b4f72460
llm/intent.ts    9680e657f687bf3877b4d7208b738bddae02e1858b4c6831b582215a3953de53
```
