# Persona v5 수정 제안 — 구현 전

2026-09-20. 이 문서는 Gemma 4 원본 84건의 실패 검토 뒤 작성한 **계획**이다. production source, 동결 corpus, 기대값, 배포 모델은 이 문서 작성으로 변경하지 않았다. 추가 모델 호출도 하지 않았다. 목표는 `JumZipPersona-v5`와 내부 `JumZipIntent-v2` 후보를 작게 검증하는 것이며, 아직 성능 개선이나 품질 통과를 주장하지 않는다.

실제 기준은 `persona-benchmark-gemma4-full-review.md`와 원본 응답이다. Gemma는 core 평균 9.25와 보충 평균 9.00이지만 각각 확정 Hard Fail 1건이 있어 실패다. 별도로 `docs/evidence/backend-recall-probe-v4.json`에는 단순 취향 회상 요청이 `natal_character`로 분류되어 사주 NATAL 추천을 만든 실제 Qwen 기록이 있다. 기억 저장/회상 기능의 lifecycle와 Persona 원문 품질은 서로 다른 검사다.

| 작업 | 현재의 확인된 문제 | 제안하는 작은 변경 | 유지할 계약 |
| --- | --- | --- | --- |
| 입력 상태 | 날짜 값을 prompt에서 지운 것을 날짜 입력 부재로 오해 | 서버가 만든 비식별 입력 availability와 계산 불확실성 원인을 별개로 전달 | 원국·점수·후보·timing 불변, B 원자료 비노출 |
| 카드 방향·타인 마음 | ID/방향 참조는 정확해도 본문이 반대 의미/실제 심정 단정 | 선택 방향의 상징 근거와 위치 소유자를 먼저 고정하고 관찰 사실·상징·조언을 구분 | 22장 정본·추첨·방향·위치·기존 JSON 출력 계약 불변 |
| M11 회상 분류 | 취미 회상을 타고난 성향으로 취급 | 내부 발화 목적 분류와 natal 의미 경계, 원문 근거 검증 | 추천 API tool/mode와 수동 실행 흐름 불변 |

입력 상태는 `null`에서 추측하지 않는다. 실제 `calculateFullSaju`가 검증을 마친 시점에 날짜 제공 여부를 기록하고 compact projection으로 전달한다. 제안 필드는 `inputAvailability: { calendarDate: 'PROVIDED' | 'NOT_RECORDED', clockTime: 'PROVIDED' | 'UNKNOWN' | 'NOT_RECORDED' }`다. 값 자체, 시간대, 도시, 좌표, 생년월일 문자열은 포함하지 않는다. 필요하다면 대운 방향 계산에 필요한 입력의 존재 여부도 별도 비식별 상태로 표현하되 실제 성별은 보내지 않는다. 일반 계산에는 날짜가 필수이므로 `PROVIDED`이며, 시각은 검증된 입력의 known/unknown 상태를 따른다. 수작업 component fixture나 이전 snapshot에서 provenance를 복원할 수 없으면 `NOT_RECORDED`로 남기고, 이 값을 사용자가 입력하지 않았다는 뜻으로 바꾸지 않는다.

같은 객체에 `calculationUncertainty`를 별개로 투영한다. 기존 flags와 상관 후보에 근거한 `UNKNOWN_CLOCK_TIME`, `DST_AMBIGUITY`, `BOUNDARY_VARIANTS`, `CURRENT_PERIOD_UNRESOLVED` 같은 설명용 enum이 후보이며, 각 enum은 기존 원인에만 대응한다. 알려진 원자료 날짜가 있어도 입춘·자시 경계 때문에 연주·월주·일주가 서로 다른 후보를 가질 수 있다. 그러므로 “날짜는 알려졌다”와 “연·월·일주가 전부 확정이다”를 동일하게 취급하지 않는다. 점수 32·37·58은 이산 후보 그대로 보존하고, 해석 projection을 줄이더라도 후보 간 결합을 새로 만들지 않는다. 궁합은 A/B별 availability를 분리하고 원자료 없이 각자의 한계만 보여준다.

