# Intent-v3 실제 18건 독립 AI 리뷰

2026-09-20 KST. `initial18-final600`의 합성 입력 18개, 실제 provider 원문 18개, 검증 후 추천을 모두 대조했다. 리뷰 중 모델 호출과 운영 코드 변경은 0회다. 실행 담당 및 Main 리뷰와 별도로 판정했지만, 이 AI 리뷰어는 Intent-v3 구현과 corpus 작성에 참여했다. 독립된 사람의 검토로 표현하지 않는다.

**도구·모드 17/18, 자동 구조 기대 16/18이다. 의미 리뷰는 정상 15건, 추천에 영향 없는 불일치 2건, 잘못된 도구 추천 1건이다.** 기존 v5 원본 8건은 모두 통과했다. 새로운 단기 관계 사례가 실패했으므로 Intent 전체 완료로 판정하지 않는다.

근거는 [원본 결과](../tests/persona/benchmark-runs/intent-v3/initial18-final600/results.json), [실제 provider 응답](../tests/persona/benchmark-runs/intent-v3/initial18-final600/provider-attempts.jsonl), [manifest](../tests/persona/benchmark-runs/intent-v3/initial18-final600/manifest.json), [별도 독립 리뷰 JSON](../tests/persona/benchmark-runs/intent-v3/initial18-final600/independent-ai-review.json)이다. 원본 입력·기대값·결과·manifest를 고치지 않았다. [기존 Engineering §11/11.1 원문 감사](intent-v2-gap-audit.md)의 도구 행렬과 [현재 router](../supabase/functions/_shared/domain/router.ts)를 적용했다. 이번 리뷰에서 Notion을 새로 조회하지 않았다.

실행 모델은 `@cf/google/gemma-4-26b-a4b-it`, 의도 버전은 `JumZipIntent-v3`다. 18건 모두 HTTP 200, `finish_reason=stop`, 최초 검증 성공이며 repair는 0회다. 정상 `VALID_NONE` 6건과 추천 12건이며, `FAILED_NULL`은 없다. 출력은 81–125토큰으로 350 한도 이내다. sourceFrozen/completed는 true, stopReason은 null, 미실행 ID는 없고, 리뷰 시점에도 33개 소스 해시가 일치한다.

러너의 보고된 토큰 기반 비용은 **283.45738 neurons**이고 실제 응답의 `usage.neurons` 합은 **283.45453453063965**다. 반올림된 공시 단가로 재계산한 값과 provider 값을 구분한다. 모든 요청에 실제 토큰 usage가 있어 예약 추정치를 유지한 건은 없다. 600 예약 상한은 지켰지만, 이 리뷰가 계정의 남은 무료 할당량을 확인한 것은 아니다.

## 사례별 판정

| 사례 ID 접미사 | 실제 결과와 근거 | 판정 |
|---|---|---|
| pure-recall-no-profile | 취미 회상 → RECALL, 검증 성공 NONE | 정상 |
| pure-recall-has-profile | 같은 회상에 출생자료 있음 boolean만 바꿔도 NONE | 정상 |
| memory-control | 기억 거부 → NONE. 이전 assistant의 사주 제안을 현재 선택으로 승격하지 않음 | 정상 |
| current-preference | 현재 취향 공유 → NONE. `요즘`/취미 설명에서 시간·상황을 읽었으며 점술 추천으로 연결하지 않음 | 정상 |
| innate-character | 타고난 기질을 알아보려는 요청 → SAJU/NATAL, ownBirthData 부족 | 정상 |
| recall-explicit-tarot | 긍정 타로 요청 유지 → RELATIONSHIP_3, targetPerson 부족. `먼저 인사할지`에 반대 대안을 상상하지 않고 choicesEvidence=[] | 정상 |
| target-remembers | 상대의 기억 질문 → RELATIONSHIP_3. `그 사람`은 별칭이 아니므로 targetPerson/recentSituation 부족 | 정상 |
| forget-and-tarot | 기억 거부와 오늘 타로 요청을 구분 → TAROT/DAILY | 정상 |
| yearly-missing-birth | 올해 전체 흐름 → SAJU/SEWOON, ownBirthData 부족 | 정상 |
| monthly-existing-birth | 일반 다음 달 흐름 → SAJU/MONTHLY, 출생자료 있음 | 정상 |
| long-compatibility-missing-partner | SAJU 궁합+partnerBirthData, Tarot 궁합 대안. 사용자 별칭 `달새`와 3년간 만난 상황이 실제 존재 | 정상 |
| long-compatibility-complete-birth | 양쪽 자료 있음 → SAJU 궁합만. `우리`를 별칭으로 확정하지 않음 | 정상 |
| decision-missing-context | 진로 타로 요청만 있으므로 DECISION_3, choices/recentSituation 부족 | 정상 |
| decision-two-real-choices | `직장을 유지할지`/`대학원에 진학할지`가 현재 원문의 별도 비중첩 대안. 계약 갱신 상황도 있어 추가 슬롯 없음 | 정상 |
| relationship-resolved-alias-period | 특정 관계 질문을 monthly_flow로 바꿔 SAJU/MONTHLY+ownBirthData 추천 | **도구 추천 실패** |
| explicit-saju-daily | 명시 SAJU/DAILY+ownBirthData는 맞지만 구체 상황 없이 recentSituationPresent=true | 낮은 영향의 슬롯 불일치 |
| general-concern | NONE은 맞지만 마음이 복잡하다는 고민을 general_concern 대신 small_talk로 분류 | 낮은 영향의 의도 불일치 |
| small-talk | 가벼운 수다 → GENERAL_CHAT/small_talk, 정상 NONE | 정상 |

