import { calculateFourPillars, lunarToSolar, isValidSolarDate, getTenGodChart, getVoidBranches, equationOfTimeMinutes, type FourPillarsDetail, type Pillar, type LuckPillarInfo } from 'manseryeok';

export const SAJU_ENGINE_VERSION = 'manseryeok-2.0.0';
export const SAJU_CONVENTION_VERSION = 'JumZipSajuConvention-v1';
/** A–G were explicitly adopted on 2026-09-20. This M7 adapter remains foundation-only;
 * callers wanting the adopted judgments use calculateFullSaju instead. */
export const SAJU_RULE_FREEZE_PENDING = Object.freeze([] as const);
export type SajuErrorCode = 'SAJU_INPUT_INCOMPLETE' | 'SAJU_LOCATION_UNRESOLVED' | 'SAJU_CONVENTION_UNSUPPORTED' | 'SAJU_CALCULATION_FAILED';
export class SajuError extends Error {
  constructor(readonly code: SajuErrorCode, readonly reason: string) { super(code); this.name = 'SajuError'; }
}
export interface BirthLocation { name: string; country?: string; latitude: number; longitude: number; timezone: string }
export interface SajuBirthInput {
  calendarType: 'SOLAR' | 'LUNAR'; leapMonth: boolean; birthDate: string;
  birthTime: string | null; birthTimeUnknown: boolean; location: BirthLocation;
  gender?: 'MALE' | 'FEMALE'; trueSolarTime?: boolean;
}
interface SolarDate { year: number; month: number; day: number }
interface BaseCandidate { result: FourPillarsDetail; utcMs: number; wallMinute: number }
type PillarName = 'year' | 'month' | 'day' | 'hour';
export interface SajuFoundationResult {
  status: 'FOUNDATION_ONLY'; fullCalculationReady: false;
  engineVersion: typeof SAJU_ENGINE_VERSION; conventionVersion: typeof SAJU_CONVENTION_VERSION;
  ruleVersion: null; pendingRules: typeof SAJU_RULE_FREEZE_PENDING;
  pillars: Record<PillarName, Pillar | null>; hourStatus: 'CONFIRMED' | 'UNKNOWN' | 'UNCERTAIN';
  tenGods: { year: FourPillarsDetail['tenGods']['year'] | null; month: FourPillarsDetail['tenGods']['month'] | null; day: FourPillarsDetail['tenGods']['day'] | null; hour: FourPillarsDetail['tenGods']['hour'] | null };
  gongmang: FourPillarsDetail['voidBranches'] | null; daewoon: LuckPillarInfo | null;
  possible_values: { year: Pillar[]; month: Pillar[]; day: Pillar[]; hour?: Pillar[]; charts: { year: Pillar; month: Pillar; day: Pillar; hour?: Pillar }[]; gongmang: FourPillarsDetail['voidBranches'][]; daewoon: LuckPillarInfo[]; chartLuck: { chartIndex: number; luckIndex: number | null }[] };
  uncertaintyFlags: string[];
  precision: 'MINUTE'; candidateCount: number;
}

const minuteMs = 60_000;
const wallMsFor = (date: SolarDate, minute: number) => Date.UTC(date.year, date.month - 1, date.day, Math.floor(minute / 60), minute % 60);

function validateInput(input: SajuBirthInput): SolarDate {
  if (!input || !['SOLAR', 'LUNAR'].includes(input.calendarType) || typeof input.leapMonth !== 'boolean' || typeof input.birthTimeUnknown !== 'boolean') throw new SajuError('SAJU_INPUT_INCOMPLETE', 'INVALID_INPUT');
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.birthDate ?? '');
  if (!match) throw new SajuError('SAJU_INPUT_INCOMPLETE', 'INVALID_DATE');
  const [, year, month, day] = match.map(Number);
  if (year! < 1800 || year! > (input.calendarType === 'LUNAR' ? 2100 : 2300)) throw new SajuError('SAJU_CONVENTION_UNSUPPORTED', 'YEAR_OUTSIDE_ENGINE_RANGE');
  if ((input.calendarType === 'SOLAR' && input.leapMonth) || (input.gender !== undefined && !['MALE', 'FEMALE'].includes(input.gender))) throw new SajuError('SAJU_INPUT_INCOMPLETE', 'INVALID_OPTIONS');
  if (input.trueSolarTime !== undefined && typeof input.trueSolarTime !== 'boolean') throw new SajuError('SAJU_INPUT_INCOMPLETE', 'INVALID_OPTIONS');
  if (input.birthTimeUnknown ? input.birthTime !== null : !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(input.birthTime ?? '')) throw new SajuError('SAJU_INPUT_INCOMPLETE', 'UNKNOWN_TIME_MUST_BE_NULL');
  const location = input.location;
  if (!location?.name || !location.timezone || !Number.isFinite(location.latitude) || Math.abs(location.latitude) > 90 || !Number.isFinite(location.longitude) || Math.abs(location.longitude) > 180) throw new SajuError('SAJU_LOCATION_UNRESOLVED', 'LOCATION_SNAPSHOT_REQUIRED');
  try { new Intl.DateTimeFormat('en-US', { timeZone: location.timezone }).format(0); } catch { throw new SajuError('SAJU_LOCATION_UNRESOLVED', 'INVALID_IANA_TIMEZONE'); }
  try {
    if (input.calendarType === 'LUNAR') return lunarToSolar(year!, month!, day!, input.leapMonth);
    if (!isValidSolarDate(year!, month!, day!)) throw new Error('invalid');
    return { year: year!, month: month!, day: day! };
  } catch { throw new SajuError('SAJU_INPUT_INCOMPLETE', 'INVALID_CALENDAR_DATE'); }
}

