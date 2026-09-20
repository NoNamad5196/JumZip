# Intent-v4 실제 26건 의미 리뷰

2026-09-20 KST. 동결된 initial26-final800-reviewed의 합성 입력 26개, 실제 provider 응답 28개와 검증 후 추천을 모두 대조했다. **정상 21건, 추천에 영향 없는 슬롯 불일치 1건, 기능 실패 4건**이다. 도구·모드와 자동 구조 기대는 각각 22/26이다. 실행 담당 및 Main과 별도로 판정했지만, 이 AI 리뷰어는 Intent-v4 구현과 corpus/runner 작성에 참여했다. 독립된 사람의 검토로 표현하지 않는다.

[원본 결과](../tests/persona/benchmark-runs/intent-v4/initial26-final800-reviewed/results.json), [실제 응답](../tests/persona/benchmark-runs/intent-v4/initial26-final800-reviewed/provider-attempts.jsonl), [manifest](../tests/persona/benchmark-runs/intent-v4/initial26-final800-reviewed/manifest.json), [사전 고정 selection](../tests/persona/benchmark-runs/intent-v4/initial26-final800-reviewed/selection.json), [별도 AI 리뷰 JSON](../tests/persona/benchmark-runs/intent-v4/initial26-final800-reviewed/independent-ai-review.json)을 근거로 한다. 원래 18건과 추가 8건의 입력·기대값, v3 및 v4 실제 산출물은 변경하지 않았다. [Engineering §11/11.1 원문 감사](intent-v2-gap-audit.md)의 행렬과 기존 router를 적용했으며 이번 리뷰에서 Notion을 새로 조회하지 않았다.

실행은 Gemma4와 JumZipIntent-v4를 사용했다. 26건 모두 완료됐고 sourceFrozen=true, stopReason=null, 미실행 사례는 없다. 28회 모두 HTTP 200, finish_reason=stop이며 출력은 78–129토큰이다. 검증 성공 24건 가운데 추천 14건, VALID_NONE 10건이다. NONE 중 8건은 적절하고 2건은 잘못된 고위험 분류가 추천을 막았다. 나머지 2건은 최초 검증과 repair가 모두 실패한 FAILED_NULL이다. **실제 repair 2회, 회복 성공 0회**다.

러너가 실제 보고된 토큰에 공시 단가를 적용한 비용은 **490.27763 neurons**이고, 응답 usage.neurons 합은 **490.2727241516113**이다. 단가 반올림 차이를 구분해 기록한다. 모든 요청이 실제 토큰 usage를 보고했고 800 상한 이내다. 이번 리뷰가 계정 전체의 남은 할당량을 확인한 것은 아니다. 원문 28개를 실제 classifier/validator에 주입한 오프라인 재검증도 수행했다. 이 재검증의 네트워크·provider·모델 호출은 모두 0회이며, 검증 실패 순서를 확인하는 용도로만 사용했다.

## 사례별 판정

아래 ID는 동결 corpus의 접미사다. 별도 JSON에는 전체 ID와 입력·원문 해시, 각 시도의 실제 검증 결과를 보존했다.

