# JumZipLuckTiming-v1 — adopted civil-date convention

Status: **adopted and locally implemented**, 2026-09-20 KST. This document records the user's explicit approval and the resulting M9 behavior. Remote deployment and live endpoint evidence are separate acceptance steps.

## Approval and scope

The user was shown this specific proposal:

> M9의 ‘현재 대운’ 선택에는 기존 문서에 없는 시작일 변환 규칙이 필요합니다. 라이브러리의 시작 연·월을 출생지의 양력 생일에 더하고(없는 날짜는 그달 말일), 시작 일수를 더한 뒤 10년 구간을 시작일 포함·종료일 제외로 계산하는 제품 규칙을 채택할까요? 출생 시각이 불명확한 경계는 확정하지 않습니다.

The user answered: **“제안 규칙 채택 후 검증·구현”**.

The original [Engineering specification](https://app.notion.com/p/3df7cdef782d81d7b3a6d28b604f050f) and [Saju specification](https://app.notion.com/p/3e07cdef782d818088cac2c9146b290f) required current daewoon, sewoon and monthly overlays, but did not freeze this duration-to-civil-date rule. This is an explicitly selected product convention, not a claim that the new date arithmetic is uniquely authoritative traditional practice or an astronomical observation.

The existing natal convention remains `JumZipSajuConvention-v1`; the approved natal judgment rules remain `JumZipSajuRules-v1`. New timing snapshots add `timing.conventionVersion: "JumZipLuckTiming-v1"` and `timing.luck.ruleVersion` with the same value. `manseryeok@2.0.0` remains pinned exactly.

## Date arithmetic

1. Validate the input and convert a lunar date, including leap-month selection, to its verified solar civil date. Retain the birth location's IANA timezone only as transient calculation input.
2. Read the pinned library's `startYears`, `startMonths` and `startDays`. Do not select periods from rounded `startAge`, and do not reinterpret its displayed `age` as an exact date.
3. Apply years and months **together** to select one target year/month. Clamp the original birth day once to the last valid day of that target month. Then add the whole start days.
4. Let this first date be `S`. Boundary `i` is `S` plus `10*i` calendar years, clamping February 29 where necessary. Each boundary is anchored to `S`, rather than repeatedly adding ten years to the preceding clamped date.
5. Select a generated period using `startDate <= asOfLocalDate < endDate`, where `asOfLocalDate` is the current instant's civil date in the birth location.

Combining years/months and anchoring every decade to the first start are explicit arithmetic elaborations of the approved rule. They prevent implementation order from changing results: 2000-02-29 + 1 year + 1 month becomes 2001-03-29; boundaries from 2000-02-29 include 2010-02-28 and 2020-02-29.

Luck boundaries have **DAY precision**. UTC `Date` values in the arithmetic helper are merely calendar carriers; no midnight birth time or exact transition instant is inferred. The separate sewoon/monthly calculation retains its existing MINUTE precision and solar-term basis. Its Korean calendar label must not be confused with the birth-location date used to select current daewoon.

## Finite coverage and uncertainty

The pinned library supplies ten daewoon pillars in the current foundation call. The implementation selects only within those ten periods. Before the first start, status is `NO_ACTIVE_PERIOD`; after the last excluded boundary, it is `OUTSIDE_COMPUTED_RANGE`, with an explicit limitation. It does not fabricate additional pillars or label exhausted coverage as absence of a future daewoon. Missing gender remains `UNRESOLVED` with `DAEWOON_REQUIRES_GENDER`.

The existing foundation enumerates all valid civil minutes for unknown birth time and both instants of a DST fold. M9 retains the actual `(chartIndex, luckIndex)` pairs produced by those candidates. Independently deduplicated natal and luck lists are never combined into a Cartesian product. Unknown-time output continues to have a null natal hour; sampled minutes and UTC birth instants are not exported.

`ACTIVE` requires agreement on the whole current period, including its dates. If candidates disagree on its dates or selection, status is `UNCERTAIN`, and `currentPeriod` is null. A common `currentPillar` may still be reported when every actual candidate has the same pillar. Candidate-specific start dates and the joint links remain available. If all candidates are before their first start, current status can be `NO_ACTIVE_PERIOD` even though future boundary dates vary. This distinction is covered by tests.

The ten displayed period summaries preserve `startDate`/`endDate` as null when not common to all candidates and provide earliest/latest date envelopes. These envelopes are bounds, not a claim that every enclosed date is possible or has an assigned probability. Exact possibilities remain in `possible_values.luckTiming`. A `pillars` disagreement remains null in the summary rather than choosing a representative.

## Runtime and snapshot contract

- Runtime entry: `calculateFullSajuWithTiming(input, asOf)` in `supabase/functions/_shared/domain/fortune-timing.ts`. One foundation sweep supplies natal and luck candidates; an inexpensive validation/conversion supplies the transient solar civil date.
- `possible_values.chartLuck`: actual `{chartIndex,luckIndex}` pairs. A null luck index represents absent luck data.
- `possible_values.luckTiming`: `{luckIndex,firstStartDate,currentIndex,status}` for each detailed luck candidate.
- `possible_values.timing`: `{chartIndex,luckIndices,sewoon,monthlyFortune}`. Equivalent overlays are deduplicated by natal chart and current daewoon pillar, with every supporting luck index retained.
- Flat sewoon/monthly interactions are the intersection across all actual overlay candidates. Participants keep NATAL/DAEWOON/SEWOON/MONTHLY identity. No overlay creates a new natal transformation or changes Strength, Balance or Shinsal.
- `timing.luck` contains the version, DAY precision, date basis, current birth-location civil date, confirmed current period/pillar, ten period summaries, candidate count and limitations. It contains no raw birthday, birth clock time, coordinates, city name or timezone.
- Compatibility uses one shared `asOf`, retains safe derived chart/luck correlations for each person, and treats only `ACTIVE`/`NO_ACTIVE_PERIOD` as confirmed for its current-daewoon limitation check. Its compact prompt carries only each person's minimal current-luck metadata.

Legacy `withFortuneTiming(result,asOf,activePillar?)` remains available for existing snapshots and tests. Calling it without a resolved current pillar retains `UNRESOLVED` behavior and does not stamp the adopted date convention. Retries must use their saved snapshot, not silently recalculate an old reading with this newer timing version.

## Verification and provenance

Main froze `tests/domain/luck-start-expectations.ts` **before** selection arithmetic was implemented. This implementation did not edit that file. Its independent manual expectations cover eight start dates, seven anchored decade cases and four timezone-midnight cases. These values validate the user-selected product arithmetic, not astronomical accuracy.

`tests/domain/luck-timing.test.ts` adds 29 tests: those 19 manual cases, finite coverage, invalid inputs, active-period integration with unchanged natal results, independently sourced lunar-date equivalence, actual chart/luck correlation at Ipchun, uncertain current boundaries, confirmed before-first status despite uncertain future dates, DST-fold alternatives, absent gender and exhausted coverage, plus prompt/snapshot privacy and size bounds. The lunar correspondence is independently sourced in `tests/domain/calendar-evidence-fixtures.ts`; the full engine integration assertions and sampled candidate comparisons are explicitly **not independent astronomical goldens**.

Validation on 2026-09-20 03:38 KST:

```text
node node_modules/vitest/vitest.mjs run tests/domain/luck-timing.test.ts tests/domain/full-saju.test.ts tests/domain/saju.test.ts tests/backend/fortune-timing.test.ts tests/domain/saju-compatibility.test.ts tests/persona/saju-benchmark.test.ts
153 passed, 6 files

node node_modules/eslint/bin/eslint.js supabase/functions/_shared/domain/saju.ts supabase/functions/_shared/domain/full-saju.ts supabase/functions/_shared/domain/fortune-timing.ts supabase/functions/_shared/domain/saju-compatibility.ts tests/domain/luck-timing.test.ts --max-warnings 0
passed

node node_modules/typescript/bin/tsc --noEmit
passed
```

A separate local Node integration measurement for unknown-time 2024 Ipchun, queried at 2036-09-20, retained three natal charts, 122 detailed luck candidates, 123 actual joint links and three distinct overlay variants. One local sweep took **105 ms wall time**. Its full JSON was 161,551 UTF-8 bytes; a known-person/unknown-person compatibility snapshot was 96,945 bytes. Compact Saju/compatibility tool data measured 6,323/13,647 characters, and full Persona prompt construction passed the 24k context guard. These are local measurements for specified examples, not worst-case coverage, Edge CPU measurements or remote acceptance.

Remote endpoint validation, frontend timeline review, and real Persona interpretation quality remain separate evidence. This change does not turn library differential tests into independently verified astronomical calculations.
