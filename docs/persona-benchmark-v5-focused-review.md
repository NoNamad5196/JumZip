# Persona v5 / Intent v2 실제 focused 검토

2026-09-20 KST. 동결한 16개 Persona 응답과 8개 의도 분류를 Gemma 4로 실제 실행했다. **24건 모두 형식 검증에 성공했으나 Persona의 의미 품질은 FAIL이다.** 이 작은 묶음은 원본 core 60개 및 사주 보충 24개의 대체 검사가 아니다. 이전 full84의 실패 판정을 바꾸지 않는다.

원본 실패 ID `10-retry-same-draw:BOMI`, `s03-correlated-boundary:ARANG`, 실제 기억 회상 분류를 첫 세 요청으로 고정했다. 기존 선택 항목의 ID와 입력은 원본 corpus를 그대로 참조했다. 새 대조는 카드 정/역방향, 위치 소유자 교환, provenance가 없는 이전 결과, A/B 교환, 순수 회상, 회상과 명시 타로의 복합 요청이다. initial 18+8 구성은 비용 전망이 한도에 가까워 Main 승인으로 중복 성공 대조 두 개를 제외한 16+8로 동결했다. 처음 26개의 사전 점검은 `draft18-*`로 남겼다.

production v5는 원자료 값을 추가하지 않고 입력 날짜/시각의 presence 상태, 기존 계산 불확실성의 원인, A/B별 상태, 현재 방향의 상징 근거와 대상 정보를 투영했다. Intent-v2는 발화 목적과 최소화된 현재 발화의 연속 인용을 요구한다. 원국 수치·채택 사주 규칙·추첨·카드 의미·기존 원본 corpus와 frozen 기대값·배포 provider 모델은 변경하지 않았다. 이전 snapshot의 NOT_RECORDED는 사용자 미입력이 아니라 상태 기록 부재로 처리한다. 다만 모델이 이 뜻을 항상 지킨 것은 아니다.

실제 실행은 24 HTTP 요청, 수리 0회, **693.897848 neurons**였다. 승인된 800 상한을 지켰고 중단 사유와 미완료 항목은 없다. 각 호출 전에 전체 직렬화 요청의 UTF-8 바이트를 입력 토큰으로 보수적으로 예약하고 최대 출력 비용을 더했다. 실제 usage가 확인되면 그 값으로 대체했고, 없으면 예약을 유지하도록 했다. 배포 변경이나 다른 공급자 호출은 없었다. 실행 전후 canonical-LF source hash는 같았으며 `sourceFrozen=true`다.

