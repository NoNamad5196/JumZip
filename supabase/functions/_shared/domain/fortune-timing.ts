import { calculateFourPillars, getSolarTerm, HEAVENLY_STEMS, EARTHLY_BRANCHES, type Pillar, type LuckPillarInfo } from 'manseryeok';
import { BRANCH_RELATIONS, BRANCHES, POSITIONS, STEMS, STEM_COMBINATIONS, validateChart } from './rules/constants.ts';
import type { NatalChart, RulePillar } from './rules/types.ts';
import { calculateFullSaju, type FortuneOverlay, type FullSajuResult } from './full-saju.ts';
import { resolveSajuSolarBirthDate, type SajuBirthInput } from './saju.ts';

export const LUCK_TIMING_VERSION = 'JumZipLuckTiming-v1';
export interface LuckPeriod { index: number; pillar: RulePillar; startDate: string; endDate: string }
export interface LuckPeriodSummary {
  index: number; pillar: RulePillar | null; startDate: string | null; endDate: string | null;
  startDateRange: { earliest: string; latest: string }; endDateRange: { earliest: string; latest: string };
}
export interface LuckTimingCandidate {
  luckIndex: number; firstStartDate: string; currentIndex: number | null;
  status: 'ACTIVE' | 'NO_ACTIVE_PERIOD' | 'OUTSIDE_COMPUTED_RANGE';
}
export interface LuckTimingMetadata {
  ruleVersion: typeof LUCK_TIMING_VERSION; precision: 'DAY'; dateBasis: 'BIRTH_LOCATION_CIVIL_DAY'; asOfLocalDate: string;
  currentPeriod: LuckPeriod | null; currentPillar: RulePillar | null; periods: LuckPeriodSummary[];
  candidateCount: number; limitations: string[];
}

const DAY_MS = 86_400_000;
function parseCivilDate(value: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new RangeError('LUCK_CIVIL_DATE_INVALID');
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (year < 100 || date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) throw new RangeError('LUCK_CIVIL_DATE_INVALID');
  return { year, month, day };
}
function civilString(date: Date): string {
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 100 || date.getUTCFullYear() > 9999) throw new RangeError('LUCK_CIVIL_DATE_OUT_OF_RANGE');
  return date.toISOString().slice(0, 10);
}

/** Approved product arithmetic: select the target month with years and months together,
 * clamp once in that month, then add calendar days. UTC is only a date arithmetic carrier;
 * these values never represent transition instants or a claimed midnight birth time. */
export function calculateLuckStartDate(solarBirthDate: string, duration: Pick<LuckPillarInfo, 'startYears' | 'startMonths' | 'startDays'>): string {
  const birth = parseCivilDate(solarBirthDate);
  if ([duration.startYears, duration.startMonths, duration.startDays].some(value => !Number.isSafeInteger(value) || value < 0)) throw new RangeError('LUCK_DURATION_INVALID');
  const targetMonth = birth.year * 12 + birth.month - 1 + duration.startYears * 12 + duration.startMonths;
  const year = Math.floor(targetMonth / 12), month = targetMonth % 12;
  if (!Number.isSafeInteger(targetMonth) || year < 100 || year > 9999) throw new RangeError('LUCK_CIVIL_DATE_OUT_OF_RANGE');
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return civilString(new Date(Date.UTC(year, month, Math.min(birth.day, lastDay)) + duration.startDays * DAY_MS));
}
export function luckBoundaryDate(firstStartDate: string, boundaryIndex: number): string {
  if (!Number.isSafeInteger(boundaryIndex) || boundaryIndex < 0) throw new RangeError('LUCK_PERIOD_INDEX_INVALID');
  return calculateLuckStartDate(firstStartDate, { startYears: boundaryIndex * 10, startMonths: 0, startDays: 0 });
}
export function selectLuckPeriodIndex(firstStartDate: string, localDate: string, periodCount = 10): number | null {
  parseCivilDate(firstStartDate); parseCivilDate(localDate);
  if (!Number.isSafeInteger(periodCount) || periodCount < 1 || periodCount > 120) throw new RangeError('LUCK_PERIOD_COUNT_INVALID');
  for (let index = 0; index < periodCount; index++) if (localDate >= luckBoundaryDate(firstStartDate, index) && localDate < luckBoundaryDate(firstStartDate, index + 1)) return index;
  return null;
}
export function birthLocationCivilDate(asOf: Date, timezone: string): string {
  if (!Number.isFinite(asOf.getTime())) throw new RangeError('FLOW_DATE_INVALID');
  let formatter: Intl.DateTimeFormat;
  try { formatter = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }); } catch { throw new RangeError('LUCK_TIMEZONE_INVALID'); }
  const parts = Object.fromEntries(formatter.formatToParts(asOf).map(part => [part.type, part.value]));
  const value = `${parts.year}-${parts.month}-${parts.day}`;
  parseCivilDate(value);
  return value;
}

