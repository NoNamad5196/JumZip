# Independently frozen Saju expectations

The user approved sections A–G of `saju-rule-freeze.md` on 2026-09-20. `tests/domain/frozen-expectations.ts` fixes expectations before the M8 judgment engine is implemented. No expectation was copied from a production implementation, calendar library output, or generated chart result. All arithmetic below follows the approved product policy; it does not establish predictive validity.

These are **synthetic component fixtures**, not astronomical golden fixtures. Some pillar tuples intentionally do not correspond to a possible calendar instant or sexagenary pairing. They isolate rule behavior. Existing astronomical/calendar release gates remain separate.

## Exact component arithmetic

All fractions in the fixture are literal numerator/denominator pairs. The helper only recursively freezes data; it calculates no expectation. Element arrays always use WOOD/FIRE/EARTH/METAL/WATER. Hidden masses are integer tenths and every branch totals ten tenths. Branch elements are never counted again.

- C1: a WOOD day sees 卯/子/午/未/酉 seasons as same/parent/generated/controlled/controller, giving 40/32/16/8/4.
- C2 weighted four: 寅 contributes 3/5; 子 contributes 3/4; 辰 contributes 3/10 + (1/10 × 3/4) = 3/8; 酉 contributes 0. Their sum is 69/40; average 69/160; weighted result 345/32.
- C2 weighted three: 子+寅+辰 sum 69/40 divided by three is 23/40; C2 = 115/8. This tests the unknown-hour denominator rather than inventing a fourth root.
- C3 external 甲/壬/丙 contributes 1 + 3/4 + 0: average 7/12; C3 = 35/3. Without the hour, 壬/甲 average 7/8; C3 = 35/2. The day stem itself is excluded.
- C4 one clash: chart 丙寅/丁申/甲午 has 寅申 clash only. The incomplete 寅午 relation is absent. Root support is .6 + .225 = .825; two external FIRE stems give raw pool mass 5, hence B=33/200. After factors .75/.75/1, support becomes .61875 and pool mass 4.5, A=11/80. C4=5+10(11/80−33/200)=189/40.
- C4 overlap: 丙子/丁丑/甲午 has 子丑 combine, 子午 clash, 丑午 harm. Factors are .85/1/.65. B=(.75+.225)/5=39/200; A=(.75×.85+.225)/4.5=23/120; C4=149/30.
- C5 uniform H=0 gives 5/2. Same-element mono H=1,u=1 gives 5; parent-only mono H=1,u=3/4 gives 15/4; unsupported mono H=1,u=0 gives zero.
- Half-up grade fixtures bracket every boundary at raw .49 and .50. Clamp precedes rounding.

The transformation fixtures isolate all five predicates: adjacency, no competitor, eligible season, first-hidden-stem root, and no outside controller. A separate case accepts a season that generates the target; missing hour is UNRESOLVED. Presence of other relations does not alter these predicates. The competing case records .75 only once per external stem even if that stem participates in multiple failed combinations.

## Synthetic chart 1: 甲寅 / 甲寅 / 甲寅 / 甲寅

Four visible WOOD masses plus four 寅=(.6 WOOD,.3 FIRE,.1 EARTH) give masses (6.4,1.2,.4,0,0), total 8, proportions (4/5,3/20,1/20,0,0).

C1=40, C2=25×.6=15, C3=20. There is no eligible complete branch relation, self-punishment, or stem combination. C4=5; B=A=(2.4+3)/7=27/35.

H=((.8−.2)²+(.15−.2)²+(.05−.2)²+2×(.0−.2)²)/.8=93/160. u=4/5. C5=5/2+(5/2)(93/160)(3/5)=1079/320. Total=26679/320=83.371875 → **83, 강**.

Strong candidates: FIRE gets deficit 15 + relief 120 + direction 20 =155; EARTH gets 45+0+5=50; METAL gets 60+120+10=190. 용신 METAL; 희신 EARTH is the generation-aligned remaining candidate, although FIRE has the higher remaining score. Month hidden 甲 is exposed: primary null, monthCore 비견, 건록 true, 양인 false. None of the ten Shinsal match.

## Synthetic chart 2: 壬子 / 甲寅 / 甲辰 / unknown hour

