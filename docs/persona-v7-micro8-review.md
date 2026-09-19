# v7 micro8 실제 출력 검토 — FAILED

2026-09-20 실행. 1차 직접 검토자 **Codex AI / fortune_audit**는 선정된8개 실제 응답과 원본 입력을 모두 읽어 **72/80, 평균9.0, 확정 Hard Fail0**으로 평가했다. 이후 독립 검토자 **Codex AI / contracts_audit**는 **74/80, 평균9.25, Hard Fail1**로 평가했다. 판정 차이를 보존하며 Main의 결합 결론은 **FAILED**다. 이8개는 **원본24/84 acceptance 통과가 아니다**.

## 실행 범위와 사용량

Main이 확인한 최신 Cloudflare usage9.05k/10k를 근거로 이번8건만 hard450으로 승인했다. 기존7개 focused 사례와 원본 `09-decision-three:SANI`를 선택했으며 입력·기대·루브릭은 바꾸지 않았다. 제안①의 공통 한국어 근거문·provenance만 추가한 `JumZipPersona-v7`을 실제 Gemma4로 검사했다.

- HTTP8회, 응답8/8 유효, repair0, stopReason null.
- 실제 사용량 **295.957505 neurons**, 상한450 준수.
- 실제 누적 정산액+다음 요청의 bytes-as-token/최대 출력 예약 조건을 유지했다. 예약량을 tokenizer 실측 비율로 줄이지 않았다.
- `sourceFrozen: true`; hash 범위는 domain/persona/llm(별도 background memory 제외)와 관련 corpus/runner다. Main의 migration/Frontend 작업은 범위 밖이다.
- 추가 모델 호출·provider 전환·배포·production source 변경은 없다.

## 직접 검토 결과

| 사례 | 합계 | 확정 HF | 핵심 판단 |
| --- | ---: | ---: | --- |
| A/B swap SANI | 10 | 0 | A 목48.3/수35, B 목80/화15를 보존하고 미상 시주는 A에게만 귀속했다. B의 확정 시주를 명시하지 않은 생략은 있으나 반대 사실을 말하지 않았다. |
| 10 BOMI | 8 | 0 | “혼자만의 시간 속에 있거나 조금은 고립된 상태”로 바뀌었다. 이전의 고독이 **필요해서**라는 반대 원인은 사라졌다. 일반화된 고독 표현과 실제 상태처럼 읽히는 경계는 감점했다. |
| s03 ARANG | 8 | 0 | 미상 시각·날짜 경계·점수/용신 후보·대운 미확정을 유지하고 입력 화면으로 안내했다. 실제32/37/58·FIRE/METAL을 나열하지 않고 일반론에 머문 점은 감점했다. |
| 10 SANI | 8 | 0 | “혼자만의 시간이 필요하거나 상황을 피하고 싶은 모습”이라는 혼합 대안이 남았다. 회피 의미도 포함하므로 기존 v5와 동일하게 감점하고 확정 반대방향 HF로 추가하지 않았다. |
| 10 ARANG | 10 | 0 | 카드의 상징이라고 명시하고 상대 위치를 고립/회피로 설명했다. 다른 두 카드의 위치도 유지했다. |
| 정방향 대비 BOMI | 8 | 0 | 정방향 성찰을 회피로 뒤집지 않았다. 상대가 실제로 혼자 생각하는 중이라는 말투는 상징/관찰 경계가 약해 감점했다. |
| 위치 교환 SANI | 10 | 0 | 사용자 위치의 은둔자 역방향은 고립/회피 상징, 상대 위치의 연인 정방향은 연결/끌림 키워드라고 분리했다. |
| 09 SANI | 10 | 0 | 추진력·거리두기를 통한 위험 관리·사실과 책임이라는 세 위치를 유지하고 실제 업무량을 물었다. 악마 역방향을 실제 중독 상태로 확정하지 않았다. |

점수와 근거는 `primary-ai-review.json`에 exact output/segments/hash와 함께 보존했다. 스크립트는 직접 작성한 AI 판단을 원문에 연결하고 합산했으며 단어 검사만으로 의미 점수를 만들지 않았다. 작성자는 사람 검토자로 표시하지 않았다.

보미의 반복적인 확정 반대 의미는 이번 응답에서 관찰되지 않았지만, 산이의 혼합 해석과 일부 상징/관찰 경계는 남았다. 따라서 한 번의8개 결과로 안정적인 해결이나 근거문의 인과 효과를 확정하지 않는다. v7에서 Saju projection은 바뀌지 않았는데 s03의 구체적인 후보 나열 여부가 이전 응답과 달라진 점도 결과 변동의 실제 예다. 독립 리뷰는 이와 같은 의미적 여지를 별도로 판단해야 한다.

독립 리뷰는 `10-retry-same-draw:SANI`의 “혼자만의 시간이 필요하거나 상황을 피하고 싶은”에서 **고독 필요**라는 대안을 원본 역방향과 반대 의미로 판정했다. 뒤에 올바른 회피 대안이 있어도 그 반대 의미가 취소되지 않는다는 판단이다. 1차는 이전 혼합 대안 사례들과 같은 보수적 정책으로 tool/context를 감점하고 추가 확정HF는 세지 않았다. 어느 쪽 파일도 덮어쓰지 않는다. 독립 리뷰의 B확정시주 생략·사주 후보값 생략에 대한 감점과 나머지 축의 차이도 그대로 보존했다. 작은 표본에서 기준 해석의 차이가 생겼으므로 이를 숨기거나 평균으로 상쇄해 PASS로 바꾸지 않는다.

## 증거

경로: `tests/persona/benchmark-runs/v7-micro8/`.

- `results.json`:8개 실제 원문. SHA256 `594688b92a49ed380091c598af2f755ae906724440b99c8cb7867020d2a1008c`.
- `provider-attempts.jsonl`, `micro-manifest.json`: provider 응답, token/neurons, 실행 순서·부분범위·소스 해시.
- `selection.json`, `selection-audit.json`: 원본 입력/루브릭 동일성. `review-template.json`은 원래 빈 양식 그대로다.
- `primary-ai-review.json`, `independent-ai-review.json`:각 검토자의 직접AI평가, exact output·input/provider hash binding. `combined-review-status.json`은 두 결과와 FAILED 결론을 연결한다.

나머지 focused24, 원본 core60/supplement24 전체는 **v7에서 미실행**이다. 알려진HF가 남아 있으므로 full84는 준비만 동결하고 실행하지 않는다. 기존 full84의 실패 상태를 이번 작은 묶음으로 덮어쓰지 않는다. 추가 호출 없이 원문 위치와 결과를 Main에 전달했다.
