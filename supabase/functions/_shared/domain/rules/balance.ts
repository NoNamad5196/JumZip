import { ELEMENTS, gen, parent, control, controller } from './constants.ts';
import { q, Rational, sum } from './rational.ts';
import { proportions, type DistributionInput } from './strength.ts';
import type { BalanceCandidate, BalanceResult, Element, HanjaBranch } from './types.ts';

export function calculateClimate(month: HanjaBranch, input: DistributionInput): { bonus: Record<Element, number>; reasons: Record<Element, string[]> } {
  const p = proportions(input), bonus = Object.fromEntries(ELEMENTS.map(e => [e, 0])) as Record<Element, number>, reasons = Object.fromEntries(ELEMENTS.map(e => [e, [] as string[]])) as Record<Element, string[]>;
  const add = (e: Element, amount: number, reason: string) => { bonus[e] += amount; reasons[e].push(reason); };
  if ('亥子丑'.includes(month) && p.WATER.compare(q(2, 5)) >= 0 && p.FIRE.compare(q(1, 10)) <= 0) add('FIRE', 40, 'COLD_FIRE');
  if ('巳午未'.includes(month) && p.FIRE.compare(q(2, 5)) >= 0 && p.WATER.compare(q(1, 10)) <= 0) add('WATER', 40, 'HOT_WATER');
  if (p.EARTH.add(p.METAL).compare(q(3, 5)) >= 0 && p.WATER.compare(q(1, 10)) <= 0) add('WATER', 20, 'DRY_WATER');
  if (p.WATER.compare(q(2, 5)) >= 0 && p.EARTH.compare(q(1, 10)) <= 0) add('EARTH', 20, 'WET_EARTH');
  return { bonus, reasons };
}
export function calculateBalance(day: Element, month: HanjaBranch, strengthScore: number, input: DistributionInput): BalanceResult {
  if (!Number.isInteger(strengthScore) || strengthScore < 0 || strengthScore > 100) throw new RangeError('STRENGTH_SCORE_INVALID');
  const direction = strengthScore >= 55 ? 'STRONG' : strengthScore <= 44 ? 'WEAK' : 'BALANCED';
  const p = proportions(input), climate = calculateClimate(month, input);
  const eligible = new Set<Element>(direction === 'STRONG' ? [gen(day), control(day), controller(day)] : direction === 'WEAK' ? [parent(day), day] : ELEMENTS);
  for (const e of ELEMENTS) if (climate.bonus[e] > 0) eligible.add(e);
  const items: { value: BalanceCandidate; score: Rational; deficit: Rational }[] = [];
  for (const e of eligible) {
    const deficit = q(1, 5).sub(p[e]).clamp(q(0), q(1));
    const relief = sum(ELEMENTS.filter(x => e === gen(x) || control(e) === x).map(x => p[x].sub(q(1, 5)).clamp(q(0), q(1))));
    const directionBonus = direction === 'STRONG' ? e === gen(day) ? 20 : e === controller(day) ? 10 : e === control(day) ? 5 : 0 : direction === 'WEAK' ? e === parent(day) ? 20 : e === day ? 10 : 0 : 0;
    const reasons = [...climate.reasons[e]];
    if (direction === 'STRONG' && directionBonus) reasons.push(e === gen(day) ? 'STRONG_DRAIN' : 'STRONG_CONTROL');
    if (direction === 'WEAK' && directionBonus) reasons.push('WEAK_SUPPORT');
    if (direction === 'BALANCED' && deficit.compare(q(0)) > 0) reasons.push('BALANCED_DEFICIT');
    if (relief.compare(q(0)) > 0) reasons.push('EXCESS_RELIEF');
    const score = q(300).mul(deficit).add(q(200).mul(relief)).add(q(directionBonus + climate.bonus[e]));
    items.push({ score, deficit, value: { element: e, proportion: p[e].number(), deficit: deficit.number(), relief: relief.number(), directionBonus, climateBonus: climate.bonus[e], score: score.number(), exactScore: score.toJSON(), reasonCodes: reasons } });
  }
  const compare = (a: typeof items[number], b: typeof items[number]) => b.score.compare(a.score) || b.value.climateBonus - a.value.climateBonus || b.deficit.compare(a.deficit) || ELEMENTS.indexOf(a.value.element) - ELEMENTS.indexOf(b.value.element);
  items.sort(compare);
  // Persist the tie stage wherever it actually influenced the ranked list, including secondary candidates.
  for (const item of items) {
    const ties = items.filter(other => other !== item && other.score.compare(item.score) === 0);
    if (ties.some(other => other.value.climateBonus !== item.value.climateBonus)) item.value.reasonCodes.push('TIE_CLIMATE');
    const climateTies = ties.filter(other => other.value.climateBonus === item.value.climateBonus);
    if (climateTies.some(other => other.deficit.compare(item.deficit) !== 0)) item.value.reasonCodes.push('TIE_DEFICIT');
    if (climateTies.some(other => other.deficit.compare(item.deficit) === 0)) item.value.reasonCodes.push('TIE_FIXED_ORDER');
  }
  const yongsin = items[0]!.value;
  const remaining = items.slice(1), aligned = remaining.filter(item => gen(item.value.element) === yongsin.element || gen(yongsin.element) === item.value.element);
  const heesin = (aligned.length ? aligned : remaining).sort(compare)[0]!.value;
  const excessiveElements = ELEMENTS.filter(e => p[e].compare(q(1, 5)) > 0);
  return { yongsin: { element: yongsin.element, reasonCodes: [...yongsin.reasonCodes] }, heesin: { element: heesin.element, reasonCodes: [...heesin.reasonCodes, aligned.length ? 'HEESIN_GENERATION_ALIGNMENT' : 'HEESIN_REMAINING_CANDIDATE'] }, candidates: items.map(item => item.value), rationale: { direction, opposition: [...new Set([controller(yongsin.element), ...excessiveElements])], excessiveElements, tieBreakOrder: ['SCORE_DESC', 'CLIMATE_DESC', 'DEFICIT_DESC', 'WOOD_FIRE_EARTH_METAL_WATER'] } };
}
