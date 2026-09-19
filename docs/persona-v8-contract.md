# Persona v8 내부 Tarot 근거 계약 — 구현 계약

2026-09-20, Codex AI / fortune_audit. Main이 선택한 대안②를 현재 provider/validator/reply 경로에 맞춰 구체화했다. 검사된 checkpoint b731b5595d9e694e7d66021439fde8906a422f37 이후 Main의 구현 GO로 provider/reply/validator/prompt에 적용했다. 원본 corpus·기대값·외부 API 변경0, 실모델 호출0이다. 실제 모델 품질은 미검증이며 별도 live GO를 기다린다.

## 목적과 보증 범위

모델의 Tarot 설명이 어느 **선택 방향 keyword**와 최종 본문의 어느 구절을 근거로 삼았는지 연결하고, 잘못된 index·저장 draw 밖의 위치·없는 본문 인용을 deterministic하게 거절한다. 자연어의 의미 일치, 타인의 실제 심정, 부정문·원인·대안의 적절성까지 증명하는 구조가 아니다.

특정 카드나 실패 문구를 금지하지 않는다. 승인된22장×정/역 배열을 그대로 사용하며 새로운 의미·동의어·점수·규칙을 만들지 않는다. 추가 검증 LLM이나 추가 왕복을 넣지 않는다. 기존900 output tokens와 **최대 한 번 repair**를 유지한다. 일반 Chat/Saju와 public API schema는 그대로다.

## 적용 조건과 내부 JSON

서버가 전달한 toolResult에 기존 canonical Tarot cards가1~3개 있을 때만 새 내부 계약을 선택한다. 사용자 문장에 “타로”가 있다고 켜지 않는다. 실행되지 않은 타로 요청처럼 cards가 없는 경우에는 기존 계약을 쓴다. Tarot 결과가 문맥에 있더라도 현재 발화가 일상 대화일 수 있으며, 그 경우도 아래 빈 근거 배열을 허용한다.

기존 `text`와 `toolReferences`에 **provider 내부 필드 하나**를 더한다.

```json
{
  "text": "사용자에게 표시할 최종 한국어 답변",
  "toolReferences": [
    {"cardId": 9, "orientation": "REVERSED", "positionIndex": 1}
  ],
  "interpretationEvidence": [
    {
      "positionIndex": 1,
      "keywordIndices": [0],
      "textEvidence": "최종 text에 그대로 존재하며 선택 keyword를 담은 구절"
    }
  ]
}
```

예시의 toolReferences는 구조 설명용 한 항목이다. 실제 요청에서는 기존 규칙대로 저장된 카드 **전체**의 정확한 ID/방향/순서를 그대로 반환한다. 이 reference 요구와 본문에서 실제 해석한 카드의 evidence 요구를 구분한다. 전체 reference가 있다고 모든 카드를 본문에서 해석해야 하는 것은 아니다.

| 필드 | 내부 JSON schema 제한 | runtime 검사 |
| --- | --- | --- |
| `text` | 기존 string1~6000 | 기존 Persona/수치/확정성 검사 그대로 |
| `toolReferences` | 기존 구조 그대로 | 기존 저장 draw tuple·순서 검사 그대로 |
| `interpretationEvidence` | required array,0~3개 | 같은 position 중복 금지. 전체 카드 수만큼 채우도록 강제하지 않음 |
| evidence.`positionIndex` | integer0~2 | 실제 expectedCards에 있는 위치인지 확인 |
| evidence.`keywordIndices` | integer array,1~5개, 각0이상 | 중복 금지. 실제 해당 카드의 선택 방향 배열 길이 안에 있는지 확인 |
| evidence.`textEvidence` | string1~200 | 공백만 있는 값 거절. 최종 trim된 text의 정확한 연속 부분문자열인지 확인 |

