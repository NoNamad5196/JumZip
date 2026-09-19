# v6 이후 방향 근거 강화 제안 — 구현·실행하지 않음

2026-09-20, Codex AI / fortune_audit의 소스·실출력 읽기 전용 조사. v6 micro3에서 은둔자 반대 방향 설명이 남았으므로 추가 호출을 중지했다. 아래는 다음 승인 판단을 위한 설계이며 production 코드·원본 의미·corpus·기대값을 변경하지 않았다.

## 확인된 구조와 남은 가설

1. `persona/tool-facts.ts`는 이미 카드 ID, 한국어 이름, 정/역 방향, 위치, 선택 방향의 `activeMeaning` 전체, 상징/관찰 구분을 제공한다. v6은 모든 카드의 공통 조언을 제거했다.
2. `llm/provider.ts` 응답 schema와 `llm/validator.ts`는 `text` 및 `toolReferences`를 받는다. Tarot의 deterministic 검증은 ID/방향/위치 tuple의 일치다. 본문의 해석이 선택 방향의 의미를 실제로 사용하는지는 검사하지 않는다.
3. micro3 `10:BOMI`는 올바른 tuple을 반환하면서 반대 방향의 원인 설명을 했다. JSON 참조 복사가 해석의 의미 충실성을 보장하지 않는다는 실제 반례다.
4. 현재 선정되어 system에 실리는 Persona 예제에는 Tarot 해석 예제가 없다. BOMI의 쉬운 말·짧은 설명 성향이 의미를 과도하게 완곡하게 바꾸는지, 카드 이름의 사전 학습 의미가 선택 방향 배열보다 우선되는지는 **가설**이다. 내부 원인을 확인했다는 주장은 하지 않는다.

## 제안 1: 방향과 위치를 연결한 서버 생성 근거문

22장×2방향에 동일한 순수 함수를 적용해 다음 기존 필드만 조합한다.

```text
[원래 위치 label]의 [원래 이름] [선택 방향 label]에서 제공된 상징 키워드는 [선택 방향 keyword 배열]이다. 이는 실제 심정·행동을 관찰한 사실이 아니다.
```

예를 들어 은둔자 하나의 정답 문장을 쓰지 않고, 어느 카드든 같은 형식으로 `positionLabel + nameKo + orientationLabel + activeMeaning`을 잇는다. 새 해석·동의어·긍정/부정 판정·행동 권고를 생성하지 않는다. `meaningVersion/cardId/orientation/positionIndex`로 원본 row를 추적한다. 같은 정보가 목록의 떨어진 필드로만 존재할 때보다 선택 방향을 하나의 명시적 근거로 읽게 한다는 가설이다.

처음에는 provider projection만 변경하는 독립 단계가 적절하다. model/schema/Persona style을 동시에 바꾸면 실패 감소의 근거가 불명확해진다. 원래 키워드 배열을 유지하면서 새 문장을 추가할지 중복을 대체할지는 토큰 사전 점검과 기존 소비자 사용처를 확인해 결정한다. 이름·방향을 임의로 숨기거나 예제 기대값을 바꾸는 방식은 이 제안에 포함하지 않는다.

구체적인 provider 전용 제안 필드는 `meaningProvenance: {meaningVersion, cardId, orientation, positionIndex, positionKey}`와 `selectedDirectionBasisKo`다. [44개 canonical mapping과 5개 payload 예시](evidence/persona-v7-direction-projection-proposal.json)에 원본 파일의 LF 정규화 SHA와 함께 기록했다. 22개 카드 각각의 upright/reversed 배열을 그대로 참조했으며 카드별 분기나 새 의미는 없다. 예시로 고정한 THEIR 위치에서 문장 최대 크기는 UTF-8 268 bytes/112자다. 이는 실제 prompt 전체나 token/요금의 예측이 아니다.

