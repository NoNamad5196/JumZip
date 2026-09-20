# Persona-v11 원본84 — 첫 요청429로 중단

상태: **INTERRUPTED_PROVIDER_429 / SEMANTIC_ACCEPTANCE_NOT_EVALUATED**. 모델이 생성한 본문이 없어 의미 점수·평균·Hard Fail 판정은 모두 **null(미평가)**이다. 0점이나 Hard Fail0으로 환산하지 않으며, 품질 PASS도 선언하지 않는다. 이 문서는 Codex AI가 실행 기록을 확인한 중단 보고서다. 원문 직접 평가에 해당하는 `primary-ai-review.json`은 만들지 않았다.

## 실제 관측

`tests/persona/benchmark-runs/v11-full84/`의 manifest/results/provider ledger를 읽어 다음 상태를 확인했다. 실행은2026-09-20 11:16:18 KST(02:16:18 UTC)에 시작했다.

| 항목 | 관측 |
| --- | --- |
| 고정 대상 | 원본 core60 + supplement24, 총84 |
| 후보 | Gemma4 / JumZipPersona-v11 / JumZipIntent-v6 |
| 최초 사례 | `01-first-meeting:BOMI` |
| 실제 HTTP | 초기1회, 수리0회 |
| 응답 | HTTP429, provider body 저장 생략 |
| provider 요청 wall time | 387ms |
| 사례 전체 wall time | 392ms |
| 완료 사례 | 0 |
| 모델 생성 본문 / 전달 응답 | 0 / 0 |
| attempted / pending / neverAttempted | 1 / 84 / 83 |
| completed / stopReason | false / `PROVIDER_QUOTA_OR_RATE_LIMIT` |
| source | 34개, sourceFrozen=true, 변경0 |

최초 사례는 실제 전송 후 `LLM_RATE_LIMITED`, `completionStatus:INTERRUPTED`, `response:null`, `review:null`로 남았다. 완료되지 않았으므로 첫 사례도 pending에 포함된다. 나머지83개는 요청을 준비·전송하기 전에 전체 실행이 중단됐다. 따라서 `notSentRequests:[]`와 neverAttempted83은 모순이 아니다. `notSentRequests`는 준비된 요청이 전송 직전에 차단된 경우의 별도 기록이다.

HTTP 오류에서 즉시 중단했으며 자동 수리나 다음 사례 호출은 없었다. 응답 JSON을 받은 뒤 schema/evidence 검증이 실패한 상황도 아니다. 원문이 없으므로 말투·문맥·도구 의미·자연스러움 등 기존5축을 평가할 수 없고, v11이 v10의 구조 실패나 의미 한계를 해결했는지도 판단할 수 없다. `automaticFlags:[]`는 이 중단을 품질 통과로 바꾸지 않는다.

## 예약 회계와 실제 과금의 구분

실행 상한은3400neurons다. 첫 요청11889 UTF-8 bytes를 입력 토큰으로 간주하고 최대900출력토큰을 더해 **132.628599neurons**를 보수적으로 예약했다.429 응답에는 기록된 token usage가 없어서 이 예약을 회수하지 않았다. ledger의 `neurons:132.628599`, `usageEstimated:true`와 총 `neuronsAccounted`는 **미정산 예약액**이며 실제 과금이나 실제 생성토큰 소비량을 뜻하지 않는다. 실제 과금은 이 artifact만으로는 **알 수 없다**.

이번 중단은 로컬3400 상한의 사전예약 거부가 아니다. provider가 첫 HTTP에429를 반환했다. Main이 직전에 확인했다고 전달한 dashboard5.68k/10k는 별도 UI 관측이며 실행기가 조회하거나 증명한 수치가 아니다. 오류 body를 보관하지 않았으므로 이 기록만으로 일일 quota, 속도 제한, 모델별 용량 등의 원인을 특정하지 않는다. 후속 원인 진단과 재시도 허가는 Main이 별도로 다루며, 이 보고서를 위해 추가 모델 요청은 하지 않았다.

## 원본 보존과 근거

원본84 selection SHA256는 `9426ea84e6c50db265f609567ac241ff7988ff43070913f0623969ec1f844406`이다. 최초 요청 SHA256는 `bc9136c99d9a8d1f4b3971f34a38b78b8baaf22525513c79579b0b673bf5d3d6`이다. 다음 원본을 수정하지 않고 확인했다.

- `results.json`: `a4090112c85c2a24714a8ea182f7f8262d0e1398e8a98b700e3131f2ceb9716e`
- `manifest.json`: `5ddfe882580925eef6ceb48b7ebcd0e885b82fbff2e6157c873a2249207baca1`
- `provider-attempts.jsonl`: `e119c0a5ab92afa0b7a5ec84f0b7cf9cad19611276838e52baec99eb1b10944e`

이 문서만 새로 작성했다. 실행된 runner, runtime, 기존 preparation, 입력·기대값·rubric 및 실행 산출물은 변경하지 않았다. 전체84 acceptance는 미평가 상태로 남으며, v10의 기존 평가 결과를 v11 성공으로 승계하지 않는다.