최상위와 evidence 객체는 `additionalProperties:false`다. keyword index는 **0-based**다. 모델이 별도 source orientation을 선언하지 않는다. 서버가 expectedCards의 방향으로 `getTarotMeaning(cardId).upright/reversed`를 고른다. 선택한 모든 keyword가 해당 `textEvidence`에 원래 표기 그대로 들어 있어야 한다. 공백을 지우거나 유사어를 확장해서 임의 의미 매칭하지 않는다. keyword가 여러 개면 모두 들어 있어야 하며, 전체5개를 쓰도록 강요하지 않는다.

200자 span 상한과 evidence 최대3은 새 전통 해석 규칙이 아니라 이번 내부 출력의 제한이다. 위치당 한 구절로도 선택 근거를 기록할 수 있도록 한 공학적 선택이며, 모델이 단순 출력 제한을 맞추지 못하는지는 별도로 계측한다.

같은 keyword가 서로 다른 카드나 정/역 배열에 함께 있으면 문자 일치만으로 의미의 출처를 구분할 수 없다. 유효한 다른 position에 근거를 붙여 놓고 본문에서 사람이나 위치를 바꿔 말하는 경우도 자연어 의미 검토가 필요하다. 이 계약은 모델이 제출한 출처의 유효성을 확인하며 그 출처 표기가 본문의 모든 주장에 정확히 대응함을 증명하지 않는다.

## 카드 하나만 묻는 후속 질문과 빈 배열

- 저장된 세 카드 중 한 장만 묻는 질문에는 해당 position의 evidence 한 개만 허용한다. 다른 두 장의 해석 본문·keyword·span을 요구하지 않는다. 기존 toolReferences는 세 장 그대로 유지한다.
- 도구 결과가 문맥에 있지만 사용자가 비점술 대화를 하면 `interpretationEvidence:[]`를 허용한다. 설명을 하지 않았는데 keyword를 억지로 넣도록 하지 않는다.
- 모델 지시는 “실제로 본문에서 해석한 카드 설명에 근거를 연결한다. 해석하지 않은 카드의 근거를 꾸미지 않는다”로 한정한다. 새 추천이나 추첨 실행을 만들지 않는다.

**한계:** 모델이 Tarot 해석을 해 놓고 빈 배열을 반환하는 우회를, 이번 구조만으로 완전히 알아낼 수 없다. `[]`를 무조건 거절하면 비점술 대화가 깨지고, 모든 카드 이름·키워드의 본문 출현을 해석으로 간주하면 인용·거절·일상어를 잘못 잡는다. 이 단계에서는 그런 휴리스틱을 의미 검증인 것처럼 추가하지 않는다. 빈 배열은 schema상 통과할 수 있으며, 실제 해석이 있는데 evidence가 없다는 문제는 직접 리뷰에서 잡아야 한다. 근거를 채웠다는 사실도 본문의 모든 점술 주장이 검증됐다는 뜻은 아니다.

## 현재 코드에 대한 patch 설계

### 1. 고정된 내부 response contract 선택

현재 `LLMProvider.generateChat(messages)`와 `repairChat(messages, invalidOutput, issues)`는 항상 `CHAT_RESPONSE_SCHEMA`를 쓴다. provider 내부의 고정 enum 계약을 선택할 수 있는 **optional argument**를 추가한다.

```ts
type ChatResponseContract = 'DEFAULT' | 'TAROT_EVIDENCE_V1';
generateChat(messages, contract?: ChatResponseContract);
repairChat(messages, invalidOutput, issues, contract?: ChatResponseContract);
```

사용자에게 임의 JSON Schema를 받는 API는 만들지 않는다. 생략하면 기존 `DEFAULT`다. 기존 일반 Chat/Saju 호출과 provider mock 구현의 필수 인자는 바뀌지 않는다. Tarot 조건은 `generatePersonaReply`가 trusted expectedCards로 결정하고, 같은 contract를 initial/repair에 전달한다. 선택 로직을 provider가 자연어로 추론하지 않는다.

