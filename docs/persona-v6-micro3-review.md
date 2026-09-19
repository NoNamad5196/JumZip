# v6 micro3 실제 출력 검토 — FAILED

2026-09-20 06:26 KST 실행. 직접 검토자: **Codex AI / fortune_audit**. 원문 세 개와 고정 입력·실제 v6 tool projection을 모두 읽어 판단했다. 일반화된 품질 통과를 주장하지 않는다.

Main이 Cloudflare 실제 사용량 8.86k/10k와 약 150 neurons 집계 지연을 고려해 승인한 **별도 350-neuron micro3**이다. v6 전체 focused24 실행은 승인·실행하지 않았다. v5 고정 corpus에서 A/B 시주 오류, 은둔자 역방향 오류, 사주 경계 회귀의 세 건을 그대로 골랐다. 큰 A/B 요청의 보수적 사전 예약을 만족시키기 위해 실행 순서만 A/B → 은둔자 → 사주 경계로 정하고 manifest에 기록했다.

## 운영 결과

- Gemma4 `@cf/google/gemma-4-26b-a4b-it`, `JumZipPersona-v6`.
- HTTP 3회, 응답 3/3 유효, repair 0회, 429 없음.
- 실제 사용량 **118.401184 neurons**, 상한 350, `sourceFrozen: true`.
- JSON object+schema, documented thinking false, 출력 900 tokens, 초기 60초/repair 30초 제한을 유지했다.
- 실행 latency: A/B 2,203ms, 은둔자 4,942ms, 경계 2,354ms. CPU 사용량으로 해석하지 않는다.
- 요청 전 reserve는 입력 bytes-as-tokens와 최대 출력을 합산한 기존 규칙이다. 실제 소비량을 받은 뒤 정산했다.
- production 모델 기본값·배포 변경 없음. 실제 사용자 데이터는 없고 원래 합성 corpus만 사용했다.

## 세 출력의 직접 판정

| 고정 사례 | 5축 합계 | Hard Fail | 관찰 |
| --- | ---: | ---: | --- |
| `v5-ab-swapped-contrast:SANI` | 10/10 | 0 | A 목48.3%, B 목80%를 보존하고 시주 미상은 A 민수에게만 귀속했다. B 시주도 미상이라는 v5 오류는 이번에는 재현되지 않았다. |
| `10-retry-same-draw:BOMI` | 7/10 | 1 | 역방향 은둔자를 여전히 “상대방은 지금 혼자만의 시간이 필요해서 조금은 움츠러든 상태”라고 설명했다. |
| `s03-correlated-boundary:ARANG` | 7/10 | 0 | 점수32·37·58과 용신 FIRE/METAL의 후보 상태를 보존했다. 알려진 날짜를 미입력으로 바꾸지 않았다. 내부 영어 코드 노출과 UI 대신 채팅에서 시각을 다시 요구하는 문제는 남았다. |

1차 검토 합계 **24/30, 평균8.0, Hard Fail1**이므로 이 부분 평가도 **FAILED**다. 숫자가 평균 기준에 도달해도 Hard Fail0 조건을 충족하지 못한다. 평가 점수는 사람이 검토한 것으로 표기하지 않는다. 평가 스크립트는 수기로 작성한 AI 판단을 원문/hash에 연결하고 합산했으며, 자동 검사만으로 의미 점수를 생성하지 않았다.

은둔자 실제 입력에는 REVERSED와 `고립/회피/과도한 폐쇄/외로움/방향 상실`만 있고 방향 공통 advice는 없다. 그런데 동일한 반대 방향의 원인 설명이 재현됐다. 따라서 **공통 advice 제거만으로 문제를 해결한다는 기대는 충족되지 않았다**. 이 한 번의 출력으로 모델 내부 원인을 확정하거나 조언 필드가 과거에 전혀 영향을 주지 않았다고 결론낼 수는 없다. 특정 은둔자 문구를 암기한 답으로 바꾸거나 기대 의미를 완화하지 않았다.

A/B coverage는 실제 chart에서 B 시주가 CONFIRMED라는 정보를 새로 명시했고, 이번에는 잘못된 B 미상 설명이 사라졌다. 단일 출력이므로 이 변경의 일반적인 효과나 재발 방지를 확정하지 않는다. 사주 경계 응답은 null을 확정값으로 바꾸지 않고 후보 숫자를 명시해 그 범위에서는 개선됐다.

## 보존된 증거와 미실행 범위

`tests/persona/benchmark-runs/v6-micro3/`에 다음을 보존했다.

- `results.json`: 실제 원문, segments, model/prompt version, latency/usage. SHA256 `7474ce66cfd44732687d1f1f92d4ab05efb3eef26022b10b73ec50e375468918`.
- `provider-attempts.jsonl`: 합성 원문 provider 응답과 각 호출의 예약·정산 사용량.
- `micro-manifest.json`: 부분범위·실행 순서·선정하지 않은 21개 ID·350 상한·원본/실행 후 source hashes.
- `selection.json`: 원래 입력/기대/루브릭, `review-template.json`: 작성하지 않은 원래 빈 평가 양식.
- `primary-ai-review.json`: 세 출력의 직접 AI 5축 평가, 근거, exact output, output hash와 입력 hash 검증.

독립 검토자 **Codex AI / contracts_audit**도 세 출력과 실제 입력을 직접 읽고 `independent-ai-review.json`을 저장했다. 독립 점수는 A/B9·10B8·s03A9, **26/30·평균8.6667·Hard Fail1**이다. 동일한 은둔자 역방향 오류 때문에 결론은 FAILED다. A/B의 B 확정 상태를 명시하지 않은 점, ARANG의 코드 병기와 말투 등에 대한 감점 폭은 1차 평가와 다르며 두 점수표를 그대로 보존했다. 독립 검토자는 1차 점수 파일을 열지 않았다고 명시했다.

원래 24건 중 나머지21건, 원본 core60 및 supplement24 전체는 **v6에서 미실행**이다. 기존 full84의 실패 상태는 유지한다. v5 대비 v6 production projection은 바뀌었지만 원래 사례와 의미 기대는 유지되며, 3개 입력은 실제 v6 selection hash와 일치한다. 추가 모델 호출이나 production 수정 없이 검토 결과와 evidence freeze를 Main에 전달했다.
