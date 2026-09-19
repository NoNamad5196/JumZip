import type { LuckPillarInfo } from 'manseryeok';
import type { LuckTimingCandidate, LuckTimingMetadata } from './fortune-timing.ts';
import { calculateSajuFoundation, SAJU_CONVENTION_VERSION, SAJU_ENGINE_VERSION, type SajuBirthInput, type SajuFoundationResult } from './saju.ts';
import { BRANCHES, POSITIONS, STEMS } from './rules/constants.ts';
import { calculateNatalRules } from './rules/natal.ts';
import type { ElementDistribution, GyeokgukResult, HiddenStem, NatalRuleResult, PillarPosition, RulePillar, RuleRelation, ShinsalMatch, StrengthComponent, StrengthGrade, Element, TenGod } from './rules/types.ts';

export const SAJU_RULE_VERSION = 'JumZipSajuRules-v1';
/** Presence only: no date/time value or location. Optional on legacy snapshots. */
export interface SajuInputAvailability {
  calendarDate: 'PROVIDED' | 'NOT_RECORDED';
  clockTime: 'PROVIDED' | 'UNKNOWN' | 'NOT_RECORDED';
}
export interface SajuCalculationUncertainty {
  causes: ('UNKNOWN_CLOCK_TIME' | 'DST_AMBIGUITY' | 'BOUNDARY_VARIANTS' | 'CURRENT_PERIOD_UNRESOLVED' | 'CURRENT_PERIOD_OUTSIDE_RANGE' | 'LUCK_DIRECTION_INPUT_MISSING')[];
  unresolvedPillars: PillarPosition[];
  currentPeriodStatus: NonNullable<FullSajuResult['timing']>['activeDaewoonStatus'];
}
/** Describes calculated pillars, not whether original input records were retained. */
export type ComputedPillarCoverage = Record<PillarPosition, 'CONFIRMED' | 'POSSIBLE' | 'UNAVAILABLE'>;
export interface FortuneOverlay {
  source: 'SEWOON' | 'MONTHLY'; year: number; month?: number; pillar: RulePillar;
  interactions: { type: RuleRelation['type']; participants: { source: 'NATAL' | 'DAEWOON' | 'SEWOON' | 'MONTHLY'; position: string; value: string }[]; transformedElement: Element | null; activatedBy: string[] }[];
}
/** Canonical M8 output. Uncertain fields remain null and correlated variants remain available.
 * The API persists this snapshot before requesting any Persona interpretation.
 */
export interface FullSajuResult {
  status: 'COMPLETE' | 'LIMITED' | 'UNCERTAIN'; fullCalculationReady: true;
  inputAvailability?: SajuInputAvailability;
  engineVersion: 'manseryeok-2.0.0'; ruleVersion: typeof SAJU_RULE_VERSION; conventionVersion: 'JumZipSajuConvention-v1';
  pillars: Record<PillarPosition, RulePillar | null>;
  hiddenStems: Record<PillarPosition, HiddenStem[] | null>;
  tenGods: Record<PillarPosition, { stem: TenGod | '일간'; branch: TenGod } | null>;
  elements: ElementDistribution | null; relations: RuleRelation[]; gongmang: SajuFoundationResult['gongmang'];
  strength: { score: number | null; grade: StrengthGrade | null; rawScore: number | null; components: Record<'season' | 'roots' | 'visibleSupport' | 'relations' | 'concentration', StrengthComponent> | null; reasons: string[]; limited: boolean };
  gyeokguk: GyeokgukResult | null;
  yongsin: { element: Element | null; reasonCodes: string[] }; heesin: { element: Element | null; reasonCodes: string[] };
  twelveStages: Record<PillarPosition, string | null>;
  shinsal: (ShinsalMatch & { certainty: 'CONFIRMED' | 'POSSIBLE' })[];
  daewoon: LuckPillarInfo | null; sewoon: FortuneOverlay | null; monthlyFortune: FortuneOverlay | null;
  timing?: { asOf: string; precision: 'MINUTE'; periodBasis: 'SOLAR_TERM'; calendarLabel: { year: number; month: number }; activeDaewoonStatus: 'UNRESOLVED' | 'NO_ACTIVE_PERIOD' | 'ACTIVE' | 'UNCERTAIN' | 'OUTSIDE_COMPUTED_RANGE'; conventionVersion?: 'JumZipLuckTiming-v1'; luck?: LuckTimingMetadata };
  possible_values: { charts: NatalRuleResult[]; score: number[]; grade: StrengthGrade[]; yongsin: Element[]; heesin: Element[]; gongmang: SajuFoundationResult['possible_values']['gongmang']; daewoon: LuckPillarInfo[];
    chartLuck?: { chartIndex: number; luckIndex: number | null }[]; luckTiming?: LuckTimingCandidate[];
    timing?: { chartIndex: number; luckIndices?: (number | null)[]; sewoon: FortuneOverlay; monthlyFortune: FortuneOverlay }[] };
  uncertaintyFlags: string[];
}