고정 schema와 type은 필요하면 `llm/chat-contract.ts` 같은 내부 파일에 분리해 provider와 validator가 공유한다. 일반 `CHAT_RESPONSE_SCHEMA`는 그대로 유지하고, 새 Tarot schema만 `interpretationEvidence`를 추가한다. schema name도 `jumzip_tarot_evidence_v1`처럼 별도로 둔다. 이 이름은 public API 버전이 아니다.

### 2. generate와 repair의 실제 schema 전달

현재 provider의 `request(messages,schema,name,timeout,temperature)`를 그대로 재사용한다. 초기와 repair가 **동일하게 선택된 Tarot schema**를 받는다. JSON object mode는 response_format에 schema가 들어가지 않으므로, 현재 구현처럼 system 메시지에 실제 schema를 넣는 경로도 두 호출에서 그대로 적용해야 한다. JSON schema mode는 동일 schema/name을 strict response_format에 넣는다.

`generateStructured`로 옮기지 않는다. 그 함수는 자체 repair를 가지므로 바깥 reply repair와 결합하면 두 번 수리가 될 수 있고, 현재 응답 model/usage/repaired metadata 경로도 달라진다. 기존 `generateChat → validate → 필요하면 repairChat 한 번 → validate` 구조를 유지한다.

최대900 tokens, 초기60초·repair30초의 기존 상한, 기존 temperature,128KB body cap, abort와 sanitized error semantics는 바꾸지 않는다. JSON으로 근거를 복사하는 output 비용이 늘 수 있어도 token 상한을 임의로 올리지 않는다.

### 3. validator

`validateChatOutput`은 existing expectedCards가 있는 Tarot 요청에서만 새 필드를 필수로 검사한다. DEFAULT 요청은 지금처럼 새 최상위 필드를 거절한다. 기존 JSON/Text/Persona/tool tuple 검사를 통과한 뒤 evidence를 검사한다.

검사 순서는 다음과 같다.

1. evidence 배열·객체 keys·각 자료형·길이 확인.
2. expectedCards에서 position을 찾아 실제 선택 방향 row를 조회.
3. position 중복과 keyword index 중복/범위 오류 확인.
4. `textEvidence`가 최종 저장될 `text.trim()` 안에 실제 존재하는지 확인.
5. index가 가리키는 원래 keyword들이 해당 span에 실제 포함됐는지 확인.

오류에는 `TAROT_EVIDENCE_REQUIRED`, `TAROT_EVIDENCE_SHAPE_INVALID`, `TAROT_EVIDENCE_POSITION_INVALID`, `TAROT_EVIDENCE_KEYWORD_INVALID`, `TAROT_EVIDENCE_SPAN_MISSING`, `TAROT_EVIDENCE_KEYWORD_NOT_IN_SPAN` 같은 고정 내부 issue를 쓴다. 원시 prompt·본문·개인정보를 error에 복제하지 않는다. repair는 기존 메시지와 고정 issue를 받아 동일 schema로 다시 생성한다. 두 번째 실패는 기존 `LLM_INVALID_RESPONSE`로 끝낸다. 자동으로 근거나 누락 필드를 만들어 통과시키지 않는다.

validator의 외부 반환값은 기존 `ValidatedReply{text,toolReferences}` 형태를 유지해 내부 evidence를 strip한다. `generatePersonaReply`의 `{content,segments,repaired,metadata}` 및 contracts의 ChatResult/TarotResult는 바꾸지 않는다. DB 컬럼·migration·RLS·프런트엔드/API envelope 변경은 필요 없다. 현재 request의 원래 카드와 dictionary keyword만 사용하고 개인정보를 추가하지 않는다. 향후 benchmark의 합성 provider 원문에는 내부 근거도 보존되지만 운영 API·메시지 본문·기억에는 이 객체를 덧붙이지 않는다.

저장된 이전 버전 응답을 조회·replay할 때 새 evidence를 소급 요구하지 않는다. 새로 해석을 생성하는 retry만 v8 내부 계약을 적용하며, 기존 draw/방향/위치는 그대로 사용한다.

### 4. prompt와 버전