type Source = 'NATAL' | 'DAEWOON' | 'SEWOON' | 'MONTHLY';
export interface LayerPillar { source: Source; position: string; pillar: RulePillar }
export interface FortuneTiming {
  asOf: string; precision: 'MINUTE'; periodBasis: 'SOLAR_TERM';
  sewoon: FortuneOverlay; monthlyFortune: FortuneOverlay;
  calendarLabel: { year: number; month: number }; limitations: string[];
}
const SOURCES: readonly Source[] = ['NATAL', 'DAEWOON', 'SEWOON', 'MONTHLY'];
const hanja = (pillar: Pillar): RulePillar => ({ heavenlyStem: STEMS[HEAVENLY_STEMS.indexOf(pillar.heavenlyStem)]!, earthlyBranch: BRANCHES[EARTHLY_BRANCHES.indexOf(pillar.earthlyBranch)]! });
function combinations<T>(items: readonly T[], count: number): T[][] {
  if (count === 0) return [[]];
  return items.flatMap((item, index) => combinations(items.slice(index + 1), count - 1).map(tail => [item, ...tail]));
}
const symbolsEqual = (symbols: readonly string[], pattern: string) => [...symbols].sort().join('') === [...pattern].sort().join('');

/** Each participant identity is source + position. Equal symbols in separate layers remain
 * separate activations. Overlay presence never establishes a new natal transformation. */
export function calculateOverlayInteractions(layers: readonly LayerPillar[], activatedLayer: 'SEWOON' | 'MONTHLY'): FortuneOverlay['interactions'] {
  const ids = layers.map(layer => `${layer.source}:${layer.position}`);
  if (new Set(ids).size !== ids.length || layers.some(layer => !STEMS.includes(layer.pillar.heavenlyStem) || !BRANCHES.includes(layer.pillar.earthlyBranch))) throw new RangeError('FLOW_LAYER_INVALID');
  const interactions: FortuneOverlay['interactions'] = [];
  const add = (type: FortuneOverlay['interactions'][number]['type'], participants: readonly LayerPillar[], symbol: 'heavenlyStem' | 'earthlyBranch') => {
    if (!participants.some(participant => participant.source === activatedLayer)) return;
    interactions.push({ type, participants: participants.map(({ source, position, pillar }) => ({ source, position, value: pillar[symbol] })), transformedElement: null,
      activatedBy: SOURCES.filter(source => participants.some(participant => participant.source === source)) });
  };
  for (const pair of combinations(layers, 2)) {
    const [a, b] = pair.map(layer => layer.pillar.heavenlyStem);
    if (STEM_COMBINATIONS.some(([left, right]) => a === left && b === right || a === right && b === left)) add('STEM_COMBINATION', pair, 'heavenlyStem');
  }
  for (const [type, patterns] of Object.entries(BRANCH_RELATIONS) as [keyof typeof BRANCH_RELATIONS, readonly string[]][]) {
    for (const pattern of patterns) for (const participants of combinations(layers, [...pattern].length)) {
      if (symbolsEqual(participants.map(participant => participant.pillar.earthlyBranch), pattern)) add(type, participants, 'earthlyBranch');
    }
  }
  return interactions;
}

