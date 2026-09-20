# Persona-v11 / Intent-v6 제안 — 신뢰된 수리 힌트와 고정 구조 진단

상태: **PROPOSED_NOT_IMPLEMENTED**. Main이 v10 체크포인트를 고정한 뒤 별도 source GO를 주기 전에는 production을 수정하지 않는다. 실제 모델 호출0. 이 문서는 v10 full84의 확인된 구조 실패에 대한 좁은 제안이며, 의미 품질 개선이나 원본84 통과를 주장하지 않는다.

## 확인된 문제

v10 원본84에서 `07:SANI`는 힘의 `인내`에 index2를 썼다가1로 수리해 성공했다. `10:BOMI`는 연인의 `연결`에 index2를 초기·수리 모두 써서 실패했다. `11:SANI/ARANG`은 해석하지 않는 재추첨 대화에서 evidence뿐 아니라 필수 저장 `toolReferences`도 비웠고 수리에서도 반복했다. 모두 finish=`stop`, 최대312출력토큰으로900 한도 문제가 아니다.

현재 `tarotRepairGuidance`는 카드의 원본 방향별 keyword 배열에 접근할 수 없다. 따라서 `TAROT_EVIDENCE_KEYWORD_NOT_IN_SPAN`을 받은 뒤에도 해당 위치의 정확한 index→keyword 관계를 구체적으로 보여주지 못한다. `TOOL_RESULT_CHANGED` 역시 일반 메시지로만 주어지고 실제 필수 tuple 목록을 수리 안내에 다시 싣지 않는다.

## 내부 호출 계약

`LLMProvider.repairChat(messages, invalidOutput, issues, contract?, context?)`에 선택적 내부 context를 추가하는 안이다.

```ts
interface TarotRepairContext {
  expectedCards: readonly {
    cardId: number;
    orientation: 'UPRIGHT' | 'REVERSED';
    positionIndex: number;
  }[];
}
```

`generatePersonaReply`가 validator에도 전달하는 같은 저장 카드에서 위3필드만 새 객체로 복사한다. 사용자 문장, invalidOutput의 카드·이름·키워드, positionKey, 추가 문자열은 context에 넣지 않는다. `DEFAULT`와 `generateStructured`에는 context를 전달하지 않는다. 기존4인자 provider double/caller는 그대로 동작한다. endpoint/action/공개 응답/DB/schema/validator는 바뀌지 않는다.

TypeScript 형식만 신뢰하지 않고 힌트를 만들 때 런타임도 확인한다.1–3개 배열, 정수 cardId0–21, orientation exact enum, 서로 다른 positionIndex0–2를 만족해야 한다. 부가 필드를 그대로 직렬화하지 않고3필드만 allowlist로 선택한다. context가 없거나 이 조건에 맞지 않으면 새 canonical 힌트를 만들지 않고 기존 고정 수리 안내로 처리한다. 잘못된 context로 새 카드·키워드를 추정하거나 예외적인 fallback 결과를 만들어 성공시키지 않는다. 최종 strict validator는 계속 원래 expectedCards로 검사한다.

## 서버가 만드는 자료와 만들지 않는 답

카드 id와 orientation으로 `domain/tarot.ts`의 canonical dataset을 조회해 다음 자료를 만든다.

```ts
{
  requiredToolReferences: /* stored tuple list, same original order */,
  activeKeywordOptions: [
    { positionIndex, items: [{ index: 0, keyword: canonicalArray[0] }, /* ... */] }
  ]
}
```

이것은 모든 선택방향 항목의 **표**이며 모델이 쓸 keyword/index/span의 정답을 고르지 않는다. 최대3카드×5항목으로 제한한다. 재추첨·점술 없는 후속 대화에서도 `toolReferences`는 저장 tuple 전체를 그대로 출력하고, 실제로 풀이하지 않은 카드의 evidence만 생략할 수 있음을 분리해서 안내한다.

키워드 오류에는 기존 bounded 진단 경로에 더해 해당 위치의 선택방향 표를 보여준다. `positionIndex`와 배열 index는 raw에서 읽어도 canonical expected 위치와 안전한 숫자 범위에 맞는 것만 진단에 사용한다. 원문 text/textEvidence/사용자 발화는 새 system 안내로 올리지 않는다. 모든 문자열 키워드는 canonical dataset에서만 가져온다. 실제 `textEvidence`를 선택·생성·치환하거나 본문을 서버에서 다시 쓰지 않는다.

