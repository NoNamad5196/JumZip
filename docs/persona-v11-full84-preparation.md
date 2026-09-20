# Persona-v11 원본84 실행 준비

상태: **PREPARED_NOT_EXECUTED**. 모델 요청0, 자격증명 읽기0, 배포0. Main의 최신 계정 사용량 확인과 별도 live GO 전에는 실행하지 않는다.

`tests/persona/v11-full84-preflight.mts`와 `v11-full84-runner.mts`는 실행된 v10 pair를 별도 파일로 복사했다. Persona-v11 / Intent-v6, 새 artifact 경로와 환경 guard, Main이 지정한 **3400neurons** 상한만 적용했다. v10 micro와 현재 source가 같아야 한다는 이전 조건은 역사적 비용 참고로 명시적으로 분리했다. 새 v11 자체34 source의 사전·사후 LF hash는 일치한다. 이전 executed runner와 결과는 바꾸지 않았다.

## 동일한 원본과 실제 provider 계약

- 원본 core20×3=60 뒤 supplement8×3=24를 원래 순서로 사용한다. `v7-full84-preparation/selection.json`과84개 ID·입력 hash·reviewChecks가 완전히 같다.
- `benchmark-runs/v11-full84/{preflight,selection,review-template}.json`을 배타 생성했다. 기존5축0–2, 평균8이상·Hard Fail0을 유지하고 core/supplement를 따로 판단한다. 검토자와 점수는 비어 있다.
- 후보 모델은 기존 Gemma4이며 provider의 실제 `thinking=false` 요청을 assertion한다. 운영 기본 모델을 변경하지 않는다.
- JSON object,900출력,초기60초/수리30초,최대1회 수리,128000bytes,최대168HTTP 그대로다. 실제 source schema와 provider를 사용하고 사전 점검의 transport만 injected double이다.
- 기본 runner는 `PLAN_ONLY`다. 실행에는 `--execute`, `JUMZIP_RUN_V11_FULL84=LIVE`, `JUMZIP_V11_FULL84_USAGE_GO=FRESH_USAGE_CONFIRMED` 모두 필요하다. 환경값은 실제 Main 승인을 대신하지 않는다.

## 비용과 중단

기존에 검증한 요율 입력9091/출력27273neurons per million tokens를 사용했다. 새 가격 조회나 계정 요청은 하지 않았다. 모든 비용 수치는 과거 관측을 현재 요청 bytes에 적용한 **추정**이며 상한이나 완료 보장이 아니다.

| 시나리오 | neurons |
| --- | ---: |
| 과거 v10 micro 동일 ID/동일 계약 기준 초기84 추정 | 2950.53 |
| 초기 추정 + 과거 Tarot 수리율·수리비 외삽 | 3220.10 |
| 관측 최대 입력 비율 + 모든 응답900출력, 수리 제외 | 4751.46 |
| 초기 추정 사용량에서 순차 예약 peak, 수리 제외 | 3092.42 |
| 가장 큰 단일 초기 예약 | 294.52 |
| Main이 지정한 hard cap | **3400** |

v10 micro는 v11의 새 canonical repair hint 이전 자료다. `microEvidence.historicalOnly=true`, `sourceMatched=false` 및 실제 source 차이 목록으로 이를 보존했다. 과거 수리비 외삽은 새 힌트로 늘어난 입력이나 다른 수리 횟수의 상한이 아니다. 실제 v10 full84의2945.90neurons도 다음 실행 비용을 보장하지 않는다.

각 초기/수리 직전에 직렬화한 UTF-8 bytes 전체를 입력 토큰으로 보고900출력을 더해 예약한다. 실제 usage로 정산하고 불명 사용량은 예약을 유지한다. `accounted + nextReserve > 3400`이면 전송하지 않으며,3400 안에84개를 끝내지 못하면 그대로 중단·보존한다.429/transport/timeout도 중단한다. 예약보다 실제 usage가 크면 추가 요청을 중단한다. 유료 전환이나 quota 우회는 없다.

## 보존·검증

정확한 Cloudflare account AI 목적지 guard, `redirect:error`, 원본 selection/rubric/source/body hash 대조, `wx` run lock와 final report, append-only raw/progress ledger를 v10에서 그대로 사용한다. 비밀·헤더·임의 오류 body는 기록하지 않는다. 초기 전송 전 중단은 `notSentRequests`/pending에 남고 actual attempts에 세지 않는다. 초기 후 수리 전 중단은 INTERRUPTED와 pending으로 보존한다. 생성 완료와 의미 통과를 구분하고 직접 전체 검토 전 PASS를 만들지 않는다.

로컬 Persona319 tests PASS/2 opt-in SKIP, 전체 TS, runtime/tests 및 새 `.mts`의 scoped ESLint, 별도 `test-results/v11-build` Vite build가 통과했다. 84개 injected request를 만든 preflight는 network0/sourceFrozen=true다. 기본 PLAN_ONLY 요청0, 잘못된 인자 거부, live opt-in 누락 거부, 기존 preflight 덮어쓰기 거부, 새 runner EOF 한 줄바꿈도 검사했다.

source LF SHA256:

- preflight: `f599d02f8c58b523fd1e77a9b79c228b9554769be68bf59bf16f479f6bba3b0c`
- runner: `deb21a9a965e1d5d040a30e4099ec3a8c87e87de64373404b2e54a1e7f9ed9f7`

v11 수리의 canonical 표는 모델이 고를 원본 선택지이며 서버가 evidence를 채워 주지 않는다. 올바른 keyword/index/span과 잘못된 해석 원인이 함께 있으면 구조 검사를 통과할 수 있다. 이 한계와 원본 Hard Fail 기준은 그대로다.