/** Year/month pillars use the absolute current instant and pinned library solar terms.
 * year is the Ipchun-based solar-term year; monthly month is 寅=1 ... 丑=12.
 * calendarLabel is kept separately so UI cannot confuse Gregorian and solar-term months.
 * activeDaewoon undefined means not resolved; null means caller confirmed no active period.
 * Duration-to-civil-date selection is intentionally a separate convention boundary. */
export function calculateFortuneTiming(input: { natal: NatalChart; asOf: Date; activeDaewoon?: RulePillar | null }): FortuneTiming {
  validateChart(input.natal);
  if (!Number.isFinite(input.asOf.getTime())) throw new RangeError('FLOW_DATE_INVALID');
  const instant = Math.floor(input.asOf.getTime() / 60_000) * 60_000;
  const bridge = new Date(instant + 9 * 60 * 60_000);
  const year = bridge.getUTCFullYear();
  if (year < 1800 || year > 2300) throw new RangeError('FLOW_YEAR_OUTSIDE_ENGINE_RANGE');
  const calculated = calculateFourPillars({ year, month: bridge.getUTCMonth() + 1, day: bridge.getUTCDate(), hour: bridge.getUTCHours(), minute: bridge.getUTCMinutes(), dayBoundary: 'splitJasi' });
  const yearPillar = hanja(calculated.year), monthPillar = hanja(calculated.month);
  const solarYear = instant < getSolarTerm(year, 2).date.getTime() ? year - 1 : year;
  const solarMonth = (BRANCHES.indexOf(monthPillar.earthlyBranch) + 10) % 12 + 1;
  const layers: LayerPillar[] = POSITIONS.flatMap(position => input.natal[position] ? [{ source: 'NATAL' as const, position, pillar: input.natal[position]! }] : []);
  if (input.activeDaewoon) layers.push({ source: 'DAEWOON', position: 'current', pillar: input.activeDaewoon });
  layers.push({ source: 'SEWOON', position: String(solarYear), pillar: yearPillar });
  const sewoon: FortuneOverlay = { source: 'SEWOON', year: solarYear, pillar: yearPillar, interactions: calculateOverlayInteractions(layers, 'SEWOON') };
  layers.push({ source: 'MONTHLY', position: `${solarYear}-${solarMonth}`, pillar: monthPillar });
  const monthlyFortune: FortuneOverlay = { source: 'MONTHLY', year: solarYear, month: solarMonth, pillar: monthPillar, interactions: calculateOverlayInteractions(layers, 'MONTHLY') };
  return { asOf: new Date(instant).toISOString(), precision: 'MINUTE', periodBasis: 'SOLAR_TERM', sewoon, monthlyFortune,
    calendarLabel: { year, month: bridge.getUTCMonth() + 1 }, limitations: input.activeDaewoon === undefined ? ['CURRENT_DAEWOON_NOT_RESOLVED'] : [] };
}

/** Retains correlated candidate timing rather than inventing a Cartesian product. Only
 * interactions present for every actual candidate are projected as confirmed flat facts. */
export function withFortuneTiming(result: FullSajuResult, asOf: Date, activeDaewoon?: RulePillar | null): FullSajuResult {
  const candidates = result.possible_values.charts.map((chart, chartIndex) => ({ chartIndex,
    ...calculateFortuneTiming({ natal: chart.pillars, asOf, activeDaewoon }) }));
  const first = candidates[0];
  if (!first) throw new RangeError('FLOW_CHART_CANDIDATES_REQUIRED');
  const common = (field: 'sewoon' | 'monthlyFortune'): FortuneOverlay => ({ ...first[field], interactions: first[field].interactions.filter(interaction =>
    candidates.every(candidate => candidate[field].interactions.some(other => JSON.stringify(other) === JSON.stringify(interaction)))) });
  const differs = candidates.some(candidate => JSON.stringify([candidate.sewoon, candidate.monthlyFortune]) !== JSON.stringify([first.sewoon, first.monthlyFortune]));
  const limitations = [...first.limitations, ...(differs ? ['TIMING_INTERACTIONS_UNCERTAIN'] : [])];
  return { ...result, status: result.status === 'COMPLETE' && limitations.length ? 'LIMITED' : result.status,
    sewoon: common('sewoon'), monthlyFortune: common('monthlyFortune'),
    timing: { asOf: first.asOf, precision: first.precision, periodBasis: first.periodBasis, calendarLabel: first.calendarLabel,
      activeDaewoonStatus: activeDaewoon === undefined ? 'UNRESOLVED' : activeDaewoon === null ? 'NO_ACTIVE_PERIOD' : 'ACTIVE' },
    possible_values: { ...result.possible_values, timing: candidates.map(({ chartIndex, sewoon, monthlyFortune }) => ({ chartIndex, sewoon, monthlyFortune })) },
    uncertaintyFlags: [...new Set([...result.uncertaintyFlags, ...limitations])].sort() };
}