표의 위치 범위를 좁힐 수 있는 경우에는 실제 오류가 있는 expected 위치만 표시한다. JSON 파싱/형태 오류로 위치를 확정할 수 없거나 참조 전체가 틀린 경우에는 최대3개의 원본 표/필수 tuple 전체를 준다. 기존16개 진단 상한과 row 검사 상한을 유지한다. 진단 생성 실패 자체가 추가 LLM 요청이나 validator 우회가 되면 안 된다.

v10의 수리 message 순서는 유지한다. 서버 고정 안내+검증한 canonical 표만 원래 leading system에 추가하고, 원래 message 전체→실패 assistant→원래 마지막 user payload를 그대로 유지한다. 마지막 user가 없으면 extra HTTP 없이 fail-closed다. 신뢰하지 않는 model/user 문자열은 기존 assistant/user 역할에만 남는다.

초기 Tarot provider projection에도 `activeMeaning`과 같은 순서의 명시적인 `{index, keyword}` 표를 추가할 수 있다. `persona/tool-facts.ts`의 기존 canonical 선택방향 조회를 재사용하며 원본 dataset·배열 순서·corpus input·expected·공개 API를 바꾸지 않는다. 이 표가 있어도 모델이 대표 항목과 본문을 직접 선택한다. DEFAULT Chat/Saju 자료에 Tarot 표를 추가하지 않는다.

## 범위와 변경 파일 후보

- `llm/provider.ts`: optional context 형식, 검증한 canonical 힌트 및 구체 경로의 수리 안내.
- `llm/reply.ts`: 같은 expectedCards의 최소 tuple 전달, `JumZipPersona-v11` 버전.
- `persona/tool-facts.ts` / 필요 시 `persona/prompt.ts`: 초기 명시적 index 표와 참조/evidence 역할 분리. model·Persona 성격은 변경하지 않는다.
- 관련 unit tests와 새로운 v11 준비 runner/docs만 추가한다. 기존 v10/v9 실행 source·manifest·corpus·review는 보존한다.

900출력, 초기60초/수리30초,128000bytes, 최대1수리, temperature, provider 모델 옵션, DEFAULT 수리 메시지 규칙은 유지한다. 아래의 별도 제안대로 명시적 내부 mapper를 지정한 Intent에만 allowlisted 구조 진단을 추가할 수 있다. Intent/Memory의 공개 schema는 바꾸지 않으며 mapper 없는 structured 요청은 기존 generic 안내를 유지한다.

## Intent-v6와 같은 provider batch에 통합하는 최소안

이 절은 Main의 추가 설계 요청에 따른 **제안**이다. 코드 GO가 아니다. Backend의 v5 실패 raw4개 offline 재현에서는 assistant 발화의 별칭을 선택한 `INTENT_ALIAS_SOURCE_INVALID`와 두 대안을 하나의 객체에 합친 `INTENT_CHOICES_INVALID`가 각각 초기·수리에서 반복됐다. 현재 `generateStructured`는 JSON 파싱과 `validate` 예외를 같은 catch에서 처리하여 모두 `STRUCTURED_VALIDATION_FAILED`만 넘긴다. source role 및 선택지 길이0또는2는 현재 JSON Schema만으로는 특정하지 못하는 runtime 제약이다.

### 선택적 내부 mapper

최초에는 실제 확인된 두 code만 연다. 임의 path/reason 문자열을 반환할 수 있는 범용 diagnostic 객체는 허용하지 않는다.

```ts
type StructuredDiagnosticCode =
  | 'INTENT_ALIAS_SOURCE_INVALID'
  | 'INTENT_CHOICES_INVALID';

interface StructuredRequest<T> {
  // 기존 messages/schema/validate/name 그대로
  diagnoseValidationError?:
    (error: unknown) => StructuredDiagnosticCode | null;
}
```