/** Runtime-only civil-date input for the adopted luck convention. Never persist or send
 * this birth-date value in a derived result or interpretation payload. */
export function resolveSajuSolarBirthDate(input: SajuBirthInput): string {
  const date = validateInput(input);
  return `${String(date.year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}

/** IANA civil-time resolver considers both offsets at a DST fold, never picks one silently. */
function createDayResolver(date: SolarDate, timezone: string): (minute: number) => number[] {
  // The pinned engine explicitly adopts KST before Korea introduced standard time.
  if (timezone === 'Asia/Seoul' && wallMsFor(date, 0) < Date.UTC(1908, 3, 1)) return minute => [wallMsFor(date, minute) - 540 * minuteMs];
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const localWall = (instant: number): number => {
    const parts = Object.fromEntries(formatter.formatToParts(instant).map(p => [p.type, p.value]));
    return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  };
  const start = wallMsFor(date, 0);
  const offsets = new Set<number>();
  // All civil offsets around the date, including transition offsets on either side.
  for (let hours = -48; hours <= 72; hours += 6) {
    const instant = start + hours * 60 * minuteMs;
    offsets.add((localWall(instant) - instant) / minuteMs);
  }
  if ([...offsets].some(offset => !Number.isInteger(offset))) throw new SajuError('SAJU_CONVENTION_UNSUPPORTED', 'SUB_MINUTE_HISTORICAL_OFFSET');
  return minute => {
    const wall = wallMsFor(date, minute);
    return [...offsets].map(offset => wall - offset * minuteMs).filter(instant => localWall(instant) === wall).sort((a, b) => a - b);
  };
}

const unique = <T>(values: readonly T[]): T[] => [...new Map(values.map(value => [JSON.stringify(value), value])).values()];
const confirmed = <T>(values: readonly T[]): T | null => values.length === 1 ? values[0]! : null;

/** M7 only. Does not implement or claim frozen Strength/Balance/Shinsal rules.
 * Enumeration covers every valid birth minute, including DST folds/gaps. The pinned engine
 * accepts minute precision; future optimizations must be equivalent to this reference sweep.
 */
export function calculateSajuFoundation(input: SajuBirthInput): SajuFoundationResult {
  const date = validateInput(input);
  const resolve = createDayResolver(date, input.location.timezone);
  const flags = new Set<string>();
  if (input.birthTimeUnknown) flags.add('BIRTH_TIME_UNKNOWN');
  if (input.location.timezone === 'Asia/Seoul' && wallMsFor(date, 0) < Date.UTC(1908, 3, 1)) flags.add('PRE_STANDARD_TIME_KST_CONVENTION');
  const knownMinute = input.birthTimeUnknown ? 0 : Number(input.birthTime!.slice(0, 2)) * 60 + Number(input.birthTime!.slice(3));
  const from = input.birthTimeUnknown ? 0 : knownMinute;
  const through = input.birthTimeUnknown ? 1439 : knownMinute;
  const candidates: BaseCandidate[] = [];
  for (let minute = from; minute <= through; minute++) {
    const instants = resolve(minute);
    if (instants.length > 1) flags.add('DST_AMBIGUOUS_TIME');
    for (const utcMs of instants) {
      const bridge = new Date(utcMs + 540 * minuteMs);
      let result: FourPillarsDetail;
      try {
        result = calculateFourPillars({ year: bridge.getUTCFullYear(), month: bridge.getUTCMonth() + 1, day: bridge.getUTCDate(), hour: bridge.getUTCHours(), minute: bridge.getUTCMinutes(),
          dayBoundary: 'splitJasi', gender: input.gender === 'MALE' ? 'male' : input.gender === 'FEMALE' ? 'female' : undefined,
          trueSolarTime: { longitude: input.location.longitude, applyEquationOfTime: true, applyHistoricalDst: false } });
        if (input.trueSolarTime === false) {
          // The absolute instant still determines year/month/luck. Civil wall time determines
          // day/hour when solar correction is explicitly disabled; no offset is applied twice.
          const civil = calculateFourPillars({ ...date, hour: Math.floor(minute / 60), minute: minute % 60, dayBoundary: 'splitJasi' });
          const pillars = { year: result.year, month: result.month, day: civil.day, hour: civil.hour };
          result = { ...result, ...pillars, tenGods: getTenGodChart(pillars), voidBranches: getVoidBranches(civil.day.heavenlyStem, civil.day.earthlyBranch) };
        }
      } catch { throw new SajuError('SAJU_CALCULATION_FAILED', 'BASE_ENGINE_REJECTED_INPUT'); }
      const apparent = input.trueSolarTime === false ? minute : ((Math.floor((utcMs + (input.location.longitude * 4 + equationOfTimeMinutes(utcMs)) * minuteMs) / minuteMs) % 1440) + 1440) % 1440;
      if (apparent >= 1380 || apparent < 60 || minute >= 1380 || minute < 60) flags.add('JASI_CONVENTION_BOUNDARY');
      candidates.push({ result, utcMs, wallMinute: minute });
    }
  }
  if (!candidates.length) throw new SajuError('SAJU_CONVENTION_UNSUPPORTED', 'NONEXISTENT_CIVIL_TIME');
  const values = (name: PillarName) => unique(candidates.map(c => c.result[name]));
  const year = values('year'), month = values('month'), day = values('day'), hour = values('hour');
  for (const [name, values] of Object.entries({ year, month, day })) if (values.length > 1) flags.add(`${name.toUpperCase()}_PILLAR_UNCERTAIN`);
  const gongmang = unique(candidates.map(c => c.result.voidBranches));
  const daewoon = unique(candidates.flatMap(c => c.result.luckPillars ? [c.result.luckPillars] : []));
  if (daewoon.length > 1) flags.add('DAEWOON_START_UNCERTAIN');
  if (!input.gender) flags.add('DAEWOON_REQUIRES_GENDER');
  const tenGods = <K extends PillarName>(name: K): FourPillarsDetail['tenGods'][K] | null => confirmed(unique(candidates.map(c => c.result.tenGods[name])));
  // Preserve joint possibilities. Combining each pillar's independent alternatives would create
  // impossible charts at date/solar-term boundaries. Unknown time never exports any hour candidate.
  const chartFor = (result: FourPillarsDetail) => ({ year: result.year, month: result.month, day: result.day, ...(input.birthTimeUnknown ? {} : { hour: result.hour }) });
  const charts = unique(candidates.map(({ result }) => chartFor(result)));
  const chartIndex = new Map(charts.map((chart, index) => [JSON.stringify(chart), index]));
  const luckIndex = new Map(daewoon.map((luck, index) => [JSON.stringify(luck), index]));
  const chartLuck = unique(candidates.map(({ result }) => ({ chartIndex: chartIndex.get(JSON.stringify(chartFor(result)))!, luckIndex: result.luckPillars ? luckIndex.get(JSON.stringify(result.luckPillars))! : null })));
  return {
    status: 'FOUNDATION_ONLY', fullCalculationReady: false, engineVersion: SAJU_ENGINE_VERSION, conventionVersion: SAJU_CONVENTION_VERSION,
    ruleVersion: null, pendingRules: SAJU_RULE_FREEZE_PENDING,
    pillars: { year: confirmed(year), month: confirmed(month), day: confirmed(day), hour: input.birthTimeUnknown ? null : confirmed(hour) },
    hourStatus: input.birthTimeUnknown ? 'UNKNOWN' : hour.length === 1 ? 'CONFIRMED' : 'UNCERTAIN',
    tenGods: { year: tenGods('year'), month: tenGods('month'), day: tenGods('day'), hour: input.birthTimeUnknown ? null : tenGods('hour') },
    gongmang: confirmed(gongmang), daewoon: confirmed(daewoon),
    possible_values: { year, month, day, ...(input.birthTimeUnknown ? {} : { hour }), charts, gongmang, daewoon, chartLuck },
    uncertaintyFlags: [...flags].sort(), precision: 'MINUTE', candidateCount: candidates.length,
  };
}
