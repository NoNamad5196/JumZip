# Independent foundation expectations

Prepared on 2026-09-20. The expected-value file was written before running JumZip or manseryeok against these cases. It imports neither implementation nor library. Concrete pillar names, all checked ten-god pairs, void branches and luck directions are literal manual expectations. Reuse of an identical literal chart and recursive freezing do not calculate expected results.

The source is the already reviewed [KASI 2024 almanac](https://astro.kasi.re.kr/file/astro_almanac_pdf/20231023135218580.pdf), SHA-256 `967fcf5dba1ab002ab0627ae39b6863af60ec96e2d742d1764056fa300fff7dc`, and the fixed IANA 2026d rules in [calendar-evidence-fixtures.ts](../tests/domain/calendar-evidence-fixtures.ts). [Calendar evidence](calendar-evidence.md) records the rendered-page review and original precision. KASI supplies calendar, daily sexagenary and solar-term facts. It does **not** certify the following astrological product conventions or their predictive validity.

## Derivation rules

The already adopted rules are recorded in [the rule freeze](saju-rule-freeze.md), with Notion Saju Rules and Engineering as their source. This file does not introduce a new boundary or fortune-telling rule. Only the installed library's public TypeScript declarations were consulted for output field names (`stem`, `branch`, `일간`, `forward`, `pillar`); neither library source computations nor runtime outputs supplied an expected value.

- Year uses the adopted Ipchun boundary and annual sexagenary cycle; month uses the adopted twelve *jie*, not KASI's lunar month label. Five Tiger starts are 甲己→丙寅, 乙庚→戊寅, 丙辛→庚寅, 丁壬→壬寅, 戊癸→甲寅; subsequent months advance both characters. Before the 2024 boundary the previous 癸 year ends at 乙丑; afterward 甲 year's 寅 month is 丙寅.
- Five Rat hour starts are 甲己→甲子, 乙庚→丙子, 丙辛→戊子, 丁壬→庚子, 戊癸→壬子. Advance one stem per two-hour branch. Under the adopted split-Jasi rule, 23:30 retains the current daily pillar while its 子 hour uses the following day's stem. At 00:30 both use the new day.
- Compare each target stem with the day master: same/opposite polarity gives self 比肩/劫財, output 食神/傷官, wealth 偏財/正財, controlling element 偏官/正官, resource 偏印/正印. Branch targets are the adopted first hidden stems: 子癸、丑己、寅甲、卯乙、辰戊、巳丙、午丁、未己、申庚、酉辛、戌戊、亥壬. The day stem's display label is `일간`.
- The six ten-day groups have voids: 甲子→戌亥, 甲戌→申酉, 甲申→午未, 甲午→辰巳, 甲辰→寅卯, 甲寅→子丑. For example, 甲辰 and 乙巳 belong to 甲辰旬; 戊戌/丁酉/丙申 belong to 甲午旬; 戊辰/癸酉/丙寅 belong to 甲子旬.
- Yang-year men and yin-year women move forward; yin-year men and yang-year women move backward. The first luck pillar is the next/previous month-cycle step. These fixtures do not assert independent exact start age, start duration, or civil start dates.

## Manual anchors and 12 acceptance classes

The fixture contains 22 cases spanning the 12 requested classes, with complete derived fields in 17 cases, explicit rejection in two, and deliberately partial derived fields in three. “Complete” below means the selected foundation fields (four pillars or explicit unknown hour, ten gods, gongmang and applicable direction), not a complete externally certified astrological reading.

| Class | Manual anchor and expected result | Coverage |
| --- | --- | --- |
| Solar | KASI p8 Feb10=甲辰. After Ipchun/before Gyeongchip: 甲辰/丙寅/甲辰/庚午 at civil noon. 甲's hour 庚 is 偏官, 午's core 丁 is 傷官; void 寅卯. | Complete derived fields |
| Lunar | KASI p8 lunar2024-01-01=Feb10甲辰; same noon chart and ten gods. | Complete derived fields |
| Leap month | KASI p227 ordinary2020-04-01=Apr23丙申, leap2020-04-01=May23丙寅. 丙 noon starts 戊子+6→甲午. The two days have voids 辰巳 and 戌亥 respectively. | Partial: no independently transcribed 2020 Jie brackets for either month pillar |
| Ipchun | Feb10甲辰−6 days=Feb4戊戌. KASI17:27 is bracketed by17:20 and17:40, well outside its60-second precision tolerance. 癸卯/乙丑 becomes甲辰/丙寅; 戊戌/辛酉 remain. | Complete derived fields, both sides |
| Monthly Jie | Feb10甲辰+24 days (19 remaining February days+5 March days)=Mar5戊辰. KASI11:23 is bracketed by11:10/11:35. 丙寅 becomes丁卯; 戊午 hour stays. | Complete derived fields, both sides |
| 23h | KASI p14 Feb10甲辰; product split-Jasi yields 丙子 from next乙 day's hour stem. Current甲 DM makes 丙/癸=食神/正印. | Complete derived fields |
| 00h | KASI p14 Feb11乙巳; 丙子 now belongs to current乙 day, so 丙/癸=傷官/偏印. | Complete derived fields |
| Unknown time | Civil correction OFF: Feb10 has1440 valid minutes and one triple甲辰/丙寅/甲辰; Feb4 has exactly two correlated triples癸卯/乙丑/戊戌 and甲辰/丙寅/戊戌. No exported hour. | Complete derived common fields and exact joint chart sets |
| Korea DST | IANA1988May8 jumps02:00→03:00, so02:30 must reject. Oct9's02:30 occurs atUTC previous16:30 and17:30. KASI1992Sep26乙巳−1448 days→丁酉; 丁02:30=辛丑. | Gap rejection plus partial fold fields; 1988 month bracket unavailable |
| Overseas IANA | New York2024Mar10 15:00 after DST is19:00UTC/Mar11 04:00KST. Absolute year/month remain甲辰/丁卯; civil-OFF uses localMar10 KASI癸酉 and癸's申 hour庚申. Same-day02:30 is a gap. | Complete adopted fields plus gap rejection; no independent foreign astronomical claim |
| Apparent hour | KASI p14 Seoul transit12:46:16 implies07:05≈06:18:44 apparent, over40 minutes from the nearest hour boundary. Civil戊辰 becomes apparent丁卯 on the same甲辰 day. | Complete derived fields; no second-level EoT claim |
| Luck direction | At甲year丙寅month: male next丁卯/戊辰/己巳, female previous乙丑/甲子/癸亥. At癸year乙丑month: male previous甲子/癸亥/壬戌, female next丙寅/丁卯/戊辰. | All four polarity/sex combinations, first three cycle pillars only |

The Korea fold day difference is independent calendar arithmetic: Oct9 1988→Oct9 1992 is365+365+365+366=1461 days; subtract13 to reachSep26 gives1448. A60-day cycle removes1440, leaving eight steps backward from乙巳 to丁酉. This is a derivative of the published1992 day, not a separately printed1988 KASI daily value.

For all non-apparent examples solar correction is explicitly OFF to separate daily/hour rules from unverified equation-of-time accuracy. Overseas year/month still use absolute time under the adopted adapter convention. The separate apparent-hour pair uses KASI's published transit and a wide boundary margin.

## Remaining facts and comparison protocol

This does not close a claim that all 12 classes possess externally certified complete four-pillar goldens. The missing independent facts are the 2020 清明/立夏/芒種 brackets and1988 寒露/立冬 brackets for the selected leap and Korea-fold dates. Their month fields are **omitted** from the expected object, not set to a false `null`. Unknown-time `null` values instead mean the adopted rules require withholding a single value. Exact luck-start duration and full supported-year calendar coverage remain separate evidence.

The expectation-file SHA-256 was sent to Main before the comparison test was written/run: `498d2d4c82c290cd8e58d406d453ea1816c207c7a785f236bfe01efcd1cfaa1c`. Any failure must be investigated against these fixed facts; expected values or tolerance must not be rewritten from implementation output.

The original raw freeze and the LF-normalized source both have that same SHA-256; direct inspection found the original source already uses LF. The comparison normalizes only CRLF to LF before hashing so Git checkout transport cannot cause a Windows/Linux mismatch. No expected literal was edited for this portability change.

```sh
node node_modules/vitest/vitest.mjs run tests/domain/foundation-independent.test.ts
```

Comparison on 2026-09-20 at04:45 KST: **23 tests passed** (22 cases plus the unchanged-byte freeze check). Whole TypeScript checking and scoped ESLint passed. There were no expectation changes after observing implementation output. The case test checks each present literal pillar/ten-god pair, gongmang, candidate count, required flags, exact correlated unknown-time chart sets, and the four applicable luck directions with first three pillar steps. These results retain the partial-evidence limits above and make no remote Edge, CPU, or exact luck-start claim.