provider에 보내는 Tarot 전용 출력 지시에 evidence 작성법만 추가한다. 현재 공통 prompt의 두 키 JSON 예시와 충돌하지 않도록 **출력 형식 설명 부분만** contract별로 나눈다. 일반 Chat/Saju의 실제 두 키 예시·말투·스타일 지시는 그대로 유지한다. 기존 selectedDirectionBasisKo와 원본 keyword 배열을 재사용하며 카드별 예시/금칙문은 추가하지 않는다. 구현 버전은 `JumZipPersona-v8`다. 생산 모델을 동시에 바꾸지 않는다.

## 의미 있는 로컬 검증 사례

| 사례 | 기대 |
| --- | --- |
|22장×정역×각 spread position의 유효 index와 정확한 keyword/span|구조 통과, 원본 row/draw 불변|
|원래 draw에 없는 위치|evidence position 오류|
|음수·소수·범위 밖 index, 중복 index/position|구조 오류; 빈 배열로 자동 대체하지 않음|
|선택 방향 배열에 없는 index 또는 실제 선택 keyword가 없는 span|keyword 오류|
|본문에 없는 인용, 본문 trim으로 사라진 전용 공백, 공백뿐 span|span/shape 오류|
|올바른 keyword가 본문 다른 곳에만 있고 지정 span에는 없음|keyword-in-span 오류|
|세 카드가 저장됐지만 사용자가 한 카드만 물음|toolReferences3개+해당 evidence1개 허용; 나머지 본문 강제 안 함|
|Tarot context가 있지만 비점술 대화이며 evidence빈 배열|구조 통과; 불필요한 카드 설명 강제 안 함|
|Tarot 해석 본문인데 evidence빈 배열|현재 구조의 한계로 통과 가능한 fixture; semantic PASS로 라벨링하지 않음|
|일반 Chat/Saju에 interpretationEvidence키가 섞임|기존 schema대로 거절; 정상 두 키 응답은 기존처럼 통과|
|초기 evidence오류→repair정상|HTTP2회 이내, initial/repair동일 Tarot schema, repaired=true|
|초기·repair 모두 오류|정확히2회 후 LLM_INVALID_RESPONSE; 세 번째 요청 없음|
|JSON object/JSON schema transport|두 방식 모두 초기/repair에 실제 Tarot schema 전달|
|900tokens·finish_reason length·timeout·bodycap|기존 차단 동작 유지; evidence때문에 예외 완화 안 함|
|API/reply 반환값|추가 evidence가 content/segments/metadata/public응답으로 새어 나오지 않음|
|이전 버전 결과 조회와 새 해석 retry|조회는 불변; 새 retry만 같은 draw로 v8 계약 적용|

## 반드시 통과 가능한 한계 반례

저장된 상대 위치가 은둔자 REVERSED이고 keyword index1이 `회피`인 경우를 **검증기 전용 합성 반례**로 고정한다.

```text
text = "상대는 혼자만의 시간이 필요하거나 회피하는 모습이야."
evidence = [{positionIndex:1, keywordIndices:[1],
             textEvidence:"상대는 혼자만의 시간이 필요하거나 회피하는 모습이야."}]
```

정확한 원본 toolReferences도 함께 주면 index·방향·keyword·본문 span의 모든 구조 검사를 통과할 수 있다. 하지만 “고독이 필요하다”는 반대 대안은 남아 있으므로 **최종 semantic rubric에서는 Hard Fail로 유지**한다. 이 fixture의 목적은 코드가 의미까지 증명한다고 착각하지 않게 하는 것이지, 특정 카드 문자열을 production에서 금지하기 위한 것이 아니다. 올바른 keyword가 들어간 부정문·반대 원인 문장도 같은 한계군이다.

## 평가와 진행 조건

