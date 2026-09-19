/** Independent expected values frozen BEFORE importing/running the foundation engine.
 * KASI supplies calendar/day/term facts; all astrology fields are manually derived
 * from the explicitly adopted product rules, not claimed as KASI astrology output.
 * There are deliberately no engine/library imports or expected-value calculations. */
type Pair = readonly [string, string];
type Position = 'year' | 'month' | 'day' | 'hour';
export interface IndependentBirth {
  calendarType: 'SOLAR' | 'LUNAR'; leapMonth: boolean; birthDate: string; birthTime: string | null;
  birthTimeUnknown: boolean; trueSolarTime: boolean; gender?: 'MALE' | 'FEMALE';
  location: { name: string; latitude: number; longitude: number; timezone: string };
}
export interface IndependentExpectation {
  pillars: Partial<Record<Position, string | null>>;
  tenGods: Partial<Record<Position, Pair | null>>;
  gongmang: readonly string[]; candidateCount: number; hourStatus: 'CONFIRMED' | 'UNKNOWN';
  flags?: readonly string[]; charts?: readonly (readonly [string, string, string, string | null])[];
  direction?: { forward: boolean; firstThree: readonly string[] };
}
export interface IndependentFixture {
  id: string; acceptanceClass: string;
  coverage: 'COMPLETE_ADOPTED_FIELDS' | 'PARTIAL_ADOPTED_FIELDS' | 'EXPECTED_REJECTION';
  input: IndependentBirth; expected?: IndependentExpectation;
  error?: { code: string; reason: string }; derivation: string;
  missingEvidence?: readonly string[];
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
const seoul = { name: 'KASI Seoul reference', latitude: 37 + 34 / 60, longitude: 126 + 58 / 60 + 42 / 3600, timezone: 'Asia/Seoul' };
const newYork = { name: 'IANA New York fixture', latitude: 40.7128, longitude: -74.006, timezone: 'America/New_York' };
const base: IndependentBirth = { calendarType: 'SOLAR', leapMonth: false, birthDate: '2024-02-10', birthTime: '12:00', birthTimeUnknown: false, trueSolarTime: false, location: seoul };
const noon: IndependentExpectation = {
  pillars: { year: '甲辰', month: '丙寅', day: '甲辰', hour: '庚午' },
  tenGods: { year: ['비견', '편재'], month: ['식신', '비견'], day: ['일간', '편재'], hour: ['편관', '상관'] },
  gongmang: ['寅', '卯'], candidateCount: 1, hourStatus: 'CONFIRMED',
};
const beforeIpchun: IndependentExpectation = {
  pillars: { year: '癸卯', month: '乙丑', day: '戊戌', hour: '辛酉' },
  tenGods: { year: ['정재', '정관'], month: ['정관', '겁재'], day: ['일간', '비견'], hour: ['상관', '상관'] },
  gongmang: ['辰', '巳'], candidateCount: 1, hourStatus: 'CONFIRMED',
};
const afterIpchun: IndependentExpectation = {
  pillars: { year: '甲辰', month: '丙寅', day: '戊戌', hour: '辛酉' },
  tenGods: { year: ['편관', '비견'], month: ['편인', '편관'], day: ['일간', '비견'], hour: ['상관', '상관'] },
  gongmang: ['辰', '巳'], candidateCount: 1, hourStatus: 'CONFIRMED',
};

export const FOUNDATION_INDEPENDENT_RULES = deepFreeze({
  evidence: 'KASI 2024 almanac SHA256 967fcf5dba1ab002ab0627ae39b6863af60ec96e2d742d1764056fa300fff7dc; existing calendar-evidence-fixtures.ts; IANA2026d transcriptions',
  boundary: 'Year changes at Ipchun; month changes at the adopted 12 jie. These are product conventions applied to published term instants.',
  month: '五虎遁: 甲己年丙寅, 乙庚年戊寅, 丙辛年庚寅, 丁壬年壬寅, 戊癸年甲寅; increment both stem and branch for each month. Before2024Ipchun, previous癸year terminal month is乙丑.',
  hour: '五鼠遁: 甲己日甲子, 乙庚日丙子, 丙辛日戊子, 丁壬日庚子, 戊癸日壬子; increment each two-hour branch. splitJasi23h keeps current day pillar but hour stem uses next civil day;00h uses new day.',
  tenGods: 'Same/opposite polarity: self 비견/겁재; output 식신/상관; wealth 편재/정재; controller 편관/정관; resource 편인/정인. Branch target is adopted first hidden stem; day stem is rendered 일간.',
  branchCore: '子癸 丑己 寅甲 卯乙 辰戊 巳丙 午丁 未己 申庚 酉辛 戌戊 亥壬',
  voids: '甲子旬戌亥;甲戌旬申酉;甲申旬午未;甲午旬辰巳;甲辰旬寅卯;甲寅旬子丑. Determine the ten-day旬 containing the independently anchored day.',
  direction: 'Yang-year male and yin-year female forward; yin-year male and yang-year female backward. First luck pillar is one sexagenary month step away; no independent start-age/duration claim.',
});

export const FOUNDATION_INDEPENDENT_FIXTURES: readonly IndependentFixture[] = deepFreeze([
  { id: 'solar-noon', acceptanceClass: 'SOLAR', coverage: 'COMPLETE_ADOPTED_FIELDS', input: { ...base }, expected: noon,
    derivation: 'KASI p8:2024-02-10=甲辰. After Feb4Ipchun and before Mar5Gyeongchip:甲辰year/丙寅month.甲day starts甲子;午 is6 steps→庚午.甲辰旬 void寅卯.' },
  { id: 'lunar-new-year', acceptanceClass: 'LUNAR', coverage: 'COMPLETE_ADOPTED_FIELDS', input: { ...base, calendarType: 'LUNAR', birthDate: '2024-01-01' }, expected: noon,
    derivation: 'KASI p8 directly equates lunar2024-01-01 and solar2024-02-10甲辰. The same noon rules independently give甲辰/丙寅/甲辰/庚午.' },
  { id: 'leap-fourth-month', acceptanceClass: 'LEAP_MONTH', coverage: 'PARTIAL_ADOPTED_FIELDS', input: { ...base, calendarType: 'LUNAR', birthDate: '2020-04-01', leapMonth: true },
    expected: { pillars: { year: '庚子', day: '丙寅', hour: '甲午' }, tenGods: { year: ['편재', '정관'], day: ['일간', '편인'], hour: ['편인', '겁재'] }, gongmang: ['戌', '亥'], candidateCount: 1, hourStatus: 'CONFIRMED' },
    derivation: 'KASI p227:2020leap4/1=May23丙寅.2024甲辰 minus4annual steps=庚子.丙day starts戊子;+6→甲午.丙寅 belongs甲子旬. The missing2020jie bracket prevents a complete independently anchored month.',
    missingEvidence: ['2020立夏 and芒種 instants were not transcribed in existing evidence; month pillar and month ten gods are intentionally unchecked.'] },
  { id: 'ordinary-fourth-month', acceptanceClass: 'LEAP_MONTH', coverage: 'PARTIAL_ADOPTED_FIELDS', input: { ...base, calendarType: 'LUNAR', birthDate: '2020-04-01', leapMonth: false },
    expected: { pillars: { year: '庚子', day: '丙申', hour: '甲午' }, tenGods: { year: ['편재', '정관'], day: ['일간', '편재'], hour: ['편인', '겁재'] }, gongmang: ['辰', '巳'], candidateCount: 1, hourStatus: 'CONFIRMED' },
    derivation: 'KASI p227:ordinary2020fourth-month day1=Apr23丙申, distinct from leapMay23丙寅.丙申 is甲午旬 thirdday, hence辰巳 void. Same丙day noon甲午.',
    missingEvidence: ['2020清明 and立夏 instants were not transcribed; month pillar and its ten gods are unchecked.'] },
  { id: 'ipchun-before', acceptanceClass: 'IPCHUN', coverage: 'COMPLETE_ADOPTED_FIELDS', input: { ...base, birthDate: '2024-02-04', birthTime: '17:20' }, expected: beforeIpchun,
    derivation: 'Feb10甲辰 minus6days=戊戌.17:20 precedes KASI17:27 by7min, outside60sec tolerance. Prior year癸卯, terminal month乙丑.戊day壬子+9=辛酉.戊戌 belongs甲午旬.' },
  { id: 'ipchun-after', acceptanceClass: 'IPCHUN', coverage: 'COMPLETE_ADOPTED_FIELDS', input: { ...base, birthDate: '2024-02-04', birthTime: '17:40' }, expected: afterIpchun,
    derivation: '17:40 follows KASI17:27 by13min. Only year/month cross to甲辰/丙寅. Same戊戌day and辛酉hour; ten-god changes follow戊day relationships.' },
  { id: 'gyeongchip-before', acceptanceClass: 'SOLAR_TERM', coverage: 'COMPLETE_ADOPTED_FIELDS', input: { ...base, birthDate: '2024-03-05', birthTime: '11:10' },
    expected: { pillars: { year: '甲辰', month: '丙寅', day: '戊辰', hour: '戊午' }, tenGods: { year: ['편관', '비견'], month: ['편인', '편관'], day: ['일간', '비견'], hour: ['비견', '정인'] }, gongmang: ['戌', '亥'], candidateCount: 1, hourStatus: 'CONFIRMED' },
    derivation: 'Feb10甲辰 +24days(19 remaining February days plus5March)=戊辰.11:10 before KASI11:23 keeps丙寅.戊day壬子+6=戊午;午core丁 is正印.甲子旬 void戌亥.' },
  { id: 'gyeongchip-after', acceptanceClass: 'SOLAR_TERM', coverage: 'COMPLETE_ADOPTED_FIELDS', input: { ...base, birthDate: '2024-03-05', birthTime: '11:35' },
    expected: { pillars: { year: '甲辰', month: '丁卯', day: '戊辰', hour: '戊午' }, tenGods: { year: ['편관', '비견'], month: ['정인', '정관'], day: ['일간', '비견'], hour: ['비견', '정인'] }, gongmang: ['戌', '亥'], candidateCount: 1, hourStatus: 'CONFIRMED' },
    derivation: '11:35 after KASI11:23 advances month丙寅→丁卯.戊day sees丁as正印 and卯core乙as正官. The independently derived戊辰day/戊午hour remain unchanged.' },
  { id: 'late-jasi', acceptanceClass: 'HOUR_23', coverage: 'COMPLETE_ADOPTED_FIELDS', input: { ...base, birthTime: '23:30' },
    expected: { pillars: { year: '甲辰', month: '丙寅', day: '甲辰', hour: '丙子' }, tenGods: { year: ['비견', '편재'], month: ['식신', '비견'], day: ['일간', '편재'], hour: ['식신', '정인'] }, gongmang: ['寅', '卯'], candidateCount: 1, hourStatus: 'CONFIRMED', flags: ['JASI_CONVENTION_BOUNDARY'] },
    derivation: 'KASI p14 Feb10甲辰 remains currentday. ProductsplitJasi23:30 uses nextFeb11乙day for子stem丙. With current甲DM,丙=食神/子core癸=正印. Not a KASI hour-pillar claim.' },
  { id: 'early-jasi', acceptanceClass: 'HOUR_00', coverage: 'COMPLETE_ADOPTED_FIELDS', input: { ...base, birthDate: '2024-02-11', birthTime: '00:30' },
    expected: { pillars: { year: '甲辰', month: '丙寅', day: '乙巳', hour: '丙子' }, tenGods: { year: ['겁재', '정재'], month: ['상관', '겁재'], day: ['일간', '상관'], hour: ['상관', '편인'] }, gongmang: ['寅', '卯'], candidateCount: 1, hourStatus: 'CONFIRMED', flags: ['JASI_CONVENTION_BOUNDARY'] },
    derivation: 'KASI p14 Feb11乙巳.乙day子stem丙; daymaster changes allrelationships:甲劫財,戊正財,丙傷官,癸偏印.乙巳 is second day of甲辰旬.' },
  { id: 'unknown-civil-hour', acceptanceClass: 'UNKNOWN_TIME', coverage: 'COMPLETE_ADOPTED_FIELDS', input: { ...base, birthTime: null, birthTimeUnknown: true },
    expected: { pillars: { year: '甲辰', month: '丙寅', day: '甲辰', hour: null }, tenGods: { year: ['비견', '편재'], month: ['식신', '비견'], day: ['일간', '편재'], hour: null }, gongmang: ['寅', '卯'], candidateCount: 1440, hourStatus: 'UNKNOWN', flags: ['BIRTH_TIME_UNKNOWN', 'JASI_CONVENTION_BOUNDARY'], charts: [['甲辰', '丙寅', '甲辰', null]] },
    derivation: 'Civil correctionOFF, normal KSTdate=1440valid minutes. Feb10 crosses noyear/month boundary; splitJasi never changes civil day beforemidnight. Omit hour from every exported chart; no inferred hour.' },
  { id: 'unknown-ipchun-civil-hour', acceptanceClass: 'UNKNOWN_TIME', coverage: 'COMPLETE_ADOPTED_FIELDS', input: { ...base, birthDate: '2024-02-04', birthTime: null, birthTimeUnknown: true },
    expected: { pillars: { year: null, month: null, day: '戊戌', hour: null }, tenGods: { year: null, month: null, day: ['일간', '비견'], hour: null }, gongmang: ['辰', '巳'], candidateCount: 1440, hourStatus: 'UNKNOWN', flags: ['BIRTH_TIME_UNKNOWN', 'YEAR_PILLAR_UNCERTAIN', 'MONTH_PILLAR_UNCERTAIN'], charts: [['癸卯', '乙丑', '戊戌', null], ['甲辰', '丙寅', '戊戌', null]] },
    derivation: 'Feb4 civil date remains戊戌. Before/after officialIpchun allows exactly two correlated triples; year/month cross together, never four Cartesian combinations. Unknown hour stays absent.' },
  { id: 'korea-dst-gap', acceptanceClass: 'KOREA_DST', coverage: 'EXPECTED_REJECTION', input: { ...base, birthDate: '1988-05-08', birthTime: '02:30' }, error: { code: 'SAJU_CONVENTION_UNSUPPORTED', reason: 'NONEXISTENT_CIVIL_TIME' },
    derivation: 'IANA2026d ROK rule MaySun>=8 02:00+01:00 means1988May8 jumps02:00→03:00.02:30 has no instant, so no legitimate pillar result exists.' },
  { id: 'korea-dst-fold', acceptanceClass: 'KOREA_DST', coverage: 'PARTIAL_ADOPTED_FIELDS', input: { ...base, birthDate: '1988-10-09', birthTime: '02:30' },
    expected: { pillars: { year: '戊辰', day: '丁酉', hour: '辛丑' }, tenGods: { year: ['상관', '상관'], day: ['일간', '편재'], hour: ['편재', '식신'] }, gongmang: ['辰', '巳'], candidateCount: 2, hourStatus: 'CONFIRMED', flags: ['DST_AMBIGUOUS_TIME'] },
    derivation: 'IANAfold givesUTC1988Oct8 16:30(+10) and17:30(+9). CivilOFF keeps02:30丑. KASI1992Sep26乙巳 minus1448days[365+365+365+366-13] =minus8cycle steps→丁酉.丁day庚子+1=辛丑.1988annualpillar=戊辰.甲午旬 void辰巳.',
    missingEvidence: ['1988寒露/立冬 instants are not independently transcribed; no month pillar or month ten-god expectation.'] },
  { id: 'new-york-after-dst', acceptanceClass: 'OVERSEAS_IANA', coverage: 'COMPLETE_ADOPTED_FIELDS', input: { ...base, birthDate: '2024-03-10', birthTime: '15:00', location: newYork },
    expected: { pillars: { year: '甲辰', month: '丁卯', day: '癸酉', hour: '庚申' }, tenGods: { year: ['상관', '정관'], month: ['편재', '식신'], day: ['일간', '편인'], hour: ['정인', '정인'] }, gongmang: ['戌', '亥'], candidateCount: 1, hourStatus: 'CONFIRMED' },
    derivation: 'IANA2024Mar10 posttransition15:00EDT=19:00UTC=Mar11 04:00KST; absolute instant stillbetween KASI Gyeongchip/Cheongmyeong. ProductcivilOFF intentionallyuses localMar10 day=KASI癸酉.癸day壬子+8=庚申. This is a derived overseas convention test, not KASIforeign astronomy.' },
  { id: 'new-york-dst-gap', acceptanceClass: 'OVERSEAS_IANA', coverage: 'EXPECTED_REJECTION', input: { ...base, birthDate: '2024-03-10', birthTime: '02:30', location: newYork }, error: { code: 'SAJU_CONVENTION_UNSUPPORTED', reason: 'NONEXISTENT_CIVIL_TIME' },
    derivation: 'IANAUS2007–max MarchSun>=8 02:00+01:00 selects2024Mar10;02:30nonexistent. No astrological result is fabricated.' },
  { id: 'solar-hour-off', acceptanceClass: 'APPARENT_HOUR', coverage: 'COMPLETE_ADOPTED_FIELDS', input: { ...base, birthTime: '07:05' },
    expected: { pillars: { year: '甲辰', month: '丙寅', day: '甲辰', hour: '戊辰' }, tenGods: { year: ['비견', '편재'], month: ['식신', '비견'], day: ['일간', '편재'], hour: ['편재', '편재'] }, gongmang: ['寅', '卯'], candidateCount: 1, hourStatus: 'CONFIRMED' },
    derivation: 'Civil07:05 is辰.甲day甲子+4=戊辰;戊and辰core戊both偏財. Uses independently anchoredFeb10day.' },
  { id: 'solar-hour-on', acceptanceClass: 'APPARENT_HOUR', coverage: 'COMPLETE_ADOPTED_FIELDS', input: { ...base, birthTime: '07:05', trueSolarTime: true },
    expected: { pillars: { year: '甲辰', month: '丙寅', day: '甲辰', hour: '丁卯' }, tenGods: { year: ['비견', '편재'], month: ['식신', '비견'], day: ['일간', '편재'], hour: ['상관', '겁재'] }, gongmang: ['寅', '卯'], candidateCount: 1, hourStatus: 'CONFIRMED' },
    derivation: 'KASIp14Feb10Seoultransit12:46:16 means civil07:05≈apparent06:18:44, safelyinside卯 with>40min margin. Same甲day;甲子+3=丁卯,丁傷官/乙劫財. This anchors branch, not second-levelEoTaccuracy; stemderivationisproductrule.' },
  { id: 'yang-year-male', acceptanceClass: 'LUCK_DIRECTION', coverage: 'COMPLETE_ADOPTED_FIELDS', input: { ...base, gender: 'MALE' }, expected: { ...noon, direction: { forward: true, firstThree: ['丁卯', '戊辰', '己巳'] } },
    derivation: '甲yang+male→forward. From natal丙寅 advance threecycle steps:丁卯,戊辰,己巳. Independent of start-age rounding.' },
  { id: 'yang-year-female', acceptanceClass: 'LUCK_DIRECTION', coverage: 'COMPLETE_ADOPTED_FIELDS', input: { ...base, gender: 'FEMALE' }, expected: { ...noon, direction: { forward: false, firstThree: ['乙丑', '甲子', '癸亥'] } },
    derivation: '甲yang+female→backward. From丙寅 reverse:乙丑,甲子,癸亥; do notalter natalpillars/ten-gods/gongmang.' },
  { id: 'yin-year-male', acceptanceClass: 'LUCK_DIRECTION', coverage: 'COMPLETE_ADOPTED_FIELDS', input: { ...base, birthDate: '2024-02-04', birthTime: '17:20', gender: 'MALE' }, expected: { ...beforeIpchun, direction: { forward: false, firstThree: ['甲子', '癸亥', '壬戌'] } },
    derivation: 'BeforeIpchunyear癸yin+male→backward. From乙丑 reverse甲子,癸亥,壬戌.' },
  { id: 'yin-year-female', acceptanceClass: 'LUCK_DIRECTION', coverage: 'COMPLETE_ADOPTED_FIELDS', input: { ...base, birthDate: '2024-02-04', birthTime: '17:20', gender: 'FEMALE' }, expected: { ...beforeIpchun, direction: { forward: true, firstThree: ['丙寅', '丁卯', '戊辰'] } },
    derivation: 'BeforeIpchunyear癸yin+female→forward. From乙丑 advance丙寅,丁卯,戊辰.' },
]);
