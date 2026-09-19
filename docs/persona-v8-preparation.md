# Persona v8 구현 및 실행 준비

2026-09-20, Codex AI / fortune_audit. **실모델 요청0, 배포0, Secrets·선택 모델 변경0.** Main의 checkpoint b731b5595d9e694e7d66021439fde8906a422f37 이후 승인된 내부 Tarot evidence 계약을 구현했다. v7 micro8의 독립 HF1과 기존 FAILED 판정은 그대로다. v8 의미 품질은 아직 검증하지 않았다.

## 구현 범위와 확인

`llm/chat-contract.ts`의 고정 enum으로 DEFAULT/TAROT_EVIDENCE_V1을 선택한다. 서버 cards가 있는 요청만 선택 방향 keyword index와200자 이하의 실제 본문 구절을 요구한다. 일반 Chat/Saju의 두 키 schema와 공통 지시 문자열은 checkpoint와 동일하다. initial/repair에 같은 schema를 보내고, Tarot evidence가 없으면 자동으로 채우지 않고 한 repair 후 실패한다. 검증 결과에서 내부 evidence를 제거해 공개 응답·DB 계약은 유지했다.

22장×정역×3위치132조합, 카드 한 장 후속 질문, 비점술의 빈 배열, invalid index/span/position, provider byte cap·timeout·900token, exactly-one repair, 공개 응답 strip을 검증했다. 반대 원인과 올바른 keyword가 섞인 문장은 구조 검사를 통과할 수 있다는 반례도 유지한다. 빈 evidence 우회·부정문·사람 대상의 의미 일탈까지 deterministic하게 증명하지 못한다. 자세한 계약과 한계는 [persona-v8-contract.md](persona-v8-contract.md)에 있다.

