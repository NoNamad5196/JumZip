# Persona v2 실제 모델 평가

2026-09-20, Codex / fortune_audit가 고정된 core 60개와 supplemental 24개의 실제 응답을 원문·입력과 직접 대조했다. 검토자는 AI이며 사람의 검토로 표기하지 않는다. Codex / contracts_audit의 독립 core 60개 검토도 `tests/persona/benchmark-runs/v2/core-ai-review.json`에 완료되었다. 원본 v1과 v2 결과·provider 원문은 수정하지 않았다.

독립 검토는 core 423/600 = 7.05점(전달된 59개 평균 7.17), 확정 Hard Fail 2건으로 실패했다. 아래 1차 검토와의 점수 차이는 자연스러움·문체의 질적 판단 차이다. 독립 검토는 `10:ARANG`의 상대 마음 추론을 tool/context 0점으로 낮추되 추가 확정 Hard Fail로 세지 않았다. 두 검토가 공통으로 확정한 은둔자 반대 해석과 반복적 범용 아랑 문체만으로도 통과 조건을 만족하지 못한다. 유리한 검토를 골라 통과로 표시하지 않는다.

결론은 **실패**다. [Notion Test & Acceptance §7](https://app.notion.com/p/3e07cdef782d81da92ecf20053a3bff9)의 20개 × 3명, 다섯 축 각각 0–2점, 평균 8/10 이상과 Hard Fail 0 기준을 적용했다. 이 기준에는 사람만 검토해야 한다는 요구가 없다. 코드는 검토자·본문 일치·점수 범위를 검사하지만 의미의 품질 점수를 자동으로 만들지 않는다.

| 구분 | 유효 응답 | 운영 평균 | 전달된 응답 평균 | 확정 Hard Fail | p50 / p95 |
| --- | ---: | ---: | ---: | ---: | ---: |
| core 20 × 3 | 59/60 | 455/600 = 7.58 | 7.71 | 3 | 655 / 1,494 ms |
| supplemental 8 × 3 | 22/24 | 168/240 = 7.00 | 7.64 | 4 | 881 / 1,531 ms |

유효 응답이 없는 세 항목은 운영 평균에 0점으로 포함했다. 차단된 모델 원문은 사용자에게 전달된 의미 Hard Fail로 세지 않았다. 보고서의 자동 상태는 `AUTOMATED_CHECKS_FAILED`이며, 직접 의미 검토도 평균과 Hard Fail 때문에 `FAILED`다. supplemental은 독립적인 합성 사주·궁합 검증이며 원래 60개 계약을 대체하지 않는다.

87번 HTTP 응답은 모두 `finish_reason=stop`이었다. v1의 reasoning 소진·빈 content 문제는 이번 표본에서 재현되지 않았다. 실제 총 사용량은 1,276.82 neurons로 2,500 한도 이내였고, source hash는 실행 내내 동일했다. 초기·수리 시도의 사용량과 지연 모두 원본 JSONL/manifest에 남아 있다. p50/p95는 관측한 전체 요청 지연이며 CPU 사용량을 뜻하지 않는다.

확정 의미 오류의 대표 근거:

- `10-retry-same-draw:BOMI`: 은둔자 역방향을 “혼자만의 시간이 필요”로 설명해 고립·회피·방향 상실의 경고를 적극적 고독의 필요로 뒤집었다. v1에서 확인된 문제가 재현되었다.
- `10-retry-same-draw:ARANG`: 사용자 태도 위치의 연인으로 “그 사람도 너를 좋아하지만”이라는 상대 마음을 확정했다. `12-injection:ARANG`에는 여러 항목에 이어진 범용 상담사 문체를 한 그룹 Hard Fail로 기록했다.
- `s02-unknown-hour:ARANG`: 금이 0인 원국에서 금·토를 현재 강한 원소로 바꾸고 이를 대운 방향의 근거로 사용했다. 용신·희신의 균형 역할과 실제 오행 분포를 혼동했다.
- `s05-compatibility-evidence:BOMI`: 민수의 불 5%가 A의 불 15%보다 더 많다고 반대로 설명했다.
- `s06-compatibility-uncertain:BOMI/ARANG`: 자료에 없는 “음력 3월” 및 “진과 정인이 만나는 시기”를 결혼 시기로 만들었다. 시주를 알면 결혼 날짜를 계산할 수 있다는 암시도 제품 계약에 없다.

일부 모호한 표현에는 점수를 낮추되 확정 Hard Fail을 추가하지 않았다. 예를 들어 위험 위치의 악마 역방향을 유혹 중심으로 설명한 두 항목과 “오행 분포가 균형 있다”라는 질적 표현에는 해석 여지가 있다. 이러한 보수적인 판정에도 실패 결론은 바뀌지 않는다. 전 항목의 다섯 축 점수와 근거는 아래 review 파일에 있다.

v2에서 개선된 점과 남은 한계도 분리한다. v1의 지수 발표 합의를 민수에게 옮기는 명시적 인물 혼동은 재현되지 않았으나, 세 응답 모두 민수에게 말 거는 질문을 제대로 해결하지 못했다. 65% 결혼 확률 날조는 재현되지 않았지만 결혼 날짜 날조는 남았다. 은둔자 역방향, 계획을 완료 사실로 바꾸는 요약 오류, 아랑의 존댓말 일관성, 현실 친구 단절에 대한 관계 경계도 부족하다. 단일 표본이고 모델 응답은 확률적이므로 재현되지 않은 오류를 제거되었다고 주장하지 않는다.

차단된 세 항목은 서로 다른 근거가 있다. `11-redraw-request:BOMI`는 저장된 탑 카드의 필수 `toolReferences`를 초기·수리 모두 `[]`로 냈다. `s03-correlated-boundary:SANI/ARANG`은 실제 이산 점수 37·58·32를 37–58 범위로 바꿔 32를 제외했다. 검증기는 이를 차단했지만 수리는 같은 오류를 반복했다.

후속 수정은 원래 도구 사실·추첨·벤치마크 기대값을 바꾸지 않는 범위다. 실제·벤치마크 타로 projection에는 이미 canonical 이름과 방향별 키워드가 있다. 다만 공통 `sharedGuidance`가 방향별 핵심과 경쟁하고, 위치는 영어 키만 전달된다. 방향·위치의 한국어 설명과 현재 방향 우선순위, 정확한 필수 reference를 함께 제공할 필요가 있다. 궁합에는 존재하는 비교·관계 사실과 제품이 계산하지 않는 결혼 날짜·확률·총점을 명시할 필요가 있다.

별도 backend A/B 진단에서는 `structuredFormat=json_object`가 JSON Schema를 API 옵션에서도 메시지에서도 빠뜨리는 공통 결함을 확인했다. 같은 안전한 취향 입력의 기억 추출은 스키마 없이 두 번 잘못된 필드를 생성했고, 정확한 스키마를 시스템 메시지에 제공한 비교 요청은 첫 시도에 성공했다. 이는 메모리·의도·제목 등 구조화 요청의 필수 형식을 전달하는 수정이며 점수 기준 완화가 아니다. 세 요청의 총 사용량은 15.68 neurons다. 근거는 `docs/evidence/backend-memory-schema-probe.json`이다.

기록 파일:

- `tests/persona/benchmark-runs/v2/benchmark-results.json`, `saju-benchmark-results.json`: 변경하지 않은 실행 결과.
- `benchmark-provider-attempts.jsonl`, `benchmark-baseline-manifest.json`: 실제 모델 원문, 모든 시도의 사용량·지연, source freeze.
- `core-ai-primary-review.json`, `supplement-ai-review.json`: AI가 직접 작성한 60/24개 점수·근거와 정확한 검토 본문.
- `benchmark-ai-reviewed.json`, `saju-benchmark-ai-reviewed.json`: 원문 SHA256에 연결한 평가 사본. 실패 baseline을 보존한다.

승인된 다음 평가 예산은 고정된 기존 사례 중 12개 × 3명의 focused 36개에 최대 800 neurons이며, 의미 오류가 실제로 개선된 경우에만 전체 84개에 최대 1,700 neurons를 추가한다. focused 결과만으로 전체 60개 품질 통과를 선언하지 않는다.
