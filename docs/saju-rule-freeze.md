# Saju implementation gate

Current adoption state: A–G below were explicitly approved on 2026-09-20 at approximately 02:01 KST. Independent manual expectations were frozen before M8 judgment code. The adopted M8 implementation and its component/golden tests now pass locally; [fixture review](saju-fixture-review.md) records provenance. [Independent calendar evidence](calendar-evidence.md) adds official KASI checks and states their limits. Local checks do not replace actual Edge verification.

Source of truth: [Saju Rules](https://app.notion.com/p/3e07cdef782d818088cac2c9146b290f), [Engineering §12.1/20](https://app.notion.com/p/3df7cdef782d81d7b3a6d28b604f050f), [Acceptance §2/3/11](https://app.notion.com/p/3e07cdef782d81da92ecf20053a3bff9).

## Implemented boundary

`calculateSajuFoundation` wraps exact-pinned `manseryeok@2.0.0`. It returns **FOUNDATION_ONLY**, `fullCalculationReady: false`, `ruleVersion: null`. It must not be persisted or presented as a successful Full v1 reading. The adopted `calculateFullSaju` entry point adds validated M8 judgments with `JumZipSajuRules-v1`; public CALCULATE uses this full entry point.

M7 performs calendar validation, lunar/leap conversion, IANA timezone normalization, the fixed true solar time + splitJasi convention, pillars, library ten gods/gongmang and library daewoon. It does not calculate Strength, Balance, Shinsal, Gyeokguk, monthly overlays or compatibility.

Unknown birth time enumerates every valid minute of the local date, including both instants in a DST fold. It returns common year/month/day values only when all candidates agree. Hour pillar and hour ten gods remain null and no possible hour chart is manufactured. This reference sweep needs an actual Supabase Edge CPU benchmark before production; Node measurements are not a substitute.

The engine accepts Korean wall time and does not have an IANA timezone input. The adapter maps local civil time to UTC, then to a KST bridge with `applyHistoricalDst: false` to avoid applying Korea DST a second time. True solar longitude/EoT remains enabled by default. When solar correction is disabled, only day/hour use the original local civil time; year/month/luck retain the absolute instant. Korea before 1908 follows the pinned engine's documented KST convention and exposes a flag. Other sub-minute historical offsets are explicitly unsupported because the engine input is minute precision. A nonexistent civil time is rejected; an ambiguous one returns possible values. Resolver provenance verification belongs at the server input boundary.

## M7.5 freeze checklist — resolved by adopted A–G below

The implementation does not default these values. This checklist records the gaps that A–G subsequently resolved through explicit user approval; the adopted contract below controls implementation.

| Rule | Must be frozen | Evidence required |
| --- | --- | --- |
| Strength | Seasonal raw/partial points; 40/25/20/10/5 component formulas; main/middle/residual hidden-stem weights; multiple roots/caps; direct/indirect support and duplicates; relations' exact effect; imbalance metric; clamp/normalization/rounding; grade boundaries; missing-hour propagation | Adopted source, component reasons, reference fixtures and boundary cases |
| Balance | Candidate scoring/priority; deterministic precedence; yongsin then heesin selection; whether equal elements are permitted; final fixed tie-break; reason codes | Equal-score fixtures, reasons, versioned rule contract |
| Shinsal | 천을귀인, 문창귀인, 도화, 역마, 화개, 양인, 괴강, 홍염, 백호, 귀문관살: each id/name/referenceType/referenceValue/matchType/mapping/matchAgainst/allowMultiple/adoptedConvention/source | Positive, negative, multiple-match and missing-hour fixtures for each immutable table |

Adjacent result-changing decisions also need explicit resolution: actual 합화 season/root/surrounding-element predicates (§5), multiple exposed hidden stems' Gyeokguk primary/secondary precedence (§9), and the element distribution measure feeding Strength/Balance and UI (§14). Relation presence alone can be computed from the fixed lists; transformation flags cannot be guessed.

## Required reference fixture coverage

Ordinary Korea solar; lunar; leap month; before/after Ipchun; before/after month solar term; 23:00–23:59; 00:00–00:59; unknown time; historical Korea DST; overseas IANA timezone; solar correction changing hour; male/female luck direction. Each fixture needs input, expected values, possible_values/uncertainty_flags where relevant, convention version and reference source. Differential tests against the same library only validate the adapter, not independent astronomical correctness.

Included Node fixtures cover the pinned library's published examples, official KASI date/日辰 and minute-precision solar-term facts, timezone rules, and independent manual full-rule expectations. [Calendar evidence](calendar-evidence.md) distinguishes direct facts, derived convention expectations and unverified areas. Actual Edge CPU measurement and any remaining runtime/deployment checks are separate release gates; Node tests are not substitutes.

References: [v2.0.0 package](https://github.com/yhj1024/manseryeok/blob/v2.0.0/package.json), [time conversion](https://github.com/yhj1024/manseryeok/blob/v2.0.0/src/time/true-solar-time.ts), [README](https://github.com/yhj1024/manseryeok/blob/v2.0.0/README.md).

## M7.5 채택 규칙 — A~G 사용자 승인, 구현·검증 진행

제안 날짜: 2026-09-20. 원 제안 ID: `JumZipSajuRules-v1-proposal-20260920`. **사용자 A~G 명시 승인: 2026-09-20 약 02:01 KST.** 승인된 규칙 버전: `JumZipSajuRules-v1`.

이 절 A~G는 사용자가 구체적으로 채택한 **새 제품 정책**이다. 판단 구현 전에 별도 작성자가 수작업으로 독립 기대값 fixture를 고정한다. 그 다음 구현 테스트와 실제 Edge 검증을 수행한다. 승인 자체가 테스트 통과나 Full Engine 완성을 뜻하지 않는다. 새로운 수치와 우선순위를 전통의 정답이나 경험적으로 검증된 예측력으로 주장하지 않는다. 아래 본문의 '제안' 표현은 채택한 원안의 설명이며, 승인 범위 A~G의 값은 별도 변경 승인 없이 바꾸지 않는다.

| 구분 | 이미 정해진 내용 / 새로 제안하는 내용 |
| --- | --- |
| Notion 계약에서 확정 | 지장간 순서, 십성 생극·음양표, 천간 5합, 지지 관계 목록, 12운성표, Strength 40/25/20/10/5 비중과 5등급 경계, 신살 10종 지원 목록 |
| 자료로 확인한 내용 | 계절·생극과 화기 성립을 구별하는 전통 개념, 아래 신살 대응표와 학파별 차이 |
| JumZip 신규 정책 | 모든 부분 점수·배율·상한·반올림, 합화의 보수적 판정식, 후보 점수·동률 순서, 격국 복수 후보 순위, 불확실성 집계, 신살 판정 범위 |

전통 개념의 근거는 [《삼명통회》 권2, 오행 왕상휴수사·십간합·화기](https://zh.wikisource.org/zh-hant/三命通會/卷二)와 기존 문서가 참조한 [Sean Chan의 지지 관계 설명](https://www.masterseanchan.com/bazi-clashes-and-combinations/)이다. 이 자료들은 **아래 숫자들을 제시하지 않는다**. 숫자는 테스트 가능한 제품 휴리스틱으로 별도 채택하는 것이다.

### A. 공통 수학·오행 분포

오행 고정 순서 `WOOD, FIRE, EARTH, METAL, WATER`를 사용한다. 생성은 이 순서의 다음 오행(순환), 극은 두 칸 뒤 오행이다. `gen(e)`는 e가 생하는 오행, `parent(e)`는 e를 생하는 오행, `control(e)`는 e가 극하는 오행, `controller(e)`는 e를 극하는 오행이다. `clamp(x,a,b)=min(b,max(a,x))`.

천간 오행은 甲乙木/丙丁火/戊己土/庚辛金/壬癸水이다. 지장간의 **Notion 명시 순서**에 다음 질량을 준다. 본기/중기/여기라는 명칭 대신 저장된 순서와 weight를 함께 기록하여 자료별 이름 차이를 피한다.

| 지지 | 제안 질량: 지장간 순서대로 |
| --- | --- |
| 子 | 癸 1 |
| 丑 | 己 .6 / 癸 .3 / 辛 .1 |
| 寅 | 甲 .6 / 丙 .3 / 戊 .1 |
| 卯 | 乙 1 |
| 辰 | 戊 .6 / 乙 .3 / 癸 .1 |
| 巳 | 丙 .6 / 戊 .3 / 庚 .1 |
| 午 | 丁 .7 / 己 .3 |
| 未 | 己 .6 / 丁 .3 / 乙 .1 |
| 申 | 庚 .6 / 壬 .3 / 戊 .1 |
| 酉 | 辛 1 |
| 戌 | 戊 .6 / 辛 .3 / 丁 .1 |
| 亥 | 壬 .7 / 甲 .3 |

알려진 각 천간 질량 1, 각 지지의 지장간 질량 합 1로 계산한다. 4주이면 총질량 8, 시간 미상이면서 3주가 확정이면 6이다. **지지 자체 오행을 다시 더하지 않는다.** 일간도 오행 분포에는 포함한다. `mass[e]`는 해당 오행 질량 합, `p[e]=mass[e]/totalMass`. 합·충·합화는 이 원본 분포를 변조하지 않고 별도 관계/유효성 자료로 기록한다. 아래 판단에 쓰는 분포와 UI 분포는 동일한 값이다.

부동소수점 오차로 결과가 바뀌지 않도록 분수 또는 정수 배율 연산을 사용한다. 계산 중간에는 반올림하지 않는다. 화면 백분율만 소수 첫째 자리로 표시하며 표시값을 재입력으로 사용하지 않는다.

### B. Strength: 다섯 성분의 완전한 산식

`d=일간 오행`, `s(e)=1 (e=d), .75 (e=parent(d)), 0 (그 외)`. 직접 비겁/인성만 지원으로 인정하며 간접 생성 사슬은 추적하지 않는다. 한 천간 또는 한 지장간을 같은 성분 안에서 중복 계수하지 않는다. 서로 다른 성분에서 월지·지원 비율을 다시 관찰하는 것은 이 제안의 의도된 중복 가중이다.

1. **월령 C1, 0~40점.** 계절 대표 오행 `m`: 寅卯木 / 巳午火 / 申酉金 / 亥子水 / 辰戌丑未土. `r1`은 m=d이면 1, m=parent(d)이면 .8, m=gen(d)이면 .4, m=control(d)이면 .2, m=controller(d)이면 .1. `C1=40*r1`. 절기 내부 날짜에 따른 토왕 전환·분일사령은 v1에서 적용하지 않는다.
2. **통근·지장간 C2, 0~25점.** 각 알려진 지지 b에 대해 `root[b]=Σ(hiddenWeight*s(hiddenElement))`. `r2=Σroot[b]/알려진지지수`, `C2=25*r2`. 동일 오행 뿌리가 여러 지지에 있으면 각 지지당 한 번씩 평균에 포함하며 추가 가산은 없다.
3. **천간 지원 C3, 0~20점.** 일간을 제외한 알려진 년·월·시 천간의 `s` 평균이 `r3`, `C3=20*r3`. 시간 미상은 년·월 2개로 나눈다. 일간 자체에 20점을 주거나 투출 지장간을 한 번 더 더하지 않는다.
4. **관계 유효성 C4, 0~10점.** 아래 관계 규칙으로 pool의 전후 지원율 B/A를 계산하여 `C4=clamp(5+10*(A-B),0,10)`. 관계가 없거나 지원율 변화가 없으면 5점이다. C1~C3와 원본 오행 분포를 다시 계산하지 않는다.
5. **편중 C5, 0~5점.** 편중도 `H=Σ(p[e]-.2)^2/.8` (0~1), 지원 질량률 `u=p[d]+.75*p[parent(d)]`. `C5=clamp(2.5+2.5*H*(2*u-1),0,5)`. 균등 분포는 2.5점이며 지원 오행 편중은 이를 올리고 비지원 편중은 내린다.

최종 `rawScore=clamp(C1+C2+C3+C4+C5,0,100)`, `score=floor(rawScore+.5)` (0.5 올림). **반올림된 정수** 기준 65 이상 강, 55~64 약강, 45~54 중화, 35~44 약약, 0~34 약. 예: raw 64.49 → 64/약강, 64.50 → 65/강. 저장값에는 raw 성분, weighted 성분, 분모·분자, rawScore, score, grade, reasonCodes를 모두 포함한다.

#### 관계 유효성과 합화의 제안 정책

관계의 존재 목록은 Notion §5/6 그대로다. 참여자는 오행 문자가 아닌 **기둥 위치 ID**로 구별한다. 같은 type+정렬된 참여자 조합은 한 번만 센다. 중복 지지가 다른 기둥에 있으면 서로 다른 참여 조합을 만들 수 있다. 삼합·삼회·寅巳申형·丑戌未형은 세 글자가 모두 있을 때만 완성 관계를 만든다. 반합/반회/삼형의 두 글자만 있는 경우는 v1에 만들지 않는다. 子卯형은 쌍, 자형은 서로 다른 두 기둥이 같은 지지일 때만 생성한다. 巳申은 합과 파 등 서로 다른 type을 모두 보존한다.

각 지지 효율 `f[b]=clamp(1 + .10*(육합+완전삼합+완전삼회 참여건수) - .25*충 참여건수 - .10*(형+해+파 참여건수), .5,1.25)`. 길흉을 직접 뜻하는 계수가 아니며 Strength 지원의 실효성만 조정하는 정책이다. 원국 관계만 사용한다. 대운/세운/월운은 activation overlay이며 natal Strength를 덮어쓰지 않는다.

천간합 존재는 거리와 관계없이 기록하지만 **합화 인정**은 다음 조건을 전부 만족할 때만 별도 flag를 준다.

- 甲己土 / 乙庚金 / 丙辛水 / 丁壬木 / 戊癸火 중 하나이며 기둥 순서 년-월-일-시에서 이웃한다.
- 어느 한 참여 천간과도 동일 합을 만들 수 있는 세 번째 천간이 없다(쟁합은 미성립).
- 위 계절 대표 오행 m이 화기 target과 같거나 target을 생한다.
- 알려진 지지의 **첫 지장간** 중 target이 하나 이상 있다.
- 합 참여자 외의 보이는 천간 중 target을 극하는 오행이 없다.

이는 출처의 계절·뿌리·주변 조건 개념을 **JumZip이 보수적으로 수치화한 선택**이다. 다른 학파와 동일하다고 주장하지 않는다. 시간 미상은 주변 천간 부재를 검증할 수 없어 합화 flag를 `UNRESOLVED`로 둔다.

C4 pool은 모든 알려진 지장간 질량과 일간을 제외한 보이는 천간(각 1)이다. B는 pool의 원본 `s` 질량 가중 평균. A는 지장간에 해당 지지의 f를 곱한 뒤, 합에 참여하되 합화 미성립인 외부 천간에는 효율 .75를 곱하고, 확정 합화 참여 외부 천간은 target 오행/효율 1로 바꿔 얻는 `s` 가중 평균이다. A의 분모도 조정된 질량 합이다. 미해결 합화는 변환하지 않고 .75를 적용하며 limitation을 기록한다. 여러 미성립 합에 참여해도 .75를 한 번만 적용한다. 합화가 일간과 연결돼도 **기준 일간 d는 바꾸지 않는다**. 재귀 합화·연쇄 재계산은 없다.

### C. Balance: 후보 점수와 동률 처리

정수 Strength score가 55 이상이면 강 쪽, 44 이하이면 약 쪽, 45~54이면 중화로 취급한다. 초기 후보는 강 `{gen(d),control(d),controller(d)}`, 약 `{parent(d),d}`, 중화는 다섯 오행 전부다.

각 오행 e에 대해 `deficit[e]=max(0,.2-p[e])`. `relief[e]`는 e가 x를 설기하거나 극하는 오행인 각 x에 대해 `max(0,p[x]-.2)`를 합한 값이다. 즉 `e=gen(x) OR control(e)=x`일 때 해당 x를 한 번만 합한다.

방향 가산 D는 강일 때 gen(d)=20 / controller(d)=10 / control(d)=5, 약일 때 parent(d)=20 / d=10, 그 외 0이다. 다음 조건으로 조후 가산 T를 계산한다. 복수 조건이 맞으면 더하며, T가 양수인 오행은 초기 후보 밖이어도 후보에 추가한다.

| 조건 | 가산 |
| --- | --- |
| 월지 亥子丑, p[WATER] ≥ .4, p[FIRE] ≤ .1 | FIRE +40 |
| 월지 巳午未, p[FIRE] ≥ .4, p[WATER] ≤ .1 | WATER +40 |
| p[EARTH]+p[METAL] ≥ .6, p[WATER] ≤ .1 | WATER +20 |
| p[WATER] ≥ .4, p[EARTH] ≤ .1 | EARTH +20 |

후보 점수 `balanceScore[e]=300*deficit[e]+200*relief[e]+D[e]+T[e]`. 중간 반올림 없이 비교한다. 정렬 순서는 **balanceScore 내림차순 → T 내림차순 → deficit 내림차순 → WOOD/FIRE/EARTH/METAL/WATER 고정 순서**다. 마지막 순서는 구현 안정성용 제품 선택이며 전통적 우열을 뜻하지 않는다.

첫 후보가 용신. 용신과 동일 오행은 희신 후보에서 제외한다. 남은 후보 중 용신을 생하거나 용신이 생하는 오행이 있으면 그 집합만 동일 comparator로 정렬해 첫 번째를 희신으로 선택한다. 없으면 남은 전체 후보의 첫 번째다. 초기 후보가 최소 2개이므로 시간 있는 확정 원국에서 희신 null은 발생하지 않는다.

`rationale`에는 오행별 p/deficit/relief/D/T/score/rank, 채택 방향, 동률 해소 단계와 반대 요소를 남긴다. 반대 요소는 선택된 용신을 극하는 `controller(yongsin)` 및 용신이 보완하려는 과다 오행 목록으로 명시한다. reasonCodes는 `WEAK_SUPPORT`, `STRONG_DRAIN`, `STRONG_CONTROL`, `BALANCED_DEFICIT`, `COLD_FIRE`, `HOT_WATER`, `DRY_WATER`, `WET_EARTH`, `EXCESS_RELIEF`, `TIE_CLIMATE`, `TIE_DEFICIT`, `TIE_FIXED_ORDER`, `HEESIN_GENERATION_ALIGNMENT`, `HEESIN_REMAINING_CANDIDATE` 중 실제 적용한 것만 기록한다.

### D. 격국 복수 후보의 순위

월지 지장간 순서에서 년/월/시 천간에 정확히 같은 글자로 드러난 지장간을 먼저 나열한다. 드러난 후보끼리는 지장간 순서(첫째→둘째→셋째), 같은 후보의 증거 위치는 월→년→시 순이다. 일간과 글자가 같다는 이유만으로 투출로 세지 않는다. 투출 후보가 없으면 첫 지장간 하나를 기본 후보로 삼는다.

이 순서의 첫 후보 십성이 표준 8격이면 primary, 나머지 서로 다른 표준 8격은 secondary다. 첫 후보가 비견/겁재이면 primary를 억지로 8격에 맞추지 않고 null, `monthCore=비견|겁재`, standard 8격 후보만 secondary로 둔다. 일간의 12운성표에서 월지가 임관이면 `건록` flag, 아래 양인 표의 월지 match이면 `양인` flag를 별도로 기록한다. 해당하지 않으면 둘 다 false. 합화·종격·특수격은 candidate만 가능하며 이 버전에서 자동 확정하지 않는다.

### E. 신살 10종 Canonical Mapping 채택안

공통 저장 필드: `id/name/referenceType/referenceValue/matchType/mapping/matchAgainst/allowMultiple/adoptedConvention/source/evidence`. `evidence`는 기준 기둥과 일치한 기둥의 위치/글자를 포함한다. 연·월·일·시 순으로 정렬하며 모든 행 `allowMultiple=true`. 누락 시주는 판정 대상에서 제외하고 `LIMITED_UNKNOWN_HOUR`를 붙인다. 해석에서 질병·사고·정신건강·성적 성향을 사실로 추론하지 않는다.

| id / 이름 | referenceType / matchType / matchAgainst | 채택 대응표 및 차이 |
| --- | --- | --- |
| CHEONEUL / 천을귀인 | dayStem / branch / year,month,day,hour | 甲戊→丑未; 乙己→子申; 丙丁→亥酉; 庚辛→寅午; 壬癸→巳卯. 주야귀인 구분 없이 [허유의 현대 대응표](https://www.dk-saju.com/sinsal/천을귀인)를 채택. 庚의 귀인을 다르게 배치하는 전승과 혼용하지 않는다. |
| MUNCHANG / 문창귀인 | dayStem / branch / year,month,day,hour | 甲→巳; 乙→午; 丙戊→申; 丁己→酉; 庚→亥; 辛→子; 壬→寅; 癸→卯. [채택 출처](https://www.dk-saju.com/sinsal/문창귀인). |
| DOHWA / 도화 | yearBranch와 dayBranch를 각각 독립 기준 / branch / year,month,day,hour | 寅午戌→卯; 巳酉丑→午; 申子辰→酉; 亥卯未→子. [채택 출처](https://www.dk-saju.com/sinsal/도화살). 연지 기준과 일지 기준을 합쳐 하나의 근거로 숨기지 않는다. |
| YEOKMA / 역마 | yearBranch와 dayBranch 각각 / branch / year,month,day,hour | 寅午戌→申; 巳酉丑→亥; 申子辰→寅; 亥卯未→巳. [채택 출처](https://www.dk-saju.com/sinsal/역마살). |
| HWAGAE / 화개 | yearBranch와 dayBranch 각각 / branch / year,month,day,hour | 寅午戌→戌; 巳酉丑→丑; 申子辰→辰; 亥卯未→未. [채택 출처](https://www.dk-saju.com/sinsal/화개살). 기준 기둥 자신이 대응값인 경우도 인정한다. |
| YANGIN / 양인 | dayStem / branch / year,month,day,hour | 甲→卯; 丙戊→午; 庚→酉; 壬→子. 乙丁己辛癸는 빈 대응표. 음간 양인을 추가하는 전승을 채택하지 않는다. [현대 채택표](https://www.dk-saju.com/sinsal/양인살), [《삼명통회》 사고전서본 권5, 양인](https://zh.wikisource.org/zh/三命通會_(四庫全書本)/卷05). |
| GOEGANG / 괴강 | dayPillar / exactPillar / day only | **庚辰, 壬辰, 戊戌, 庚戌** 네 일주. [《삼명통회》 권6 괴강](https://zh.wikisource.org/zh-hant/三命通會/卷六)의 네 날을 채택. [현대 자료](https://www.dk-saju.com/sinsal/괴강살)의 壬戌 포함 또는 戊辰 추가 전승과 차이가 확인되어 섞지 않는다. |
| HONGYEOM / 홍염 | dayStem / branch / year,month,day,hour | 甲乙→午; 丙→寅; 丁→未; 戊己→辰; 庚→戌; 辛→酉; 壬→子; 癸→申. 특히 **己→辰**은 [채택한 현대 자료](https://www.dk-saju.com/sinsal/홍염살)의 규칙이다. 다른 己 대응표를 암묵적으로 대입하지 않는다. |
| BAEKHO / 백호 | eachPillar / exactPillar / year,month,day,hour | **甲辰, 乙未, 丙戌, 丁丑, 戊辰, 壬戌, 癸丑**. [채택 출처](https://www.dk-saju.com/sinsal/백호살). 일주 여부를 evidence로 구별하되 연월시 match도 보존하는 범위는 JumZip 선택이다. |
| GWIMUN / 귀문관살 | natalBranchPair / unorderedBranchPair / 서로 다른 두 기둥의 모든 조합 | **子酉, 丑午, 寅未, 卯申, 辰亥, 巳戌**. [현대 채택 출처](https://www.dk-saju.com/sinsal/귀문관살). 거리에 따른 강도 점수는 만들지 않는다. 《삼명통회》 권3에 유사 쌍이 있어도 이름이 다른 항목이므로 동일 명칭의 고전 근거라고 인용하지 않는다. |

yearBranch/dayBranch가 모두 같은 지지를 참조해 같은 기둥에 매치하면 UI는 신살 항목을 한 번 표시할 수 있지만 저장 evidence에는 두 기준을 모두 남긴다. 참고 자료가 말하는 인생 사건·성격 단정은 lookup 사실과 구분하여 데이터셋에 가져오지 않는다. 위 현대 페이지들은 **해당 저자가 채택한 관례의 1차 자료**이며 학계 합의나 과학적 검증을 의미하지 않는다.

### F. 모름·경계·버전 처리

시간 미상은 임의 시주를 만들지 않는다. 확정 3주만으로 A~D의 분모를 재정규화한 `limited` 판단을 만들 수 있지만, 합화와 시주 기반 신살은 확정하지 않는다. 이 정책은 출생시간을 추정하는 것이 아니다. 월/일/년이 경계 때문에 여러 값이면 M7이 얻은 **실제로 가능한 3주 조합별**로 계산한다. 각 기둥의 가능값을 카테시안 곱으로 합쳐 존재하지 않는 조합을 만들지 않는다.

후보별 모든 계산 결과를 `possible_values`에 보존한다. score가 모두 같을 때만 단일 score, grade가 모두 같을 때만 단일 grade, 용신/희신도 각 필드가 전 후보에서 같을 때만 단일 값을 둔다. 그렇지 않으면 해당 값은 null과 가능한 값 목록이다. 신살은 모든 후보에 존재하는 동일 evidence만 confirmed, 일부 후보에서만 나타나면 possible로 둔다. 누락 시주로 인해 관측하지 못한 match는 false로 단정하지 않는다. 제안 채택 시 규칙/컨벤션 버전을 올려 저장하며 과거 snapshot을 재계산해 덮어쓰지 않는다.

### G. 승인 후 구현 전에 만들 독립 기대값

1. A의 12지 질량 합=1, 완전 원국 총질량=8, 알려진 3주=6; 같은 천간/지지를 여러 번 포함한 분포 수작업 계산.
2. C1의 5관계 기대값 **40/32/16/8/4**, C2/C3의 무지원/반지원/완전지원, C4의 무관계=5·합충 중첩·쟁합·합화 다섯 predicate 반례, C5 균등=2.5/일간과 같은 단일오행=5/인성 단일오행=3.75/비지원 단일오행=0. ('지원 단일오행=5'라는 원안의 축약 표현은 B의 정확한 u 산식에 따라 일간과 같은 오행을 뜻한다.)
3. 최종 rawScore 34.49/34.50, 44.49/44.50, 54.49/54.50, 64.49/64.50의 등급 경계. 라이브러리 결과에서 복사하지 않은 수작업 분수 기대값을 fixture 옆에 기록.
4. Balance 강/약/중화 각 방향, 각 조후 조건의 정확 경계, 같은 score의 T/deficit/고정순서 tie, 희신 생성 정렬/대체 정렬, 용신≠희신.
5. 신살 각 행마다 positive/negative/multiple/unknown-hour, year와day 기준 동시 hit, 괴강 戊戌 positive·壬戌 negative, 홍염 己辰 positive·己巳 negative, 음간 양인 empty, 귀문 비인접 쌍.
6. 격국 월지 지장간 둘 이상 투출, 동일 십성 중복, 비겁 primary null, 건록/양인 구분; 시간 미상·절기/자시 후보에서 동일/상이 필드 집계.

### H. 현재 M7 fixture의 출처 등급

| 종류 | 현재 범위 | 검증 한계 |
| --- | --- | --- |
| 고정된 공개 기대값 | 라이브러리 v2.0.0 README/CHANGELOG의 1992-10-24 05:30 임신/경술/계유/을묘, 음력 동등 날짜, splitJasi 사례, 입춘 2024-02-04 17:26/17:28, 진태양시 시주 변화, 공망 예시 | 테스트 시 실행 출력에서 복사한 값은 아니지만 **라이브러리 작성자와 독립된 천문 교차검증은 아니다**. |
| 어댑터 differential/property | 윤달 변환 뒤 같은 라이브러리 계산 비교, Korea DST, 월 절기 경계 라이브러리 term, 1440분 공통값, 뉴욕 DST gap/fold, 성별 대운 순역 | 변환·보존 속성을 검증한다. 기초 천문 알고리즘의 독립 정답 증명이 아니다. |
| 아직 필요한 release evidence | 제3의 명시된 기준에 의한 절기/4주 기대값, 실제 Edge/Deno 실행과 CPU, 12개 acceptance 사례의 완전 결과 필드, 승인된 M7.5 판단 fixture | 현재 M7 Node pass를 M8 Full Saju 완료로 부르지 않는다. |
