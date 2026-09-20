# Intent-v4 구현과 실제 평가 준비

2026-09-20 KST. Main이 승인한 일반 의미 설명 세 가지를 구현했고 런타임을 동결했다. **실제 모델 호출·배포는 0회**다. [v3 실제 리뷰](intent-v3-live-review.md)의 실패와 원본 산출물은 그대로 보존한다.

[intent.ts](../supabase/functions/_shared/llm/intent.ts)의 변경은 버전 `JumZipIntent-v4`, structured request 이름 `jumzip_intent_v4`, 다음 설명뿐이다.

- 주제를 먼저 선택하고 기간은 주제의 수식어로 읽는다. 특정 관계의 기간별 흐름과 자신의 전반적인 월·연 운 흐름을 구분하며, 장기 궁합은 기존 행렬을 유지한다.
- recentSituation은 구체적인 사건·행동·관계 상태 설명이 있을 때만 인정한다. 날짜·기간·도구 요청 자체로 채우지 않는다.
- 고민을 이야기하려는 대화와 가벼운 잡담을 구분한다.

응답 schema 필드, runtime validator, router, 공개 Recommendation, provider, 350토큰·8초/3초·repair 1회는 바꾸지 않았다. 특정 문장을 감지해 도구를 바꾸는 분기나 모델 출력을 사후 정답으로 고치는 로직을 추가하지 않았다.

## 사전 고정 사례

[새 corpus](../tests/persona/intent-v4-corpus.ts)는 원본 v3의 **18개 input 및 expected 객체를 그대로 import**하고 8개를 추가한다. 기존 18개의 input/expected가 과거 selection과 동일하다는 회귀 검사를 통과했다. 원래 관계/기간 실패 사례의 기대도 유지한다. 실제 출력 관찰 전에 고정한 [selection](../tests/persona/benchmark-runs/intent-v4/initial26-final800-reviewed/selection.json)에 전체 문장과 기대가 있다.

| 새 대조 사례 | 사전에 고정한 의미·슬롯 기대 |
|---|---|
| recent-user-alias-filtered-index | 출생 label 문장 제거 후 사용자 별칭은 recent index1. 현재 대명사를 해소해 RELATIONSHIP_3, 부족 슬롯 없음 |
| assistant-only-alias-unresolved | assistant만 제안한 별칭은 UNRESOLVED. RELATIONSHIP_3의 targetPerson 부족 유지 |
| recent-user-choice-pair | recent user의 현 직장 유지/대학원 진학은 실제 대안 둘. 현재 계약 갱신 상황과 함께 DECISION_3, 부족 없음 |
| unrelated-recent-quotes-not-choices | 공원 산책/점심 메뉴는 실재 인용이지만 진로 선택과 무관. 명시된 이직 대안 하나만으로 두 선택을 만들지 않고 choices 부족 유지 |
| period-general-flow | 출생자료 true, 이번 달 전체 운 흐름 → SAJU/MONTHLY |
| period-specific-relationship | 동일한 기간·자료 존재, 달새와의 관계 흐름 → TAROT/RELATIONSHIP_3. 기간만으로 구체 상황을 만들지 않음 |
| semantic-medical-high-stakes | 의료 판단을 타로에 맡기는 요청 → 모델 highStakes=true, 검증 성공 VALID_NONE. 없는 의료 intent enum을 새로 요구하지 않음 |
| concern-conversation-only | 여러 고민으로 마음이 무겁고 대화를 원하는 요청 → GENERAL_CHAT/general_concern, VALID_NONE |

별칭·대안 인용은 역할·index·실제 의미를 함께 읽어야 한다. ALIAS의 특정 문자열 길이나 조사 포함 여부를 단일 정답으로 강제하지 않는다. 독립 코드 검토 후 새 고민 사례의 recentSituation을 false로 명시했다. 막연한 감정만 있고 구체 사건 설명이 없으므로 v4의 구체 상황 조건과 맞춘 것이다. 아직 실제 모델 호출은 없으며 원본 18개에는 손대지 않았다. 첫 준비 폴더 initial26-final800는 이 수정 전 이력으로 보존하고, 최종 실행 근거는 initial26-final800-reviewed다. 의료 사례는 좁은 정규식 차단을 통과해 실제 structured 분류 경로에 도달함을 mock으로 확인했다.

## 검증과 준비된 실행 경로

