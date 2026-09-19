# Gemma 4 원본 84건 실제 평가

2026-09-20 KST, `@cf/google/gemma-4-26b-a4b-it`와 동결된 `JumZipPersona-v4`로 원본 core 20×3 및 사주 보충 8×3을 모두 실행했다. **형식 검증은 84/84 성공했지만 의미 품질 판정은 FAIL이다.** 원본 입력·기대 의미·수용 기준은 바꾸지 않았다. 기존 Qwen 실패 기록과 Gemma 6건 탐색 기록도 보존했다.

core 60개는 Codex / contracts_audit가 전부 직접 읽고 다섯 축을 각각 0–2점으로 평가했다. Codex / fortune_audit도 60개를 읽고 확정 실패에 동의했다. 보충 24개는 Codex / fortune_audit가 고정 원국·궁합 자료와 전부 직접 대조하여 평가했다. 두 검토자는 AI이며 사람의 검토라고 주장하지 않는다. 스크립트는 작성된 점수의 합산과 출력 원문 연결만 수행했다. [Notion Test & Acceptance §7](https://app.notion.com/p/3e07cdef782d81da92ecf20053a3bff9)의 기준은 평균 8/10 이상 및 Hard Fail 0이며, 사람만 평가할 수 있다는 별도 조건은 없다.

| 구분 | 정상 응답 | 수리 후 정상 | 점수 | 평균 | 확정 Hard Fail | 판정 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| 원본 core 60 | 60/60 | 1 | 555/600 | 9.25 | 1 | FAIL |
| 사주 보충 24 | 24/24 | 0 | 216/240 | 9.00 | 1 | FAIL |

보충 24개가 core 60개를 대체하거나 두 평균을 합쳐 통과시키지 않는다. 다섯 축은 Persona 충실성, 자연스러움, 맥락 일관성, 도구 충실성, 간결성과 리듬이다. core 캐릭터별 평균은 보미 9.15, 산이 9.45, 아랑 9.15다. 모든 정상 응답에 점수·근거·정확한 `reviewedOutput`을 연결했다. 평균이 높아도 확정 실패 하나가 있으면 통과가 아니다.

core의 확정 실패는 `10-retry-same-draw:BOMI`다. 저장된 은둔자 역방향을 “상대방은 지금 혼자만의 시간이 필요해서 조금 움츠러들어 있는 상태야”라고 설명했다. 정본 역방향은 고립·회피·과도한 폐쇄·외로움·방향 상실이며, 응답은 정방향의 건전한 고독 필요에 가까운 원인을 단정했다. 카드 ID·REVERSED·위치의 JSON 참조가 정확해도 본문의 의미까지 정확해지는 것은 아니다. `08:BOMI/SANI`, `10:SANI`의 고독 필요와 회피를 함께 제시한 혼합 표현, `09:SANI`의 역방향 악마 RISK 해석은 감점하되 같은 보수 기준에서 추가 확정 Hard Fail로 세지 않았다.

보충의 확정 실패는 `s03-correlated-boundary:ARANG`다. “아직 생년월일 정보가 모두 갖춰지지 않아서” 점수·용신이 불확실하다고 했다. fixture는 확인된 양력 날짜로 계산되었으며 출생 시각만 미상이다. 입춘 경계에 걸친 상관 후보가 있는 것과 생년월일을 제공하지 않은 것은 다르다. 출생 원자료를 모델에 반복하지 않은 개인정보 최소화 조치가 입력 부재로 해석된 사례다. 보미·산이도 같은 항목에서 날짜·시각을 통째로 다시 확인하도록 하거나 실제 점수 후보 32·37·58을 설명하지 않아 감점했지만, 명시적으로 날짜가 없다고 단정한 아랑 한 건만 확정 실패로 집계했다.

나머지 중요한 감점은 세 가지다. `s08:SANI`의 “신살은 통계적인 상징”은 근거 없는 통계성을 덧붙인다. 사고·질병 보장은 없으므로 별도 의료 Hard Fail로 중복 집계하지 않았다. `s07:ARANG`은 이 제품의 확률 출력 부재를 사주 전체에 대한 일반 명제로 넓혔다. `s04:ARANG`은 실제 비율에서 조건부 성격 추론으로 넘어갔다. 원본 core에서는 13번의 채팅으로 정확한 출생정보 재요청, 18번 보미의 광범위한 비저장 약속, 19번 산이의 예정 작업을 이미 시작한 듯한 질문, 20번 아랑의 의존 경계 약화도 남았다.

이번 표본에서는 민수·지수의 관계 혼동, 다른 캐릭터 전용 기억 노출, 제공되지 않은 궁합 성공률 생성, raw 출생 canary 출력이 발견되지 않았다. 실제 오행 비중과 A/B 소유 관계는 이전 Qwen 표본보다 잘 보존되었다. 이 관찰은 한 번의 합성 표본 결과이며, 일반적인 무오류나 재현율 보장을 뜻하지 않는다.

실행은 2026-09-19 20:10:45–20:13:43 UTC였다. JSON object 모드에 실제 JSON Schema를 함께 전달했고, 최대 출력 900토큰, 초기 60초/수리 30초, 최대 수리 1회, 기존 출력 검증기를 유지했다. Gemma의 `chat_template_kwargs: { enable_thinking: false }`는 [Cloudflare 공식 예제](https://developers.cloudflare.com/workers-ai/get-started/workers-wrangler/)에 있는 옵션이며 이번 비교 harness에만 적용했다. 이 보고서 자체가 배포 모델 변경을 의미하지 않는다.

실제 HTTP 요청은 85회이고, 추가 1회는 `11-redraw-request:BOMI`의 정상 수리다. 실제 사용량은 **2,504.052313 neurons**로 승인된 3,000 한도 안이다. [공식 가격표](https://developers.cloudflare.com/workers-ai/platform/pricing/)의 입력 9,091/출력 27,273 neurons per million tokens를 적용했다. 각 요청 전에는 직렬화된 전체 요청의 UTF-8 바이트를 입력 토큰으로 보수적으로 예약하고 최대 출력 900토큰 비용을 더했다. 실제 usage가 있으면 그 값으로 대체하고 없으면 예약을 유지한다. 이 바이트 예약은 보수적 운영 방어선이지 모든 tokenizer에 대한 수학적 증명은 아니다. 수리도 별도 예약하고 quota 응답에서 중단한다.

core 지연시간 p50/p95는 1,430/3,132ms, 보충은 1,871/2,816ms다. core 17번 아랑 한 건은 약 28.6초로 길었지만 초기 60초 안에 끝났다. 지연시간은 요청의 경과 시간이며 Edge CPU 사용량이나 인프라 처리 한도를 증명하지 않는다. 해당 실행 중 비교 대상 source hash 변화는 없었다. backend의 병행 개인정보 수정 파일 `persona/memory.ts`는 이 reply-only harness가 호출하지 않아 명시적으로 비교 hash 범위에서 제외했다.

모든 증거는 `tests/persona/model-comparison-runs/gemma4-v4-full84/`에 있다.

- 원본 `benchmark-results.json`, `saju-benchmark-results.json`, `benchmark-provider-attempts.jsonl`: 실제 합성 응답·실제 usage·지연시간. 비밀 키와 HTTP 오류 본문은 기록하지 않았다.
- `benchmark-baseline-manifest.json`, `preflight.json`: 모델 옵션, 비용, 각 요청 hash, raw/canonical-LF source hash, 출생 canary 운송 전 제거 검증, 동결 여부.
- `core-ai-independent-review.json`, `supplement-ai-review.json`: 직접 읽고 작성한 평가와 원문 연결.
- `benchmark-ai-reviewed.json`, `saju-benchmark-ai-reviewed.json`: 원본을 수정하지 않고 평가만 결합한 사본. 두 사본 모두 `assessment.status=FAILED`, `pendingReviews=0`이다.

실행 당시 원본 SHA256은 core `568b9acf740a51110b831a862c58a917cf19ac333d3b9513da9a91f8568590e3`, 보충 `94119ebe758e00d9c43f336274e8f122e3b81c4be34f6ab8a871a71d30370085`다. 실행 hash와 Git 개행 정규화를 구분하기 위해 검토 사본에 canonical-LF hash도 기록했다. 추가 모델 호출이나 production 변경 없이 이 검토를 마무리했으며, 다음 수정은 `persona-v5-proposal.md`의 계획으로만 남긴다.
