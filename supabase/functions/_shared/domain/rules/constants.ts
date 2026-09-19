import type { Element, HanjaBranch, HanjaStem, NatalChart, PillarPosition, TenGod } from './types.ts';
export const ELEMENTS = ['WOOD', 'FIRE', 'EARTH', 'METAL', 'WATER'] as const;
export const STEMS = [...'甲乙丙丁戊己庚辛壬癸'] as HanjaStem[];
export const BRANCHES = [...'子丑寅卯辰巳午未申酉戌亥'] as HanjaBranch[];
export const POSITIONS = ['year', 'month', 'day', 'hour'] as const;
export function freezeRule<T>(value: T): T { if (value && typeof value === 'object') { for (const item of Object.values(value)) freezeRule(item); Object.freeze(value); } return value; }
freezeRule(STEMS); freezeRule(BRANCHES);
export const HIDDEN_MASS = freezeRule<Record<HanjaBranch, readonly (readonly [HanjaStem, number])[]>>({
  子: [['癸', 10]], 丑: [['己', 6], ['癸', 3], ['辛', 1]], 寅: [['甲', 6], ['丙', 3], ['戊', 1]], 卯: [['乙', 10]],
  辰: [['戊', 6], ['乙', 3], ['癸', 1]], 巳: [['丙', 6], ['戊', 3], ['庚', 1]], 午: [['丁', 7], ['己', 3]],
  未: [['己', 6], ['丁', 3], ['乙', 1]], 申: [['庚', 6], ['壬', 3], ['戊', 1]], 酉: [['辛', 10]], 戌: [['戊', 6], ['辛', 3], ['丁', 1]], 亥: [['壬', 7], ['甲', 3]],
});
export const SEASON: Readonly<Record<HanjaBranch, Element>> = freezeRule({ 寅: 'WOOD', 卯: 'WOOD', 巳: 'FIRE', 午: 'FIRE', 申: 'METAL', 酉: 'METAL', 亥: 'WATER', 子: 'WATER', 辰: 'EARTH', 戌: 'EARTH', 丑: 'EARTH', 未: 'EARTH' });
export const STEM_COMBINATIONS = freezeRule<readonly (readonly [HanjaStem, HanjaStem, Element])[]>([['甲', '己', 'EARTH'], ['乙', '庚', 'METAL'], ['丙', '辛', 'WATER'], ['丁', '壬', 'WOOD'], ['戊', '癸', 'FIRE']]);
export const BRANCH_RELATIONS = freezeRule({
  SIX_COMBINATION: ['子丑', '寅亥', '卯戌', '辰酉', '巳申', '午未'], CLASH: ['子午', '丑未', '寅申', '卯酉', '辰戌', '巳亥'],
  HARM: ['子未', '丑午', '寅巳', '卯辰', '申亥', '酉戌'], BREAK: ['子酉', '丑辰', '寅亥', '卯午', '巳申', '未戌'],
  TRINE: ['申子辰', '亥卯未', '寅午戌', '巳酉丑'], DIRECTIONAL: ['寅卯辰', '巳午未', '申酉戌', '亥子丑'],
  PUNISHMENT: ['寅巳申', '丑戌未', '子卯'], SELF_PUNISHMENT: ['辰辰', '午午', '酉酉', '亥亥'],
});
export const TWELVE_STAGE_NAMES = freezeRule(['장생', '목욕', '관대', '임관', '제왕', '쇠', '병', '사', '묘', '절', '태', '양'] as const);
export const TWELVE_STAGE_BRANCHES = freezeRule<Record<HanjaStem, string>>({ 甲: '亥子丑寅卯辰巳午未申酉戌', 乙: '午巳辰卯寅丑子亥戌酉申未', 丙: '寅卯辰巳午未申酉戌亥子丑', 戊: '寅卯辰巳午未申酉戌亥子丑', 丁: '酉申未午巳辰卯寅丑子亥戌', 己: '酉申未午巳辰卯寅丑子亥戌', 庚: '巳午未申酉戌亥子丑寅卯辰', 辛: '子亥戌酉申未午巳辰卯寅丑', 壬: '申酉戌亥子丑寅卯辰巳午未', 癸: '卯寅丑子亥戌酉申未午巳辰' });
export const stemElement = (stem: HanjaStem): Element => ELEMENTS[Math.floor(STEMS.indexOf(stem) / 2)]!;
export const gen = (element: Element): Element => ELEMENTS[(ELEMENTS.indexOf(element) + 1) % 5]!;
export const parent = (element: Element): Element => ELEMENTS[(ELEMENTS.indexOf(element) + 4) % 5]!;
export const control = (element: Element): Element => ELEMENTS[(ELEMENTS.indexOf(element) + 2) % 5]!;
export const controller = (element: Element): Element => ELEMENTS[(ELEMENTS.indexOf(element) + 3) % 5]!;
export function getTenGod(dayStem: HanjaStem, target: HanjaStem): TenGod {
  const d = stemElement(dayStem), e = stemElement(target), samePolarity = STEMS.indexOf(dayStem) % 2 === STEMS.indexOf(target) % 2;
  const pair: readonly [TenGod, TenGod] = e === d ? ['비견', '겁재'] : e === gen(d) ? ['식신', '상관'] : e === control(d) ? ['편재', '정재'] : e === controller(d) ? ['편관', '정관'] : ['편인', '정인'];
  return pair[samePolarity ? 0 : 1];
}
export const getTwelveStage = (dayStem: HanjaStem, branch: HanjaBranch): string => TWELVE_STAGE_NAMES[TWELVE_STAGE_BRANCHES[dayStem].indexOf(branch)]!;
export function knownPositions(chart: NatalChart): PillarPosition[] { return POSITIONS.filter(position => chart[position] !== null); }
export function validateChart(chart: NatalChart): void {
  if (!chart || POSITIONS.some(position => position === 'hour' && chart.hour === null ? false : !chart[position] || !STEMS.includes(chart[position]!.heavenlyStem) || !BRANCHES.includes(chart[position]!.earthlyBranch))) throw new RangeError('NATAL_CHART_INVALID');
  // Synthetic component fixtures may use combinations outside the sexagenary cycle; the
  // calendar adapter supplies valid real pillars. The rule layer validates symbols only.
}