Cloudflare Gemma4 시험과 운영 요청이 달랐던 부분도 Main 승인으로 맞췄다. [공식 예제](https://developers.cloudflare.com/workers-ai/get-started/workers-wrangler/)에 따른 `chat_template_kwargs.enable_thinking=false`를 exact 모델·HTTPS Cloudflare account API에만 적용한다. [모델 문서](https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/)에도 해당 parameter와 compatible endpoint가 있다. 다른 endpoint/Qwen은 불변이다. 새 v8 wrapper는 주입 대신 provider가 만든 옵션을 assert하며 역사적 v4~v7 소스/증거는 그대로다. 실제 createExecutor→Persona→provider→주입 fetch 경로를 로컬 테스트했고, 모델을 바꾸거나 배포했다는 뜻은 아니다.

최종 로컬 검증은 domain+Persona **443 PASS/2 live skip**, provider/evidence/runtime 집중 **58 PASS**, 전체 TypeScript·소유 파일 ESLint·신규 `.mts` stdin ESLint·Vite build PASS다. build의 기존 큰 청크 경고는 남는다. 실제 모델 출력이나 의미 품질 PASS로 세지 않는다.

## 변경하지 않은 평가 입력과 산출물

새 micro8은 v7의8개 사례를 같은 순서로 사용한다. v5의24개 및 원본84를 대체하지 않는다. 새 full84는 기존 core20×3을 먼저, supplement8×3을 뒤에 실행하도록 기존 runner를 재사용한다. 양쪽 모두 이전 selection의 **입력 hash·순서·reviewChecks 동일**을 검증했다. 모든 rubric 점수와 Hard Fail은 아직 미작성이다.

- `tests/persona/benchmark-runs/v8-micro8/`: selection, 빈 review template, Persona-v8/Intent-v3 preflight, budget-preparation.
- `tests/persona/benchmark-runs/v8-full84-preparation/`: 원본84 selection, 빈 review template, preflight, budget-proposal.
- `tests/persona/v8-micro8-runner.mts`: 별도600 cap 실행기. 현재 실제 results/raw/manifest 없음.
- `tests/persona/v8-full84-preflight.mts`: live 경로 없는 사전 계산기.
- `tests/persona/v8-full84-runner.mts`: 미래 결과를 별도 v8-full84에 저장하는 실행기. 현재 실행 결과 없음.
- `tests/persona/v8-budget-preparation.mts`: 이전 실측과 새 preflight만 읽는 추가 예산 계산. provider/credential 접근 없음.

Preflight는 실제 provider에 injected transport로 만든 요청을 사용하며 외부 네트워크를 호출하지 않는다. Tarot schema도 실제 initial과 동일하게 선택한다. micro8 중6개, 원본84 중18개가 TAROT_EVIDENCE_V1이고 나머지는 DEFAULT다. canary 유출0 및 sourceFrozen=true다. domain/persona/llm(별도 background memory 제외)와 관련 corpus/runner의 raw·LF 정규화 SHA를 보존한다. 최종 Intent-v3 소스도 포함한다. 실제 호출 전 preflight와 source hash가 다르면 거부한다.

## 비용과 실행 조건

단가는 기존 승인된 Gemma4 input9091/output27273 neurons per million tokens다. 과거 실측 input tokens/payload bytes 비율로 새 입력을 추정한다. **이전 출력에는 v8 evidence가 없으므로 이전 출력 길이 가정은 낙관적 시나리오이며 새 모델 비용을 측정한 값이 아니다.** 아래900 출력 시나리오도 input은 추정이므로 엄밀한 총비용 상한은 아니다. repair는 추가다.

| 범위·가정 | neurons |
| --- | ---: |
| micro8: 같은 v7 사례의 이전 출력 길이 | 314.45 |
| micro8: Tarot6개만900 출력, 나머지 이전 길이 | 438.38 |
| micro8: 전부900 출력, 같은 사례 input 비율 | 482.73 |
| micro8: 이전 출력 길이로 순차 진행해도 필요한 최대 사전 예약 | 453.56 |
| micro8: 가장 큰 단일 보수 예약 | 205.80 |
| 원본84: 같은 사례 이전 출력 길이 | 2786.35 |
| 원본84: 그 가정에20% 계획 여유 | 3343.62 |
| 원본84: 전부900 출력, 최대 이전 input 비율 | 4788.21 |
| 원본84: 이전 출력 길이로 순차 진행 시 최대 예약 | 2929.06 |
| 원본84: 가장 큰 단일 보수 예약 | 294.52 |

최초 준비 cap450는 근거 추가 출력 전의 낙관적 시나리오에서도 마지막 요청 전 예약 필요치453.56보다 작았다. 이 결과를 검토한 Main은 **준비 cap을600으로 바꾸는 것만 승인**했다. 실행 승인은 아니며 source hash/preflight도600 설정으로 갱신했다. 원본84는 준비 cap3500 그대로 보류하고 micro8의 실제 usage·repair·evidence 출력 증가와 독립 품질 검토 뒤 다시 판단한다. 어느 cap도 완주를 보장하지 않는다.

모든 실제 요청은 **이미 정산된 사용량+현재 요청 bytes-as-input-tokens+최대900 output 예약**이 cap 안에 들어야 전송한다. 예약을 I/O 전에 공제하고 usage가 있으면 실측으로 대체하며 미정산은 예약 전액 유지한다. repair에도 동일 조건을 적용한다.429·한도·transport 실패는 중단하며 pending ID를 보존하고 자동으로 cap을 늘리지 않는다. 기존 결과 파일이 있으면 덮어쓰지 않는다.

Main이09시 KST/00시 UTC 무료 초기화와 fresh 실제 사용량·잔액을 확인한 뒤, 범위와 hard cap을 별도로 승인해야 한다. 원본84는 작은 검사의 직접·독립 의미 리뷰 결과도 확인한 뒤 판단한다. 현재 live marker를 설정하지 않았으며 actual 요청은0이다. 내부 evidence/schema 통과나 부분검사로 core60+supplement24의 최종 HF0 조건을 대체하지 않는다.

사전 계산 재현 명령은 `node --experimental-transform-types tests/persona/v8-micro8-runner.mts --preflight`, `node --experimental-transform-types tests/persona/v8-full84-preflight.mts`, `node tests/persona/v8-budget-preparation.mts`다. 환경 파일 없이 실행하며 실제 모델 호출을 만들지 않는다. 두 live 실행기는 명시적 marker가 없으면 endpoint/credential 처리 전에 거부한다.
