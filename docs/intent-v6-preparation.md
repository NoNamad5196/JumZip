# Intent-v6 슬롯 검증 진단과 28건 평가 준비

2026-09-20 KST. [v5 실제 리뷰](intent-v5-live-review.md)의 두 실패를 보존하고, 기존 계약을 설명하는 순서와 repair 진단만 보강했다. 실제 모델 호출과 배포는 하지 않았다. 초기·repair 출력350토큰, 제한8초/3초, repair1회, 정규식 안전 차단, router와 공개 Recommendation은 그대로다.

## 변경과 불변 경계

`JumZipIntent-v6` / `jumzip_intent_v6`의 prompt는 별칭 구절을 고르기 전에 source 발화자가 user인지 검사하도록 명확히 한다. assistant가 만든 별칭을 사용자가 채택한 증거가 없으면 기존 UNRESOLVED/null/null을 유지한다. 선택지 배열은 메시지·문장 개수가 아니라 별도 대안 개수이며, 같은 source에 두 대안이 있어도 두 객체로 분리하도록 설명한다. 특정 평가 입력이나 별칭을 prompt 예제로 넣지 않았다.

`diagnoseValidationError(error)`는 실제 Error의 메시지가 정확히 `INTENT_ALIAS_SOURCE_INVALID` 또는 `INTENT_CHOICES_INVALID`일 때만 그 고정 코드 하나를 반환한다. 그 밖의 값·문자열·유사 객체·추가 문구는 null이다. Domain 소유 provider가 반환값을 다시 allowlist로 검사하고 고정 code/path/reason만 system 안내에 넣는다. 원문 quote나 예외 객체를 system으로 전달하지 않는다. 최초 JSON 파싱이 성공한 뒤 validator가 거부한 경우에만 mapper를 호출하며, parse 실패·unknown·mapper 실패는 기존 일반 진단을 유지한다.

JSON Schema와 validator는 변경하지 않았다. schema SHA256은 `e4a5429d927615eab1fc6601a483a4e157ec889be1c9f853f8551aac377096b9`다. 별칭 발화자와 선택지 길이0/2는 원래 runtime에서 검사하던 조건이며 새 schema 제한이나 자동 출력 교정을 추가한 것이 아니다. repair에서도 같은 실패가 반복되면 FAILED_NULL이고, 이를 정상 NONE이나 정답 슬롯으로 바꾸지 않는다.

[새 corpus](../tests/persona/intent-v6-corpus.ts)는 [원본 v5의28건](../tests/persona/intent-v5-corpus.ts)을 그대로 참조한다. 새 입력·기대·순서·review 기준은 추가하지 않았다. [실행된 v5 selection](../tests/persona/benchmark-runs/intent-v5/initial28-final800/selection.json)과 case 전체 및 입력 hash의 동일성을 unit test와 runner 모두 검사한다. 원래 v5 corpus·runner·실제 산출물·리뷰는 보존했다. 과거 전용 unit/preflight의 설명과 현재 버전 단언만 현재 runtime 회귀임을 명확히 했다.

## 오프라인 검사

Intent 관련10개 파일의 **121 tests**, 전체 TypeScript와 대상 ESLint가 통과했다. .mts 실행기도 TypeScript parser로 lint 및 Node 문법 검사를 수행했다. 주요 검증은 다음과 같다.

- 원래28개 input/expected/review 조건과 JSON Schema 불변.
- 두 실제 v5 최초 실패 응답을 공급하면 실제 validator의 고정 진단이 repair의 system 안내까지 전달됨.
- quote·이전 잘못된 JSON은 추가 system 진단에 복사되지 않고 원래 assistant 위치에만 유지됨.
- 원래 마지막 user payload가 byte-identical하게 반복되고 budget/config가 그대로 유지됨.
- 유효한 대역 재응답은 기존 matrix 추천으로 복구되지만 동일한 잘못된 재응답은1회 repair 뒤 FAILED_NULL.
- parse 실패와 허용되지 않은 오류는 일반 진단을 유지하고 값이나 원문을 system으로 승격하지 않음.

공급한 대역 출력의 통과는 실모델이 두 오류를 고친다는 증거가 아니다. source-valid quote가 의미상 별칭이나 서로 다른 대안인지는 이후 원문 리뷰가 필요하다.