const unique = <T>(values: readonly T[]): T[] => [...new Map(values.map(value => [JSON.stringify(value), value])).values()];
const common = <T>(values: readonly T[]): T | null => { const distinct = unique(values); return distinct.length === 1 ? distinct[0]! : null; };
export function toRulePillar(pillar: { heavenlyStem: string; earthlyBranch: string }): RulePillar {
  const stemIndex = STEMS.indexOf(pillar.heavenlyStem as RulePillar['heavenlyStem']);
  const branchIndex = BRANCHES.indexOf(pillar.earthlyBranch as RulePillar['earthlyBranch']);
  const heavenlyStem = stemIndex >= 0 ? STEMS[stemIndex] : STEMS['갑을병정무기경신임계'.indexOf(pillar.heavenlyStem)];
  const earthlyBranch = branchIndex >= 0 ? BRANCHES[branchIndex] : BRANCHES['자축인묘진사오미신유술해'.indexOf(pillar.earthlyBranch)];
  if (!heavenlyStem || !earthlyBranch) throw new RangeError('ENGINE_PILLAR_INVALID');
  return { heavenlyStem, earthlyBranch };
}
export function aggregateUncertainChoices(values: readonly { score: number; grade: StrengthGrade; yongsin: Element; heesin: Element }[]) {
  if (!values.length) throw new RangeError('CHART_CANDIDATES_REQUIRED');
  return { score: common(values.map(v => v.score)), grade: common(values.map(v => v.grade)), yongsin: common(values.map(v => v.yongsin)), heesin: common(values.map(v => v.heesin)),
    possible: { score: unique(values.map(v => v.score)), grade: unique(values.map(v => v.grade)), yongsin: unique(values.map(v => v.yongsin)), heesin: unique(values.map(v => v.heesin)) } };
}
function aggregateShinsal(variants: readonly NatalRuleResult[]): FullSajuResult['shinsal'] {
  const output: FullSajuResult['shinsal'] = [];
  const ids = unique(variants.flatMap(v => v.shinsal.map(s => s.id)));
  for (const id of ids) {
    const matches = variants.flatMap(v => v.shinsal.filter(s => s.id === id));
    const base = matches[0]!;
    const evidences = unique(matches.flatMap(s => s.evidence));
    const confirmed = evidences.filter(e => variants.every(v => v.shinsal.some(s => s.id === id && s.evidence.some(item => JSON.stringify(item) === JSON.stringify(e)))));
    const possible = evidences.filter(e => !confirmed.includes(e));
    if (confirmed.length) output.push({ ...base, evidence: confirmed, limitations: unique(matches.flatMap(s => s.limitations)), certainty: 'CONFIRMED' });
    if (possible.length) output.push({ ...base, evidence: possible, limitations: unique([...matches.flatMap(s => s.limitations), 'BOUNDARY_VARIANT']), certainty: 'POSSIBLE' });
  }
  return output;
}
/** Uses correlated foundation candidates, never a Cartesian product of independent pillar fields. */
export function calculateFullSaju(input: SajuBirthInput): FullSajuResult {
  const foundation = calculateSajuFoundation(input);
  const variants = foundation.possible_values.charts.map(chart => calculateNatalRules({ year: toRulePillar(chart.year), month: toRulePillar(chart.month), day: toRulePillar(chart.day), hour: chart.hour ? toRulePillar(chart.hour) : null }));
  const choices = aggregateUncertainChoices(variants.map(v => ({ score: v.strength.score, grade: v.strength.grade, yongsin: v.yongsin.element, heesin: v.heesin.element })));
  const byPillar = <T>(pick: (variant: NatalRuleResult, position: PillarPosition) => T): Record<PillarPosition, T | null> => Object.fromEntries(POSITIONS.map(p => [p, common(variants.map(v => pick(v, p)))])) as Record<PillarPosition, T | null>;
  const flags = unique([...foundation.uncertaintyFlags, ...variants.flatMap(v => v.uncertaintyFlags), ...(['score', 'grade', 'yongsin', 'heesin'] as const).filter(field => choices[field] === null).map(field => `${field.toUpperCase()}_UNCERTAIN`)]).sort();
  return {
    status: variants.length > 1 ? 'UNCERTAIN' : input.birthTimeUnknown || !input.gender ? 'LIMITED' : 'COMPLETE', fullCalculationReady: true,
    // Foundation already validated the calendar input. Uncertain pillars do not
    // erase that fact, and the original values do not cross this result boundary.
    inputAvailability: { calendarDate: 'PROVIDED', clockTime: input.birthTimeUnknown ? 'UNKNOWN' : 'PROVIDED' },
    engineVersion: SAJU_ENGINE_VERSION, ruleVersion: SAJU_RULE_VERSION, conventionVersion: SAJU_CONVENTION_VERSION,
    pillars: byPillar((v, p) => v.pillars[p]), hiddenStems: byPillar((v, p) => v.hiddenStems[p]), tenGods: byPillar((v, p) => v.tenGods[p]),
    elements: common(variants.map(v => v.elements)), relations: variants[0]!.relations.filter(relation => variants.every(v => v.relations.some(other => JSON.stringify(other) === JSON.stringify(relation)))), gongmang: foundation.gongmang,
    strength: { score: choices.score, grade: choices.grade, rawScore: common(variants.map(v => v.strength.rawScore)), components: common(variants.map(v => v.strength.components)), reasons: unique(variants.flatMap(v => v.strength.reasons)), limited: input.birthTimeUnknown },
    gyeokguk: common(variants.map(v => v.gyeokguk)),
    yongsin: { element: choices.yongsin, reasonCodes: unique(variants.flatMap(v => v.yongsin.reasonCodes)) }, heesin: { element: choices.heesin, reasonCodes: unique(variants.flatMap(v => v.heesin.reasonCodes)) },
    twelveStages: byPillar((v, p) => v.twelveStages[p]), shinsal: aggregateShinsal(variants), daewoon: foundation.daewoon, sewoon: null, monthlyFortune: null,
    possible_values: { charts: variants, ...choices.possible, gongmang: foundation.possible_values.gongmang, daewoon: foundation.possible_values.daewoon, chartLuck: foundation.possible_values.chartLuck }, uncertaintyFlags: flags,
  };
}