const unique = <T>(values: readonly T[]): T[] => [...new Map(values.map(value => [JSON.stringify(value), value])).values()];
const common = <T>(values: readonly T[]): T | null => { const distinct = unique(values); return distinct.length === 1 ? distinct[0]! : null; };

/** One foundation sweep, followed by date-only selection from its actual chart/luck pairs.
 * Raw birth date, location and clock time remain transient input. The saved snapshot contains
 * only derived boundaries and correlation indices; rounded startAge is never used here. */
export function calculateFullSajuWithTiming(input: SajuBirthInput, asOf: Date): FullSajuResult {
  const result = calculateFullSaju(input);
  const solarBirthDate = resolveSajuSolarBirthDate(input);
  const localDate = birthLocationCivilDate(asOf, input.location.timezone);
  const links = result.possible_values.chartLuck;
  if (!links?.length) throw new RangeError('FLOW_CHART_LUCK_CORRELATION_REQUIRED');
  const luckCandidates = result.possible_values.daewoon.map((luck, luckIndex) => {
    const firstStartDate = calculateLuckStartDate(solarBirthDate, luck);
    const currentIndex = selectLuckPeriodIndex(firstStartDate, localDate, luck.pillars.length);
    const periods: LuckPeriod[] = luck.pillars.map((entry, index) => ({ index, pillar: hanja(entry.pillar), startDate: luckBoundaryDate(firstStartDate, index), endDate: luckBoundaryDate(firstStartDate, index + 1) }));
    const status: LuckTimingCandidate['status'] = currentIndex !== null ? 'ACTIVE' : localDate < firstStartDate ? 'NO_ACTIVE_PERIOD' : 'OUTSIDE_COMPUTED_RANGE';
    return { luckIndex, firstStartDate, currentIndex, status, periods, current: currentIndex === null ? null : periods[currentIndex]! };
  });
  // Overlay calculations depend on the active pillar, not the differing date boundary.
  // Deduplicate equivalent overlays while retaining every supporting luckIndex explicitly.
  const groups = new Map<string, { chartIndex: number; luckIndices: (number | null)[]; activeDaewoon: RulePillar | null | undefined }>();
  for (const link of links) {
    const luck = link.luckIndex === null ? undefined : luckCandidates[link.luckIndex];
    if (!result.possible_values.charts[link.chartIndex] || (link.luckIndex !== null && !luck)) throw new RangeError('FLOW_CHART_LUCK_CORRELATION_INVALID');
    const activeDaewoon = luck?.status === 'OUTSIDE_COMPUTED_RANGE' || !luck ? undefined : luck.current?.pillar ?? null;
    const key = JSON.stringify([link.chartIndex, activeDaewoon === undefined ? 'UNRESOLVED' : activeDaewoon]);
    const group = groups.get(key);
    if (group) group.luckIndices.push(link.luckIndex);
    else groups.set(key, { chartIndex: link.chartIndex, luckIndices: [link.luckIndex], activeDaewoon });
  }
  const overlays = [...groups.values()].map(group => ({ ...group,
    ...calculateFortuneTiming({ natal: result.possible_values.charts[group.chartIndex]!.pillars, asOf, activeDaewoon: group.activeDaewoon }) }));
  const first = overlays[0]!;
  const commonOverlay = (field: 'sewoon' | 'monthlyFortune'): FortuneOverlay => ({ ...first[field], interactions: first[field].interactions.filter(interaction =>
    overlays.every(candidate => candidate[field].interactions.some(other => JSON.stringify(other) === JSON.stringify(interaction)))) });
  const limitations: string[] = [];
  const differs = overlays.some(candidate => JSON.stringify([candidate.sewoon, candidate.monthlyFortune]) !== JSON.stringify([first.sewoon, first.monthlyFortune]));
  if (differs) limitations.push('TIMING_INTERACTIONS_UNCERTAIN');
  let activeDaewoonStatus: NonNullable<FullSajuResult['timing']>['activeDaewoonStatus'];
  if (!luckCandidates.length || links.some(link => link.luckIndex === null)) {
    activeDaewoonStatus = 'UNRESOLVED'; limitations.push('CURRENT_DAEWOON_NOT_RESOLVED');
  } else if (luckCandidates.every(candidate => candidate.status === 'NO_ACTIVE_PERIOD')) activeDaewoonStatus = 'NO_ACTIVE_PERIOD';
  else if (luckCandidates.every(candidate => candidate.status === 'OUTSIDE_COMPUTED_RANGE')) {
    activeDaewoonStatus = 'OUTSIDE_COMPUTED_RANGE'; limitations.push('CURRENT_DAEWOON_OUTSIDE_COMPUTED_RANGE');
  } else if (luckCandidates.every(candidate => candidate.status === 'ACTIVE') && common(luckCandidates.map(candidate => candidate.current))) activeDaewoonStatus = 'ACTIVE';
  else { activeDaewoonStatus = 'UNCERTAIN'; limitations.push('CURRENT_DAEWOON_UNCERTAIN'); }
  if (luckCandidates.some(candidate => candidate.status === 'OUTSIDE_COMPUTED_RANGE') && !limitations.includes('CURRENT_DAEWOON_OUTSIDE_COMPUTED_RANGE')) limitations.push('CURRENT_DAEWOON_OUTSIDE_COMPUTED_RANGE');
  const periods: LuckPeriodSummary[] = (luckCandidates[0]?.periods ?? []).map((period, index) => {
    const variants = luckCandidates.map(candidate => candidate.periods[index]!);
    const starts = variants.map(candidate => candidate.startDate).sort(), ends = variants.map(candidate => candidate.endDate).sort();
    return { index: period.index, pillar: common(variants.map(candidate => candidate.pillar)), startDate: common(starts), endDate: common(ends),
      startDateRange: { earliest: starts[0]!, latest: starts.at(-1)! }, endDateRange: { earliest: ends[0]!, latest: ends.at(-1)! } };
  });
  const luck: LuckTimingMetadata = { ruleVersion: LUCK_TIMING_VERSION, precision: 'DAY', dateBasis: 'BIRTH_LOCATION_CIVIL_DAY', asOfLocalDate: localDate,
    currentPeriod: common(luckCandidates.map(candidate => candidate.current)), currentPillar: common(luckCandidates.map(candidate => candidate.current?.pillar ?? null)),
    periods, candidateCount: luckCandidates.length, limitations };
  const status = activeDaewoonStatus === 'UNCERTAIN' ? 'UNCERTAIN' : result.status === 'COMPLETE' && limitations.length ? 'LIMITED' : result.status;
  return { ...result, status, sewoon: commonOverlay('sewoon'), monthlyFortune: commonOverlay('monthlyFortune'),
    timing: { asOf: first.asOf, precision: first.precision, periodBasis: first.periodBasis, calendarLabel: first.calendarLabel, activeDaewoonStatus, conventionVersion: LUCK_TIMING_VERSION, luck },
    possible_values: { ...result.possible_values,
      luckTiming: luckCandidates.map(({ luckIndex, firstStartDate, currentIndex, status }) => ({ luckIndex, firstStartDate, currentIndex, status })),
      timing: overlays.map(({ chartIndex, luckIndices, sewoon, monthlyFortune }) => ({ chartIndex, luckIndices, sewoon, monthlyFortune })) },
    uncertaintyFlags: [...new Set([...result.uncertaintyFlags, ...limitations])].sort() };
}