함수는 선택적이고 진단은 최대1개다. 현재 validator가 첫 실패에서 예외를 던지므로 배열·복수 선택 API는 필요 없다. `intent.ts`가 mapper를 제공하고 두 `Error.message`를 **완전 일치**로 검사해 해당 code만 반환한다. 그 외에는 null이다. raw Error.message, stack, value, quote, source payload는 반환하지 않는다. 이 변화는 기존 `validateIntent` 예외·판정·순서나 추천 routing을 바꾸지 않는다.

provider는 TypeScript 선언과 별개로 mapper 반환값이 runtime string이고 자체 allowlist에 있는지 재확인한다. null, 잘못된 문자열/객체, mapper throw는 모두 generic 안내로 처리한다. unknown code를 잘라내거나 escaping해 system에 넣지 않는다. mapper 없는 Memory/Summary/Title와 테스트 double은 이전 호출 계약 그대로 동작한다.

### provider가 소유하는 고정 registry

| code | 고정 path | 고정 reason |
| --- | --- | --- |
| `INTENT_ALIAS_SOURCE_INVALID` | `/targetAliasEvidence/source` | `ALIAS_SOURCE_MUST_BE_CURRENT_OR_RECENT_USER` |
| `INTENT_CHOICES_INVALID` | `/choicesEvidence` | `CHOICES_REQUIRE_ZERO_OR_TWO_SEPARATE_SOURCE_QUOTE_OBJECTS` |

첫 reason에 연결하는 서버 고정 설명은 현재 발화(source=-1) 또는 전달된 recentMessages에서 role이 user인 항목만 별칭 근거가 될 수 있다는 것이다. 먼저 role을 확인한 뒤 원문 인용을 찾으며, assistant에서만 별칭이 보이면 `UNRESOLVED`를 유지한다. 실제 이름·인용·해당 사용자 index는 서버가 정답으로 골라 넣지 않는다.

둘째 reason은 근거가 없으면[]이고, 실제 관련 대안 두 개가 있으면 각각 `{source,quote}`로 작성하며 source가 같아도 두 대안을 한 객체의 인용으로 합치지 않는다는 것이다. 이 code는 길이 문제뿐 아니라 object 형태 문제에도 쓰이므로 “현재 길이가1이다”처럼 진단되지 않은 사실을 단정하지 않고 **요구되는 형식**만 전달한다. 모델이 각 대안과 인용을 다시 선택한다.

고정 registry는 `provider.ts` 단일 owner가 관리한다. structured mapper는 code만 선택하며 path/reason/설명은 provider가 registry에서 만든다. 필드가 없거나 다른 오류이면 기존 `STRUCTURED_VALIDATION_FAILED`만 남는다. 새 code를 열 때마다 별도의 근거와 테스트를 요구하고 이번 batch에서 기타 모든 Intent 오류나 Memory 오류로 넓히지 않는다.

### 실제 전달 경로와 fallback

1. `intent.ts`가 기존 최소화 입력과 같은 schema/validator를 `generateStructured`에 넘기고 선택적 mapper만 추가한다.
2. 초기 model content의 `JSON.parse`와 `input.validate`를 catch 경계상 구분한다. 파싱 실패에는 mapper를 호출하지 않는다. JSON 파싱에 성공한 뒤 validation이 실패한 경우에만 mapper를 정확히1회 호출한다.
3. 최초 성공이면 진단 및 수리 호출0이다. 최초 검증 실패이면 기존 generic issue를 유지한 채 allowlisted 진단이 있을 때만 고정 `{code,path,reason}`와 서버 고정 설명을 추가한다.
4. 진단은 원래 leading system의 서버 수리 지침 안에 추가한다. message 전체·실패 assistant·원래 최종 user payload 순서와 byte-identical 조건은 v10 그대로다. 임의 원문은 새 system에 승격하지 않는다.
5. 수리 응답은 동일한 `input.validate`로 재검증한다. 실패해도 세 번째 요청이나 반복 mapper 호출 없이 기존 `LLM_INVALID_RESPONSE`다. 추천 추출은 기존대로 fail-soft null을 반환한다.
6. `DEFAULT` Chat/Saju의 `repairChat`은 이 structured hook을 받지 않는다. Tarot typed context와 structured 진단은 별도 인자/경로이며 조건을 섞지 않는다. Memory/Summary/Title의 mapper 없는 serialized repair는 v10과 동일해야 한다.

