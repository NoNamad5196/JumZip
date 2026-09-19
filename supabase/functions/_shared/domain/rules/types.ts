/** M7.5 A–G adopted 2026-09-20 ~02:01 KST. Types only; fixtures precede judgments. */
export type Element = 'WOOD' | 'FIRE' | 'EARTH' | 'METAL' | 'WATER';
export type HanjaStem = '甲' | '乙' | '丙' | '丁' | '戊' | '己' | '庚' | '辛' | '壬' | '癸';
export type HanjaBranch = '子' | '丑' | '寅' | '卯' | '辰' | '巳' | '午' | '未' | '申' | '酉' | '戌' | '亥';
export type PillarPosition = 'year' | 'month' | 'day' | 'hour';
export interface RulePillar { heavenlyStem: HanjaStem; earthlyBranch: HanjaBranch }
export interface NatalChart { year: RulePillar; month: RulePillar; day: RulePillar; hour: RulePillar | null }
export interface ExactRational { numerator: string; denominator: string }
export type TenGod = '비견' | '겁재' | '식신' | '상관' | '편재' | '정재' | '편관' | '정관' | '편인' | '정인';
export interface ElementDistribution { mass: Record<Element, number>; proportion: Record<Element, number>; exactMass: Record<Element, ExactRational>; totalMass: number }
export interface HiddenStem { stem: HanjaStem; element: Element; weight: number; tenGod: TenGod }
export type RelationType = 'STEM_COMBINATION' | 'SIX_COMBINATION' | 'CLASH' | 'HARM' | 'BREAK' | 'TRINE' | 'DIRECTIONAL' | 'PUNISHMENT' | 'SELF_PUNISHMENT';
export interface RuleRelation {
  type: RelationType; participants: PillarPosition[]; values: string[];
  transformedElement: Element | null; transformationStatus?: 'CONFIRMED' | 'NOT_ESTABLISHED' | 'UNRESOLVED';
  activatedBy: string[]; reasonCodes: string[];
}
export type StrengthGrade = '강' | '약강' | '중화' | '약약' | '약';
export interface StrengthComponent { raw: ExactRational; weighted: ExactRational; points: number; reasonCodes: string[]; evidence: unknown }
export interface StrengthResult {
  rawScore: number; exactScore: ExactRational; score: number; grade: StrengthGrade;
  components: { season: StrengthComponent; roots: StrengthComponent; visibleSupport: StrengthComponent; relations: StrengthComponent; concentration: StrengthComponent };
  reasons: string[]; limited: boolean;
}
export interface BalanceCandidate {
  element: Element; proportion: number; deficit: number; relief: number; directionBonus: number; climateBonus: number;
  score: number; exactScore: ExactRational; reasonCodes: string[];
}
export interface BalanceChoice { element: Element; reasonCodes: string[] }
export interface BalanceResult {
  yongsin: BalanceChoice; heesin: BalanceChoice; candidates: BalanceCandidate[];
  rationale: { direction: 'STRONG' | 'WEAK' | 'BALANCED'; opposition: Element[]; excessiveElements: Element[]; tieBreakOrder: readonly string[] };
}
export interface GyeokgukResult {
  primary: TenGod | null; secondary: TenGod[]; monthCore: TenGod; geonrok: boolean; yangin: boolean;
  candidates: { stem: HanjaStem; tenGod: TenGod; exposedAt: PillarPosition[] }[];
  specialStructureCandidate: boolean; reasons: string[];
}
export type ShinsalId = 'CHEONEUL' | 'MUNCHANG' | 'DOHWA' | 'YEOKMA' | 'HWAGAE' | 'YANGIN' | 'GOEGANG' | 'HONGYEOM' | 'BAEKHO' | 'GWIMUN';
export interface ShinsalEvidence { referenceType: string; referenceValue: string; referencePosition: PillarPosition | null; matchedPositions: PillarPosition[]; matchedValues: string[] }
export interface ShinsalMatch {
  id: ShinsalId; name: string; referenceType: string; matchType: 'branch' | 'exactPillar' | 'unorderedBranchPair';
  matchAgainst: PillarPosition[]; allowMultiple: true; adoptedConvention: string; source: string;
  evidence: ShinsalEvidence[]; limitations: string[];
}
export interface NatalRuleResult {
  pillars: NatalChart; hiddenStems: Record<PillarPosition, HiddenStem[] | null>;
  tenGods: Record<PillarPosition, { stem: TenGod | '일간'; branch: TenGod } | null>;
  elements: ElementDistribution; relations: RuleRelation[]; strength: StrengthResult; gyeokguk: GyeokgukResult;
  yongsin: BalanceChoice; heesin: BalanceChoice; balance: BalanceResult;
  twelveStages: Record<PillarPosition, string | null>; shinsal: ShinsalMatch[]; uncertaintyFlags: string[];
}
