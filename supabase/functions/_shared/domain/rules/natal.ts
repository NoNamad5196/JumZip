import { getTenGod, getTwelveStage, HIDDEN_MASS, POSITIONS, stemElement, validateChart } from './constants.ts';
import { calculateElements, calculateStrength } from './strength.ts';
import { calculateRelations } from './relations.ts';
import { calculateBalance } from './balance.ts';
import { calculateShinsal, SHINSAL_MAPPINGS } from './shinsal.ts';
import type { GyeokgukResult, HiddenStem, NatalChart, NatalRuleResult, PillarPosition, TenGod } from './types.ts';

export function calculateGyeokguk(chart: NatalChart): GyeokgukResult {
  validateChart(chart);
  const day = chart.day.heavenlyStem;
  let candidates = HIDDEN_MASS[chart.month.earthlyBranch].map(([stem]) => ({ stem, tenGod: getTenGod(day, stem), exposedAt: (['month', 'year', 'hour'] as PillarPosition[]).filter(p => chart[p]?.heavenlyStem === stem) })).filter(candidate => candidate.exposedAt.length > 0);
  if (!candidates.length) { const stem = HIDDEN_MASS[chart.month.earthlyBranch][0]![0]; candidates = [{ stem, tenGod: getTenGod(day, stem), exposedAt: [] }]; }
  const first = candidates[0]!.tenGod, standard = (god: TenGod) => god !== '비견' && god !== '겁재';
  const primary = standard(first) ? first : null;
  return { primary, secondary: [...new Set(candidates.slice(1).map(c => c.tenGod).filter(standard))].filter(god => god !== primary), monthCore: first,
    geonrok: getTwelveStage(day, chart.month.earthlyBranch) === '임관', yangin: (SHINSAL_MAPPINGS.YANGIN[day] as readonly string[]).includes(chart.month.earthlyBranch),
    candidates, specialStructureCandidate: calculateRelations(chart).some(r => r.transformationStatus === 'CONFIRMED'), reasons: [candidates.some(c => c.exposedAt.length) ? 'EXPOSED_MONTH_HIDDEN_STEM_FIRST' : 'MONTH_FIRST_HIDDEN_FALLBACK', 'HIDDEN_ORDER_THEN_MONTH_YEAR_HOUR', ...(primary === null ? ['BI_GYEOP_NOT_FORCED_INTO_STANDARD_EIGHT'] : [])] };
}
export function calculateNatalRules(chart: NatalChart): NatalRuleResult {
  validateChart(chart); const day = chart.day.heavenlyStem;
  const hiddenStems = Object.fromEntries(POSITIONS.map(p => [p, chart[p] ? HIDDEN_MASS[chart[p]!.earthlyBranch].map(([stem, units]): HiddenStem => ({ stem, element: stemElement(stem), weight: units / 10, tenGod: getTenGod(day, stem) })) : null])) as NatalRuleResult['hiddenStems'];
  const tenGods = Object.fromEntries(POSITIONS.map(p => [p, chart[p] ? { stem: p === 'day' ? '일간' : getTenGod(day, chart[p]!.heavenlyStem), branch: getTenGod(day, HIDDEN_MASS[chart[p]!.earthlyBranch][0]![0]) } : null])) as NatalRuleResult['tenGods'];
  const elements = calculateElements(chart), relations = calculateRelations(chart), strength = calculateStrength(chart, elements, relations);
  const balance = calculateBalance(stemElement(day), chart.month.earthlyBranch, strength.score, elements);
  return { pillars: structuredClone(chart), hiddenStems, tenGods, elements, relations, strength, gyeokguk: calculateGyeokguk(chart), yongsin: balance.yongsin, heesin: balance.heesin, balance,
    twelveStages: Object.fromEntries(POSITIONS.map(p => [p, chart[p] ? getTwelveStage(day, chart[p]!.earthlyBranch) : null])) as NatalRuleResult['twelveStages'],
    shinsal: calculateShinsal(chart), uncertaintyFlags: chart.hour === null ? ['LIMITED_UNKNOWN_HOUR'] : [] };
}