변경 지점은 `domain/full-saju.ts`의 결과/projection, 필요한 `domain/saju-compatibility.ts`의 A/B projection, `persona/tool-facts.ts`, `persona/prompt.ts`다. 역직렬화된 과거 snapshot과 합성 component wrapper는 선택적 필드의 안전한 fallback을 가져야 한다. `sanitizePersonaToolResult`의 private-key 차단을 넓게 해제하지 않는다. 새 상태 이름에는 원자료가 없고 scrub을 통과하는지 별도 회귀를 둔다. 날짜 입력이 없는 plain chat의 `toolResult:null`과 날짜를 이미 검증한 사주 해석은 서로 다른 경로로 설명한다. 부족한 정보를 채팅에 다시 쓰도록 요구하기보다 실제 허용된 입력 UI로 이어지는 작업 안내를 따른다.

카드 방향 문제는 정본 의미의 누락이 아니다. 현재 v4에는 `nameKo`, `orientationLabel`, `positionLabel`, 선택 방향 `activeMeaning`, `contextAdvice`, 정확한 `requiredToolReferences`가 모두 있다. 따라서 데이터를 처음 추가했다고 주장하거나 은둔자 한 문구만 금지하는 수정은 하지 않는다. v5 후보는 모든 22장×2방향에 동일한 해석 frame을 만든다: `evidenceKind: 'SYMBOLIC_NOT_OBSERVED'`, 위치별 대상, 현재 방향의 정본 keyword 목록, 조언과 현재 상태의 구분이다. 카드를 설명할 때 현재 방향의 핵심 중 하나를 먼저 짚고, 실제로 관찰한 사실처럼 원인이나 상대의 욕구를 확정하지 않도록 한다. 다른 방향의 의미를 함께 늘어놓는 방식은 혼동을 더할 수 있어 첫 후보에서는 추가하지 않는다.

예를 들어 사용자가 직접 말한 행동은 관찰 자료, 카드가 제시하는 고립/회피는 검토할 상징, 연락 속도를 확인하는 행동은 현실 조언이다. “혼자 있어야 한다”는 필요나 원인을 카드가 확정했다는 식으로 두 번째 단계와 세 번째 단계를 합치지 않는다. 이것은 특정 카드만의 규칙이 아니며 상대 태도·관계 방향·위험·조언 위치 모두에 적용한다. 산이의 단호함과 아랑의 통찰이라는 말투 설정도 사실 확정 권한을 주지 않는다. 현재 Persona 설정 전체를 다시 쓰거나 긴 금지 문장을 계속 덧붙이기보다 중복된 tool 해석 규칙을 짧은 공통 frame으로 정리한다. 2–4문장, 반말/존댓말, 기존 `text/toolReferences`와 최대 900토큰을 유지하는 것이 첫 실험 범위다.

M11은 `llm/intent.ts`의 내부 schema와 prompt만 확장한다. 제안 필드는 `requestPurpose: 'FORTUNE_EXPLORATION' | 'RECALL' | 'MEMORY_CONTROL' | 'PREFERENCE_SHARING' | 'GENERAL_CHAT'`와 필요한 경우 길이가 제한된 현재 발화의 `intentEvidenceQuote`다. 회상은 이전에 말한 사실을 찾는 요청이고, 기억 관리는 저장·삭제·정정 요청이며, 현재 취향 공유는 새 대화 사실이다. `natal_character`는 선천적/타고난 성향을 점술적 구조로 살펴보려는 의미에만 해당한다. 취미·선호라는 주제 단어 자체나 `hasOwnBirthData=true`는 그 근거가 아니다. 모호하면 기존 `general_concern`/무추천으로 이어진다.

순수 회상·기억 관리·취향 공유는 명시적 도구 선택이 없는 한 추천하지 않는다. 다만 “취미 기억해? 오늘 모임은 타로로도 봐줘” 같은 복합 요청은 현재의 긍정적 타로 요청과 원문 근거가 있어 기존 명시적 선택 우선순위를 지킨다. “그 사람이 날 기억하는지 타로로 보고 싶어”의 기억은 사용자 메모리 회상이 아니라 관계 질문이다. “그 얘긴 기억하지 말고 타로 한 장”도 기억 거부와 새 도구 요청을 각각 존중해야 한다. 따라서 모든 ‘기억’ 문자열을 정규식으로 금지하지 않는다. 실제 저장/삭제 권한이나 memory persistence를 이 classifier에 맡기지 않는다. `recommendTool` 행렬과 외부 tool/mode는 그대로 두고 내부 분류를 기존 행렬 입력에 연결한다. 실패 시에는 현재처럼 추천만 생략하고 대화를 계속한다.

