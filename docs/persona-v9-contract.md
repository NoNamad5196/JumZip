# Persona-v9: Tarot 수리 진단 구체화

상태: **구현 및 로컬 검증 완료, 실제 모델 실행·배포 없음.** `JumZipPersona-v9` / `JumZipIntent-v4` 후보 소스에서 micro8 오프라인 준비만 완료했다. 원본 84개 합격 여부는 계속 미충족이다. 이 문서는 의미 품질 개선을 주장하지 않는다.

## 변경 이유와 범위

v8 실제 micro8은 4개 유효 응답, 3개 계약 실패, 1개 전송 전 예산 중단이었다. 실제 HTTP 10회는 모두 `finish_reason=stop`, 최대 출력 369 tokens였으므로 900-token 상한을 높일 근거가 없었다. 실패는 5개 근거 항목/중복 위치, 또는 본문의 연속 구절을 복사하지 않고 단어를 쉼표로 재조합한 `textEvidence`였다. 원문과 검토는 `tests/persona/benchmark-runs/v8-micro8/` 및 `docs/persona-v8-micro8-review.md`에 그대로 보존한다.

변경된 런타임 파일은 다음 세 개뿐이다.

- `persona/prompt.ts`: Tarot 출력 안내에서 조사·어미·공백·문장부호까지 연속 구절을 그대로 복사하도록 구체화한다. 여러 keyword가 멀리 떨어져 있다면 실제 근거가 있는 keyword만 선택하게 한다.
- `llm/provider.ts`: `repairChat(..., 'TAROT_EVIDENCE_V1')`에만 동일 안내와 `{path, reason}` 진단을 추가한다. 예를 들어 `/interpretationEvidence/1/positionIndex`의 `DUPLICATE_CARD_POSITION`, `/interpretationEvidence/0/textEvidence`의 `NOT_A_CONTIGUOUS_SUBSTRING_OF_TEXT`를 전달한다. 상위 배열이 3개를 초과해 validator가 조기에 종료해도 중복 위치를 함께 설명할 수 있다.
- `llm/reply.ts`: prompt version만 `JumZipPersona-v9`로 변경한다.

진단은 처음 12개 항목, 최대 16개 경로로 제한한다. 추가 진단에는 모델이 출력한 임의 값이나 본문을 복사하지 않는다. 원래 수리 대화의 assistant 메시지에는 기존과 같이 무효 출력 전체가 있다. 실제 선택 방향의 keyword 범위처럼 provider가 판단할 원자료를 받지 않는 오류는 해당 필드 계열 경로와 기존 validator 오류 코드를 안내하며, 올바른 index나 인용문을 추측하지 않는다.

DEFAULT Chat/Saju 수리 및 `generateStructured`의 Intent/Memory 수리 문구는 기존과 동일하다. JSON Schema, validator, 공개 응답, 카드 데이터, 방향, 위치, 도메인 수치·규칙, 모델 선택 및 provider 옵션은 바꾸지 않았다. 기존 900-token, initial 60초/repair 30초, 최대 한 번의 수리, 응답 128,000-byte cap을 유지한다. provider 일반 timeout/cap 및 v8 계약 테스트도 그대로 통과한다.

## 보장과 한계

서버는 근거 문구를 자동 생성하거나 누락된 필드를 채우지 않는다. 안내를 받은 두 번째 응답도 같은 validator를 통과해야 하며, 실패하면 `LLM_INVALID_RESPONSE`다. 카드당 항목 하나라는 기존 규칙을 유지하되 한 카드만 묻는 후속 질문에 모든 카드를 설명하도록 강제하지 않는다. 비점술 답변에서 빈 배열을 허용하는 기존 규칙도 그대로다.

이는 연속 인용 및 자료 출처의 구조 오류에 대한 수정이다. 유효 keyword/span 안에 방향과 반대되는 원인을 섞는 문장, 또는 실제 해석을 했는데 빈 배열로 숨기는 문장은 구조 검사만으로 모두 탐지할 수 없다. 기존 wrong-cause 반례는 여전히 구조상 통과하고 의미 평가에서는 Hard Fail이다. 원본 평가의 다섯 축과 Hard Fail 기준을 바꾸지 않았다.

## 테스트

