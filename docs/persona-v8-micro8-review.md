# Persona v8 micro8 실제 실행 검토

**결과는 실패·미완료다.** 선정8개 중 실제 전송7개, 사용자에게 전달 가능한 응답4개, 두 번의 구조 검증을 모두 실패한 응답3개, 예산으로 전송하지 않은 응답1개다. 원본 core60+supplement24 품질 검사를 대체하지 않는다.

검토자: **Codex / fortune_audit, AI 직접 원문 검토**. 유효4개 본문과 고정 입력을 직접 대조해 원래 다섯 축을 각0~2점으로 평가했다. 무효3개는 점수 `null`, 미전송1개도 `null`이다. 구조 체크가 자동으로 의미 품질 점수를 부여하지 않는다. 프로덕션 수정과 추가 모델 호출은0회다.

## 실행 사실과 원문 연결

- 실제 모델: `@cf/google/gemma-4-26b-a4b-it`, Persona-v8, Intent-v3. 이 묶음은 reply만 검사하므로 Intent-v3 의미 분류 평가 결과는 없다.
- [results](../tests/persona/benchmark-runs/v8-micro8/results.json), [provider 원문10개](../tests/persona/benchmark-runs/v8-micro8/provider-attempts.jsonl), [실행 manifest](../tests/persona/benchmark-runs/v8-micro8/micro-manifest.json)는 변경하지 않았다.
- [primary AI review](../tests/persona/benchmark-runs/v8-micro8/primary-ai-review.json)에 각 입력 SHA, 정확한 검토 본문·segments·본문 SHA, provider 원문 행·요청 SHA·JSON 원문 SHA를 연결했다. 현재 고정 corpus로 생성한8개 입력 hash가 selection과 모두 일치한다.
- 실제 HTTP10회는 모두200, `finish_reason=stop`이다. 출력 tokens는86~369로900 상한에 닿은 요청이 없다. 토큰 길이·timeout·실제 provider429 때문에 실패한 사례는 없다.
- 사용량은 **429.522477 neurons**. 이 중 실패한 repair3회의 합은136.810459다. 비용은 실행기의 공식 token 요율 계측이며 추정 예약과 구분한다.

| 항목 | 수 |
| --- | ---: |
| 선정 사례 |8|
| provider에 실제 보낸 사례 |7|
| 전달 가능한 응답 |4|
| initial+repair 모두 무효 |3|
| 전송 전 예산 중단 |1|
| provider HTTP |10|
| repair 시도 / 성공 |3 /0|
| 유효 Tarot / 실제 전송 Tarot |2 /5|
| 유효 DEFAULT / 실제 전송 DEFAULT |2 /2|

## 전달 가능한 응답의 직접 평가

축 순서는 Persona / 자연스러움 / 맥락 / 도구 충실도 / 간결함이다. 유효 응답만의 합은 **34/40, 평균8.5/10**, 해당4개의 확정 의미 Hard Fail은0이다. 이 수치를 전체8개 평균이나 acceptance PASS로 사용하지 않는다.

| 사례 | 점수 | 판단 |
| --- | --- | --- |
|A/B 교환 SANI|2/2/2/2/2 =10|민수의 목48.3%, 사용자의 목80%, 민수만 시주 미상이고 사용자는 시주 확인됨을 정확히 구분했다.|
|s03 ARANG|2/2/1/1/2 =8|시각 미상·후보 점수/용신·현재 대운 미확정을 보존했다. 제공된 날짜까지 다시 요구하고, 실제 후보37/58/32·FIRE/METAL 설명을 생략했다.|
|10 같은 추첨 SANI|2/2/1/1/2 =8|역방향 은둔자를 고립/회피로 설명했다. 이전의 “혼자만의 시간이 필요하다”는 반대 대안은 없다. 다만 상대의 실제 상태와 카드의 상징을 더 분명히 구분해야 한다.|
|은둔자 정방향 BOMI|2/2/1/1/2 =8|성찰/거리두기와 나·상대·관계 흐름의 위치를 유지했다. 실제 상대에게 필요한 욕구처럼 해석하는 경계가 여전히 약하다.|

s03의 “생년월일시를 다시 한번 확인” 요청은 불필요하지만, 과거처럼 **생년월일이 없다고 단정한 문장**은 아니다. 기존 같은 기준에 따라 감점과 `KNOWN_BIRTH_DATE_ERASED` Hard Fail을 구분했다. Tarot의 조건부 상대 상태 설명도 개선 대상이지만, 이번 유효 응답에는 정반대 방향의 필요성 설명이나 확정적인 마음 보장은 없다.

독립 검토자가 전달한 결과는 유효4개 **38/40, 평균9.5, Hard Fail0**이다. primary와 독립 점수 차이는 보존한다. primary는 s03의 입력 재요구와 Tarot의 현실/상징 경계를 더 엄격히 감점했다. 어느 평균도 구조 실패3개와 미전송1개를 없애지 않으며, 전체 결과는 실패·미완료다.

