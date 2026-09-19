/** Independently hand-calculated expectations for approved M7.5 A–G.
 * No production engine, calendar library, or calculated engine output is imported here.
 * Fractions are exact; pillar charts are SYNTHETIC COMPONENT FIXTURES, not astronomical goldens.
 * Evidence shorthand: `day>year` = day reference matches year; `year+hour` = unordered pair.
 */
function freeze<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}

export const FROZEN_SAJU_EXPECTATIONS = freeze({
  provenance: { kind: 'SYNTHETIC_COMPONENT_FIXTURES', policy: 'JumZipSajuRules-v1', approvedSections: 'A–G', independentOfEngineOutputs: true },
  elementOrder: ['WOOD', 'FIRE', 'EARTH', 'METAL', 'WATER'],
  hiddenMass: {
    子: [['癸', 10]], 丑: [['己', 6], ['癸', 3], ['辛', 1]], 寅: [['甲', 6], ['丙', 3], ['戊', 1]], 卯: [['乙', 10]],
    辰: [['戊', 6], ['乙', 3], ['癸', 1]], 巳: [['丙', 6], ['戊', 3], ['庚', 1]], 午: [['丁', 7], ['己', 3]],
    未: [['己', 6], ['丁', 3], ['乙', 1]], 申: [['庚', 6], ['壬', 3], ['戊', 1]], 酉: [['辛', 10]],
    戌: [['戊', 6], ['辛', 3], ['丁', 1]], 亥: [['壬', 7], ['甲', 3]],
  },
  hiddenMassDenominator: 10,
  seasonal: [
    { dayElement: 'WOOD', monthBranch: '卯', relation: 'SAME', expectedC1: 40 },
    { dayElement: 'WOOD', monthBranch: '子', relation: 'PARENT', expectedC1: 32 },
    { dayElement: 'WOOD', monthBranch: '午', relation: 'GENERATED', expectedC1: 16 },
    { dayElement: 'WOOD', monthBranch: '未', relation: 'CONTROLLED', expectedC1: 8 },
    { dayElement: 'WOOD', monthBranch: '酉', relation: 'CONTROLLER', expectedC1: 4 },
  ],
  roots: [
    { id: 'none', dayElement: 'WOOD', branches: ['酉', '午'], expectedRatio: { numerator: 0, denominator: 1 }, expectedC2: { numerator: 0, denominator: 1 } },
    { id: 'half', dayElement: 'WOOD', branches: ['卯', '酉'], expectedRatio: { numerator: 1, denominator: 2 }, expectedC2: { numerator: 25, denominator: 2 } },
    { id: 'complete', dayElement: 'WOOD', branches: ['卯', '卯', '卯', '卯'], expectedRatio: { numerator: 1, denominator: 1 }, expectedC2: { numerator: 25, denominator: 1 } },
    { id: 'parent-only', dayElement: 'WOOD', branches: ['子', '子'], expectedRatio: { numerator: 3, denominator: 4 }, expectedC2: { numerator: 75, denominator: 4 } },
    { id: 'weighted-four', dayElement: 'WOOD', branches: ['寅', '子', '辰', '酉'], expectedRoots: [{ numerator: 3, denominator: 5 }, { numerator: 3, denominator: 4 }, { numerator: 3, denominator: 8 }, { numerator: 0, denominator: 1 }], expectedRatio: { numerator: 69, denominator: 160 }, expectedC2: { numerator: 345, denominator: 32 } },
    { id: 'weighted-three', dayElement: 'WOOD', branches: ['子', '寅', '辰'], expectedRatio: { numerator: 23, denominator: 40 }, expectedC2: { numerator: 115, denominator: 8 } },
  ],
  visibleSupport: [
    { id: 'none', dayElement: 'WOOD', externalStems: ['庚', '丙', '戊'], expectedC3: { numerator: 0, denominator: 1 } },
    { id: 'half', dayElement: 'WOOD', externalStems: ['甲', '庚'], expectedC3: { numerator: 10, denominator: 1 } },
    { id: 'complete', dayElement: 'WOOD', externalStems: ['甲', '乙', '甲'], expectedC3: { numerator: 20, denominator: 1 } },
    { id: 'parent-only', dayElement: 'WOOD', externalStems: ['壬', '癸'], expectedC3: { numerator: 15, denominator: 1 } },
    { id: 'known-hour-weighted', dayElement: 'WOOD', externalStems: ['甲', '壬', '丙'], expectedRatio: { numerator: 7, denominator: 12 }, expectedC3: { numerator: 35, denominator: 3 } },
    { id: 'unknown-hour-renormalized', dayElement: 'WOOD', externalStems: ['壬', '甲'], expectedRatio: { numerator: 7, denominator: 8 }, expectedC3: { numerator: 35, denominator: 2 } },
  ],
  relationEffect: [
    { id: 'neutral', chart: { year: '甲寅', month: '甲寅', day: '甲寅', hour: '甲寅' }, expectedB: { numerator: 27, denominator: 35 }, expectedA: { numerator: 27, denominator: 35 }, expectedC4: { numerator: 5, denominator: 1 } },
    // 寅申 clash only. 寅午 is incomplete; no half relation is generated.
    { id: 'one-clash', chart: { year: '丙寅', month: '丁申', day: '甲午', hour: null }, expectedBranchFactors: { year: .75, month: .75, day: 1 }, expectedB: { numerator: 33, denominator: 200 }, expectedA: { numerator: 11, denominator: 80 }, expectedC4: { numerator: 189, denominator: 40 } },
    // 子丑 combine, 子午 clash, 丑午 harm coexist; each participant factor is applied once.
    { id: 'overlapping-relations', chart: { year: '丙子', month: '丁丑', day: '甲午', hour: null }, expectedBranchFactors: { year: .85, month: 1, day: .65 }, expectedB: { numerator: 39, denominator: 200 }, expectedA: { numerator: 23, denominator: 120 }, expectedC4: { numerator: 149, denominator: 30 } },
  ],
  transformationPredicates: [
    { id: 'all-five-pass', chart: { year: '甲辰', month: '己未', day: '丙申', hour: '壬子' }, pair: ['year', 'month'], target: 'EARTH', expected: 'CONFIRMED' },
    { id: 'season-generates-target', chart: { year: '甲辰', month: '己巳', day: '丙申', hour: '壬子' }, pair: ['year', 'month'], target: 'EARTH', expected: 'CONFIRMED' },
    { id: 'non-adjacent', chart: { year: '甲辰', month: '丙未', day: '己丑', hour: '壬子' }, pair: ['year', 'day'], target: 'EARTH', expected: 'NOT_TRANSFORMED', failedPredicate: 'ADJACENCY' },
    { id: 'competing-stem', chart: { year: '甲辰', month: '己未', day: '己丑', hour: '壬子' }, pair: ['year', 'month'], target: 'EARTH', expected: 'NOT_TRANSFORMED', failedPredicate: 'NO_COMPETITOR', untransformedExternalStemFactor: .75 },
    { id: 'wrong-season', chart: { year: '甲辰', month: '己酉', day: '丙申', hour: '壬子' }, pair: ['year', 'month'], target: 'EARTH', expected: 'NOT_TRANSFORMED', failedPredicate: 'SEASON' },
    { id: 'no-first-hidden-root', chart: { year: '甲寅', month: '己午', day: '丙申', hour: '壬亥' }, pair: ['year', 'month'], target: 'EARTH', expected: 'NOT_TRANSFORMED', failedPredicate: 'FIRST_HIDDEN_ROOT' },
    { id: 'outside-controller', chart: { year: '甲辰', month: '己未', day: '乙卯', hour: '壬子' }, pair: ['year', 'month'], target: 'EARTH', expected: 'NOT_TRANSFORMED', failedPredicate: 'NO_EXTERNAL_CONTROLLER' },
    { id: 'missing-hour', chart: { year: '甲辰', month: '己未', day: '丙申', hour: null }, pair: ['year', 'month'], target: 'EARTH', expected: 'UNRESOLVED', untransformedExternalStemFactor: .75 },
  ],
  concentration: [
    { id: 'uniform', dayElement: 'WOOD', proportions: [.2, .2, .2, .2, .2], expectedH: { numerator: 0, denominator: 1 }, expectedU: { numerator: 7, denominator: 20 }, expectedC5: { numerator: 5, denominator: 2 } },
    { id: 'same-mono', dayElement: 'WOOD', proportions: [1, 0, 0, 0, 0], expectedH: { numerator: 1, denominator: 1 }, expectedU: { numerator: 1, denominator: 1 }, expectedC5: { numerator: 5, denominator: 1 } },
    { id: 'parent-mono', dayElement: 'WOOD', proportions: [0, 0, 0, 0, 1], expectedH: { numerator: 1, denominator: 1 }, expectedU: { numerator: 3, denominator: 4 }, expectedC5: { numerator: 15, denominator: 4 } },
    { id: 'unsupported-mono', dayElement: 'WOOD', proportions: [0, 1, 0, 0, 0], expectedH: { numerator: 1, denominator: 1 }, expectedU: { numerator: 0, denominator: 1 }, expectedC5: { numerator: 0, denominator: 1 } },
  ],
  rounding: [
    { raw: 34.49, score: 34, grade: '약' }, { raw: 34.50, score: 35, grade: '약약' },
    { raw: 44.49, score: 44, grade: '약약' }, { raw: 44.50, score: 45, grade: '중화' },
    { raw: 54.49, score: 54, grade: '중화' }, { raw: 54.50, score: 55, grade: '약강' },
    { raw: 64.49, score: 64, grade: '약강' }, { raw: 64.50, score: 65, grade: '강' },
    { raw: -1, score: 0, grade: '약' }, { raw: 101, score: 100, grade: '강' },
  ],
  balance: [
    { id: 'uniform-neutral-fixed-tie', dayElement: 'WOOD', monthBranch: '卯', strengthScore: 50, proportions: [.2, .2, .2, .2, .2], expectedScores: { WOOD: 0, FIRE: 0, EARTH: 0, METAL: 0, WATER: 0 }, expectedRanking: ['WOOD', 'FIRE', 'EARTH', 'METAL', 'WATER'], yongsin: 'WOOD', heesin: 'FIRE', requiredReasons: ['TIE_FIXED_ORDER', 'HEESIN_GENERATION_ALIGNMENT'] },
    { id: 'uniform-strong', dayElement: 'WOOD', monthBranch: '卯', strengthScore: 55, proportions: [.2, .2, .2, .2, .2], expectedScores: { FIRE: 20, EARTH: 5, METAL: 10 }, expectedRanking: ['FIRE', 'METAL', 'EARTH'], yongsin: 'FIRE', heesin: 'EARTH', requiredReasons: ['STRONG_DRAIN', 'HEESIN_GENERATION_ALIGNMENT'] },
    { id: 'uniform-weak', dayElement: 'WOOD', monthBranch: '卯', strengthScore: 44, proportions: [.2, .2, .2, .2, .2], expectedScores: { WOOD: 10, WATER: 20 }, expectedRanking: ['WATER', 'WOOD'], yongsin: 'WATER', heesin: 'WOOD', requiredReasons: ['WEAK_SUPPORT', 'HEESIN_GENERATION_ALIGNMENT'] },
    // FIRE/EARTH both 90: T=40 beats T=20 before the fixed EARTH/FIRE order matters.
    { id: 'climate-tie', dayElement: 'WOOD', monthBranch: '子', strengthScore: 50, proportions: [.3, .1, .1, .1, .4], expectedScores: { WOOD: 40, FIRE: 90, EARTH: 90, METAL: 50, WATER: 0 }, expectedT: { FIRE: 40, EARTH: 20 }, expectedRanking: ['FIRE', 'EARTH', 'METAL', 'WOOD', 'WATER'], yongsin: 'FIRE', heesin: 'EARTH', requiredReasons: ['TIE_CLIMATE', 'COLD_FIRE', 'WET_EARTH'] },
    // WOOD/FIRE/METAL each 30: FIRE deficit .1 wins, then WOOD beats METAL by fixed order.
    { id: 'deficit-tie', dayElement: 'WOOD', monthBranch: '卯', strengthScore: 50, proportions: [.2, .1, .35, .2, .15], expectedScores: { WOOD: 30, FIRE: 30, EARTH: 0, METAL: 30, WATER: 15 }, expectedRanking: ['FIRE', 'WOOD', 'METAL', 'WATER', 'EARTH'], yongsin: 'FIRE', heesin: 'WOOD', requiredReasons: ['TIE_DEFICIT', 'TIE_FIXED_ORDER'] },
    { id: 'climate-expands-weak-candidates', dayElement: 'WATER', monthBranch: '子', strengthScore: 35, proportions: [.2, .1, .1, .2, .4], expectedScores: { FIRE: 70, EARTH: 90, METAL: 20, WATER: 10 }, expectedRanking: ['EARTH', 'FIRE', 'METAL', 'WATER'], yongsin: 'EARTH', heesin: 'FIRE', requiredReasons: ['COLD_FIRE', 'WET_EARTH'] },
    { id: 'heesin-fallback', dayElement: 'WOOD', monthBranch: '卯', strengthScore: 35, proportions: [.2, .1, 0, .1, .6], expectedScores: { WOOD: 90, EARTH: 160, WATER: 20 }, expectedRanking: ['EARTH', 'WOOD', 'WATER'], yongsin: 'EARTH', heesin: 'WOOD', requiredReasons: ['HEESIN_REMAINING_CANDIDATE'] },
  ],
  climate: [
    { id: 'cold-inclusive', monthBranch: '子', proportions: [.1, .1, .2, .2, .4], expectedT: [0, 40, 0, 0, 0] },
    { id: 'cold-water-below', monthBranch: '子', proportions: [.1001, .1, .2, .2, .3999], expectedT: [0, 0, 0, 0, 0] },
    { id: 'cold-fire-above', monthBranch: '子', proportions: [.0999, .1001, .2, .2, .4], expectedT: [0, 0, 0, 0, 0] },
    { id: 'hot-inclusive', monthBranch: '未', proportions: [.1, .4, .2, .2, .1], expectedT: [0, 0, 0, 0, 40] },
    { id: 'hot-fire-below', monthBranch: '未', proportions: [.1001, .3999, .2, .2, .1], expectedT: [0, 0, 0, 0, 0] },
    { id: 'hot-water-above', monthBranch: '未', proportions: [.0999, .4, .2, .2, .1001], expectedT: [0, 0, 0, 0, 0] },
    { id: 'dry-inclusive', monthBranch: '卯', proportions: [.2, .1, .3, .3, .1], expectedT: [0, 0, 0, 0, 20] },
    { id: 'dry-mass-below', monthBranch: '卯', proportions: [.2001, .1, .2999, .3, .1], expectedT: [0, 0, 0, 0, 0] },
    { id: 'dry-water-above', monthBranch: '卯', proportions: [.1999, .1, .3, .3, .1001], expectedT: [0, 0, 0, 0, 0] },
    { id: 'wet-inclusive', monthBranch: '卯', proportions: [.1, .2, .1, .2, .4], expectedT: [0, 0, 20, 0, 0] },
    { id: 'wet-water-below', monthBranch: '卯', proportions: [.1001, .2, .1, .2, .3999], expectedT: [0, 0, 0, 0, 0] },
    { id: 'wet-earth-above', monthBranch: '卯', proportions: [.0999, .2, .1001, .2, .4], expectedT: [0, 0, 0, 0, 0] },
    { id: 'hot-plus-dry', monthBranch: '午', proportions: [0, .4, .3, .3, 0], expectedT: [0, 0, 0, 0, 60] },
    { id: 'cold-plus-wet', monthBranch: '丑', proportions: [.2, .1, .1, .2, .4], expectedT: [0, 40, 20, 0, 0] },
  ],
  shinsal: [
    { id: 'CHEONEUL', positive: { year: '乙丑', month: '丙寅', day: '甲辰', hour: '丁未' }, expectedEvidence: ['day>year', 'day>hour'], negative: { year: '壬子', month: '丙寅', day: '甲辰', hour: '庚申' }, unknownHourEvidence: ['day>year'] },
    { id: 'MUNCHANG', positive: { year: '乙巳', month: '丁巳', day: '甲辰', hour: '己巳' }, expectedEvidence: ['day>year', 'day>month', 'day>hour'], negative: { year: '壬子', month: '丙寅', day: '甲辰', hour: '庚申' }, unknownHourEvidence: ['day>year', 'day>month'] },
    { id: 'DOHWA', positive: { year: '甲寅', month: '乙卯', day: '丙午', hour: '丁卯' }, expectedEvidence: ['year>month', 'year>hour', 'day>month', 'day>hour'], negative: { year: '甲寅', month: '戊戌', day: '丙午', hour: '庚辰' }, unknownHourEvidence: ['year>month', 'day>month'] },
    { id: 'YEOKMA', positive: { year: '甲寅', month: '庚申', day: '丙午', hour: '壬申' }, expectedEvidence: ['year>month', 'year>hour', 'day>month', 'day>hour'], negative: { year: '甲寅', month: '乙卯', day: '丙午', hour: '庚辰' }, unknownHourEvidence: ['year>month', 'day>month'] },
    { id: 'HWAGAE', positive: { year: '甲戌', month: '戊戌', day: '丙午', hour: '壬戌' }, expectedEvidence: ['year>year', 'year>month', 'year>hour', 'day>year', 'day>month', 'day>hour'], negative: { year: '甲寅', month: '乙卯', day: '丙午', hour: '庚辰' }, unknownHourEvidence: ['year>year', 'year>month', 'day>year', 'day>month'] },
    { id: 'YANGIN', positive: { year: '乙卯', month: '丁卯', day: '甲辰', hour: '己卯' }, expectedEvidence: ['day>year', 'day>month', 'day>hour'], negative: { year: '甲卯', month: '丁卯', day: '乙巳', hour: '己卯' }, unknownHourEvidence: ['day>year', 'day>month'] },
    // GOEGANG is day-only: repeated qualifying pillars elsewhere never create additional evidence.
    { id: 'GOEGANG', positive: { year: '庚辰', month: '壬辰', day: '戊戌', hour: '庚戌' }, expectedEvidence: ['day>day'], negative: { year: '庚辰', month: '壬辰', day: '壬戌', hour: '庚戌' }, unknownHourEvidence: ['day>day'] },
    { id: 'HONGYEOM', positive: { year: '甲辰', month: '戊辰', day: '己辰', hour: '壬辰' }, expectedEvidence: ['day>year', 'day>month', 'day>day', 'day>hour'], negative: { year: '乙巳', month: '丁巳', day: '己巳', hour: '辛巳' }, unknownHourEvidence: ['day>year', 'day>month', 'day>day'] },
    { id: 'BAEKHO', positive: { year: '甲辰', month: '乙未', day: '丙戌', hour: '丁丑' }, expectedEvidence: ['year>year', 'month>month', 'day>day', 'hour>hour'], negative: { year: '甲寅', month: '丙午', day: '戊戌', hour: '庚申' }, unknownHourEvidence: ['year>year', 'month>month', 'day>day'] },
    { id: 'GWIMUN', positive: { year: '甲子', month: '乙丑', day: '丙午', hour: '丁酉' }, expectedEvidence: ['year+hour', 'month+day'], negative: { year: '甲寅', month: '丙午', day: '庚戌', hour: '壬辰' }, unknownHourEvidence: ['month+day'] },
  ],
  shinsalCanonical: {
    CHEONEUL: { 甲: ['丑', '未'], 戊: ['丑', '未'], 乙: ['子', '申'], 己: ['子', '申'], 丙: ['亥', '酉'], 丁: ['亥', '酉'], 庚: ['寅', '午'], 辛: ['寅', '午'], 壬: ['巳', '卯'], 癸: ['巳', '卯'] },
    MUNCHANG: { 甲: ['巳'], 乙: ['午'], 丙: ['申'], 戊: ['申'], 丁: ['酉'], 己: ['酉'], 庚: ['亥'], 辛: ['子'], 壬: ['寅'], 癸: ['卯'] },
    DOHWA: { 寅: '卯', 午: '卯', 戌: '卯', 巳: '午', 酉: '午', 丑: '午', 申: '酉', 子: '酉', 辰: '酉', 亥: '子', 卯: '子', 未: '子' },
    YEOKMA: { 寅: '申', 午: '申', 戌: '申', 巳: '亥', 酉: '亥', 丑: '亥', 申: '寅', 子: '寅', 辰: '寅', 亥: '巳', 卯: '巳', 未: '巳' },
    HWAGAE: { 寅: '戌', 午: '戌', 戌: '戌', 巳: '丑', 酉: '丑', 丑: '丑', 申: '辰', 子: '辰', 辰: '辰', 亥: '未', 卯: '未', 未: '未' },
    YANGIN: { 甲: ['卯'], 乙: [], 丙: ['午'], 丁: [], 戊: ['午'], 己: [], 庚: ['酉'], 辛: [], 壬: ['子'], 癸: [] },
    GOEGANG: ['庚辰', '壬辰', '戊戌', '庚戌'],
    HONGYEOM: { 甲: ['午'], 乙: ['午'], 丙: ['寅'], 丁: ['未'], 戊: ['辰'], 己: ['辰'], 庚: ['戌'], 辛: ['酉'], 壬: ['子'], 癸: ['申'] },
    BAEKHO: ['甲辰', '乙未', '丙戌', '丁丑', '戊辰', '壬戌', '癸丑'],
    GWIMUN: [['子', '酉'], ['丑', '午'], ['寅', '未'], ['卯', '申'], ['辰', '亥'], ['巳', '戌']],
  },
  gyeokguk: [
    { id: 'three-exposed-standard', chart: { year: '庚子', month: '丙巳', day: '甲辰', hour: '戊申' }, expectedCandidateStems: ['丙', '戊', '庚'], expectedPrimary: '식신', expectedSecondary: ['편재', '편관'], expectedGeonrok: false, expectedYangin: false },
    { id: 'nonstandard-first', chart: { year: '戊子', month: '丙寅', day: '甲辰', hour: '甲申' }, expectedCandidateStems: ['甲', '丙', '戊'], expectedPrimary: null, expectedMonthCore: '비견', expectedSecondary: ['식신', '편재'], expectedGeonrok: true, expectedYangin: false },
    { id: 'duplicate-exposure-evidence', chart: { year: '丙子', month: '丙寅', day: '甲辰', hour: '丙申' }, expectedCandidateStems: ['丙'], expectedExposurePositions: ['month', 'year', 'hour'], expectedPrimary: '식신', expectedSecondary: [], expectedGeonrok: true, expectedYangin: false },
    { id: 'no-exposure-fallback', chart: { year: '丙子', month: '庚辰', day: '甲寅', hour: '壬申' }, expectedCandidateStems: ['戊'], expectedPrimary: '편재', expectedSecondary: [], expectedGeonrok: false, expectedYangin: false },
    { id: 'day-stem-not-an-exposure', chart: { year: '乙丑', month: '庚寅', day: '甲辰', hour: '辛酉' }, expectedCandidateStems: ['甲'], expectedExposed: false, expectedPrimary: null, expectedMonthCore: '비견', expectedSecondary: [], expectedGeonrok: true, expectedYangin: false },
    { id: 'yangin-distinct-from-geonrok', chart: { year: '壬子', month: '丙卯', day: '甲辰', hour: null }, expectedCandidateStems: ['乙'], expectedPrimary: null, expectedMonthCore: '겁재', expectedSecondary: [], expectedGeonrok: false, expectedYangin: true },
  ],
  charts: [
    { id: 'repeated-jia-yin-four-pillars', kind: 'SYNTHETIC_COMPONENT_FIXTURE', chart: { year: '甲寅', month: '甲寅', day: '甲寅', hour: '甲寅' },
      massTenths: [64, 12, 4, 0, 0], totalMass: 8, proportions: [{ numerator: 4, denominator: 5 }, { numerator: 3, denominator: 20 }, { numerator: 1, denominator: 20 }, { numerator: 0, denominator: 1 }, { numerator: 0, denominator: 1 }],
      components: { C1: { numerator: 40, denominator: 1 }, C2: { numerator: 15, denominator: 1 }, C3: { numerator: 20, denominator: 1 }, C4: { numerator: 5, denominator: 1 }, C5: { numerator: 1079, denominator: 320 } },
      H: { numerator: 93, denominator: 160 }, u: { numerator: 4, denominator: 5 }, rawScore: { numerator: 26679, denominator: 320 }, score: 83, grade: '강',
      balanceScores: { FIRE: { numerator: 155, denominator: 1 }, EARTH: { numerator: 50, denominator: 1 }, METAL: { numerator: 190, denominator: 1 } }, yongsin: 'METAL', heesin: 'EARTH',
      gyeokguk: { primary: null, monthCore: '비견', secondary: [], geonrok: true, yangin: false }, expectedShinsalIds: [],
    },
    { id: 'water-wood-three-pillars-unknown-hour', kind: 'SYNTHETIC_COMPONENT_FIXTURE', chart: { year: '壬子', month: '甲寅', day: '甲辰', hour: null },
      massTenths: [29, 3, 7, 0, 21], totalMass: 6, proportions: [{ numerator: 29, denominator: 60 }, { numerator: 1, denominator: 20 }, { numerator: 7, denominator: 60 }, { numerator: 0, denominator: 1 }, { numerator: 7, denominator: 20 }],
      components: { C1: { numerator: 40, denominator: 1 }, C2: { numerator: 115, denominator: 8 }, C3: { numerator: 35, denominator: 2 }, C4: { numerator: 5, denominator: 1 }, C5: { numerator: 19109, denominator: 6912 } },
      H: { numerator: 31, denominator: 144 }, u: { numerator: 179, denominator: 240 }, rawScore: { numerator: 550469, denominator: 6912 }, score: 80, grade: '강',
      balanceScores: { FIRE: { numerator: 365, denominator: 3 }, EARTH: { numerator: 60, denominator: 1 }, METAL: { numerator: 380, denominator: 3 } }, yongsin: 'METAL', heesin: 'EARTH',
      gyeokguk: { primary: null, monthCore: '비견', secondary: [], geonrok: true, yangin: false }, expectedShinsalIds: ['YEOKMA', 'HWAGAE', 'BAEKHO'], expectedLimitations: ['LIMITED_UNKNOWN_HOUR'],
    },
  ],
  aggregation: [
    { id: 'same-grade-different-score', candidateValues: [{ score: 60, grade: '약강', yongsin: 'WOOD', heesin: 'WATER' }, { score: 64, grade: '약강', yongsin: 'WOOD', heesin: 'FIRE' }], expected: { score: null, grade: '약강', yongsin: 'WOOD', heesin: null }, possibleScores: [60, 64], possibleHeesin: ['WATER', 'FIRE'] },
    { id: 'same-all-fields', candidateValues: [{ score: 50, grade: '중화', yongsin: 'WOOD', heesin: 'FIRE' }, { score: 50, grade: '중화', yongsin: 'WOOD', heesin: 'FIRE' }], expected: { score: 50, grade: '중화', yongsin: 'WOOD', heesin: 'FIRE' }, possibleScores: [50], possibleHeesin: ['FIRE'] },
  ],
} as const);