## 확인된 차이

`v3-relationship-resolved-alias-period`의 원문은 “달새와 다음 달 관계가 어떻게 흘러갈지 궁금해.”다. 사용자 source=-1의 `달새` 인용과 기간 존재는 올바르다. 그러나 **단기 관계라는 주제보다 `다음 달`이라는 기간 수식어가 우선돼** monthly_flow로 분류됐다. 원문 행렬의 단기 관계는 TAROT/RELATIONSHIP_3이고 대상·기간이 모두 있으므로 부족 슬롯이 없다. 실제 SAJU/MONTHLY 추천은 도구를 바꾸고 불필요한 ownBirthData 요청을 더했다. 이는 잘못된 기대값이나 JSON 오류가 아니라 schema를 통과한 의미 분류 오류다. 자동 repair가 실행되지 않은 이유도 여기에 있다.

`v3-explicit-saju-daily`에는 날짜와 요청만 있고 현재의 사건·상황 설명은 없다. recentSituationPresent=true는 과대 추출이다. DAILY 경로가 이 필드를 사용하지 않으므로 지금 추천은 맞지만 모든 슬롯이 정확했다고 집계하지 않는다.

`v3-general-concern`의 “요즘 마음이 복잡해서 그냥 이야기하고 싶어.”는 고민 대화를 요청한다. 정상 NONE은 유지됐지만 동결된 general_concern 기대와 small_talk 출력은 다르다. 공개 추천이 같다는 이유로 원래 기대나 출력 기록을 바꾸지 않는다.

별칭·선택 근거는 모든 사례에서 실제 사용자 원문과 일치했고 의미도 적합했다. 특히 앞선 v2의 모임 사례에서 없던 두 번째 선택지를 만들던 문제와, `그 사람`을 확보된 별칭으로 보던 문제는 이번 동일 원문에서 관찰되지 않았다. ALIAS의 양성 사례는 현재 발화의 `달새` 두 건이며, 실제 두 대안의 양성 사례는 직장/대학원 한 건이다. 이 작은 표본을 일반 신뢰도 증명으로 확대하지 않는다.

## 적용 범위와 남은 검증

- 18회 단일 관측이며 반복 실행 신뢰도나 전체 Persona 품질 검증이 아니다. 운영 Qwen/Intent-v1, hosted Edge/DB 저장, 실제 기억 삭제, 공개 인증을 이 결과로 통과 처리하지 않는다.
- 최초 응답이 모두 유효했으므로 실제 repair 회복, 잘린 JSON, timeout, quota 거부는 이번 실행에서 관찰하지 못했다. 0회 repair를 해당 기능의 실제 성공으로 세지 않는다.
- 최근 사용자 메시지에서 별칭·대안을 가져오는 양성 사례, 필터 후 index 이동, assistant만 만든 별칭, 인용은 실재하지만 무관한 선택 대안은 실제 corpus에 없다. 단위 검사와 구별한다.
- 고위험 요청, 명시 도구 거부/다른 도구 우선, birth availability의 다른 조합, 기간 없는 관계 흐름, 맥락을 모두 갖춘 상대 마음, 비명시적 기본 오늘 운세 등은 이 18건으로 전부 덮이지 않는다.
- 자동 구조 판정은 enum·개수·지정 슬롯을 검사한다. 원문 인용의 존재만으로 대안의 의미나 별칭 identity가 보장되지는 않는다. recentSituation/period는 별도 근거 객체도 없다.
- `요즘`, `오늘은`, `삼 년째` 같은 시점·지속기간을 곧바로 미래 상담 기간 확보로 바꾸지 않는다. 해당 경로의 실제 의미와 필수 슬롯에 미친 영향을 구분해 읽었다.

현재 결론은 **원본 8개 회귀 통과, 신규 관계/기간 분류 실패 보존**이다. 후속 일반화 수정과 별도 평가가 필요하며, 이 문서는 배포 승인이나 기대값 변경을 수행하지 않는다.