## 무효 응답별 실제 원인

검증기에 원문을 다시 넣어 아래 issue를 재현했다. 새 서버 응답을 생성하거나 원문을 고쳐 통과시키지 않았다. 아래는 **차단된 원문**의 진단이며 사용자에게 전달된 해석으로 점수화하지 않는다.

| 사례·시도 | finish / output tokens | 구조 실패 |
| --- | --- | --- |
|10 BOMI initial|stop /369|evidence5개로 상한3을 넘고 위치1·2를 중복했다. 실제 반환 issue는 `TAROT_EVIDENCE_SHAPE_INVALID`; 배열 상한에서 먼저 반환하므로 중복 위치 issue는 별도로 나오지 않는다.|
|10 BOMI repair|stop /327|3개로 묶었지만 `고립, 회피`, `조율, 균형`이 본문에 없는 조합이다. `TAROT_EVIDENCE_SPAN_MISSING`.|
|10 ARANG initial|stop /212|본문의 `고립이나 회피`, `조율과 균형`을 evidence에서는 쉼표로 합성했다. `TAROT_EVIDENCE_SPAN_MISSING`.|
|10 ARANG repair|stop /212|같은 본문과 잘못된 evidence를 반복했다. 동일 issue.|
|역방향 소유자 교환 SANI initial|stop /337|본문의 `고립이나 회피`, `연결이나 끌림`, `조율이나 균형`을 쉼표 조합으로 바꾸었다. `TAROT_EVIDENCE_SPAN_MISSING`.|
|역방향 소유자 교환 SANI repair|stop /337|같은 본문과 evidence를 반복했다. 동일 issue.|

원본 keyword나 카드 tuple이 틀려서 생긴 오류가 아니다. 모델이 **정확한 본문 인용**을 키워드 목록 요약으로 취급했다. BOMI repair는 배열 수만 고친 뒤 같은 요약 방식을 택했다. 성공한 Tarot 두 사례는 카드마다 keyword index하나와 실제 본문에 있는 짧은 한 단어를 제출했다. 관측된 차이일 뿐, 한 keyword만 강제하면 의미 품질이 보장된다는 증거는 아니다.

## 마지막 사례의 예산 중단

`09-decision-three:SANI`는 실제 요청을 보내지 않았다. 누적429.522477에 다음 요청의 보수 예약177.047225를 더하면 **606.569702 >600**이다. 잔여170.477523으로 예약을 충족하지 못해 guard가 전송 전에 중단한 것은 의도된 동작이다. 상한이나 예약을 완화하지 않는다.

원본 `results.json`의 `LLM_RATE_LIMITED`는 로컬 예산 오류의 내부 매핑이다. 실제 provider429가 아니다. 원본 manifest의 `pendingIds=[]`는 결과 entry 유무로 계산하면서 전송 전 차단 entry를 이미 처리한 항목으로 센 기록상의 한계다. 원본은 보존하고 다음 근거로 실제 미전송을 구분한다.

- manifest requests11개 중 마지막은 사전 요청 기록뿐이다.
- provider-attempts는10개이며 해당ID가 없다.
- `completed=false`, `stopReason=LOCAL_BUDGET_OR_ATTEMPT_CAP`이다.
- primary review에 별도 `reviewDerivedNotSentIds`를 기록했다.

## 다음 변경 제안 — 아직 구현하지 않음

1. **generic repair의 진단을 구체화한다.** 고정 issue에 내부 field path·배열 상한·위치 중복·exact substring 실패를 연결한다. “카드당 한 항목, 본문의 짧은 연속 구절을 그대로 복사하고 단어를 쉼표로 합치지 않는다”는 조건을 실제 실패에 맞게 안내한다. 원래 본문은 이미 repair 입력에 있으므로 개인정보를 더 실을 필요가 없다.
2. 예시가 필요하면 실제 runtime의 선택 방향 keyword와 위치를 사용해 일반적으로 구성한다. 특정 실패 카드나 benchmark 문장을 정답으로 하드코딩하지 않는다. 검증을 약화하거나 서버가 모델 대신 evidence를 만들어 통과시키지 않는다.900tokens와 repair1회는 유지한다.
3. 다음 runner에서는 준비된 요청과 실제 provider 전송을 나눈다. 전송 전 예산 차단 항목을 `pending/notSent`에 남기고, 실제 시도한 응답처럼 집계하지 않는다. 기존 v8 원본 기록·corpus·기대값은 변경하지 않는다.

exact keyword/span이 있어도 반대 원인·부정문·타인 마음 단정이 구조 검사를 통과할 수 있다는 기존 반례는 유효하다. 구조 repair가 개선되어도 원본 의미 Hard Fail 기준과 core60+supplement24 검토는 그대로 필요하다. 이번 결과만으로 full84 확대나 배포 품질 통과를 주장할 수 없다.
