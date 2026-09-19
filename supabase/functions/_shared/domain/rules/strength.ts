import { ELEMENTS, gen, parent, control, HIDDEN_MASS, knownPositions, SEASON, stemElement, validateChart } from './constants.ts';
import { calculateRelations } from './relations.ts';
import { fromDecimal, fromExact, q, Rational, sum } from './rational.ts';
import type { Element, ElementDistribution, HanjaBranch, HanjaStem, NatalChart, PillarPosition, RuleRelation, StrengthComponent, StrengthGrade, StrengthResult } from './types.ts';

export const support = (element: Element, day: Element) => element === day ? q(1) : element === parent(day) ? q(3, 4) : q(0);
const component = (raw: Rational, weight: number, reasonCodes: string[], evidence: unknown): StrengthComponent => {
  const weighted = raw.mul(q(weight)); return { raw: raw.toJSON(), weighted: weighted.toJSON(), points: weighted.number(), reasonCodes, evidence };
};
export type DistributionInput = ElementDistribution | Readonly<Record<Element, number>>;
export function proportions(input: DistributionInput): Record<Element, Rational> {
  const result = Object.fromEntries(ELEMENTS.map(e => [e, 'exactMass' in input ? fromExact(input.exactMass[e]).div(q(input.totalMass)) : fromDecimal(input[e])])) as Record<Element, Rational>;
  if (ELEMENTS.some(e => result[e].compare(q(0)) < 0) || sum(Object.values(result)).compare(q(1)) !== 0) throw new RangeError('ELEMENT_DISTRIBUTION_INVALID');
  return result;
}
export function calculateElements(chart: NatalChart): ElementDistribution {
  validateChart(chart); const units = Object.fromEntries(ELEMENTS.map(e => [e, 0])) as Record<Element, number>;
  const positions = knownPositions(chart);
  for (const p of positions) {
    const pillar = chart[p]!; units[stemElement(pillar.heavenlyStem)] += 10;
    for (const [stem, weight] of HIDDEN_MASS[pillar.earthlyBranch]) units[stemElement(stem)] += weight;
  }
  const totalMass = positions.length * 2;
  return { mass: Object.fromEntries(ELEMENTS.map(e => [e, units[e] / 10])) as Record<Element, number>, proportion: Object.fromEntries(ELEMENTS.map(e => [e, units[e] / (10 * totalMass)])) as Record<Element, number>, exactMass: Object.fromEntries(ELEMENTS.map(e => [e, q(units[e], 10).toJSON()])) as ElementDistribution['exactMass'], totalMass };
}
export function calculateSeasonComponent(day: Element, month: HanjaBranch): StrengthComponent {
  const season = SEASON[month]; const ratio = season === day ? q(1) : season === parent(day) ? q(4, 5) : season === gen(day) ? q(2, 5) : season === control(day) ? q(1, 5) : q(1, 10);
  return component(ratio, 40, ['SEASON_FIXED_RELATION'], { dayElement: day, monthBranch: month, seasonElement: season });
}
export function calculateRootsComponent(day: Element, branches: readonly HanjaBranch[]): StrengthComponent {
  if (!branches.length) throw new RangeError('ROOTS_REQUIRED');
  const roots = branches.map(branch => sum(HIDDEN_MASS[branch].map(([stem, units]) => q(units, 10).mul(support(stemElement(stem), day)))));
  return component(sum(roots).div(q(branches.length)), 25, ['KNOWN_BRANCH_AVERAGE'], { branches, roots: roots.map(root => root.toJSON()), denominator: branches.length });
}
export function calculateVisibleSupportComponent(day: Element, stems: readonly HanjaStem[]): StrengthComponent {
  if (!stems.length) throw new RangeError('EXTERNAL_STEMS_REQUIRED');
  return component(sum(stems.map(stem => support(stemElement(stem), day))).div(q(stems.length)), 20, ['DIRECT_VISIBLE_SUPPORT_ONLY', 'DAY_STEM_EXCLUDED'], { externalStems: stems, denominator: stems.length });
}
export function calculateRelationComponent(chart: NatalChart, relations = calculateRelations(chart)): StrengthComponent {
  const day = stemElement(chart.day.heavenlyStem), positions = knownPositions(chart);
  const factor = (position: PillarPosition): Rational => {
    let f = q(1);
    for (const relation of relations.filter(r => r.type !== 'STEM_COMBINATION' && r.participants.includes(position))) {
      f = f.add(['SIX_COMBINATION', 'TRINE', 'DIRECTIONAL'].includes(relation.type) ? q(1, 10) : relation.type === 'CLASH' ? q(-1, 4) : q(-1, 10));
    }
    return f.clamp(q(1, 2), q(5, 4));
  };
  const factors = Object.fromEntries(positions.map(p => [p, factor(p)])) as Record<PillarPosition, Rational>;
  const pool: { position: PillarPosition; original: Element; effective: Element; mass: Rational; factor: Rational; kind: string }[] = [];
  for (const p of positions) {
    for (const [stem, units] of HIDDEN_MASS[chart[p]!.earthlyBranch]) pool.push({ position: p, original: stemElement(stem), effective: stemElement(stem), mass: q(units, 10), factor: factors[p], kind: 'HIDDEN' });
    if (p !== 'day') {
      const joined = relations.filter(r => r.type === 'STEM_COMBINATION' && r.participants.includes(p));
      const transformed = joined.find(r => r.transformationStatus === 'CONFIRMED');
      const original = stemElement(chart[p]!.heavenlyStem);
      pool.push({ position: p, original, effective: transformed?.transformedElement ?? original, mass: q(1), factor: joined.length && !transformed ? q(3, 4) : q(1), kind: 'VISIBLE' });
    }
  }
  const before = sum(pool.map(item => item.mass.mul(support(item.original, day)))).div(sum(pool.map(item => item.mass)));
  const adjusted = pool.map(item => item.mass.mul(item.factor));
  const after = sum(pool.map((item, i) => adjusted[i]!.mul(support(item.effective, day)))).div(sum(adjusted));
  const points = q(5).add(q(10).mul(after.sub(before))).clamp(q(0), q(10));
  return component(points.div(q(10)), 10, ['NATAL_RELATION_EFFECT_ONLY', 'ORIGINAL_PILLARS_PRESERVED'], { B: before.toJSON(), A: after.toJSON(), branchFactors: Object.fromEntries(positions.map(p => [p, factors[p].number()])), visibleFactors: pool.filter(p => p.kind === 'VISIBLE').map(p => ({ position: p.position, factor: p.factor.number(), original: p.original, effective: p.effective })) });
}
export function calculateConcentrationComponent(day: Element, input: DistributionInput): StrengthComponent {
  const p = proportions(input);
  const H = sum(ELEMENTS.map(e => p[e].sub(q(1, 5)).mul(p[e].sub(q(1, 5))))).div(q(4, 5));
  const u = p[day].add(q(3, 4).mul(p[parent(day)]));
  const points = q(5, 2).add(q(5, 2).mul(H).mul(q(2).mul(u).sub(q(1)))).clamp(q(0), q(5));
  return component(points.div(q(5)), 5, ['ELEMENT_CONCENTRATION_SUPPORT'], { H: H.toJSON(), u: u.toJSON() });
}
export function roundStrength(raw: number | Rational): { score: number; grade: StrengthGrade } {
  const bounded = (raw instanceof Rational ? raw : fromDecimal(raw)).clamp(q(0), q(100));
  const score = Number((bounded.n * 2n + bounded.d) / (bounded.d * 2n));
  return { score, grade: score >= 65 ? '강' : score >= 55 ? '약강' : score >= 45 ? '중화' : score >= 35 ? '약약' : '약' };
}
export function calculateStrength(chart: NatalChart, elements = calculateElements(chart), relations: RuleRelation[] = calculateRelations(chart)): StrengthResult {
  validateChart(chart); const positions = knownPositions(chart), day = stemElement(chart.day.heavenlyStem);
  const components = { season: calculateSeasonComponent(day, chart.month.earthlyBranch), roots: calculateRootsComponent(day, positions.map(p => chart[p]!.earthlyBranch)), visibleSupport: calculateVisibleSupportComponent(day, positions.filter(p => p !== 'day').map(p => chart[p]!.heavenlyStem)), relations: calculateRelationComponent(chart, relations), concentration: calculateConcentrationComponent(day, elements) };
  const raw = sum(Object.values(components).map(c => fromExact(c.weighted))).clamp(q(0), q(100));
  return { rawScore: raw.number(), exactScore: raw.toJSON(), ...roundStrength(raw), components, reasons: [...new Set(Object.values(components).flatMap(c => c.reasonCodes))], limited: chart.hour === null };
}
