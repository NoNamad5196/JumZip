import type { FullSajuResult, FortuneOverlay } from './full-saju.ts';
import { BRANCH_RELATIONS, control, ELEMENTS, gen, getTenGod, knownPositions, STEM_COMBINATIONS, stemElement } from './rules/constants.ts';
import type { Element, NatalRuleResult, PillarPosition, RuleRelation, TenGod } from './rules/types.ts';

type Person = 'A' | 'B';
type Certainty = 'CONFIRMED' | 'POSSIBLE';
export interface CompatibilityParticipant { person: Person; position: PillarPosition; value: string }
export interface CompatibilityRelation {
  type: RuleRelation['type']; participants: CompatibilityParticipant[];
  transformedElement: null; activatedBy: ['PERSON_A:NATAL', 'PERSON_B:NATAL'];
}
export interface DayMasterRelation {
  personA: string; personB: string; aSeesB: TenGod; bSeesA: TenGod;
  elementRelation: 'SAME' | 'A_GENERATES_B' | 'B_GENERATES_A' | 'A_CONTROLS_B' | 'B_CONTROLS_A';
}
export interface ElementComparison { element: Element; personAProportion: number; personBProportion: number; personABalanceRole: 'YONGSIN' | 'HEESIN' | null; personBBalanceRole: 'YONGSIN' | 'HEESIN' | null }
export interface MutualTenGod { observer: Person; subject: Person; position: PillarPosition; stem: string; tenGod: TenGod }
export interface CompatibilityPair {
  dayMasterRelation: DayMasterRelation; elementComplement: ElementComparison[];
  spousePalaceRelations: CompatibilityRelation[]; stemRelations: CompatibilityRelation[]; branchRelations: CompatibilityRelation[];
  mutualTenGods: MutualTenGod[];
}
export interface CompatibilityEvidenceNote { code: string; label: string; certainty: Certainty; relation?: CompatibilityRelation; element?: Element; person?: Person }
export interface CompatibilityTiming {
  personA: { sewoon: FortuneOverlay | null; monthlyFortune: FortuneOverlay | null; metadata?: FullSajuResult['timing'] };
  personB: { sewoon: FortuneOverlay | null; monthlyFortune: FortuneOverlay | null; metadata?: FullSajuResult['timing'] };
  simultaneousActivations: { source: 'SEWOON' | 'MONTHLY'; type: RuleRelation['type']; pillar: string; personA: FortuneOverlay['interactions']; personB: FortuneOverlay['interactions'] }[];
  limitations: string[];
}
interface DerivedPerson {
  engineVersion: string; ruleVersion: string; conventionVersion: string; status: FullSajuResult['status'];
  charts: NatalRuleResult[]; gongmang: FullSajuResult['gongmang']; daewoon: FullSajuResult['daewoon'];
  sewoon: FullSajuResult['sewoon']; monthlyFortune: FullSajuResult['monthlyFortune']; uncertaintyFlags: string[];
  timing?: FullSajuResult['timing']; possibleTiming?: FullSajuResult['possible_values']['timing'];
  chartLuck?: FullSajuResult['possible_values']['chartLuck']; possibleLuckTiming?: FullSajuResult['possible_values']['luckTiming'];
}
export interface SajuCompatibilityResult {
  kind: 'SAJU_COMPATIBILITY'; engineVersion: string; ruleVersion: string; conventionVersion: string;
  personA: DerivedPerson; personB: DerivedPerson;
  summary: {
    dayMasterRelation: DayMasterRelation | null;
    elementComplement: (ElementComparison & { certainty: Certainty })[];
    spousePalaceRelations: (CompatibilityRelation & { certainty: Certainty })[];
    stemRelations: (CompatibilityRelation & { certainty: Certainty })[];
    branchRelations: (CompatibilityRelation & { certainty: Certainty })[];
    mutualTenGods: (MutualTenGod & { certainty: Certainty })[];
    timing: CompatibilityTiming; strengths: CompatibilityEvidenceNote[]; frictions: CompatibilityEvidenceNote[];
    /** Discussion prompts derived from evidence, not a substituted Persona response. */
    practicalAdvice: { code: string; label: string }[];
  };
  possible_values: { pairs: { personAChartIndex: number; personBChartIndex: number; analysis: CompatibilityPair }[] };
  uncertaintyFlags: string[];
}
const unique = <T>(items: readonly T[]): T[] => [...new Map(items.map(item => [JSON.stringify(item), item])).values()];
const common = <T>(items: readonly T[]): T | null => { const values = unique(items); return values.length === 1 ? values[0]! : null; };
function combinations<T>(items: readonly T[], size: number): T[][] { return size === 0 ? [[]] : items.flatMap((item, index) => combinations(items.slice(index + 1), size - 1).map(tail => [item, ...tail])); }
const sameSymbols = (values: readonly string[], pattern: string) => [...values].sort().join('') === [...pattern].sort().join('');

