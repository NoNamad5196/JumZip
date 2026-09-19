import { freezeRule, knownPositions, POSITIONS, validateChart } from './constants.ts';
import type { HanjaBranch, HanjaStem, NatalChart, PillarPosition, ShinsalEvidence, ShinsalId, ShinsalMatch } from './types.ts';

/** A–G adopted tables. Source variants were resolved explicitly in docs/saju-rule-freeze.md. */
export const SHINSAL_MAPPINGS = freezeRule({
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
});
const modernSource = (name: string) => `https://www.dk-saju.com/sinsal/${name}`;
type RuleMetadata = Omit<ShinsalMatch, 'evidence' | 'limitations'> & { mapping: unknown };
const meta = (id: ShinsalId, name: string, referenceType: string, matchType: ShinsalMatch['matchType'], source: string, matchAgainst: PillarPosition[] = [...POSITIONS]): RuleMetadata => ({ id, name, referenceType, matchType, matchAgainst, allowMultiple: true, adoptedConvention: `JumZipSajuRules-v1:${id}`, source, mapping: SHINSAL_MAPPINGS[id] });
export const SHINSAL_RULES: readonly RuleMetadata[] = freezeRule([
  meta('CHEONEUL', '천을귀인', 'dayStem', 'branch', modernSource('천을귀인')),
  meta('MUNCHANG', '문창귀인', 'dayStem', 'branch', modernSource('문창귀인')),
  meta('DOHWA', '도화', 'yearBranch|dayBranch', 'branch', modernSource('도화살')),
  meta('YEOKMA', '역마', 'yearBranch|dayBranch', 'branch', modernSource('역마살')),
  meta('HWAGAE', '화개', 'yearBranch|dayBranch', 'branch', modernSource('화개살')),
  meta('YANGIN', '양인', 'dayStem', 'branch', modernSource('양인살')),
  meta('GOEGANG', '괴강', 'dayPillar', 'exactPillar', 'https://zh.wikisource.org/zh-hant/三命通會/卷六', ['day']),
  meta('HONGYEOM', '홍염', 'dayStem', 'branch', modernSource('홍염살')),
  meta('BAEKHO', '백호', 'eachPillar', 'exactPillar', modernSource('백호살')),
  meta('GWIMUN', '귀문관살', 'natalBranchPair', 'unorderedBranchPair', modernSource('귀문관살')),
]);
export function calculateShinsal(chart: NatalChart): ShinsalMatch[] {
  validateChart(chart); const positions = knownPositions(chart), result: ShinsalMatch[] = [];
  for (const rule of SHINSAL_RULES) {
    const evidence: ShinsalEvidence[] = [];
    if (rule.referenceType === 'dayStem') {
      const mapping = rule.mapping as Record<HanjaStem, readonly string[]>;
      for (const p of positions) if (mapping[chart.day.heavenlyStem].includes(chart[p]!.earthlyBranch)) evidence.push({ referenceType: 'dayStem', referenceValue: chart.day.heavenlyStem, referencePosition: 'day', matchedPositions: [p], matchedValues: [chart[p]!.earthlyBranch] });
    } else if (rule.referenceType === 'yearBranch|dayBranch') {
      const mapping = rule.mapping as Record<HanjaBranch, string>;
      for (const reference of ['year', 'day'] as const) for (const p of positions) if (mapping[chart[reference].earthlyBranch] === chart[p]!.earthlyBranch) evidence.push({ referenceType: `${reference}Branch`, referenceValue: chart[reference].earthlyBranch, referencePosition: reference, matchedPositions: [p], matchedValues: [chart[p]!.earthlyBranch] });
    } else if (rule.matchType === 'exactPillar') {
      for (const p of rule.matchAgainst.filter(p => chart[p] !== null)) {
        const value = `${chart[p]!.heavenlyStem}${chart[p]!.earthlyBranch}`;
        if ((rule.mapping as readonly string[]).includes(value)) evidence.push({ referenceType: rule.referenceType, referenceValue: value, referencePosition: p, matchedPositions: [p], matchedValues: [value] });
      }
    } else {
      for (let i = 0; i < positions.length; i++) for (let j = i + 1; j < positions.length; j++) {
        const a = positions[i]!, b = positions[j]!, values = [chart[a]!.earthlyBranch, chart[b]!.earthlyBranch];
        const pair = (rule.mapping as readonly (readonly string[])[]).find(pair => pair.includes(values[0]!) && pair.includes(values[1]!) && values[0] !== values[1]);
        if (pair) evidence.push({ referenceType: 'natalBranchPair', referenceValue: pair.join(''), referencePosition: null, matchedPositions: [a, b], matchedValues: values });
      }
    }
    if (evidence.length) {
      const { mapping: _mapping, ...metadata } = rule;
      result.push({ ...metadata, matchAgainst: [...rule.matchAgainst], evidence, limitations: chart.hour === null ? ['LIMITED_UNKNOWN_HOUR'] : [] });
    }
  }
  return result;
}