로컬 검사에서는 단위 검증의 PASS와 위 반례의 semantic FAIL을 분리한다. 실제 모델 평가는 새 source가 동결된 뒤 원래 사례/기대/루브릭을 그대로 사용하고, 추가 output tokens·repair율·latency·빈 evidence·허위 span·방향 반대 해석을 각각 기록해야 한다. 8개 부분검사나 schema통과로 원본 core60+supplement24 품질 통과를 선언하지 않는다. 소스 구현은 승인되어 로컬 검증 중이며 실모델 호출은 별도 Main GO를 기다린다.

## 구현과 로컬 증거

`llm/chat-contract.ts`에 고정 schema/선택기를 추가하고 provider, reply, validator, Persona prompt를 연결했다. 선택기는 서버가 준 cards로만 분기하며 카드 없는 일반 Chat/Saju는 DEFAULT다. provider의 기존 `CHAT_RESPONSE_SCHEMA` export도 유지했다. `generateStructured`는 변경하지 않았다. 공통 DEFAULT prompt 전체 문자열을 checkpoint b731b5595d9e694e7d66021439fde8906a422f37의 원문과 비교해 동일함을 확인했다.

`tests/persona/v8-evidence.test.ts`와 `provider.test.ts` 집중44개가 통과했다. 그 안의 canonical 검증은22×2×3=132 조합의 모든 keyword index를 확인하며, known semantic Hard Fail의 structural-pass 반례·빈 evidence 우회·한 카드 후속 질문·두 transport mode의 동일 repair schema·정확히 한 repair·API strip·900token/byte cap/hanging body를 포함한다. 합성 테스트 응답을 실제 모델 출력으로 세지 않는다. 도메인+Persona 전체도 당시388 PASS/2 live skip이었으며, 후속 Intent-v3 작업의 새로운 검사는 별도 통합 집계에 포함된다. v8 소스의 scoped ESLint와 프런트엔드 build가 통과했다.

새 `v8-micro8-runner.mts`, `v8-full84-preflight.mts`, `v8-full84-runner.mts`는 이전 실행기에서 별도 파일로 준비했다. 기존 v7 산출물·원본 corpus·기대값·리뷰는 덮어쓰지 않는다. 사전 요청에도 실제 Tarot 계약을 명시적으로 전달하므로 evidence schema가 빠진 DEFAULT 비용으로 예측하지 않는다. 최종 source hash와 비용은 Intent-v3 동결 후 별도 준비 문서에 기록한다. 이 문서의 로컬 결과는 v8 실제 의미 품질의 통과 근거가 아니다.

## 후보 모델의 운영 요청과 시험 요청 일치

추가 Main 검토에서 과거 Gemma 시험 wrapper에만 생각 모드 해제 옵션이 있었음을 확인했다. [Cloudflare 공식 Gemma4 예제](https://developers.cloudflare.com/workers-ai/get-started/workers-wrangler/)는 `chat_template_kwargs.enable_thinking=false`를 사용하며, [해당 모델 문서](https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/)는 `chat_template_kwargs`와 OpenAI-compatible endpoint를 안내한다. 이를 바탕으로 production provider에 **정확한 Gemma4 모델 ID 및 HTTPS api.cloudflare.com의 account /ai/v1 경로**에만 옵션을 추가했다. 다른 endpoint/model과 Qwen의 기존 요청은 그대로다. Secrets·모델 선택·배포는 변경하지 않았다.

새 v8 wrapper는 옵션을 주입하지 않고 실제 provider body에 그 설정이 있는지 assert한다. 역사적 v4~v7 wrapper와 원문 요청 증거는 변경하지 않았다. `tests/persona/v8-runtime-provider.test.ts`는 실제 createExecutor의 환경 설정→Persona→provider→주입된 fetch까지 실행해 Chat/Tarot 초기와 repair에 같은 옵션·schema·900token이 전달됨을 검증한다. DB만 합성 fixture이고 외부 모델 요청은 없다. 구조화 응답350token/단일 repair 및 다른 endpoint/Qwen 불변도 포함해 provider/evidence/runtime 집중58개가 통과했다. 이것은 요청 경로의 일치 근거이며 실제 모델 품질이나 배포 완료 증거는 아니다.
