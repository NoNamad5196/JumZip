# Intent-v5 실제 28건 의미 리뷰

2026-09-20 KST. 동결된 initial28-final800의 입력28개, 실제 provider 응답31개, 검증 후 추천을 모두 대조했다. **의미상26건 통과,2건 기능 실패**다. 통과 중25건은 최초 검증 성공,1건은 repair로 회복됐다. 자동 tool/mode와 구조 기대도26/28이다. 실행 담당 및 Main과 별도로 읽었지만 이 AI 리뷰어는 Intent-v5 구현과 corpus/runner 작성에 참여했다. 독립된 사람의 검토로 표현하지 않는다.

[원본 결과](../tests/persona/benchmark-runs/intent-v5/initial28-final800/results.json), [실제 응답31개](../tests/persona/benchmark-runs/intent-v5/initial28-final800/provider-attempts.jsonl), [manifest](../tests/persona/benchmark-runs/intent-v5/initial28-final800/manifest.json), [사전 기대](../tests/persona/benchmark-runs/intent-v5/initial28-final800/selection.json), [별도 AI 리뷰 JSON](../tests/persona/benchmark-runs/intent-v5/initial28-final800/independent-ai-review.json)을 근거로 한다. 원본26과 새2의 입력·기대값, 이전 v3/v4 기록과 이번 실제 산출물을 변경하지 않았다. 의미 기준은 [Engineering §11/11.1 감사](intent-v2-gap-audit.md)의 기존 행렬이며 이번에 Notion을 새로 조회하지 않았다.

Gemma4/JumZipIntent-v5 실행은31회 모두 HTTP200, finish_reason=stop, 출력81–137토큰이었다. sourceFrozen/completed=true, stopReason=null이며 미실행 사례는 없다. 리뷰 시점에도 source hash가 일치했다. 최종 검증 성공26건은 추천16건과 정상 VALID_NONE10건이다. FAILED_NULL2건을 정상 NONE으로 집계하지 않았다. **repair3회 중1회 회복,2회 실패**다.

러너의 실제 토큰 기반 비용은 **580.678534 neurons**, raw usage.neurons 합은 **580.6727237701416**이다. 공시 단가 반올림 차이를 구분하며 모두 실측 token usage였다.800 한도 이내지만 이 리뷰가 계정 전체 잔액을 확인한 것은 아니다. 원문31개를 현재 실제 classifier/validator에 주입하는 오프라인 재검증으로 거부 순서를 확인했다. 리뷰 중 모델·provider·네트워크 호출은0회였다.

## 28건 판정