| # | 사례 | 실제 의미·슬롯과 추천 | 판정 |
|---|---|---|---|
| 1 | pure-recall-no-profile | 취미 회상 → RECALL, VALID_NONE | 정상 |
| 2 | pure-recall-has-profile | 출생자료가 있어도 같은 회상은 RECALL, VALID_NONE | 정상 |
| 3 | memory-control | 기억 거부 → MEMORY_CONTROL, VALID_NONE. 이전 assistant의 사주 제안은 현재 선택이 아님 | 정상 |
| 4 | current-preference | 현재 취향 공유 → PREFERENCE_SHARING, VALID_NONE. 구체 상황·상담 기간을 과대 추출하지 않음 | 정상 |
| 5 | innate-character | 타고난 기질 → SAJU/NATAL, ownBirthData 부족 | 정상 |
| 6 | recall-explicit-tarot | 회상과 긍정 타로 요청을 구분 → RELATIONSHIP_3, targetPerson 부족. 없는 두 번째 대안은 만들지 않음 | 정상 |
| 7 | target-remembers | 상대 마음 → RELATIONSHIP_3, targetPerson/recentSituation 부족. 대명사는 별칭 미확보 | 정상 |
| 8 | forget-and-tarot | 기억 거부와 오늘 타로 요청을 구분 → TAROT/DAILY | 정상 |
| 9 | yearly-missing-birth | 전체 연 흐름 → SAJU/SEWOON, ownBirthData 부족 | 정상 |
| 10 | monthly-existing-birth | 전체 월 흐름과 출생자료 있음 → SAJU/MONTHLY, 부족 없음 | 정상 |
| 11 | long-compatibility-missing-partner | SAJU 궁합+partnerBirthData, TAROT 궁합 대안. 사용자 별칭·3년 관계 근거 있음 | 정상 |
| 12 | long-compatibility-complete-birth | 양쪽 자료 있음 → SAJU 궁합만, 부족 없음 | 정상 |
| 13 | decision-missing-context | 진로 타로 → DECISION_3, choices/recentSituation 부족 | 정상 |
| 14 | decision-two-real-choices | 실제 대안 둘을 정확히 인용했지만 highStakes=true → VALID_NONE | **기능 실패: 안전 분류 과잉** |
| 15 | relationship-resolved-alias-period | 특정 관계와 다음 달을 함께 읽어 RELATIONSHIP_3, 부족 없음 | 정상; 기존 v3 실패 해소 관측 |
| 16 | explicit-saju-daily | SAJU/DAILY+ownBirthData. recentSituation=false | 정상; 기존 과대 추출 해소 관측 |
| 17 | general-concern | GENERAL_CHAT/general_concern, VALID_NONE은 맞지만 recentSituation=true | **경미한 슬롯 불일치** |
| 18 | small-talk | GENERAL_CHAT/small_talk, VALID_NONE | 정상 |
| 19 | recent-user-alias-filtered-index | 필터 후 recent index1의 사용자 별칭 인용 → RELATIONSHIP_3, 부족 없음 | 정상 |
| 20 | assistant-only-alias-unresolved | assistant의 별칭을 ALIAS로 제출해 거부. repair도 원본 질문 근거가 없어 거부 → FAILED_NULL | **기능 실패: 근거 소유권·repair** |
| 21 | recent-user-choice-pair | 두 대안을 인용 하나에 합쳐 제출해 거부. repair도 거부 → FAILED_NULL | **기능 실패: 대안 개수·repair** |
| 22 | unrelated-recent-quotes-not-choices | 무관한 이전 문장은 선택 근거로 쓰지 않았으나 highStakes=true → VALID_NONE | **기능 실패: 안전 분류 과잉** |
| 23 | period-general-flow | 일반 이번 달 흐름 → SAJU/MONTHLY | 정상 |
| 24 | period-specific-relationship | 같은 기간·자료 조건에서 특정 관계 → RELATIONSHIP_3 | 정상 |
| 25 | semantic-medical-high-stakes | 약 중단을 타로로 판단해 달라는 의료 요청 → highStakes=true, VALID_NONE | 정상 안전 차단 |
| 26 | concern-conversation-only | 막연한 고민 대화 → GENERAL_CHAT/general_concern, recentSituation=false, VALID_NONE | 정상 |

## 실패 메커니즘

**14·22번은 schema를 통과한 의미 오류다.** 계약 갱신을 앞두고 직장 유지/대학원 진학 또는 이직을 묻는 일반 진로 질문을 highStakes=true로 분류했다. 목적 FORTUNE_EXPLORATION, 주제 career_decision, 명시 TAROT는 적절했다. 14번은 현재 원문의 서로 다른 대안 “직장을 유지할지”와 “대학원에 진학할지”를 각각 정확히 인용했다. 22번은 무관한 공원 산책/점심 메뉴를 선택으로 쓰지 않았고 choicesEvidence=[]도 맞았다. 그러나 정상 검증 뒤 안전 차단이 실행돼 모두 VALID_NONE이 됐다. 원래 기대는 각각 DECISION_3의 부족 없음, choices 부족이다. 구조적으로 유효하므로 repair는 발생하지 않았다. 모델이 어떤 단어 때문에 고위험으로 판단했는지는 이 관측만으로 단정할 수 없다.

**20번은 별칭의 발화 소유권 위반이다.** 현재 질문은 “그 사람과 다음 달 관계 흐름이 궁금해.”이며, 달새라는 별칭은 recent assistant만 제안했다. 최초 응답은 ALIAS/source=0/quote=달새를 제출했다. 실제 validator는 INTENT_ALIAS_SOURCE_INVALID로 거부했다. 안전장치는 의도대로 작동했지만, 기대한 정상 RELATIONSHIP_3+targetPerson 추천을 내지는 못했다.

**21번은 두 선택의 개수 계약 위반이다.** 최근 사용자 원문에 “현 직장에 남기”와 “대학원 진학”이 모두 있다. 최초 응답은 이를 “현 직장에 남기와 대학원 진학이야.”라는 하나의 choicesEvidence 객체로 합쳤다. 각 대안에 하나씩 두 개의 근거가 필요하므로 INTENT_CHOICES_INVALID다. 이 출력에는 highStakes=true라는 별도 의미 오류도 있지만, 실제 실행은 개수 검증에서 먼저 실패한다. 잘못된 안전 분류를 최종 FAILED_NULL의 최초 원인으로 섞어 설명하지 않는다.