provider의 공통 `repairMessages`에 내부 진단 인자를 추가한다면 이미 allowlist로 변환된 code 한 개만 받도록 한다. 임의 diagnostic 문자열을 직접 받는 overload는 만들지 않는다. 기존 knownIssues의 allowlist 보호는 그대로 두고 generic structured 오류를 원시 validator 예외로 대체하지 않는다.

### Intent prompt에서 바뀌는 절차와 안 바뀌는 정책

Backend 소유 `intent.ts`의 다음 두 일반 절차만 명확히 한다. 버전은 `JumZipIntent-v6`로 구분한다.

- 별칭은 인용 단어를 먼저 찾지 말고 source의 role을 먼저 검사한다. currentMessage는 user, recent는 전달된 실제 배열의 role/index를 따른다. assistant-only 이름을 user 근거로 이동하지 않는다.
- 선택 대안 두 개가 있으면 각 대안을 별도 `{source,quote}`로 작성한다. 같은 source에 함께 있어도 두 대안을 합친 긴 인용 하나로 대체하지 않는다.

alias의 현재/관련 user 범위, 선택지의 실제 대안 의미·중복/겹침 금지, 명시 도구 우선순위, highStakes, currentMessage 분류 기준, router/API, schema, 원본28사례와 expected는 바꾸지 않는다. 두 실패의 이름이나 인용을 prompt에 외우게 하지 않는다.350출력,8초+3초,1회 수리도 그대로다.

### 소유권과 의존 순서

- Domain은 `provider.ts`의 유일한 편집 owner다. Tarot context·structured hook·registry·공통 수리 helper·provider tests를 한 batch로 검증한다.
- Backend는 `intent.ts`와 Intent 관련 tests/새 준비 runner owner다. Domain이 확정한 optional type을 import하고 mapper/두 절차만 연결한다. provider를 병행 편집하지 않는다.
- Main이 source GO를 주면 provider optional type을 먼저 안정화하고 Backend에 전달한다. 양쪽 runtime 동결 뒤 최종 source hash·사전 비용을 계산한다. 이는 아직 실행한 절차가 아닌 제안된 작업 순서다.

### 추가 회귀 목록

1. 실제 `extractToolRecommendation`을 통해 user-only alias 위반을 재현하고 수리 request의 system에 정확한 allowlisted code/path/reason이 있는지 확인한다. user/assistant 인용 canary는 새 안내 부분에 없어야 한다.
2. 같은 source에 있는 실제 두 대안을 한 object로 합친 초기 응답이 선택지 진단을 받고, 모델이 별도 두 object를 반환했을 때만 통과한다. 서버가 배열을 분할하거나 source/quote를 대신 채우지 않는다.
3. 같은 초기 오류를 수리에서도 반복하면 기존 validator가 거부하며 provider HTTP는 정확히2회다. 원본 잘못된 응답을 실패 근거로 보존한다.
4. parse 실패·unknown Error.message·유사 prefix/suffix·비Error throw·mapper null/throw/객체 반환은 generic 안내만 사용한다. raw text/stack/quote/code canary가 system에 유출되지 않는다.
5. 초기 성공이면 mapper0/수리0, 초기 validation 실패이면 mapper1, repair 실패 뒤 mapper 추가 호출0을 확인한다. callback이 원래 validator를 다시 호출하지 않는다.
6. Memory extraction/summary/title와 DEFAULT Chat/Saju의 원래 마지막 user, 선두 system 복제, 출력 schema,350/900 caller cap·timeout·stream byte cap은 기존 회귀와 함께 검사한다. mapper 없는 요청의 body를 v10 동결 기준과 비교한다.
7. Intent의 valid NONE와 두 번 검증 실패에 의한 null을 계속 구분한다. 진단 hint가 있다는 이유로 실패를 성공 분류로 바꾸지 않는다.
8. 선택지 길이0/2·alias source role을 강제하는 현재 runtime validator와 schema의 hash/행위가 변하지 않았음을 확인한다. 새 mapper는 판정 변경이 아니라 실패 안내만 바꾼다.