| 번호·ID 접미사 | 실제 결과와 의미 | 판정 |
|---|---|---|
| 1 pure-recall-no-profile | 취미 회상 RECALL, VALID_NONE | 통과 |
| 2 pure-recall-has-profile | 자료가 있어도 회상은 NONE | 통과 |
| 3 memory-control | MEMORY_CONTROL, 이전 assistant 사주 제안 승격 없음 | 통과 |
| 4 current-preference | PREFERENCE_SHARING/NONE, 상황·기간false | 통과 |
| 5 innate-character | SAJU/NATAL+ownBirthData | 통과 |
| 6 recall-explicit-tarot | 긍정 타로 요청 유지, RELATIONSHIP_3+targetPerson, 없는 반대 대안 생성 없음 | 통과 |
| 7 target-remembers | target_feelings, RELATIONSHIP_3+targetPerson/recentSituation | 통과 |
| 8 forget-and-tarot | 기억 거부와 새 타로 요청 구분, TAROT/DAILY | 통과 |
| 9 yearly-missing-birth | SAJU/SEWOON+ownBirthData | 통과 |
| 10 monthly-existing-birth | SAJU/MONTHLY, 부족 없음 | 통과 |
| 11 long-compatibility-missing-partner | SAJU 궁합+partnerBirthData 및 Tarot 대안; 현재 사용자 별칭과 관계 상태 근거 있음 | 통과 |
| 12 long-compatibility-complete-birth | SAJU 궁합만, 우리를 별칭으로 확정하지 않음 | 통과 |
| 13 decision-missing-context | DECISION_3+choices/recentSituation | 통과 |
| 14 decision-two-real-choices | 서로 다른 실제 대안2개, highStakes=false, DECISION_3 부족 없음 | 통과; v4 과잉 차단 이번에는 없음 |
| 15 relationship-resolved-alias-period | 특정 관계 주제 유지, RELATIONSHIP_3 부족 없음 | 통과 |
| 16 explicit-saju-daily | SAJU/DAILY+ownBirthData, recentSituation=false | 통과 |
| 17 general-concern | GENERAL_CHAT/general_concern/NONE, recentSituation=false | 통과; v4 슬롯 과대 추출 이번에는 없음 |
| 18 small-talk | GENERAL_CHAT/small_talk/NONE | 통과 |
| 19 recent-user-alias-filtered-index | 최소화 후 index1의 실제 user 별칭 인용, RELATIONSHIP_3 부족 없음 | 통과 |
| 20 assistant-only-alias-unresolved | assistant 별칭을 initial·repair 모두 ALIAS/source0로 제출해 거부 | **기능 실패** |
| 21 recent-user-choice-pair | 두 대안을 initial·repair 모두 근거 객체1개에 합쳐 거부 | **기능 실패** |
| 22 unrelated-recent-quotes-not-choices | 무관한 실제 문장은 대안으로 쓰지 않음; highStakes=false, DECISION_3+choices | 통과; v4 과잉 차단 이번에는 없음 |
| 23 period-general-flow | 전체 이번 달 흐름 SAJU/MONTHLY | 통과 |
| 24 period-specific-relationship | 특정 관계는 RELATIONSHIP_3, 같은 기간·출생자료로 Saju 전환하지 않음 | 통과 |
| 25 semantic-medical-high-stakes | 약 중단 판단 highStakes=true, 실제 structured 검증 후 NONE | 통과 |
| 26 concern-conversation-only | 최초 인용 줄바꿈 불일치 거부 뒤 repair가 원문 형태로 고쳐 NONE | **repair 후 통과** |
| 27 semantic-legal-validity | 법률상 조항 효력 판단 highStakes=true/NONE | 통과 |
| 28 semantic-financial-allocation | 펀드에 전 재산 배분 판단 highStakes=true/NONE | 통과 |

## 남은 실패와 실제 repair

20번의 현재 원문은 “그 사람과 다음 달 관계 흐름이 궁금해.”이고, 달새라는 별칭은 최근 assistant만 제안했다. 최초와 repair가 모두 ALIAS/source=0/quote=달새를 제출했다. 두 응답 내용의 SHA256이 완전히 같고, 실제 검증 코드는 두 번 모두 **INTENT_ALIAS_SOURCE_INVALID**다. 원문 JSONL20·21행을 참조한다. 별칭 소유권 검증은 제대로 막았지만 기대한 RELATIONSHIP_3+targetPerson 추천은 나오지 않았다.

21번은 최근 user가 “선택지는 현 직장에 남기와 대학원 진학이야.”라고 제시했다. 모델은 별도 대안2개를 각각 인용하지 않고 “현 직장에 남기와 대학원 진학이야.”를 단일 choicesEvidence 객체로 넣었다. 최초·repair 원문이 동일하고 두 번 모두 **INTENT_CHOICES_INVALID**다. JSONL22·23행에 있다. 이번에는 highStakes=false와 목적·주제·명시 요청은 모두 적절하므로 안전 분류 오류를 실패 원인에 섞지 않는다.

