# Persona v7 준비 — 실제 호출 0

2026-09-20, Codex AI / fortune_audit. 이 문서는 실제 호출 전의 준비 기록이다. 검사된 v6 checkpoint `b3124e2` 이후 승인된 제안①만 구현했다. 이후 별도 승인된8건의 실제 실행·1차 직접 검토는 [v7 micro8 검토](persona-v7-micro8-review.md)에 기록했다. 아래의 호출0은 준비 시점의 상태이며, 원본 full84의 실패 상태는 유지한다.

## 단일 변경

Tarot provider projection에 `meaningProvenance`와 `selectedDirectionBasisKo`만 추가했다. 전자는 원래 버전·카드 ID·방향·위치 index/key이고, 후자는 모든22장×정역에 같은 함수로 원래 위치 label·카드명·방향 label·선택 keyword 배열을 연결한 한국어 근거문이다. 앞서 보존한 v7 제안의 문장을 그대로 사용했다. 카드별 특수 분기, 새 의미, 새 조언은 없다.

예를 들어 “상대의 마음 / 태도” 위치의 역방향 카드에서는 해당 방향의 원본 키워드를 나열하고, 실제 사람의 심정·행동을 관찰했다는 뜻이 아니라는 동일한 문장을 붙인다. `activeMeaning`, 참조 tuple, 상징 frame, 기존 제약은 그대로다. `JumZipPersona-v7`로 버전만 올렸으며 provider 모델·출력 schema·validator·Persona 스타일·도메인 규칙·원본 의미·벤치 기대는 변경하지 않았다.

`tests/persona/v7-direction-basis.test.ts`의 네 검사는22×2×모든spread 위치의 원본 필드/키워드 연결, 입력 불변, 오염된 복사 의미/근거필드 무시, provider-message 경로 포함, Saju에 Tarot 필드 미추가를 확인한다. 자연어 의미를 자동으로 통과시키는 검사는 아니다.

로컬 확인: domain+Persona **357 PASS, 2 live skips**, 전체 TypeScript PASS, 변경 `.ts`와 `.mts` stdin ESLint PASS, production build PASS. 기존 큰 bundle 경고는 남아 있다. `b3124e2` 대비 domain·provider·validator·Persona config/prompt·원본 core/supplement/focused corpus·동결기대 diff는0이다.

## 기존 8건과 비용

새 `tests/persona/v7-micro8-runner.mts`는 기존 focused24 중7개와 원본 core의 `09-decision-three:SANI`를 그대로 골라 별도 디렉터리 `tests/persona/benchmark-runs/v7-micro8/`에 준비했다. 원본24/84는 수정하지 않았다. 8개 모두 원래 입력 SHA/루브릭이 일치한다. 실행 순서는 A/B swap →10B→s03A→10S→10A→정방향 대비B→위치 교환S→09S다.

`preflight-JumZipPersona-v7-JumZipIntent-v2.json`은 injected transport로 **network0**을 확인하고 전체 요청 bytes·source hashes를 보존한다. `selection-audit.json`은 원래 입력/루브릭 binding, `budget-preparation.json`은 가장 최근 동일 사례의 실제 토큰을 이용한 별도 예측, `review-template.json`은 비어 있는 직접 평가 양식이다. 다른 source가 섞인 선택임을 `JumZipV7Micro8Selection-v1`과 원본 버전 두 개로 구분했다.

| 비용 점검 | neurons |
| --- | ---: |
| 이전 full84의 평균/최대 input token 비율과 평균 출력으로 예상 | 285.77–300.95 |
| 동일 사례의 최신 실측 토큰 비율·출력으로 예상 | 297.13 |
| 위 입력 비율에서 모든 응답이900 output tokens인 경우 | 463.03 |
| 모든 최초 요청의 bytes-as-input-tokens 예약 합계 | 1381.96 |
| 가장 큰 단일 요청의 호출 전 예약 | 205.80 |
| 실측 비율 예측에 따른 순차 호출 중 최대 누적 예약 필요치 | 423.66 |

**450 hard cap을 제안값으로만** 준비했다. 각 호출은 실제 누적 정산액에 입력 bytes-as-tokens+최대900 출력 예약을 더해450 이하일 때만 시작한다. 입력 token 예측 비율로 실제 예약을 줄이지 않는다. 첫 응답이 길거나 repair가 생기면8건 완료 전에 중단될 수 있다. HTTP429·한도 초과·응답 미정산 시 기존 중단·보수 정산 규칙을 유지한다. 전체 output900 가정의463.03도 입력 token 수가 실측 비율과 같다는 가정이므로 절대 상한이 아니다.

현재 계정의 남은 무료 allowance는 이 도구가 읽지 않는다. **Main의 최신 잔액 확인과 별도 live GO 전 실행하지 않는다.** 마지막 사용량이9k 부근이므로 집계 지연·예비분을 포함하면 지금450을 허용할 수 있는지도 별도 판단해야 한다. 이번 작업은 실제모델0·배포0이며, 작은8건이 좋아지더라도 원본84 acceptance를 대체하지 않는다.