/** Trust explicit provenance only. A legacy null pillar does not prove missing input.
 * Causes describe existing calculations; they never recompute or collapse candidates. */
export function buildSajuInputContext(result: FullSajuResult): { inputAvailability: SajuInputAvailability; calculationUncertainty: SajuCalculationUncertainty } {
  const flags = result.uncertaintyFlags;
  const inputAvailability: SajuInputAvailability = {
    calendarDate: result.inputAvailability?.calendarDate === 'PROVIDED' ? 'PROVIDED' : 'NOT_RECORDED',
    clockTime: result.inputAvailability?.clockTime === 'PROVIDED' ? 'PROVIDED' : result.inputAvailability?.clockTime === 'UNKNOWN' || flags.includes('BIRTH_TIME_UNKNOWN') ? 'UNKNOWN' : 'NOT_RECORDED',
  };
  const currentPeriodStatus = result.timing?.activeDaewoonStatus ?? 'UNRESOLVED';
  const causes: SajuCalculationUncertainty['causes'] = [];
  if (inputAvailability.clockTime === 'UNKNOWN') causes.push('UNKNOWN_CLOCK_TIME');
  if (flags.includes('DST_AMBIGUOUS_TIME')) causes.push('DST_AMBIGUITY');
  if (result.possible_values.charts.length > 1) causes.push('BOUNDARY_VARIANTS');
  if (['UNRESOLVED', 'UNCERTAIN'].includes(currentPeriodStatus)) causes.push('CURRENT_PERIOD_UNRESOLVED');
  if (currentPeriodStatus === 'OUTSIDE_COMPUTED_RANGE') causes.push('CURRENT_PERIOD_OUTSIDE_RANGE');
  if (flags.includes('DAEWOON_REQUIRES_GENDER')) causes.push('LUCK_DIRECTION_INPUT_MISSING');
  return { inputAvailability, calculationUncertainty: { causes, unresolvedPillars: POSITIONS.filter(position => result.pillars[position] === null), currentPeriodStatus } };
}