결정적으로 확인할 수 있는 범위는 명확히 제한한다. 현재도 카드 ID·방향·위치, JSON 키·자료형, 일부 명시적 숫자 변경을 검증한다. 추가 테스트로 상태 projection의 정확성, A/B 소유, 원자료 비노출, 후보 불변, classifier의 원문 substring 존재와 schema/enum을 확인할 수 있다. 그러나 원문 substring이 있다는 것이 분류의 의미가 맞다는 증거는 아니다. 카드 참조가 맞거나 정본 keyword를 한 번 썼다는 것만으로 자연어 해석 전체가 충실해지지도 않는다.

자연어에 대한 선택지는 구분해 둔다. 좁은 확정 입력 부정 패턴은 `calendarDate=PROVIDED`일 때 “생년월일을 모른다/입력되지 않았다” 같은 명백한 자기 모순을 탐지하는 회귀 후보가 될 수 있다. 인용, 부정, “생년월일시 중 시각만 미상”은 정상일 수 있어 대조 테스트 없이 넓게 차단하지 않는다. ‘혼자’, ‘필요’, ‘기억’ 같은 단어 blacklist로 타인 심정 확정이나 역방향 왜곡을 보장하려 하지 않는다. 임의의 한국어 문장에 담긴 인과·반대 의미·화자·부정을 완전히 판별하는 deterministic verifier는 현재 제안하지 않는다. 내부 구조화 claim을 추가해 서버 사실과 대조하는 확장은 가능하지만, 모델이 claim은 맞게 쓰고 본문은 틀릴 수 있고 토큰/형식 부담도 늘어나므로 첫 v5 범위에 포함하지 않는다. 형식 오류의 누락 필드를 자동으로 채우거나 실패를 사용자에게 전달하는 방식으로 통과율을 높이지 않는다.

검증은 먼저 로컬에서 한다. 날짜 known/time unknown, 입춘 상관 후보, known time DST fold, provenance가 없는 legacy/component 결과, A/B 서로 다른 상태, raw canary scrub을 검사한다. 카드 projection은 22장 양방향과 모든 위치에서 정본/불변을 확인하고, 의미 회귀는 건강한 고독과 회피·반대 방향·상대 욕구 확정·정상 조건부 조언의 대조 사례로 구성한다. 이는 고정 문구 암기 검사가 아니라 실패를 유발한 의미 구분의 테스트다. M11은 순수 회상, 삭제/정정, 현재 선호, 선천 성향, 복합 명시 타로, 관계 대상이 기억하는지 묻는 문장을 서로 대조한다. 최근 assistant가 사주를 언급했더라도 현재의 회상을 덮어쓰지 않아야 한다. 출생정보 유무 booleans만 바꿔도 회상 분류가 바뀌지 않아야 한다.

모델 검증은 체크포인트 이후 Main이 모델·배포·당일 잔여 한도를 확인한 다음에만 진행한다. 기존 실패 입력을 포함한 작은 대조 묶음을 먼저 동결하고 새 versioned manifest에 원본과 추가 회귀를 구분한다. 36개 focused를 택하면 기존 Qwen 사용량을 Gemma 예산으로 재사용하지 않고 실제 직렬화 요청 크기와 Gemma 요율로 preflight한다. core60/보충24는 ID·본문·기대 의미를 바꾸지 않은 별도 최종 검사로 유지한다. 입력 availability라는 production projection의 추가는 새 prompt/source version으로 기록하며 원래 corpus를 수정한 것으로 숨기지 않는다. 작은 표본이 나아져도 원본 전체 평균≥8, Hard Fail0을 실제 직접 검토하기 전까지 release 품질은 FAIL 상태다. 추가 호출의 구체 한도는 Main의 잔여 사용량 확인 뒤 확정하며 이 계획은 새로운 호출 승인이 아니다.
