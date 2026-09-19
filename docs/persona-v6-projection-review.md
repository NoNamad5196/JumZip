# Persona v6: 계산 근거의 분리와 방향 공통 조언 제거

2026-09-20, 작성·코드 검토: Codex AI (`fortune_audit`). 이 문서는 **실제 호출 전 로컬 구현·사전 점검 기록**이다. 이후 별도 승인된 세 건의 실행·실패 결과는 [v6 micro3 검토](persona-v6-micro3-review.md)에 기록했다. 아래 24건 준비 시점의 호출0은 그대로 보존한다. v5 실패 증거는 checkpoint `b96a2ab` 및 `tests/persona/benchmark-runs/v5-focused/`에 보존했다. 이 변경으로 품질 통과를 주장하지 않는다.

## 변경 근거와 범위

v5의 `10-retry-same-draw:BOMI`는 은둔자 역방향의 고립·회피 의미를 “혼자만의 시간이 필요해서”라는 원인 설명으로 바꿨다. 기존 provider 입력에는 선택 방향의 `activeMeaning`과 방향에 관계없이 붙는 `contextAdvice`가 함께 있었다. 은둔자의 공통 조언은 “혼자 있는 것과 도망치는 것을 구분한다.”이며, 악마의 공통 조언은 “내가 스스로 묶여 있는 지점을 확인한다.”이다. 조언 자체가 잘못된 데이터라는 판단은 아니다. 선택 방향의 상태 설명과 다음 행동을 위한 조언이 혼재하는 것이 원인 후보다. 실제 인과관계는 미검증이다.

v6은 **22장 전부** provider 카드 projection에서 `contextAdvice`를 제거한다. 원본 Tarot dataset·정/역 의미·배열·카드 ID·방향·위치·필수 참조는 그대로다. `activeMeaning`과 상징/관찰 구분을 유지한다. 은둔자 한 장이나 특정 실패 문장에 맞춘 답을 추가하지 않았다. 현재 사용되는 Persona 말투 예제에는 Tarot 예제가 없어, 이번 수정은 예제 속 은둔자 해석 제거가 아니다.

v5의 `v5-ab-swapped-contrast:SANI`는 A의 시주만 미상인 입력에서 B의 시주도 미상이라고 했다. B 원자료의 입력 provenance는 `NOT_RECORDED`였지만 B의 실제 계산 chart에는 시주가 있고, 상대 십성 행에도 B 시주가 `CONFIRMED`로 들어 있었다. 입력 기록이 없는 상태와 계산값이 없는 상태를 구분하도록 하는 지시만으로는 실제 출력 오류가 막히지 않았다.

v6은 실제 **correlated chart 배열**에서 `computedPillarCoverage`를 파생해 compact 입력에 추가한다. 일반 사주는 year/month/day/hour, 궁합은 personA/personB 각각 같은 네 필드를 보낸다.

| 값 | 직접 파생 조건 |
| --- | --- |
| `CONFIRMED` | 모든 후보 chart에 해당 기둥이 있으며 천간·지지가 모두 동일 |
| `POSSIBLE` | 후보별 천간·지지가 다르거나 일부 후보에만 기둥이 있음 |
| `UNAVAILABLE` | 후보가 없거나 모든 후보에서 해당 기둥이 null |

새 계산 판단이나 사주 규칙은 없다. 후보를 고르거나 서로 조합하지 않는다. 입력 날짜·시각·좌표를 복원하거나 추가로 직렬화하지 않는다. `PROVIDED`/`UNKNOWN`/`NOT_RECORDED`는 원자료 입력 상태로 계속 별도 유지한다. 이전 compact 자료에 coverage 자체가 없으면 표시되지 않은 것으로 취급하며, 미상으로 바꾸지 않는다. 실제 chart를 가진 과거 저장 snapshot을 재해석할 때는 원자료 입력 기록 없이도 coverage를 계산할 수 있다.

## 로컬 검증

`tests/persona/v6-projection.test.ts`의 7개 테스트는 22장×양방향×모든 spread 위치의 선택 의미/참조 유지, 원본 dataset 불변, 전체 provider-message 경로의 공통 조언 제외, 알려진/미상 시주, 경계 후보, 일부 후보에만 존재하는 기둥, A/B 교환, 입력 metadata 없는 legacy snapshot, 원자료 비노출을 검사한다. 배열 후보와 동결된 엔진 기대값은 바꾸지 않았다.