## 실행 준비와 사용량 경계

[새 실행기](../tests/persona/intent-v6-runner.mts)의 기본 동작은 비밀·네트워크 없는 preflight다. 실제 실행에는 Main의 별도 GO, fresh 잔액 확인, `--live`, `JUMZIP_INTENT_V6_LIVE_GO=1`, `JUMZIP_INTENT_V6_USAGE_GO=FRESH_USAGE_CONFIRMED`, 동일한 source/input preflight가 필요하다. 기본 run-name은 `initial28-final700`이며 **28건 전체 순서, 최대56 HTTP, 700 neurons**로 고정한다. 사례를 골라 실행하거나 예산을 자동 증액하지 않는다.

고정 Gemma4와 exact Cloudflare account API만 허용하고 실제 provider body의 json_object/enable_thinking=false/350/temperature0.1을 단언한다. wrapper는 body를 수정하지 않는다. 초기 request hash는 사전 직렬화와 같아야 하며 initial·repair마다 전체 UTF-8 bytes를 입력토큰처럼 보수적으로 예약하고 출력350 비용을 더한다. 실제 usage가 있으면 그 예약을 대체하고, 없으면 유지한다. 다음 예약을 감당하지 못하면 전송 전에 멈춘다.

미전송 요청은 `notSentRequests`로 기록한다. 초기 응답 후 repair가 막힌 사례는 INTERRUPTED이고 pending에 남는다. 정상 검증 NONE, 검증 실패 null, 전송 전 차단을 구분하며 quota·HTTP·transport 실패 뒤 추가 사례를 보내지 않는다. 응답128KB 상한, redirect 차단, 비밀 비출력과 기존 run 덮어쓰기 거부를 유지한다.

## 최종 오프라인 동결

Domain Persona-v11/provider와 Intent-v6 runtime 동결 뒤 [최종 preflight](../tests/persona/benchmark-runs/intent-v6/initial28-final700/preflight.json)를 생성했다. **28건 직렬화·대역 matrix 검사, 40개 source hash 일치, sourceFrozen=true, completed=true, actualModelCalls=0**이다. 원래28개 case 전체의 hash는 `6d159910d0cc7af136a2b50c5623216090fd2a5c2f3ce69c353612243ec823eb`로 기존 v5 selection과 동일하다. live opt-in 없는 실행이 최초 guard에서 거부되는 것도 외부 요청 없이 확인했다.

초기 요청 크기는 **8,646–8,822 UTF-8 bytes**다. v5 실제 초기28건의 평균 input-token/byte 비율0.220428과 평균 출력93.21토큰을 적용한 초기 예측은 **559.15 neurons**다. 과거 최대 입력 비율과 매번 출력350을 가정하면 **756.65 neurons**로700 cap을 넘는다. 따라서 cap 안에서 전 사례가 완료된다고 단정하지 않는다. repair는 추가 비용이며 다음 요청의 보수적 예약까지700 안에 들어가야 한다.

가장 큰 초기 요청의 예약은 **89.75 neurons**이고 초기28 예약의 단순 합은2,481.02다. 이 합은 동시 지출이나 실제 예상 비용이 아니다. 매 완료 응답의 usage로 예약을 대체하면서 순차 실행하며, 잔액 또는 예약 조건이 부족하면 미전송·미완료를 그대로 남긴다. 실제 잔액 확인·실행 GO·실모델 의미 리뷰는 Main의 별도 판단이다.

동결 LF SHA256:

- Runtime: `19a6120041ba81a8d38b56c1f5300db9118b3c8ee0ab13e3ab97c360c2b28e18`
- Corpus: `4208c3344c2ee0bc7eb17ae206791b46a1a435f5dfb894cf5cbf37e8b8a6c513`
- Runner: `8f619b7cfa9333328523bc4b87acff9127e46f578d1dea3b5a8089f1e6e19d38`
- Selection: `17cbba75ceebecb2e43215bb002b5b413b5139d1bb0dae914a90497971f14dbd`

기존 v5의 두 기능 실패를 해소했다는 판정이나 production 배포 승인은 아직 아니다.
