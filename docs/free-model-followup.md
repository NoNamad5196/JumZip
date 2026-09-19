# 무료 모델 후보 후속 확인

2026-09-20 KST. Main의 공식 문서 확인이며, 이 조사에서 모델 호출·계정 생성·요금제 변경은 없다. 운영은 검증한 Qwen/v4 그대로이고 Gemma/v8은 별도 품질 평가 후 판단한다.

Cloudflare의 2026-09-17 갱신 가격표에서 하루 무료 할당은10,000 neurons, 초기화는00:00 UTC(09:00 KST)다. 07시대 실제 계정 화면은9.41k/10k를 표시했다. [공식 가격표](https://developers.cloudflare.com/workers-ai/platform/pricing/)

| 같은 Cloudflare의 후보 | 입력/출력 백만 토큰당 neurons | 이번 판단 |
| --- | ---: | --- |
| Qwen3 30B A3B FP8 | 4,625 / 30,475 | 현재 운영; 원래 전체 의미 평가 실패는 보존 |
| Gemma4 26B A4B | 9,091 / 27,273 | 현재 개선 후보; v7의 독립 Hard Fail을 해결해야 함 |
| Qwen3.8 27B | 40,909 / 290,909 | 목록에 있으나 제한된 무료 평가 예산에서 비용이 크게 늘어남; 요청하지 않음 |
| Kimi K2.6 | 86,364 / 363,636 | 표준 Workers Free 대상이 아니므로 무료 실행 후보에서 제외 |

요율과 유료 접근 예외는 [가격표](https://developers.cloudflare.com/workers-ai/platform/pricing/), 개별 기능은 [Qwen3.8 문서](https://developers.cloudflare.com/workers-ai/models/qwen3.8-27b/)와 [Kimi K2.6 문서](https://developers.cloudflare.com/workers-ai/models/kimi-k2.6/)에서 확인했다. 각 후보의 JumZip 한국어 품질은 실제 원본 평가로 확인해야 한다.

먼저 동일한 원본 입력·평가 기준으로 현재 후보를 검증한다. 호출 전에는 실사용량을 다시 읽고, 요청별 보수적 최대 예약과 실제 usage를 구분한다. 새 후보 비교가 필요하면 모델별 비용·timeout·응답 계약부터 별도로 준비한다.