모델은 `@cf/google/gemma-4-26b-a4b-it`, Persona는 `JumZipPersona-v5`, 의도 분류는 `JumZipIntent-v2`다. 기존 JSON object+명시 schema, 한 번의 수리, Persona 900토큰/60초+30초, Intent 350토큰/8초+3초, 문서화된 Gemma thinking=false를 유지했다. [공식 요율](https://developers.cloudflare.com/workers-ai/platform/pricing/) 입력 9,091/출력 27,273 neurons per million tokens를 사용했다. 실행 경과 시간이나 형식 성공으로 Edge CPU 한도 또는 의미 품질을 증명하지 않는다.

Codex / fortune_audit(AI)가 응답 16개와 구조화 분류 8개를 모두 직접 읽고 입력과 대조했다. Persona 다섯 축의 점수 합은 **137/160, 평균 8.5625/10**, 확정 Hard Fail은 **2건**이다. 자동 스크립트는 작성된 점수를 합산하고 실제 출력에 연결했으며, 품질 점수를 자동으로 생성하지 않았다. Codex / contracts_audit(AI)의 독립 검토는 **143/160, 평균 8.9375/10**이며 같은 두 확정 실패와 의도 슬롯 오류에 동의했다. 일부 자연스러움·맥락 점수에 차이가 있으나 두 판정 모두 FAIL이다. 점수를 유리한 쪽으로 합치거나 한 평가를 지우지 않고 독립 점수표를 `independent-ai-review.json`에 보존한다.

첫 번째 실패는 `10-retry-same-draw:BOMI`의 “혼자만의 시간이 필요해서 조금 움츠러든 상태일 수 있어”다. 가능성 표현이 추가되었지만 은둔자 역방향의 고립·회피·과도한 폐쇄를 건강한 고독 필요라는 원인으로 바꿨다. `REVERSED` 참조가 정확하거나 “일 수 있다”를 붙였다고 반대 의미가 정확해지는 것은 아니다. 산이·아랑의 같은 항목은 혼자 있을 필요와 회피를 함께 제시하므로, 이전의 보수적 검토 기준과 동일하게 감점하되 추가 확정 Hard Fail로 세지 않았다.

두 번째 실패는 새 `v5-ab-swapped-contrast:SANI`다. A 민수의 목 48.3%, B 사용자의 목 80%, 둘 다 금 0이라는 비율은 맞았다. 그러나 “너도 시각 정보가 없어서 시주는 미상이야”라고 했다. B의 합성 원국에는 시주가 있고, B의 미확정 주 목록은 비어 있으며, compact 자료에도 B 시주의 확정된 상호 십성이 있다. 입력 provenance가 NOT_RECORDED라는 사실을 계산된 시주가 없다는 사실로 바꾼 것이다. 독립 source 검토에서는 A/B 구분이나 원자료 유출 결함을 발견하지 못했고, 실제 모델 응답이 제공된 구조를 잘못 읽었다.

`s03-correlated-boundary:ARANG`은 이번에는 생년월일 정보만으로 원국이 확정되지 않는다고 말해 알려진 날짜를 지웠던 실패를 반복하지 않았다. legacy 대조도 입력 상태 기록이 없는 것과 날짜를 입력하지 않은 것을 정확히 구분했다. 다만 실제 점수 후보 32·37·58 설명을 생략하거나 생년월일시를 통째로 다시 확인하게 하는 응답, 출생 입력 화면 안내 대신 시각을 직접 알려달라는 응답, 카드 해석을 실제 상대의 욕구처럼 말하는 응답이 남아 감점했다.

의도 분류는 **8/8이 schema 검증에 성공했고 목적·추천 도구·모드는 기대와 일치했다.** 프로필 존재 여부를 달리한 두 순수 회상은 모두 RECALL/small_talk의 정상 무추천이었다. 기억 관리·현재 선호도 무추천, 선천 기질 질문은 SAJU/NATAL, 긍정적 타로가 포함된 복합 질문과 상대가 나를 기억하는지 묻는 질문은 TAROT, 기억 거부와 오늘 운세 요청은 TAROT/DAILY로 이어졌다. 이 null 응답들은 파싱 실패의 fail-soft null과 구분해 기록했다.

그러나 모든 추출 필드가 정확한 것은 아니다. `v5-intent-recall-explicit-tarot`는 “이번 주 모임에서 먼저 인사할지”라는 질문에 `choicesPresent=true`를 반환했다. 명시적으로 서로 다른 선택지 두 개가 제시되지 않아 슬롯 증거가 부족하다. 해당 행렬 경로의 추천 도구·모드에는 영향을 주지 않았지만, 목적/도구 8/8을 전체 필드 무오류로 확대하지 않는다. 전 필드의 근거까지 충족한 분류는 7/8이다.

증거는 `tests/persona/benchmark-runs/v5-focused/`에 있다.

- `results.json`, `provider-attempts.jsonl`, `manifest.json`: 실제 합성 원문, usage, 지연시간, 요청 hash, 실행 전후 source hash. 비밀 키·계정 인증정보·HTTP 오류 본문은 기록하지 않았다.
- `selection.json`, `review-template.json`: 동결 선택과 한국어 빈 rubric. 실제 평가는 빈 template를 덮어쓰지 않고 별도 파일로 작성했다.
- `primary-ai-review.json`, `independent-ai-review.json`: 검토자의 AI 귀속, 실제 원문/구조화 출력 연결, 원본 hash, 점수와 근거.
- `preflight-JumZipPersona-v4-JumZipIntent-v1.json`, `preflight-JumZipPersona-v5-JumZipIntent-v2.json`: 준비 단계와 실제 source 단계의 비용 차이. v5 예상 742.64–778.39는 실제 비용 보장이 아니었다.

별도로 원본 full84의 비용만 새 `tests/persona/v5-full84-preflight.mts`로 계산했다. 이 파일에는 live mode나 실제 fetch 경로가 없고 자격증명을 읽지 않는다. `tests/persona/benchmark-runs/v5-full84-preparation/preflight.json`의 전망은 동일 항목의 이전 입력비율·출력 길이 기준 2,639.82 neurons, 이전 최대 입력비율 적용 2,766.68, 20% 여유 3,167.79다. 응답 길이·수리 발생은 달라질 수 있으므로 보장이나 호출 승인이 아니다. **full84는 추가 실행하지 않았다.** 이번 실패 기록을 보존하며 추가 production 수정·모델 교체·평가기준 완화는 하지 않는다.
