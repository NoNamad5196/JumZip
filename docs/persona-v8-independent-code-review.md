# Persona-v8 독립 코드 검토

2026-09-20 KST · Codex / repo_audit(AI) · production source 변경 0 · 모델/hosted 호출 0.

검토 범위에서 새 권한·개인정보·수리 횟수·HTTP 응답 크기 결함이나 일반 Chat/Saju 계약 파손을 발견하지 않았다. **이 결론은 의미 품질의 통과 판정이 아니다.** 정확한 키워드를 인용해도 반대 의미를 덧붙이거나 해석 근거를 빈 배열로 회피하는 응답은 구조 검증을 통과할 수 있으며, 구현과 테스트도 그 한계를 명시한다.

## 확인한 경로

| 검토 항목 | 근거와 판단 |
|---|---|
| 서버 계약 선택 | [chat-contract.ts](../supabase/functions/_shared/llm/chat-contract.ts#L28)는 서버가 넘긴 non-empty cards에만 TAROT_EVIDENCE_V1을 고른다. 사용자가 단지 타로를 요청하는 문구는 계약을 선택하지 못한다. 일반 Chat, Saju 및 cards=[]는 기존 두 키 text/toolReferences 계약을 유지한다. |
| prompt/initial/repair 일관성 | [reply.ts](../supabase/functions/_shared/llm/reply.ts#L16)의 동일 contract를 generateChat과 repairChat에 전달한다. [provider.ts](../supabase/functions/_shared/llm/provider.ts#L123)는 두 호출 모두 같은 definition을 선택한다. JSON object 모드에서는 실제 schema를 system message에 명시하고 native JSON Schema 모드에서는 같은 schema를 response_format에 넣는다. |
| 저장 카드 권위 | [validator.ts](../supabase/functions/_shared/llm/validator.ts#L11)는 positionIndex로 저장 카드를 찾고 해당 방향의 canonical 의미 배열로 keyword index를 검사한다. [tool-facts.ts](../supabase/functions/_shared/persona/tool-facts.ts#L68)의 activeMeaning과 같은 데이터에서 파생된다. 모델이 별도 방향을 선언하거나 다른 카드/위치를 참조해 덮어쓸 수 없다. |
| 근거 필드 경계 | 최대 3항목, 위치 중복 금지, 키워드 index 1~5개 및 중복 금지, 실제 배열 범위 확인, textEvidence 최대 200자, 최종 trimmed text 안의 연속 인용, 해당 span 안의 선택 키워드를 검사한다. 빈 evidence와 부분 카드 설명은 의도적으로 허용한다. |
| 수리/실패 | reply는 검증 실패 시 수리 1회만 한다. 두 번 모두 실패하면 LLM_INVALID_RESPONSE이며 누락 근거를 사후에 채워 넣지 않는다. 길이 제한으로 잘린 provider 응답도 성공으로 복원하지 않는다. initial/repair의 온도 0.65/0.15와 출력 900 한도를 유지한다. |
| HTTP/취소 | provider 응답은 스트림을 읽으면서 누적 128,000 bytes를 제한한다. Content-Length에 의존하지 않는다. timeout은 AbortSignal과 reader 취소를 사용하고 악성 cancel promise를 기다리지 않는다. 새 계약에도 동일 경로가 적용된다. |
| 공개 응답 호환 | [reply.ts](../supabase/functions/_shared/llm/reply.ts#L29)는 validated text/segments/metadata만 반환한다. interpretationEvidence가 공개 API나 저장 assistant metadata로 추가되지 않는다. 기존 결과 snapshot이나 카드 데이터도 수정하지 않는다. |
| 개인정보 | [prompt.ts](../supabase/functions/_shared/persona/prompt.ts#L12)의 structured birth/location scrub을 유지한다. 새 근거는 canonical Tarot keyword index와 모델 답변 내부 인용이며 추가 user/profile 조회를 만들지 않는다. 실제 사용자 채팅을 받는 기존 개인정보 경계가 모든 민감 발화를 자동 제거한다는 주장은 하지 않는다. provider는 raw prompt/key/error body를 로그나 예외 본문에 복사하지 않는다. |
| Gemma 옵션 일치 | provider 자체가 정확한 HTTPS Cloudflare account API 경로와 exact Gemma4 model에서만 enable_thinking=false를 넣는다. 일반 compatible URL, 잘못된 host/port, Qwen에는 넣지 않는다. runtime→provider→mock fetch 테스트로 initial/repair 및 structured 경로를 확인했다. benchmark wrapper의 본문 주입이 필요한 구조가 아니다. |

## 남는 의미 한계 — 발견된 새 보안 결함과 구분

- interpretationEvidence=[]는 저장 Tarot에 관한 비점술 후속 대화를 지원한다. 모델이 실제로 카드를 해석하면서 []로 회피해도 현재 구조 검사만으로 식별하지 못한다.
- 올바른 방향의 키워드를 포함한 뒤 잘못된 다른 의미를 함께 쓰거나, 부정·인과·상대의 실제 마음을 잘못 설명할 수 있다. 키워드 존재 검사는 의미·확실성·말투의 증명이 아니다.
- 코드에는 이 한계를 통과 사례로 숨기는 자동 보정이 없다. [v8-evidence.test.ts](../tests/persona/v8-evidence.test.ts)는 이전 의미 Hard Fail이 lexical 검사를 통과하는 상황과 빈 배열 회피를 명시적으로 남긴다.
- 새 근거 필드는 출력 길이를 늘릴 수 있다. 900토큰/HTTP timeout을 올리거나 잘린 JSON을 허용하지 않았으므로, 실제 품질·길이·실패율은 별도 승인된 실제 benchmark로 판단해야 한다.

이 한계만을 이유로 단어 blacklist, 원본 corpus 기대값 완화, 모든 카드 설명 강제, 공개 응답 schema 확대 같은 변경을 제안하지 않는다. 실제로 새 중대한 결함을 재현한 경우가 없어 추가 수정이나 재현 테스트 초안은 요구하지 않는다.

## 수행한 로컬 검증

`v8-evidence.test.ts`, `v8-runtime-provider.test.ts`, `provider.test.ts`, `v5-projection.test.ts` **68/68 PASS**. 모두 합성 fixture와 mock transport다. canonical 22장·양 방향·세 위치·전체 keyword 인덱스, first/repair schema parity, default/Saju 계약, 스트림 cap/timeout, 내부 필드 제거, structured 개인정보 투영, Gemma exact endpoint 옵션 및 Qwen 불변을 포함한다.

검토 대상 production 파일은 읽기만 했다. 이 문서가 live Persona 품질, 공개 Auth, 실제 provider 성공률 또는 전체 release acceptance를 대체하지 않는다.