- `node node_modules/vitest/vitest.mjs run tests/domain tests/persona`: **353 PASS, 2 live skips**.
- `node node_modules/typescript/bin/tsc --noEmit`: PASS.
- 변경한 production/test `.ts` 파일의 ESLint: PASS. `.mts` runner와 준비 audit도 `.ts` stdin 경로로 lint한다.
- `node node_modules/vite/bin/vite.js build`: PASS. 기존 큰 bundle 경고는 남아 있다.

단위 검사는 projection의 사실성과 불변성을 확인한다. 모델이 한국어 문장에서 방향 의미를 뒤집거나 A/B를 혼동하는지까지 증명하지 않는다. 카드 ID·방향·위치의 구조 검사는 가능하지만 모든 자연어 원인·심정·해석의 진실성은 직접 검토가 필요하다.

## 같은 24건의 다음 평가 준비

`tests/persona/v5-focused-corpus.mts`를 수정하지 않고 v6 runner에서 그대로 import한다. 원래의 16 reply+8 intent ID·실행 순서·기대·루브릭을 유지하며, 첫 세 건은 `10-retry-same-draw:BOMI`, `s03-correlated-boundary:ARANG`, 순수 recall intent다. `preparation-audit.json`은 15개 입력 SHA가 v5와 같고, 9개 입력은 새 `computedPillarCoverage`만 재귀적으로 제거하면 v5 입력 SHA와 정확히 일치함을 확인한다. 이는 production projection 변경을 시험하는 것이며, 기존 의미 기대를 고치는 것이 아니다.

새 증거 경로는 `tests/persona/benchmark-runs/v6-focused/`이다. `review-template.json`은 비어 있으며 품질 점수가 없다. 실제 모델 호출은 **0회**다. `JumZipPersona-v6`, `JumZipIntent-v2`, Gemma4 시험 모델, JSON object+schema, reply 900/intent 350 token, 기존 timeout, 한 번 repair, 800-neuron hard cap을 준비했다. production provider의 Qwen 기본값은 변경하지 않았다. 계정 잔액 확인과 Main의 별도 실행 신호가 필요하다.

| 0-network 비용 점검 | neurons |
| --- | ---: |
| v4 full84의 이전 token/byte 평균으로 예측 | 758.41 |
| 같은 자료의 최대 token/byte 비율로 예측 | 795.05 |
| 같은 v5 24건 각각의 실제 token/byte 및 출력 길이로 예측 | 710.00 |
| 같은 v5 입력 비율 + 모든 출력 token 상한 사용 가정 | 1117.46 |
| 가장 큰 단일 요청의 보수적인 호출 전 reserve | 294.52 |

예측은 상한이 아니며 repair를 포함하지 않는다. 실제 실행은 매 요청 직전에 입력 bytes를 tokens로 잡고 최대 출력까지 예약하는 기존 보수 규칙을 유지한다. 800 한도나 429로 중단되면 pending ID를 기록하며 한도를 자동으로 올리지 않는다. 이 24건은 원본 **84건 acceptance를 대체하지 않는다**.

## Intent slot 오류: 확인된 원인과 별도 제안

v5 mixed recall+Tarot 발화는 “내 취미 기억해? 이번 주 모임에서 먼저 인사할지 타로로도 보고 싶어.”였다. 요청 목적·도구 추천은 맞았지만 실제로 서로 다른 선택지 두 개가 주어지지 않았는데 `choicesPresent: true`가 반환됐다. 현재 prompt는 “서로 다른 선택지 2개 이상”을 요구하지만 validator는 이 필드의 boolean 자료형만 검증하고, 참이라는 판단을 뒷받침하는 slot별 증거를 검증하지 않는다. 그래서 잘못된 의미 판단이 유효한 구조로 통과한 것은 코드와 출력으로 확인된다. 모델이 생략된 “인사하지 않기”를 추론했는지는 가능한 설명이며 확정된 내부 원인은 아니다.

별도 소유자의 다음 수정 후보는 선택지 두 개에 대해 최소화된 현재/허용 최근 발화에서 추적 가능한 각각의 증거를 요구하고, 같은 span의 재사용이나 존재하지 않는 대안을 거절하는 내부 계약이다. 인용 존재만으로 실제 서로 다른 선택지인지까지 자동 보증되지는 않으므로, 명시된 두 선택지·예/아니오 질문·이전 맥락의 선택지·잘못된 인용을 대조해야 한다. 모든 “할지”나 “기억” 발화를 정규식으로 차단하는 규칙은 제안하지 않는다. **v6은 Intent 소스·slot 판단·행렬·외부 API를 수정하지 않았다.**