/** Cross-person presence uses the already frozen relation tables. It never treats two
 * people's charts as one natal chart for transformations, Strength or Balance. */
export function compareNatalCharts(a: NatalRuleResult, b: NatalRuleResult): CompatibilityPair {
  const aStem = a.pillars.day.heavenlyStem, bStem = b.pillars.day.heavenlyStem;
  const ae = stemElement(aStem), be = stemElement(bStem);
  const dayMasterRelation: DayMasterRelation = { personA: aStem, personB: bStem, aSeesB: getTenGod(aStem, bStem), bSeesA: getTenGod(bStem, aStem), elementRelation: ae === be ? 'SAME' : gen(ae) === be ? 'A_GENERATES_B' : gen(be) === ae ? 'B_GENERATES_A' : control(ae) === be ? 'A_CONTROLS_B' : 'B_CONTROLS_A' };
  const positions = ([['A', a], ['B', b]] as const).flatMap(([person, chart]) => knownPositions(chart.pillars).map(position => ({ person, position, pillar: chart.pillars[position]! })));
  const stemRelations: CompatibilityRelation[] = [], branchRelations: CompatibilityRelation[] = [];
  const add = (list: CompatibilityRelation[], type: RuleRelation['type'], entries: typeof positions, symbol: 'heavenlyStem' | 'earthlyBranch') => {
    if (!entries.some(p => p.person === 'A') || !entries.some(p => p.person === 'B')) return;
    list.push({ type, participants: entries.map(({ person, position, pillar }) => ({ person, position, value: pillar[symbol] })), transformedElement: null, activatedBy: ['PERSON_A:NATAL', 'PERSON_B:NATAL'] });
  };
  for (const pair of combinations(positions, 2)) {
    const [x, y] = pair.map(p => p.pillar.heavenlyStem);
    if (STEM_COMBINATIONS.some(([left, right]) => x === left && y === right || x === right && y === left)) add(stemRelations, 'STEM_COMBINATION', pair, 'heavenlyStem');
  }
  for (const [type, patterns] of Object.entries(BRANCH_RELATIONS) as [keyof typeof BRANCH_RELATIONS, readonly string[]][]) for (const pattern of patterns) for (const entries of combinations(positions, [...pattern].length)) {
    if (sameSymbols(entries.map(p => p.pillar.earthlyBranch), pattern)) add(branchRelations, type, entries, 'earthlyBranch');
  }
  const role = (chart: NatalRuleResult, element: Element) => chart.yongsin.element === element ? 'YONGSIN' as const : chart.heesin.element === element ? 'HEESIN' as const : null;
  const elementComplement = ELEMENTS.map(element => ({ element, personAProportion: a.elements.proportion[element], personBProportion: b.elements.proportion[element], personABalanceRole: role(a, element), personBBalanceRole: role(b, element) }));
  const mutualTenGods: MutualTenGod[] = ([['A', 'B', aStem, b], ['B', 'A', bStem, a]] as const).flatMap(([observer, subject, day, other]) => knownPositions(other.pillars).map(position => ({ observer, subject, position, stem: other.pillars[position]!.heavenlyStem, tenGod: getTenGod(day, other.pillars[position]!.heavenlyStem) })));
  return { dayMasterRelation, elementComplement, stemRelations, branchRelations, spousePalaceRelations: branchRelations.filter(relation => relation.participants.length === 2 && relation.participants.every(p => p.position === 'day')), mutualTenGods };
}
function aggregateEvidence<T>(groups: readonly (readonly T[])[]): (T & { certainty: Certainty })[] {
  return unique(groups.flat()).map(item => ({ ...item, certainty: groups.every(group => group.some(candidate => JSON.stringify(candidate) === JSON.stringify(item))) ? 'CONFIRMED' : 'POSSIBLE' }));
}
function timing(a: FullSajuResult, b: FullSajuResult): CompatibilityTiming {
  const simultaneousActivations: CompatibilityTiming['simultaneousActivations'] = [];
  const limitations: string[] = [];
  if (a.timing?.asOf && b.timing?.asOf && a.timing.asOf !== b.timing.asOf) limitations.push('TIMING_AS_OF_MISMATCH');
  for (const [field, source] of [['sewoon', 'SEWOON'], ['monthlyFortune', 'MONTHLY']] as const) {
    const left = a[field], right = b[field];
    if (!left || !right) { limitations.push(`${source}_NOT_CONFIRMED_FOR_BOTH`); continue; }
    const leftPillar = left.pillar.heavenlyStem + left.pillar.earthlyBranch, rightPillar = right.pillar.heavenlyStem + right.pillar.earthlyBranch;
    if (left.year !== right.year || left.month !== right.month || leftPillar !== rightPillar) { limitations.push(`${source}_PERIOD_MISMATCH`); continue; }
    for (const type of unique(left.interactions.map(r => r.type))) {
      const own = left.interactions.filter(r => r.type === type), other = right.interactions.filter(r => r.type === type);
      if (other.length) simultaneousActivations.push({ source, type, pillar: leftPillar, personA: own, personB: other });
    }
  }
  const resolved = (person: FullSajuResult) => person.timing !== undefined && ['ACTIVE', 'NO_ACTIVE_PERIOD'].includes(person.timing.activeDaewoonStatus);
  if (!resolved(a) || !resolved(b)) limitations.push('CURRENT_DAEWOON_SIMULTANEOUS_ACTIVATION_NOT_CONFIRMED');
  return { personA: { sewoon: a.sewoon, monthlyFortune: a.monthlyFortune, ...(a.timing ? { metadata: a.timing } : {}) }, personB: { sewoon: b.sewoon, monthlyFortune: b.monthlyFortune, ...(b.timing ? { metadata: b.timing } : {}) }, simultaneousActivations, limitations };
}
function derived(person: FullSajuResult): DerivedPerson {
  // Explicit projection: raw DOB/time/place cannot be persisted through an extra top-level input field.
  return structuredClone({ engineVersion: person.engineVersion, ruleVersion: person.ruleVersion, conventionVersion: person.conventionVersion, status: person.status, charts: person.possible_values.charts, gongmang: person.gongmang, daewoon: person.daewoon, sewoon: person.sewoon, monthlyFortune: person.monthlyFortune, ...(person.timing ? { timing: person.timing } : {}), ...(person.possible_values.timing ? { possibleTiming: person.possible_values.timing } : {}), ...(person.possible_values.chartLuck ? { chartLuck: person.possible_values.chartLuck } : {}), ...(person.possible_values.luckTiming ? { possibleLuckTiming: person.possible_values.luckTiming } : {}), uncertaintyFlags: person.uncertaintyFlags });
}
export function calculateSajuCompatibility(input: { personA: FullSajuResult; personB: FullSajuResult }): SajuCompatibilityResult {
  const a = input.personA, b = input.personB;
  if (!a?.fullCalculationReady || !b?.fullCalculationReady || !a.possible_values.charts.length || !b.possible_values.charts.length) throw new RangeError('COMPATIBILITY_CHART_REQUIRED');
  if (a.engineVersion !== b.engineVersion || a.ruleVersion !== b.ruleVersion || a.conventionVersion !== b.conventionVersion) throw new RangeError('COMPATIBILITY_VERSION_MISMATCH');
  const pairs = a.possible_values.charts.flatMap((left, personAChartIndex) => b.possible_values.charts.map((right, personBChartIndex) => ({ personAChartIndex, personBChartIndex, analysis: compareNatalCharts(left, right) })));
  const analyses = pairs.map(pair => pair.analysis);
  const dayMasterRelation = common(analyses.map(pair => pair.dayMasterRelation));
  const elementComplement = aggregateEvidence(analyses.map(pair => pair.elementComplement));
  const stemRelations = aggregateEvidence(analyses.map(pair => pair.stemRelations)), branchRelations = aggregateEvidence(analyses.map(pair => pair.branchRelations));
  const spousePalaceRelations = aggregateEvidence(analyses.map(pair => pair.spousePalaceRelations)), mutualTenGods = aggregateEvidence(analyses.map(pair => pair.mutualTenGods));
  // These are evidence-indexed discussion points, never a good/bad relationship verdict or score.
  const strengths: CompatibilityEvidenceNote[] = [...stemRelations, ...branchRelations.filter(r => ['SIX_COMBINATION', 'TRINE', 'DIRECTIONAL'].includes(r.type))].map(({ certainty, ...relation }) => ({ code: 'CONNECTION_PATTERN', label: '서로의 방식을 맞춰 볼 연결 패턴', certainty, relation }));
  for (const row of elementComplement) {
    if (row.personABalanceRole === 'YONGSIN' && row.personBProportion > 0) strengths.push({ code: 'A_BALANCE_ELEMENT_PRESENT_IN_B', label: '나의 용신 오행이 상대 원국에도 나타나요', certainty: row.certainty, element: row.element, person: 'A' });
    if (row.personBBalanceRole === 'YONGSIN' && row.personAProportion > 0) strengths.push({ code: 'B_BALANCE_ELEMENT_PRESENT_IN_A', label: '상대의 용신 오행이 내 원국에도 나타나요', certainty: row.certainty, element: row.element, person: 'B' });
  }
  const frictions: CompatibilityEvidenceNote[] = branchRelations.filter(r => ['CLASH', 'HARM', 'BREAK', 'PUNISHMENT', 'SELF_PUNISHMENT'].includes(r.type)).map(({ certainty, ...relation }) => ({ code: 'DIFFERENCE_PATTERN', label: '대화로 차이를 확인할 관계 패턴', certainty, relation }));
  const flow = timing(a, b);
  const flags = unique([...a.uncertaintyFlags.map(flag => `PERSON_A:${flag}`), ...b.uncertaintyFlags.map(flag => `PERSON_B:${flag}`), ...flow.limitations, ...(pairs.length > 1 ? ['COMPATIBILITY_BOUNDARY_VARIANTS'] : [])]);
  return { kind: 'SAJU_COMPATIBILITY', engineVersion: a.engineVersion, ruleVersion: a.ruleVersion, conventionVersion: a.conventionVersion, personA: derived(a), personB: derived(b),
    summary: { dayMasterRelation, elementComplement, spousePalaceRelations, stemRelations, branchRelations, mutualTenGods, timing: flow, strengths, frictions,
      practicalAdvice: [{ code: 'CHECK_ACTUAL_RELATIONSHIP', label: '이 상징과 실제 두 사람의 경험이 맞는지 먼저 확인해 보세요.' }, ...(frictions.length ? [{ code: 'DISCUSS_DIFFERENT_EXPECTATIONS', label: '연락 빈도나 함께할 시간처럼 기대가 다른 부분을 구체적으로 이야기해 보세요.' }] : []), ...(flags.length ? [{ code: 'RESPECT_UNCERTAINTY', label: '확인되지 않은 출생시간이나 경계의 가능값을 한 가지 결론으로 단정하지 마세요.' }] : [])] },
    possible_values: { pairs }, uncertaintyFlags: flags };
}