로컬 검증은 모든22장×정역×spread 위치에 대해 근거문에서 원본 배열·방향·위치가 정확히 일치하고, 현재 입력을 mutate하지 않으며, 공통 advice와 반대 방향 배열이 다시 들어오지 않는 것을 확인한다. 원본 대비 card reference·draw·도메인 결과가 그대로임을 검사한다.

## 제안 2: 필요할 때만 내부 응답에 의미 근거 연결

1단계가 실패하면 같은 금지문을 늘리는 대신, 모델이 각 카드 설명에 선택한 원본 keyword와 본문의 해당 span을 연결하도록 하는 **내부** 구조를 별도 평가할 수 있다.

```text
positionIndex → keywordIndex(해당 activeMeaning 배열의 index) → textEvidence(최종 text에 실제 존재하는 짧은 원문)
```

서버가 카드별 선택 방향을 이미 알고 있으므로 모델이 임의 `orientation`을 새로 선언해 근거로 삼게 하지 않는다. 잘못된 index/없는 카드/누락된 카드/다른 위치/본문에 없는 span은 deterministic하게 거절할 수 있다. 선택된 한국어 keyword가 해당 span에 실제 들어가는 제한도 기술적으로 검증 가능하다. 이 내부 근거는 저장된 draw나 외부 API 카드 구조를 바꿀 필요가 없지만, provider schema/repair 비용·동일 카드 재해석 흐름은 별도 검증해야 한다.

**한계:** 단어 하나를 넣고 “고립은 맞지만 상대는 혼자만의 시간이 꼭 필요하다”처럼 반대 원인을 붙일 수 있다. 문자 포함·원본 index·span 일치만으로 논리나 의미를 보증하지 못한다. keyword가 들어간 부정문·인용문과 실제 주장도 기계적으로 완전히 구분하지 못한다. 자동 점수를 semantic PASS로 승격하지 않고 기존 직접 읽기와 Hard Fail 기준을 유지해야 한다. 반대 방향 키워드를 전부 금지하는 규칙은 정/역 비교 질문과 공통 키워드를 잘못 막을 수 있어 제안하지 않는다. 요청한 쉬운 설명에서 원본 전문용어를 강제로 반복하는 자연스러움 저하도 검토 대상이다.

## 소규모 회귀 설계안

기존 v5 focused24 파일과 원본84는 유지한다. 별도 사전 점검 후 승인받은 경우 아래8건을 *부분 검증*으로 사용할 수 있다. 입력·기대·Hard Fail은 기존 것을 그대로 쓴다.

| 사례 | 확인 목적 |
| --- | --- |
| `10-retry-same-draw:BOMI` | 반복 재현된 역방향 오류, 같은 draw 재해석 |
| `10-retry-same-draw:SANI` | 같은 카드·다른 Persona에서 혼합된 반대 의미가 남는지 |
| `10-retry-same-draw:ARANG` | 정중한 설명에서도 방향을 유지하는지 |
| `v5-hermit-upright-contrast:BOMI` | 역방향 오류를 막으려다 정방향 성찰까지 회피로 바꾸지 않는지 |
| `v5-reversed-owner-contrast:SANI` | 역방향 카드가 YOUR 위치로 바뀌면 대상을 정확히 바꾸는지 |
| `09-decision-three:SANI` | 은둔자 외 역방향 악마의 RISK 위치; 원본 `persona/benchmark.ts`에서 실제 ID를 확인 |
| `s03-correlated-boundary:ARANG` | 알려진 날짜/미상 시각·32/37/58·용신 후보 회귀 |
| `v5-ab-swapped-contrast:SANI` | 이번에 개선된 A/B 계산 coverage가 유지되는지 |

새 ID로 기존 결과를 덮지 않는다. 예산 숫자는 아직 승인·예약하지 않았다. 다음 소스가 구체화되면 요청 bytes, 출력 상한, repair를 포함한 기존 conservative reserve로 **0-network preflight**부터 다시 계산한다. 작은 묶음이 좋아져도 그것으로 원본84 acceptance를 대체하지 않는다. 현재 잔액 보존을 위해 추가 실모델 호출은 0이다.