이 통합안은 추가 LLM round trip이나 출력 한도 확대를 요구하지 않는다. system 안내가 짧게 늘어난 실제 body로 새0-network 비용을 계산하고 Main의 잔액/GO 전에는 호출하지 않는다. Tarot의 알려진 반대 원인 문장이 구조 검사에 통과할 수 있다는 아래 한계는 그대로 남는다.

## 실제 의미 오류는 별개의 문제

`10:BOMI` raw의 은둔자 역방향 설명에는 “혼자만의 시간이 필요해서 회피”라는 잘못된 원인이 남아 있다. 다른 연인 인덱스를 고치면 그 문장도 구조 검사에 통과한다는 local 반례를 이미 확인했다. 따라서 위 제안은 **전달 성공률 가설**이지 의미 오류 해결 가설이 아니다.

v11은 특정 카드나 실패 문구를 금칙어로 외우게 하지 않고, 기존 상징/관찰 사실/실제 조언 구분과 선택방향 규칙을 유지한다. 별도의 의미 검증 구조 또는 반대 방향 대조를 추가하려면 schema·효과·비용을 따로 검토해야 한다. 지금 같은 batch에 추가 금칙 문구나 새 방향 의미 정책을 섞으면 원인 구분이 어려워지므로 제안하지 않는다. 후속 평가에서 잘못된 원인이 실제 전달되면 기존과 동일하게 의미 Hard Fail로 센다.

## 의미 있는 로컬 검증

1. 전체22×정/역×세 위치의 index→keyword 표가 canonical 원본 배열과 순서·문자 그대로 일치한다. 원본 배열/객체 불변과0-based index를 확인한다.
2. 임의 저장 draw의 카드/방향/순서와 필수 tuple이 일치한다. 재추첨/일반 후속 대화에서 모델이 `toolReferences:[]`를 내면 정확히1회 수리 후에도 strict validator 실패가 유지된다. 서버가 빈 배열을 보충하지 않는다.
3. 서로 다른 카드·index의 일치/불일치를 parameterized 검사한다. 특정 벤치의 `연결`이나 `인내` 정답만 hardcode하지 않는다. 여러 단어 전체 item과 원문 index 경계도 포함한다.
4. context의 추가 canary 필드, raw 본문의 system 지시, 조작된 이름/positionKey가 system 힌트에 들어가지 않는다. canonical 값만 들어가고 원래 마지막 user는 byte-identical이다. invalid/absent context는 새 힌트를 만들지 않는다.
5. 수리된 모델 출력이 유효하면 그대로 전달되지만, 오류가 남으면 실패한다. 테스트 transport는 모델이 authored한 수정 JSON을 명시적으로 반환하며 서버 자동 수정으로 성공하지 않는다.
6. 한 카드만 풀이하는 후속 질문은 그 카드 evidence만 허용하고, 아무 카드도 해석하지 않는 대화는 evidence[]를 허용하되 전체 참조를 요구한다. 실제로 풀이한 카드의 evidence 누락 한계는 별도로 기록한다.
7. DEFAULT Chat/Saju와 mapper 없는 Memory/Title-style structured 요청의 serialized repair는 기존 v10과 같다. Intent의 승인된 두 진단만 위 절의 별도 regression으로 대조하며 timeout/body cap/no-final-user/one-repair 회귀를 유지한다.
8. 잘못된 원인이 올바른 index/span과 함께 있으면 구조 validator가 통과하는 반례를 유지한다. 테스트가 의미 검출 성공을 주장하거나 rubric을 완화하지 않는다.

## 실행 준비와 비용 방침

먼저 위 unit/TS/lint 및 실제 provider body의0-network preflight를 완료한다. 원본84 입력·순서·reviewChecks를 다시 고정하고 v11 source와 전달 계약을 별도 디렉터리에 기록한다. v10 full84는2945.90neurons였지만 추가 index 표와 수리 횟수 때문에 다음 비용이 같다고 가정하지 않는다. 각 요청 전에 byte-as-token+900 예약을 계속 적용한다.

현재 Main이 알려준 계정 사용량/잔여는 실행 허가가 아니다. 다음에는 근거 없이 micro→full을 반복하지 않고 Main의 최신 사용량 확인·예산·실행 GO가 정한 범위만 실행한다. 실제 호출은 아직0이며, 이 문서에는 다음84의 완료나 품질 통과를 예약하지 않는다.