/** A confirmed pillar must exist and be identical in every correlated chart.
 * Mixed missing/present candidates remain possible; none is selected or recombined. */
export function getComputedPillarCoverage(charts: readonly Pick<NatalRuleResult, 'pillars'>[]): ComputedPillarCoverage {
  return Object.fromEntries(POSITIONS.map(position => {
    const values = charts.map(chart => chart.pillars[position]);
    if (!values.length || values.every(value => value === null)) return [position, 'UNAVAILABLE'];
    const first = values[0];
    const same = first !== null && first !== undefined && values.every(value => value !== null && value.heavenlyStem === first.heavenlyStem && value.earthlyBranch === first.earthlyBranch);
    return [position, same ? 'CONFIRMED' : 'POSSIBLE'];
  })) as ComputedPillarCoverage;
}

/** Compact immutable facts for Persona; detailed proofs stay in the saved server snapshot. */
export function buildSajuInterpretationData(result: FullSajuResult) {
  return {
    kind: 'SAJU', engineVersion: result.engineVersion, ruleVersion: result.ruleVersion, conventionVersion: result.conventionVersion,
    ...buildSajuInputContext(result),
    computedPillarCoverage: getComputedPillarCoverage(result.possible_values.charts),
    status: result.status, pillars: result.pillars, tenGods: result.tenGods, elements: result.elements?.proportion ?? null,
    strength: { score: result.strength.score, grade: result.strength.grade, limited: result.strength.limited },
    gyeokguk: result.gyeokguk ? { primary: result.gyeokguk.primary, secondary: result.gyeokguk.secondary, monthCore: result.gyeokguk.monthCore, geonrok: result.gyeokguk.geonrok, yangin: result.gyeokguk.yangin, specialStructureCandidate: result.gyeokguk.specialStructureCandidate } : null,
    yongsin: result.yongsin, heesin: result.heesin, gongmang: result.gongmang, twelveStages: result.twelveStages,
    relations: result.relations.map(({ type, participants, values, transformedElement }) => ({ type, participants, values, transformedElement })),
    shinsal: result.shinsal.map(({ id, name, certainty, evidence, limitations }) => ({ id, name, certainty, evidence, limitations })),
    daewoon: result.daewoon, sewoon: result.sewoon, monthlyFortune: result.monthlyFortune, timing: result.timing,
    possible_values: { score: result.possible_values.score, grade: result.possible_values.grade, yongsin: result.possible_values.yongsin, heesin: result.possible_values.heesin }, uncertaintyFlags: result.uncertaintyFlags,
  };
}