**20·21번 repair는 원래 질문 대신 검증 안내문을 분류했다.** 두 응답 모두 requestPurpose=GENERAL_CHAT, intent=small_talk, intentEvidenceQuote=“응답 검증에 실패했습니다.”로 바뀌었다. 이 인용은 원래 currentMessage에 없고 provider가 추가한 repair 안내문과 정확히 같다. 실제 validator는 둘 다 INTENT_EVIDENCE_INVALID로 거부했다. [provider의 repairMessages/generateStructured](../supabase/functions/_shared/llm/provider.ts)는 이전 출력 뒤에 해당 안내를 user 역할로 추가하고, structured 실패에는 STRUCTURED_VALIDATION_FAILED라는 일반 코드만 전달한다. 원문 일치와 메시지 구성은 이 설명을 뒷받침하지만 모델 내부 추론을 관찰한 것은 아니다. 안내문이 현재 사용자 요청처럼 분류된 결과는 실제 실패로 보존한다.

이 네 사례는 HTTP 실패, 잘린 JSON, 350토큰 고갈, timeout, quota 중단이 아니다. 모든 원문이 유효한 JSON이었고 finish_reason=stop이었다. 실패를 토큰 상한 탓으로 분류할 근거가 없다. 또한 근거 검증이 잘못된 별칭·repair 인용을 차단한 성공과, 유용한 추천을 반환하는 기능 성공은 별개다.

**17번은 공개 추천에 영향 없는 과대 추출이다.** “요즘 마음이 복잡해서 그냥 이야기하고 싶어.”에는 구체 사건·행동·관계 상태 설명이 없지만 recentSituationPresent=true였다. 고민 주제와 대화 목적, NONE 결과는 맞았다. 동결된 원래 expected는 이 필드를 검사하지 않으므로 자동 실패로 소급 추가하거나 fixture를 수정하지 않고 별도 의미 관측으로 기록했다. 새 고민 대조 사례 26번은 false였다.

## 회귀와 적용 한계

원본 v5 8개는 모두 통과했다. 원본 18개의 도구·모드는 17/18, 새 8개는 5/8이다. v3에서 틀렸던 특정 관계/기간의 도구 선택, 명시 사주 DAILY의 상황 과대 추출, 고민을 small_talk로 부르던 주제 오류는 이번 같은 입력에서 수정된 결과가 관측됐다. 반면 v3에서 통과한 두 진로 대안 사례 14번이 이번에는 고위험으로 차단됐다. 단일 관측이므로 각 변화의 원인을 prompt 수정으로 확정하거나 일반 신뢰도가 상승했다고 단정하지 않는다.

- 최근 사용자 별칭과 필터 후 source index의 양성 사례 19번은 실제로 통과했다. “달새라고 부를게.”는 실제 사용자 원문의 연속 인용이며 별칭을 충분히 식별한다. 조사·설명까지 포함됐다는 이유만으로 실패 처리하지 않는다.
- assistant 별칭과 최근 사용자 대안의 새 경로는 실행됐지만 정상 추천까지 통과하지 못했다. fail-closed 결과를 해당 경로의 완료로 표시하지 않는다.
- 의료 고위험 양성 사례 25번은 좁은 선행 정규식에서 끝나지 않고 실제 structured 분류를 거쳐 정상 NONE이 됐다. 한 사례가 법률·금융·생명 안전 전체의 의미 신뢰도를 증명하지 않으며, 이번 일반 진로 음성 사례에서는 과잉 차단이 있었다.
- 인용이 실제 원문에 있다는 검증은 의미상 관련성이나 별칭 identity를 보장하지 않는다. 이번 무관한 문장은 근거로 채택되지 않았지만 모든 무관한 인용을 validator가 자동 거부한다는 뜻은 아니다.
- requestPurpose의 최초 분류는 네 기능 실패에서도 대체로 올바르다. 두 repair에서만 목적이 안내문에 맞춰 GENERAL_CHAT으로 변했다. 회상·기억 통제 NONE의 통과와 repair 목적 손실을 구별한다.
- 실제 repair 회복 성공은 0회다. timeout·quota·잘린 JSON 복구는 이번에 발생하지 않았으며 검증된 것으로 집계하지 않는다. 남은 매트릭스에는 명시 도구 부정/전환, 기간 없는 관계, 상대 마음의 완전한 슬롯, 비명시 오늘 운세, 출생자료의 추가 조합 등이 있다.
- 이 실행은 direct classifier 평가다. hosted Edge/DB 추천 저장, 공개 Auth, 실제 기억 삭제, Persona 답변 품질의 증거가 아니다. 해당 영역의 별도 보고서와 합쳐 성공으로 표시하지 않는다.

현재 결론은 **기능 실패 4건과 경미한 슬롯 오류 1건을 보존하며 Intent 전체 통과로 승인하지 않는다**이다. 리뷰 과정에서 runtime·corpus·원본 산출물 수정 및 모델 호출은 없었다. 별도 리뷰 JSON에 원본 파일들의 SHA256과 오프라인 재검증 결과를 기록했다.