export function buildCompatibilityInterpretationData(result: SajuCompatibilityResult) {
  const s = result.summary;
  const currentLuck = (person: DerivedPerson) => person.timing ? { conventionVersion: person.timing.conventionVersion,
    status: person.timing.activeDaewoonStatus, precision: person.timing.luck?.precision, currentPeriod: person.timing.luck?.currentPeriod ?? null,
    currentPillar: person.timing.luck?.currentPillar ?? null } : null;
  // Full eight-pillar cross-products stay in the saved snapshot. Show representative exact
  // evidence with explicit counts; avoid exceeding the Persona context budget on dense charts.
  return { kind: result.kind, engineVersion: result.engineVersion, ruleVersion: result.ruleVersion, conventionVersion: result.conventionVersion,
    dayMasterRelation: s.dayMasterRelation, elementComplement: ELEMENTS.map(element => {
      const rows = s.elementComplement.filter(row => row.element === element);
      return { element, possiblePersonAProportions: unique(rows.map(row => row.personAProportion)), possiblePersonBProportions: unique(rows.map(row => row.personBProportion)), possiblePersonABalanceRoles: unique(rows.map(row => row.personABalanceRole)), possiblePersonBBalanceRoles: unique(rows.map(row => row.personBBalanceRole)) };
    }), spousePalaceRelations: s.spousePalaceRelations.slice(0, 8), spousePalaceRelationCount: s.spousePalaceRelations.length,
    stemRelations: s.stemRelations.slice(0, 12), stemRelationCount: s.stemRelations.length, branchRelations: s.branchRelations.slice(0, 16), branchRelationCount: s.branchRelations.length,
    mutualTenGods: s.mutualTenGods.slice(0, 16), mutualTenGodCount: s.mutualTenGods.length, strengths: s.strengths.slice(0, 8), frictions: s.frictions.slice(0, 8), practicalAdvice: s.practicalAdvice,
    timing: { personACurrentLuck: currentLuck(result.personA), personBCurrentLuck: currentLuck(result.personB), simultaneousActivations: s.timing.simultaneousActivations.map(({ source, type, pillar, personA, personB }) => ({ source, type, pillar, personAEvidenceCount: personA.length, personBEvidenceCount: personB.length })), limitations: s.timing.limitations },
    uncertaintyFlags: result.uncertaintyFlags, candidatePairCount: result.possible_values.pairs.length };
}
