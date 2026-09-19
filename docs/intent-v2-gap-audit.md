# Intent-v2 슬롯 근거 감사

2026-09-20 KST · 읽기 전용 감사 후 Main 승인 Intent-v3 구현 · 모델 호출 0 · hosted mutation 0.

현재 Intent-v2는 v5 focused의 **분류 목적·추천 도구·모드 8/8**을 재현한다. 알려진 `choicesPresent=true` 한 건은 스키마나 토큰 문제가 아니라 **선택지 근거를 모델의 boolean 판단에만 맡긴 문제**다. 해당 실제 응답은 관계 행렬로 이어져 추천 자체가 바뀌지 않았다. 같은 잘못된 boolean이 선택 행렬로 들어가면 필요한 선택지 질문을 생략한다. 원본 결과와 기대값을 고치지 않고 이 차이를 유지한다.

## 근거와 범위

- [Engineering §11/11.1](https://app.notion.com/p/3df7cdef782d81d7b3a6d28b604f050f): 이번 감사에서 Notion fetch 1회로 원문을 읽었다. 페이지 `page_last_edited_at=2026-09-19T15:44:57.528Z`, native verification은 `unverified`이며 이를 인증된 문서 상태라고 바꾸어 말하지 않는다. 반환 본문에 §11/11.1 전체가 있다. 소스 조회와 로컬 검증 외 모델/서비스 실행은 하지 않았다.
- [실제 결과](../tests/persona/benchmark-runs/v5-focused/results.json), [원본 provider 응답](../tests/persona/benchmark-runs/v5-focused/provider-attempts.jsonl), [manifest](../tests/persona/benchmark-runs/v5-focused/manifest.json), [동결 corpus](../tests/persona/v5-focused-corpus.mts).
- [당시 검토](persona-benchmark-v5-focused-review.md), 원본 primary/independent AI review는 그대로 보존한다. 실제 모델은 **Gemma 4**, `JumZipIntent-v2`다. 운영 Qwen/Intent-v1의 성공 증거로 대체할 수 없다.
- 감사 시점의 변경 전 `intent.ts`, `router.ts`, corpus canonical-LF SHA256은 당시 manifest와 모두 같았다. 각각 `f6216bf177a9dec03ad238005929a378a9e8b4b647b28c7c8ef8d5c1bcf1bd47`, `744e1b07a32183d9839f203ece853b4a19b3a847e956032d5f5b38ccf0a2f845`, `2e8e292d66b1027aae70a08925d2b9b9e2b4a5f3dfb5b4a1794fa90b9dbd397b`다. 아래 구현 후 intent.ts는 Intent-v3이며 router/corpus/원본 결과는 변경하지 않았다.

## 원문 계약과 현재 매핑

§11은 JSON Schema 우선, backend runtime validation, 낮은 structured temperature, 검증 실패 시 통제된 1회 수리, Persona 설정과 분리를 요구한다. 현재 structured provider의 temperature 0.1/한 번 수리, runtime Intent의 350토큰 및 8초+3초 별도 설정은 이 요구와 맞는다. 의미가 틀린 boolean이 타입 검증을 통과하면 수리는 시작되지 않는다.

| 원문 §11.1 의도 | 기본 도구 | 필요한 슬롯 | 현재 router |
|---|---|---|---|
| 상대 마음/현재 분위기 | Tarot RELATIONSHIP_3 | 상대 별칭, 최근 상황 | target_feelings → targetPerson/recentSituation |
| 단기 관계 흐름 | Tarot RELATIONSHIP_3 | 상대, 기간 | relationship_flow → targetPerson/period |
| 장기 궁합 | Saju Compatibility | 양쪽 Birth Data | 부족한 상대 Birth Data에 Tarot Compatibility 대안 |
| 오늘 운세 | Tarot ONE_CARD | 없음 | 내부 ONE_CARD+DAILY, 외부 추천 mode=DAILY |
| 올해/월별 | Saju Sewoon/Monthly | 본인 Birth Data | yearly_flow/monthly_flow |
| 타고난 성향 | Saju Natal | 본인 Birth Data | natal_character |
| 진로/선택/A vs B | Tarot DECISION_3 | 선택지, 현재 상황 | career_decision → choices/recentSituation |
| 막연한 고민 | 대화 우선 | 고민 핵심 | general_concern → NONE |
| 잡담 | 도구 없음 | 없음 | small_talk → NONE |

원문 우선순위의 “사용자가 Tool을 명시하면 그 선택을 우선한다”, “정보가 부족하면 … 필요한 것만 짧게 질문한다”를 함께 지켜야 한다. 선택지 슬롯 오류가 있어도 사용자의 긍정적인 타로 선택 자체를 취소하거나 자동 실행하면 안 된다.

원문은 선택 행에서 **“선택지와 현재 상황”**이라고 한다. **“서로 다른 선택지 2개 이상이 실제 존재”**는 이미 동결된 [내부 prompt](../supabase/functions/_shared/llm/intent.ts#L109)와 [router](../supabase/functions/_shared/domain/router.ts#L35)의 구체화다. 따라서 이번 false 기대는 새로 만든 점술 규칙이 아니지만, 원문이 모든 암시적인 양자택일을 금지한다고 인용해서도 안 된다.

## 실제 8건을 읽은 결과

8개 ID 모두 HTTP200, `finish_reason=stop`, schema validation 성공, 수리 0회였다. 출력 길이는 72~118토큰으로 350 한도 이내다. 파싱 실패의 fail-soft null을 정상 NONE으로 세지 않았다.

| ID 접미사 | 실제 목적/intent | 실제 추천 | 슬롯 관찰 |
|---|---|---|---|
| pure-recall-no-profile | RECALL/small_talk | NONE | 모두 false |
| pure-recall-has-profile | RECALL/small_talk | NONE | 프로필 boolean으로 회상을 사주로 바꾸지 않음 |
| memory-control | MEMORY_CONTROL/small_talk | NONE | 이전 assistant 사주 제안을 현재 선택으로 승격하지 않음 |
| current-preference | PREFERENCE_SHARING/small_talk | NONE | 모두 false |
| innate-character | FORTUNE_EXPLORATION/natal_character | SAJU/NATAL | ownBirthData 부족 유지 |
| recall-explicit-tarot | FORTUNE_EXPLORATION/relationship_flow | TAROT/RELATIONSHIP_3 | choicesPresent=true 과대추출, targetPerson 부족 유지 |
| target-remembers | FORTUNE_EXPLORATION/target_feelings | TAROT/RELATIONSHIP_3 | targetPersonPresent=true의 별칭 근거는 아래 별도 지적 |
| forget-and-tarot | FORTUNE_EXPLORATION/daily_fortune | TAROT/DAILY | 기억 거부와 명시적 타로 요청 공존 |

`matchedExpected`는 [runner 148행](../tests/persona/v5-focused-runner.mts#L148)의 도구·허용 모드 일치 검사다. 모든 슬롯 정확성을 검사하지 않는다. corpus는 모임 질문에 GENERAL_3/RELATIONSHIP_3/DECISION_3를 허용한다. 이번 RELATIONSHIP_3 결과를 다른 모드로 바꾸거나 corpus 허용 폭을 좁혀야 할 원문 근거는 없다. 오늘 운세의 DAILY 기대 역시 내부 ONE_CARD와 충돌하지 않는다.

## choices 슬롯의 정확한 실패 지점

실제 합성 입력은 “내 취미 기억해? 이번 주 모임에서 먼저 인사할지 타로로도 보고 싶어.”이고 recentMessages는 비어 있다. 모델은 현재 상담 목적과 명시 타로 인용은 맞혔으나, 존재하지 않는 두 번째 선택지를 암묵적으로 보충한 것으로 보이는 `choicesPresent=true`를 출력했다. 이것은 관찰된 출력에 대한 설명이며 모델 내부 추론을 직접 관찰했다는 주장은 아니다.

1. [schema/validator](../supabase/functions/_shared/llm/intent.ts#L60)는 슬롯을 boolean 타입으로만 검사한다. intentEvidenceQuote와 explicitToolQuote의 연속 부분문자열 검증은 슬롯별 증거가 아니다.
2. [snapshot 생성](../supabase/functions/_shared/llm/intent.ts#L125)은 true를 무조건 `['PRESENT_A','PRESENT_B']`로 승격한다. 원문 선택지 두 개가 실제로 있었는지 정보가 사라진다.
3. 이번 relationship_flow는 choices를 사용하지 않아 실제 추천은 정상이다. 같은 true가 career_decision에서 사용되면 router는 선택지 둘이 채워졌다고 보고 `missingSlots`의 choices를 생략한다.
4. 기존 [intent test](../tests/persona/intent.test.ts)는 원문에 두 선택지가 없는 일반 관계 질문에도 공급된 choicesPresent=true를 신뢰하는 stub을 사용한다. 이는 전달/행렬 테스트이지 슬롯 의미 검증이 아니다. 테스트 통과는 모델 판단의 정확성을 보장하지 않는다.

네트워크를 던지는 함수로 교체한 일회성 Node stdin probe로 저장된 실제 구조화 출력을 재생했다. true와 false 모두 현재 validator를 통과했고 실제 관계 추천은 바이트상 같았다. 별도 **반사실 로컬 검사**에서 career_decision의 true는 missingInformation=[], false는 ['choices']였다. 이 반사실을 새 실제 모델 실패로 집계하지 않는다.

## 별칭 슬롯에서 추가로 확인한 의미 차이

`v5-intent-target-remembers`의 입력은 “그 사람이 나를 기억하는지 타로로 보고 싶어.”이며 최근 대화가 없다. 실제 targetPersonPresent=true 때문에 missingSlots는 recentSituation만 포함한다. 그러나 원문 상대 마음 행과 현재 prompt는 **상대 별칭**을 요구한다. 대상이 언급되었다는 사실과 사용자에게 사용할 별칭/맥락상 해결된 지시 대상이 확보됐다는 사실은 다르다.

기존 두 리뷰는 대상 언급의 존재를 기준으로 이 항목의 슬롯을 맞다고 보았다. **본 감사는 원문의 별칭 확보 기준으로 이 필드를 미충족으로 정정 판단한다.** 전체 슬롯 7/8이라는 당시 집계를 원문 모든 필드의 완전 일치로 확대하지 않는다. 도구·모드 8/8 판정은 그대로 유지하고 원본 리뷰를 덮어쓰지 않는다. 임의 이름을 만들거나 사용자에게 실명을 요구하는 수정도 필요하지 않다. 별칭이 없다면 그 슬롯이 아직 부족하다고 표시하면 된다.

## 채택된 최소 일반화 수정안

최소 구현안은 **Intent-v3 내부의 두 boolean을 증거 구조로 교체**하는 것이다. 외부 `Recommendation`/행렬/DB 계약은 유지한다. 예전 boolean을 모델 출력에 중복으로 남겨 증거와 충돌하게 하지 않는다. 검증된 구조에서 `choicesPresent`와 `targetPersonPresent`에 해당하는 router 값을 서버가 계산한다.

```ts
type Evidence = { source: number; quote: string };
// source=-1: 최소화된 currentMessage, 0..7: 실제 전달된 recentMessages의 index.
type TargetAliasEvidence =
  | { state: 'ALIAS'; source: number; quote: string }
  | { state: 'UNRESOLVED'; source: null; quote: null };
// choicesEvidence: [] 또는 정확히 두 Evidence. 그 밖의 길이는 validation 실패.
```

- 내부 필드 10개는 requestPurpose, intentEvidenceQuote, intent, explicitTool, explicitToolQuote, targetAliasEvidence, recentSituationPresent, periodPresent, choicesEvidence, highStakes다. existing targetPersonPresent/choicesPresent 두 필드를 대체하므로 총 필드 수는 늘리지 않는다. `additionalProperties:false`와 required exact keys를 유지한다.
- `choicesEvidence=[]`이면 서버 판단 false, 정확히 두 유효 항목이면 true다. 존재하는 message index, 정확한 연속 부분문자열, 비어 있지 않음, 중복 근거/같은 선택 구절 아님을 서버가 검사한다. recent의 허용 근거는 기존의 선택지·대명사 맥락 범위를 유지한다. index는 최소화·필터 후 모델에게 실제 보낸 배열의 index다.
- 두 항목은 실제로 제시된 서로 다른 대안이어야 한다고 prompt에 정의한다. 한 가지 행동을 할지 묻는 질문에서 반대 행동을 지어내지 않는다. 이번 문장/취미/모임 등의 키워드에 묶인 예외나 문자열 blacklist는 만들지 않는다.
- `targetAliasEvidence.state='UNRESOLVED'`이면 source/quote는 null이고 router의 targetPerson을 생략한다. ALIAS는 현재 원문 또는 관련 최근 맥락에서 실제로 확보한 별칭의 연속 근거가 필요하다. 지시 대상이 있다는 사실만으로 ALIAS로 바꾸지 않는다. 대명사 단어 목록으로 금지하거나 실명·새 별칭을 생성하지 않는다. 명시 별칭을 앞선 사용자 발화에서 받고 현재 대명사로 가리키는 정상 문맥은 source index로 보존한다.
- 검사 실패는 기존 provider의 한 번 수리로 처리하고 이후 실패는 기존 fail-soft null이다. true를 근거 없이 false로 조용히 보정하거나, 빈 추천을 정상 NONE으로 기록하지 않는다. 긍정적 explicitTool 우선순위와 고위험 차단은 바꾸지 않는다.
- 정확한 인용 두 개가 있어도 서로 대안이라는 **의미**까지 증명되지는 않는다. 예를 들어 무관한 시기·장소 구절을 둘째 선택지로 붙이면 source-validity는 통과할 수 있다. 서로 다른 인용, 부분 겹침 금지, 실제 대안 여부는 별도 검증 층이며 부분문자열 검사만으로 의미 오류 0을 주장하지 않는다.
- ALIAS도 의미 판정은 남는다. 모델이 실제 대명사 구절을 ALIAS라고 잘못 붙이면 source-validity만으로 막을 수 없다. 이 한계를 숨기거나 단어 blacklist로 평가 문장만 통과시키지 않는다. 미해결 상태가 명시된 경우 targetPerson 부족을 확실히 보존하고, ALIAS 정확성은 독립된 의미 검토를 받는다.

제안 인용 상한은 intentEvidenceQuote 96자(기존 200), explicitToolQuote 64자(기존 200), choice quote 각 48자, alias quote 24자다. 완전한 발화가 아니라 목적/요청/대안을 가리키는 최소 연속 구절을 요구한다. 길이가 넘으면 인용을 임의 절단해 통과시키지 않고 검증 실패로 처리한다. provider는 **350 output tokens, initial 8초+repair 3초**를 유지한다.

외부 호출 없이 실제 8개 구조화 결과를 메모리에서 draft 구조로 투영한 compact JSON의 UTF-8 크기는 다음과 같다. 원본 파일이나 기대값은 변경하지 않았다. 이는 모델이 새 구조를 맞게 생성했다는 증거가 아니다.

| 실제 ID 접미사 | 기존 bytes | draft bytes |
|---|---:|---:|
| pure-recall-no-profile | 330 | 372 |
| pure-recall-has-profile | 330 | 372 |
| memory-control | 313 | 355 |
| current-preference | 319 | 361 |
| innate-character | 320 | 362 |
| recall-explicit-tarot | 358 | 401 |
| target-remembers | 345 | 388 |
| forget-and-tarot | 340 | 382 |

별칭과 선택지 둘이 모두 있는 별도 합성 draft는 495 bytes다. 모든 quote를 위 상한의 한글로 채운 stress draft는 1,201 bytes다. UTF-8 bytes는 모델 token 수가 아니며 350토큰 안에 언제나 들어간다는 보장이 아니다. 실제 8개의 기존 출력 72~118토큰과 인용 상한은 설계 참고치다. 구현 후 provider의 정확한 schema 포함 요청을 0-network preflight로 직렬화해 요청 크기도 확정하고, 긴 근거에서 잘린 JSON 거부/한 번 수리 한도를 유지해야 한다. 토큰 한도 증액으로 해결하는 안은 제안하지 않는다.

수정 파일은 `supabase/functions/_shared/llm/intent.ts`, `tests/persona/intent-v2.test.ts`, `tests/persona/intent.test.ts`, 새 `tests/persona/intent-slot-evidence.test.ts`와 `tests/persona/intent-v3-preflight.test.ts`다. 이 배치의 Intent 작업은 provider.ts, domain/router, 공개 추천 schema, v5 frozen corpus/results/reviews를 수정하지 않았다. 내부 schema 이름은 `jumzip_intent_v3`, 버전은 `JumZipIntent-v3`다.

## 외부 모델 0회로 검증할 수 있는 것

이번에 기존 intent-v1/v2 명명 테스트 및 router 세 파일 **63/63 PASS**를 확인했다. 이는 현재 동작의 회귀 검사다. 새 evidence 구조 구현 후에는 다음을 공급된 structured output과 mock fetch로 검사할 수 있다.

- false+[] / true+실제 대안 두 개; CURRENT와 유효한 RECENT 분산 근거; 출생 정보 최소화 이후 남은 문자열만 검사.
- 한 개뿐인 대안, 지어낸 반대 행동, 같은 인용 중복, 잘못된 index/source, 최소화되어 제거된 생년·도시 인용, extra field/타입 오류를 거부.
- 거부→수리 한 번 성공 및 두 번 거부→null; malformed 응답을 정상 NONE으로 집계하지 않음.
- 실제 모임 실패 원문을 그대로 둔 false/[] 출력은 유효하고, 원래 RELATIONSHIP_3와 explicitTool은 유지됨. career_decision에서 근거 없음은 choices 부족으로 이어짐.
- 별칭 없이 UNRESOLVED는 targetPerson 부족 유지; 실제 CURRENT 별칭과 관련 RECENT 별칭은 통과; 존재하지 않는 별칭/source, ALIAS+null, UNRESOLVED+quote 같은 모순은 거부. 새 단어 목록으로 예문만 구분하지 않음.
- 순수 회상/기억 관리/취향 공유/긍정 타로 복합 요청, high-stakes, 공개 추천 JSON 형태가 유지됨.

무관하지만 실제 존재하는 구절 두 개를 넣은 경우는 source-validity 검사가 보장할 수 없는 대조로 명시한다. 새로운 prompt가 실제 모델의 선택지 의미 추출을 고쳤는지는 소스 동결 후 별도 승인된 작은 실제 검증이 필요하다. focused 8건은 yearly/monthly, 장기 궁합과 일부 추가 슬롯을 포함한 전체 M11 행렬의 실제 품질 검증을 대신하지 않는다.

## 구현 후 검증과 다음 실제 평가 준비

Intent 관련 다섯 테스트 파일 **104/104 PASS**, 전체 TypeScript 검사, scoped ESLint, production Vite build가 통과했다. 40개 새 슬롯 회귀는 원본 8개 입력을 그대로 읽은 v3 mock, 두 근거의 실제 존재/중복/겹침, 별칭의 사용자 발화 제한, 필터 후 index, 인용 상한, 한 번 수리, 의미 검증의 한계를 포함한다. 잘못된 model boolean을 사후에 성공으로 고쳐 쓰는 경로는 없다.

[0-network preflight test](../tests/persona/intent-v3-preflight.test.ts)는 원본 8개와 아래 부족 행렬 10개를 합친 **18개**를 준비한다. 전역 fetch는 호출하면 실패하고 실제 provider의 fetchImpl만 합성 응답을 반환한다. 정상 NONE도 structured validation 성공 여부를 따로 확인한다. 이 방식으로 실제 provider가 만드는 schema 포함 JSON object 요청을 직렬화했다. Domain의 Gemma exact Cloudflare account API 옵션 구현 후 합성 account 경로에서도 `chat_template_kwargs.enable_thinking=false`가 포함되는지 확인했으며, 최종 요청 UTF-8 크기는 **6,592~6,716 bytes**, mock 출력 **321~469 bytes**다. 모두 max_tokens=350, temperature=0.1, initial8초/repair3초이고 실제 호출 0이다. 바이트는 비용/토큰 상한을 증명하지 않는다.

| 새 case ID | 합성 의도 범위 | 기대 도구/슬롯 |
|---|---|---|
| v3-yearly-missing-birth | 올해 전체 흐름 | SAJU/SEWOON + ownBirthData |
| v3-monthly-existing-birth | 다음 달, 본인 자료 있음 | SAJU/MONTHLY + 추가 슬롯 없음 |
| v3-long-compatibility-missing-partner | 장기 궁합, 본인만 자료 있음, 별칭/상황 있음 | SAJU 궁합 + partnerBirthData, Tarot 궁합 대안 |
| v3-long-compatibility-complete-birth | 양쪽 자료 있는 장기 궁합 | SAJU 궁합만 |
| v3-decision-missing-context | 명시적 타로 진로 질문, 대안/현재 상황 없음 | TAROT/DECISION_3 + choices/recentSituation |
| v3-decision-two-real-choices | 현 직장 유지/대학원 진학, 계약 갱신 상황 | TAROT/DECISION_3 + 추가 슬롯 없음 |
| v3-relationship-resolved-alias-period | 별칭과 다음 달 기간 있음 | TAROT/RELATIONSHIP_3 + 추가 슬롯 없음 |
| v3-explicit-saju-daily | 오늘 운세를 명시적으로 사주 요청 | SAJU/DAILY + ownBirthData |
| v3-general-concern | 그냥 고민 이야기 요청 | 정상 NONE |
| v3-small-talk | 가벼운 수다 | 정상 NONE |

새 mock은 모델의 실제 분류 정답을 대신하지 않는다. 실제 검증에서는 도구·모드/normal NONE 여부와 모든 근거 source/의미를 따로 검토해야 한다. original v5 corpus와 실제 응답을 바꾸지 않은 채 별도 버전의 실행 결과를 기록한다. 운영 배포와 실제 모델 검증은 이 작업에서 수행하지 않았다.

## Intent-v3 실제 평가 runner 동결

공유 corpus `JumZipIntentV3Eval-v1`은 원본 v5 8개 input/tool/mode 기대값을 그대로 import하고 추가 행렬 10개를 합친다. 슬롯 기대값과 의미 검토 기준은 별도 selection에 고정한다. 테스트용 mock 분류는 실제 결과와 구분하며 기존 v5 원문·review·fixture는 수정하지 않았다.

최종 준비 산출물은 `tests/persona/benchmark-runs/intent-v3/initial18-final600/`이다. **18개 직렬화, 실제 모델 0회, sourceFrozen=true**이며 중복 산출물 거부 및 live GO 미설정 거부를 별도 확인했다. 이전 `initial18`은 400 한도였던 준비 이력으로 보존하고 최종 실행 근거로 사용하지 않는다.

- corpus LF SHA-256: `fcd25a88d54191dc68e28059a01a8a96d7eadc339a98d0408d107a788b93f68a`
- runner LF SHA-256: `ac0d2276eea20e1a34b02a255dba7ad47c88d63dcdfdf835fb9220b59964da0f`
- selection SHA-256: `cdc4e6e3b04c4a09a4783bb1b34628951c50e52a6fa1f0bba91ddcaaebd7874a`
- 준비 한도 **600 neurons / 최대36 HTTP(initial18 + 각각 repair1)**. 자동 증액 없음. 실제 잔액 확인과 Main의 별도 GO, `--live` 및 `JUMZIP_INTENT_V3_LIVE_GO=1`이 모두 필요하다.
- 과거 8개 intent의 token/byte 비율로 초기18개 평균 추정 **283.32 neurons**, 과거 최대 입력 비율과 매회350출력 가정 **410.92 neurons**. 실제 비용이나 완료 보장은 아니다.
- 매 호출은 전체 직렬화 UTF-8 bytes를 입력 token 수로 간주하고350출력까지 먼저 예약한다. 초기18개 예약 합계1,256.26, 단일 최대70.60이다. 이는 전체 선예약이 아니라 각 호출 직전600 누적 한도를 검사하며, 응답 사용량이 있으면 실제 reported token 비용으로 교체한다. usage 없으면 예약을 유지한다. repair도 별도로 예약하고 한도·429·전송 오류에서 멈춘다.
- exact Cloudflare account API + Gemma4 모델만 허용한다. production provider가 보낸 thinking=false/max350/schema를 wrapper에서 assert하며 본문을 수정하지 않는다. 8초/3초 제한은 그대로다.
- initial/repair 원문 합성 응답과 usage를 보존한다. 인증 헤더/credential은 저장하지 않고 error HTTP 본문을 생략한다. 정상 VALID_NONE, VALID_RECOMMENDATION, FAILED_NULL을 별도 기록하며 구조 검사가 의미 품질 PASS로 승격되지 않는다.

마지막 검증은 관련5파일104 tests, 전체 TypeScript, corpus/preflight/runner의 명시적 MTS 포함 scoped ESLint(errors0/warnings0), 0-network preflight 및 두 실행 guard다. 실제 모델 검증/운영 배포는 미실행이다.
