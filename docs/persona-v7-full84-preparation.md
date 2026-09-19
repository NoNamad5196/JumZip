# v7 원본84 실행 준비 — 실제 요청0

2026-09-20, Codex AI / fortune_audit. 이 작업은 현재 남은 무료 사용량을 소비하지 않는 준비다. **09시 KST(00시 UTC) 무료 초기화 확인, 독립 v7 micro8 검토, Main의 full84 및 예산 GO 전에는 실행하지 않는다.** micro8 결과나 소스는 수정하지 않았다.

후속 상태: 독립 micro8 검토가9.25/HF1로 끝나 Main이 v7 **FAILED**를 유지했다. 따라서 reset만으로 이 준비가 실행 승인으로 바뀌지 않는다. 알려진HF가 남은 현재 full84 실행은 보류하고, 준비를 동결한다.

## 원래 순서와 평가 계약

기존 `runPersonaBenchmark`와 `runSajuSupplement`를 그대로 재사용한다. core20개×BOMI/SANI/ARANG=60건을 먼저 실행하고, supplement8개×같은 세 Persona=24건을 이어 실행한다. 과거 원본 full84의 ID 순서와 정확히 일치한다. corpus/기대/루브릭·카드·점수·규칙을 변경하지 않았다. core60과supplement24의 원래 report 및 assessment 형식을 유지한다.

새 실행기 `tests/persona/v7-full84-runner.mts`는 최근 micro8에서 사용한 동기적 예약·응답 크기 제한·사용량 정산 경로를 재사용했다. 오래된 full84 실행기의 비동기 capture 완료 전 repair가 시작될 여지를 그대로 복사하지 않았다. 코드의 모델은 기존 시험 Gemma4, 출력900 tokens, 초기60초/repair30초, JSON object+schema, thinking false로 같다. production provider 전환은 없다.

`tests/persona/v7-full84-preflight.mts`는 이전 full84 사전 계산기를 별도 파일로 재사용한 **실행 경로가 없는 zero-network 도구**다. provider에 injected transport를 넣어 실제 요청 payload만 만들고 로컬 응답을 반환한다. credential을 읽지 않는다.

## 파일과 소스 동결

준비 경로는 `tests/persona/benchmark-runs/v7-full84-preparation/`이다.

- `preflight.json`:84개 요청 ID·payload bytes/hash·원래 순서·모델 옵션·source raw/LF hashes.
- `selection.json`:core60/supplement24 각각의 입력 hash와 원래 reviewChecks.
- `review-template.json`:84개 빈5축 평가 양식. 점수·Hard Fail·직접 읽은 원문은 아직 없다.
- `budget-proposal.json`:호출 순서별 보수 예약과 예측 비용, preflight hash binding.

미래 실제 출력은 별도 `tests/persona/benchmark-runs/v7-full84/`에 저장하도록 준비했다. 현재 실제 결과·manifest·raw파일은 없다. 하나라도 기존 실행 artifact가 있으면 재실행을 거부해 덮어쓰지 않는다. 매 호출의 합성 원문·usage·예약액과 진행 상황을 남기며, 완료 시 core/supplement reports와 전체manifest를 보존한다.

hash 범위는 domain/persona/llm에서 별도 background memory를 제외한 실제 해석 관련 소스와 원래 supplement corpus/runner, 새 full84 preflight/runner다. Frontend·migration 파일은 제외한다. live 시작 시 가장 최근 zero-network preflight와 LF 정규화 hash가 같아야 하며, 끝에서도 다시 비교한다. 검사된 초기 source를 유지하지 못하면 실행 전에 새 preflight가 필요하다.

## 비용 및 예약 제안

Gemma4 공식 단가 input9091/output27273 neurons per million tokens를 사용한다. 과거 같은 원본84의 실측을 각 사례의 새 payload bytes에 비례시킨 예상이며 tokenizer/요금 상한이 아니다.

| 항목 | neurons |
| --- | ---: |
| 같은 사례의 이전 input 비율·출력 길이로 예상 | 2731.17 |
| 최대 이전 input 비율·평균 출력으로 예상 | 2862.37 |
| 첫 예상에20% 계획 여유를 추가 | 3277.40 |
| 모든 출력900·최대 이전 input 비율 가정 | 4729.31 |
| 최초84요청의 bytes-as-token 예약 합계 | 13261.17 |
| 가장 큰 단일 요청의 보수 예약 | 294.52 |
| 동일 사례 예측에 따른 순차 진행 중 최대 누적 예약 필요치 | 2873.89 |

**3500 neurons를 제안 hard cap**으로 준비했다. 단순히 전체 예약 합계를 upfront 소비하는 방식은 아니다. 각 호출 직전에 실제 정산된 누적 사용량+해당 요청 bytes-as-input-tokens+최대900 output 예약이3500 이하인지 검사하고, 통과한 예약을 **I/O 전에 공제**한다. 실제 provider usage를 받으면 해당 예약을 실측값으로 바꾸고, usage가 없으면 전액 유지한다. repair도 별도 같은 검사를 받는다. HTTP429/한도 초과/transport 실패는 중단하며 원문HTTP오류body나credential은 기록하지 않는다. 최대168HTTP다.

3500은 완주 보장이 아니다. 긴 출력이나 repair가 많으면 중단될 수 있으며 완료하지 못한 ID와 오류 항목을 남긴다. 더 높은 ceiling으로 자동 전환하지 않는다. 현재 잔액 약650으로 이 실행을 시작하려는 제안이 아니며, 그 잔액은 Main의 운영 회귀 검증용으로 보존한다.

## 로컬 확인과 이후 조건

84개 local payload 생성·canary검사·ID순서 대조·sourceFrozen 확인에 성공했다. TypeScript와 두 `.mts` 파일을 `.ts` stdin으로 검사한 ESLint도 PASS다. live 실행기는 opt-in 없이 호출하면 endpoint/credential 처리 전에 `V7_FULL84_RESET_REVIEW_AND_MAIN_GO_REQUIRED`로 거부되는 것을 확인했다. 이 거부 검사도 실제 요청0이다.

실행기는 `JUMZIP_RUN_V7_FULL84=LIVE`와 `JUMZIP_V7_FULL84_PREREQUISITES=RESET_AND_REVIEW_CONFIRMED` 두 명시적 marker가 있어야 진행한다. 이는 실제 Cloudflare reset이나 독립 리뷰를 자동 확인하는 도구가 아니다. Main이 세 조건을 실제 확인하고 승인한 뒤에만 설정해야 한다. 현재는 준비를 동결하고 기다린다. 실행이 끝나더라도 84개 원문을 직접 검토하기 전에는 품질 PASS를 표시할 수 없다.