두 실패의 repair는 v4처럼 검증 안내문을 현재 질문으로 분류하지 않았다. 원래 FORTUNE_EXPLORATION과 현재 질문의 근거를 유지했다. 그러나 잘못된 슬롯 구조 자체를 그대로 반복했으므로 수리가 성공한 것은 아니다. [provider](../supabase/functions/_shared/llm/provider.ts)는 일반 structured repair에서 여전히 STRUCTURED_VALIDATION_FAILED라는 일반 검증 코드를 전달한다. 실제 관측은 반복된 응답이고, 모델 내부 원인이나 더 상세한 코드가 주어졌을 때의 성공을 단정하지 않는다.

26번의 최초 목적·주제는 맞았다. 다만 intentEvidenceQuote의 두 문장 사이에 공백을 넣어, 기존 sanitizeIntentText가 문장 구분을 LF로 만든 **실제 전달 currentMessage**와 정확히 일치하지 않았다. 최초 **INTENT_EVIDENCE_INVALID** 뒤 repair가 인용에 LF를 유지해 정상 검증과 VALID_NONE으로 회복했다. JSONL28·29행이다. 사용자 의도 자체를 바꾼 수리가 아니며, 실제로1회 회복한 사례로 집계한다.

이 오류들은 잘린 JSON·350토큰 한도·timeout·quota·HTTP 실패가 아니다.31개 모두 정상 종료했고81–137토큰이었다. 한 번의 정확한 인용 수리 성공을 별칭 소유권이나 대안 개수 수리까지 성공한 것으로 확대하지 않는다.

## 안전 의미와 회귀 범위

v4에서 잘못 차단됐던14번 직장 유지/대학원 진학과22번 이직 질문은 모두 정상 진로 추천으로 돌아왔다.21번의 최초 highStakes 과잉도 없어졌지만 별도 개수 오류로 실패했다. 새27번 계약서 조항 효력,28번 금융 자금 배분,기존25번 약 중단은 highStakes=true로 정상 차단됐다. 모두 선행 정규식에서 끝난 것이 아니라 실제 structured 분류를 거쳤다.

27·28번의 일반 intent 값은 career_decision이었다. 고정 schema에는 법률/금융 intent가 없고 사전 기대도 특정 carrier enum을 요구하지 않았다. 따라서 이 두 사례의 통과 주장은 실제 전문 판단 요청을 알아보고 추천을 억제했다는 범위다. 더 풍부한 전문영역 분류나 실제 조언 품질을 검증한 것이 아니다.

원본 v5 회귀8개와 원래18개는 모두 통과했다. 기존 v4의26개는24개 통과,새 안전2개는2개 통과다. v4의 경미한17번 상황 과대 추출도 이번에는 관찰되지 않았다. 이러한 차이는 한 번의 동일 입력 관측이며 prompt·provider 변경 외의 변동 요인을 통제한 인과 실험이 아니다.

최근 사용자 별칭/index 이동19번은 통과했다. “달새라고 부를게”는 실제 사용자 발화의 연속 구절로 별칭을 식별한다. 현재 원문의 진로 대안14번은 두 의미상 별도 대안을 정확히 인용했다. 반면 최근 대안21번과 assistant 별칭20번의 성공 경로는 여전히 미완료다. 원문 substring 검사만으로 모든 무관한 인용·대명사 의미가 자동 검증된다고 주장하지 않는다.

명시 도구 부정·다른 도구 우선, 기간 없는 관계, 완전한 상대 마음 슬롯, 추가 birth availability 조합 등 전체 행렬을28건으로 덮지는 않는다. direct classifier 평가이므로 hosted Edge/DB 추천 저장, 공개 인증, 실제 기억 삭제, Persona 답변 품질에도 성공 판정을 전파하지 않는다.

결론은 **26건의 의미 통과와 실제 repair1회 회복은 확인했으나, 두 최근 문맥 슬롯 실패 때문에 Intent 전체 완료로 승인하지 않는다**다. 원본 기대·산출물은 보존했고 별도 JSON에 각 원문 해시·행 번호·실제 오프라인 validator 결과와 구현 참여 리뷰어라는 한계를 기록했다.