- `tests/persona/v9-repair.test.ts`: 10개. 실제 provider 직렬화, 구체 경로, 잘못된 출력 보존, 근거 자동 생성 없음, 한 번 수리 후 실패, DEFAULT/structured byte 동일성, bounded diagnostics, malformed JSON, 의미 검사의 한계를 확인한다.
- `tests/persona/v9-run-accounting.test.ts`: 4개. 첫 요청 차단, 수리 전 차단, 전송 없는 준비 기록, 두 번 모두 시도한 무효 응답을 구분한다.
- provider/v8-evidence/v8-runtime-provider/v9-repair: 68개 통과. 전체 Persona는 249개 통과/실모델 2개 skip였으며 이후 추가한 회계 테스트 4개도 통과했다. TypeScript, 수정 범위 ESLint, 새 `.mts` stdin ESLint, Vite build 통과.

명령:

```powershell
node node_modules/vitest/vitest.mjs run tests/persona
node node_modules/typescript/bin/tsc --noEmit
node --experimental-transform-types tests/persona/v9-micro8-runner.mts --preflight
```

## micro8 준비와 회계

새 실행기는 `tests/persona/v9-micro8-runner.mts`, 순수 회계 함수는 `tests/persona/v9-run-accounting.ts`다. `tests/persona/benchmark-runs/v9-micro8/`에만 selection, 빈 직접 리뷰 rubric, preflight를 쓴다. v8 selection과 실행 순서·8개 원본 input hash·reviewChecks 전체를 정확히 대조하므로 다른 사례나 기대값으로 대체하면 실행 전에 실패한다. v8/v5 원본과 전체 84개는 변경하지 않는다.

준비된 요청 `requests`와 실제 I/O 직전 추가되는 `attempts`를 구분한다. 첫 요청이 예산에 막히면 `entries`에 넣지 않고 `notSentRequests`와 `pendingIds`에 남긴다. 첫 요청은 전송됐지만 수리가 막히면 실제 호출 수가 있는 `INTERRUPTED` entry와 pending 상태를 함께 남긴다. 실제 두 번의 응답이 모두 무효인 경우는 `INVALID`로 실행만 완료된 것이며 품질 통과가 아니다. 내부 budget 오류의 `LLM_RATE_LIMITED` 매핑은 외부 HTTP 429 관측으로 해석하지 않는다.

오프라인 실행은 global fetch 금지와 주입된 mock transport를 사용했다. 실제 네트워크 0, 8개 준비 요청, `sourceFrozen=true`, Persona-v9/Intent-v4다. 실제 실행에는 별도 Main 사용량 확인·GO와 명시 opt-in이 여전히 필요하다. 기존 결과 파일이 있으면 실제 실행을 거부한다.

제안 cap은 **800 neurons**, 최대 16 HTTP다. 매 요청 전 현재 직렬화 UTF-8 bytes를 input token 수로 간주하고 output 900을 더한 보수적 예약이 cap 이내일 때만 전송한다. usage가 확인되면 실제 사용량으로 정산하고, 미확인분은 예약 전액을 남긴다. 실제 429는 즉시 중단한다. 모델 및 공식 요율은 기존 Gemma4 `@cf/google/gemma-4-26b-a4b-it`, input 9,091 / output 27,273 neurons per million tokens로 동일하다.

오프라인 예산 결과:

| 항목 | neurons | 해석 |
|---|---:|---|
| v8의 관측 토큰/byte 및 출력 길이로 추정한 초기 8회 | 341.59 | 수리 제외, 미전송 마지막 사례는 관측 최대 비율/길이 사용; 상한 아님 |
| v4 이전 출력에 기반한 초기 8회 | 307.30 | evidence 출력 이전의 낙관적 역사 시나리오 |
| 이전 최대 input 비율 + 매회 출력 900 시나리오 | 501.51 | 수리 제외, tokenization도 관측 모델이므로 보장 아님 |
| 모든 초기 요청 보수 예약의 합 | 1,477.52 | 순차 요청 후 정산하므로 동시에 필요한 금액은 아님 |
| 한 요청의 최대 초기 예약 | 205.80 | A/B 사례가 첫 순서 |

800 cap이 완주를 보장하지 않는다. v9의 더 구체적인 수리 안내는 수리 input을 늘리며, 실제 토큰·수리 수가 달라지면 미완료 ID를 남기고 중단해야 한다. 전체 84개의 실행 허가 또는 대체 검증은 아니다.

런타임 LF SHA256:

```text
llm/provider.ts   b1b1edc89be8e8705823446214dfd044119ecad63e71e88fc343b322fb181cf9
llm/reply.ts      8e8b2d6a0f28f74681daaa7f08e34dbede0524b2f13e935bb2f5af2290b0d1b7
persona/prompt.ts f8e1893e66f02129665ebcf16fc08b14d4c5581a3d7a2f063f5fbc52b4bd2d16
llm/intent.ts    a5a35e1144571472a163247087be5dc9e134ed7f1c4a47c51c1015af533d9983
```