Visible masses are WOOD=2,WATER=1. 子 adds WATER=1; 寅 adds (.6 WOOD,.3 FIRE,.1 EARTH); 辰 adds (.3 WOOD,.6 EARTH,.1 WATER). Totals are (2.9,.3,.7,0,2.1), total 6. The missing hour adds neither a stem nor a branch.

C1=40; C2=115/8; C3=35/2; C4=5. 子辰 half-combination and 寅辰 incomplete seasonal combination are absent. Sum of squared proportions is 67/180, so H=(67/180−1/5)/(4/5)=31/144. u=29/60+(3/4)(7/20)=179/240. C5=5/2+(5/2)(31/144)(59/120)=19109/6912. Total=550469/6912≈79.6396 → **80, 강**.

Strong Balance: FIRE 45+170/3+20=365/3; EARTH 25+30+5=60; METAL 60+170/3+10=380/3. 용신 METAL, 희신 EARTH. No climate threshold is met. Month 甲 exposure gives primary null/monthCore 비견, 건록 true. Year 子 and day 辰 each independently reference the 申子辰 group: YEOKMA matches month 寅 twice by reference; HWAGAE matches day 辰 twice by reference. Day 甲辰 also gives one BAEKHO exact-pillar hit. The hour is excluded and LIMITED_UNKNOWN_HOUR remains visible; no unobserved hour match is declared false.

## Balance and evidence review

The climate tie fixture (.3,.1,.1,.1,.4), neutral WOOD in 子, gives FIRE=30+20+40=90 and EARTH=30+40+20=90; FIRE wins T=40 over T=20. The deficit tie (.2,.1,.35,.2,.15) gives WOOD/FIRE/METAL=30: FIRE's deficit .1 wins, then WOOD precedes METAL by fixed order. Uniform neutral proportions isolate the final fixed tie. Weak/strong threshold inputs are exactly 44 and 55.

Climate tables include exact inclusive boundaries, misses by .0001 on both inequalities, and additive HOT_WATER+DRY_WATER=60 / COLD_FIRE+WET_EARTH. A weak WATER case expands the candidates with FIRE and EARTH. The heesin fallback fixture selects EARTH with only WOOD/WATER remaining, neither generation adjacent, so WOOD wins the ordinary comparator. Every case has different yongsin and heesin.

All ten Shinsal rows include positive/multiple evidence, an explicit negative chart, and expected evidence after removing the positive chart's hour. GOEGANG deliberately remains one day-only hit despite four qualifying pillars: allowMultiple does not broaden matchAgainst. The canonical tables additionally freeze all ten stems, all branch groups, all exact pillars and all six unordered pairs. DOHWA/YEOKMA/HWAGAE preserve both year and day references; HWAGAE accepts a self-reference; GWIMUN includes a nonadjacent year/hour pair. Required convention negatives include 壬戌 as non-GOEGANG, 己巳 as non-HONGYEOM, and every yin YANGIN stem having an empty table.

Gyeokguk cases cover three exposed candidates, nonstandard first candidate with standard secondaries, duplicate exposure positions (month/year/hour), fallback first hidden stem, excluding day-stem exposure, and separate 건록/양인 flags. Aggregation fixtures compare each field independently: common grade does not authorize a single score, and a common yongsin does not authorize a single heesin. Real correlated astronomical candidate aggregation still needs its own adapter tests.

## Review constraints

Consumers should compare exact rational results where the engine exposes them, or tightly bounded numeric conversions otherwise. They must not regenerate this fixture file from engine outputs. A mismatch requires a derivation review against the approved document. Reasons and evidence sets should be checked independently of display ordering where the policy permits UI grouping.

These fixtures do not close independent solar-term/astronomical validation, actual Edge runtime/CPU evidence, authenticated persistence/retry tests, or final release acceptance.

Pre-implementation cross-review correction: the second synthetic chart's day 甲辰 was checked against the literal BAEKHO table and its initially omitted hit was added. This correction comes from the approved table, not an engine output.

Predicate-isolation review: the competing-stem case uses a second 己 outside the 甲己 pair. A second 甲 would also be an external EARTH controller, conflating two failed predicates. The expected non-transformation and .75 factor are unchanged; the revised input isolates NO_COMPETITOR by direct policy reasoning.