관련 7개 테스트 파일 **118/118 PASS**, fixture 검토 반영 후 해당 14개 재검사 PASS, 전체 TypeScript, production build, `.mts`를 명시적으로 포함한 scoped ESLint, runner 문법 검사가 통과했다. birth minimization 후 index, assistant 별칭 거부와 1회 repair, 반복 오류의 FAILED_NULL, 의미상 의료 차단의 VALID_NONE, 원본 기대 보존을 검사했다. 공급된 잘못된 monthly 분류나 무관한 실제 인용은 여전히 구조 검증을 통과한다는 한계도 테스트로 남겼다. Mock 성공은 실제 모델 의미 품질의 증거가 아니다.

기존 `intent-v3-preflight.test.ts`는 현재 런타임에서 historical18 corpus를 재사용하는 오프라인 회귀임을 이름·설명에 명시했다. 과거 v3 runner와 source-hash guard를 바꾸지 않았다. 새 v4 테스트·runner·산출물은 별도 파일과 폴더다.

[preflight](../tests/persona/benchmark-runs/intent-v4/initial26-final800-reviewed/preflight.json)는 26개 실제 provider 요청을 직렬화했고, sourceFrozen=true, 실제 요청 0이다. Domain의 Persona-v9 생산 소스 동결 후 해시를 잡았다. 요청은 7,351–7,527 UTF-8 bytes다. 모델은 고정 Gemma4, exact Cloudflare account API, json_object, `enable_thinking=false`이며 wrapper는 실제 provider 본문을 검증할 뿐 변경하지 않는다.

실행에는 별도 Main GO와 `--live`, `JUMZIP_INTENT_V4_LIVE_GO=1`, 비공개 환경 로딩이 모두 필요하다. 별도 GO 없이 이를 설정하거나 실행하지 않았다. GO 없는 live는 파일 생성 전에 거부되고, 기존 preflight 이름 재사용도 원본 변경 없이 거부되는 것을 확인했다. 향후 승인된 실행은 `intent-v4-runner.mts --live --run-name=initial26-final800-reviewed`이며 실행 직전 소스 해시가 달라졌다면 새 이름의 fresh preflight가 필요하다.

러너는 initial/repair별 합성 원문과 usage를 보존하고, VALID_NONE/FAILED_NULL을 구분한다. 128KB body 한도, timeout, destination/model/body guard, overwrite 금지, 사전 예약과 quota 중단은 유지된다. 최대 HTTP는 52회지만 사례당 repair는 1회이며, 의미 판정은 자동 PASS로 처리하지 않는다.

## 비용 예측과 한도

새 준비 한도는 **800 neurons**다. 기존 v3의 600 한도는 변경하지 않았다. 실제 v3 18건의 평균 input-token/요청 byte 비율 0.220745와 평균 출력 89.78토큰을 이번 정확 직렬화 byte 수에 적용한 초기 26건 예측은 **449.97 neurons**다. 과거 최대 입력 비율과 매번 350 출력토큰을 사용하면 **635.56 neurons**다. 추가 evidence 문맥과 출력 변화 때문에 실제 비용·완료 보장은 아니다.

매 호출 전에 전체 직렬화 UTF-8 bytes를 입력토큰처럼 보수적으로 예약하고 350 출력토큰 비용을 더한다. 가장 큰 단일 예약은 **77.97 neurons**다. 초기 26개 예약을 단순 합한 1,998.20은 동시 지출값이 아니다. 매 응답에서 실측 토큰 usage로 예약을 대체하며, usage가 없으면 예약을 유지한다. 800을 넘을 다음 요청은 보내지 않는다. repair가 많거나 usage가 없으면 26건 전에 중단될 수 있다. 실잔액 확인과 live GO는 Main이 별도로 수행해야 한다.

## 동결 식별자

- Runtime LF SHA256: `a5a35e1144571472a163247087be5dc9e134ed7f1c4a47c51c1015af533d9983`
- Corpus LF SHA256: `e22a9a9b332aaa8a3ee664b01bfcaa29ec740e72b31b4b567fe58e3af35c1d9f`
- Runner LF SHA256: `961b760658bb046c96b84e879b487df78ea9b8a85cee0a3101e90bf1fca42647`
- Selection SHA256: `7aeaf263785624d1f5dc81b1a4c695723433658588f947e0691635c6515e6f92`

과거 18건의 입력·기대·실제 결과는 변경하지 않았다. 이번 준비는 새 의미 설명이 실제 모델에서 통한다는 결론이나 배포 승인이 아니다.
