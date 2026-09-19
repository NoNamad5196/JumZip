# Gemma 4 소규모 실제 비교

2026-09-20, Cloudflare의 `@cf/google/gemma-4-26b-a4b-it`를 합성 사례6개로 비교했다. 6/6 정상 JSON, 수리0회, 실제194.265579neurons다. 기존 v4 Persona 문맥·JSON Schema·검증·출력900토큰·시간60초/수리30초는 같고, 배포 모델을 교체하지 않았다. Qwen 전용 `/no_think`는 전송하지 않으며 Gemma에는 공식 Cloudflare 예제의 `chat_template_kwargs.enable_thinking=false`를 비교용 어댑터에서만 적용했다. [Cloudflare 모델 문서](https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/), [공식 생각 모드 해제 예제](https://developers.cloudflare.com/workers-ai/get-started/workers-wrangler/).

표본은 취향 기억 회상(보미), 첫 만남(산이), 같은 관계 카드 재해석(보미), 시각 미상 사주(보미), 실제 궁합 근거와 확률 거부(아랑)다. 회상에는 Qwen에서 잘못 분류된 NATAL 추천까지 같은 값으로 유지해 답변 모델만 비교했다. 원래 정리된 테스트 계정의 실제 전체 문맥을 재생한 것은 아니다. 별도 intent 오류가 해결되었다고 주장하지 않는다.

Codex / fortune_audit(AI)가 여섯 응답을 직접 읽어 다섯 축 점수를 기록했다. 55/60(평균9.17), 확정 Hard Fail0이지만 **여섯 개로 수용 기준을 통과한 것이 아니다.** 은둔자 역방향을 혼자만의 시간을 원하거나 움츠러든 상태라고 설명한 표현은 고립·회피의 핵심을 흐릴 수 있어 tool fidelity1로 기록했다. 명확한 정방향 성찰·방향 찾기로 뒤집지는 않았으므로 이 모호한 문장만으로 반대 해석 Hard Fail을 확정하지 않았고 전체 검토 대상으로 남겼다.

기억 회상은 필수 toolReferences를 포함해 성공했다. 일상·해석 문체는 Qwen의 해당 표본보다 짧고 자연스러웠으며, 시주·대운을 만들거나 오행의 최대값을 바꾸거나 결혼 확률을 생성하지 않았다. 여전히 알려진 시각 미상을 되묻고 분포에서 비슷한 성향을 추론하는 한계가 있다. 비교 사례 수와 Persona 범위가 작고 확률적 모델이므로 우수성이 확정된 것은 아니다.

단가는 입력100만토큰당9091neurons, 출력100만토큰당27273neurons를 적용했다. Gemma는 공식 paid-required 목록에 없으며 일반 무료 할당은 하루10000neurons다. JSON 출력 요청이 모든 응답의 스키마 준수를 보장한다고 가정하지 않고 실제 반환값을 동일 검증기에 통과시켰다. [Cloudflare 가격표](https://developers.cloudflare.com/workers-ai/platform/pricing/), [JSON Mode의 한계](https://developers.cloudflare.com/workers-ai/features/json-mode/).

6개에서 실제 입력19830/출력513토큰을 관측했다. 전체84개의 요청 크기를 로컬에서만 구성해 같은 토큰/바이트 비율로 추정한 비용은 약2500–2589neurons,20%여유를 둔 계획치는3107이다. 이는 여섯 사례에서 추정한 값이며 보장된 토크나이저 상한이 아니다. 추가 수리나 긴 응답은 더 쓰며 모든 응답이900토큰이라면 관측 입력 비율 기준4455neurons까지 가능하다. 승인된 full84 hard cap3000은 완료를 보장하지 않는다. 실제 계정 사용량 확인 후 실행해야 한다.

모델별 원문·실제 토큰·단가·문서 출처·원문 및 LF정규화 source hash·점수·비용 추정은 `tests/persona/model-comparison-runs/gemma4-v4-six/`에 보존했다. 독립적으로 수정 중인 background memory helper는 이 reply-only 비교의 의존성이 아니므로 freeze 범위에서 제외했으며, 실제 Persona/provider/domain 입력은 고정했다.
