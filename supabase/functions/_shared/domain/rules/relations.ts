import { BRANCH_RELATIONS, gen, control, HIDDEN_MASS, knownPositions, POSITIONS, SEASON, STEM_COMBINATIONS, stemElement, validateChart } from './constants.ts';
import type { NatalChart, PillarPosition, RuleRelation } from './types.ts';

function choose<T>(items: readonly T[], size: number): T[][] {
  if (!size) return [[]]; return items.flatMap((item, index) => choose(items.slice(index + 1), size - 1).map(tail => [item, ...tail]));
}
const sameSymbols = (a: readonly string[], b: string) => [...a].sort().join('') === [...b].sort().join('');
export function calculateRelations(chart: NatalChart): RuleRelation[] {
  validateChart(chart); const positions = knownPositions(chart); const result: RuleRelation[] = [];
  for (const [left, right] of choose(positions, 2) as [PillarPosition, PillarPosition][]) {
    const a = chart[left]!.heavenlyStem, b = chart[right]!.heavenlyStem;
    const rule = STEM_COMBINATIONS.find(([x, y]) => (a === x && b === y) || (a === y && b === x));
    if (!rule) continue;
    const target = rule[2];
    const predicates: Record<string, boolean> = {
      ADJACENCY: Math.abs(POSITIONS.indexOf(left) - POSITIONS.indexOf(right)) === 1,
      NO_COMPETITOR: !positions.some(p => p !== left && p !== right && [a, b].includes(chart[p]!.heavenlyStem)),
      SEASON: SEASON[chart.month.earthlyBranch] === target || gen(SEASON[chart.month.earthlyBranch]) === target,
      FIRST_HIDDEN_ROOT: positions.some(p => stemElement(HIDDEN_MASS[chart[p]!.earthlyBranch][0]![0]) === target),
      NO_EXTERNAL_CONTROLLER: !positions.some(p => p !== left && p !== right && control(stemElement(chart[p]!.heavenlyStem)) === target),
    };
    const status = chart.hour === null ? 'UNRESOLVED' : Object.values(predicates).every(Boolean) ? 'CONFIRMED' : 'NOT_ESTABLISHED';
    result.push({ type: 'STEM_COMBINATION', participants: [left, right], values: [a, b], transformedElement: status === 'CONFIRMED' ? target : null, transformationStatus: status, activatedBy: ['NATAL'], reasonCodes: [...Object.entries(predicates).map(([name, passed]) => `${passed ? 'PASS' : 'FAIL'}_${name}`), ...(chart.hour === null ? ['LIMITED_UNKNOWN_HOUR'] : [])] });
  }
  for (const [type, patterns] of Object.entries(BRANCH_RELATIONS) as [keyof typeof BRANCH_RELATIONS, readonly string[]][]) for (const pattern of patterns) {
    for (const participants of choose(positions, [...pattern].length)) {
      const values = participants.map(p => chart[p]!.earthlyBranch);
      if (sameSymbols(values, pattern)) result.push({ type, participants, values, transformedElement: null, activatedBy: ['NATAL'], reasonCodes: ['CANONICAL_BRANCH_RELATION'] });
    }
  }
  return result;
}
