import { readFileSync } from 'node:fs';
import type { IntentInput } from '../../supabase/functions/_shared/llm/intent.ts';
import { V5_INTENT_CASES } from './v5-focused-corpus.mts';

/** New independent evaluation version; imports the original eight inputs and tool/mode expectations unchanged. */
export const INTENT_V3_CORPUS_VERSION = 'JumZipIntentV3Eval-v1';
export interface IntentEvaluationCase {
  id: string; origin: 'ORIGINAL_V5' | 'MATRIX_EXTENSION'; input: IntentInput;
  mockClassification: Record<string, unknown>;
  expectedRecommendation: { recommendation: string; modes: readonly string[] };
  expectedSlots: {
    requestPurposes: readonly string[]; intents: readonly string[]; explicitTool: string | null;
    aliasState: 'ALIAS' | 'UNRESOLVED'; choiceCount: 0 | 2; highStakes: false;
    exactTools?: readonly string[]; missingSlots?: readonly string[];
    missingByIntent?: Record<string, readonly string[]>;
  };
  reviewChecks: readonly string[];
}
const unresolved = { state: 'UNRESOLVED', source: null, quote: null };
const plain = (currentMessage: string, hasOwnBirthData = false, hasPartnerBirthData = false): IntentInput => ({ currentMessage, recentMessages: [], hasOwnBirthData, hasPartnerBirthData });
const classify = (intent: string, quote: string, patch: Record<string, unknown> = {}) => ({
  requestPurpose: ['small_talk', 'general_concern'].includes(intent) ? 'GENERAL_CHAT' : 'FORTUNE_EXPLORATION', intentEvidenceQuote: quote,
  intent, explicitTool: null, explicitToolQuote: null, targetAliasEvidence: unresolved, choicesEvidence: [],
  recentSituationPresent: false, periodPresent: false, highStakes: false, ...patch,
});
const alias = { state: 'ALIAS', source: -1, quote: '달새' };
const missingMatrixCases = [
  { id: 'v3-yearly-missing-birth', input: plain('올해 전체 흐름이 궁금해.'), output: classify('yearly_flow', '올해 전체 흐름이 궁금해.'), tools: ['SAJU:SEWOON'], missing: ['ownBirthData'] },
  { id: 'v3-monthly-existing-birth', input: plain('다음 달 흐름을 살펴보고 싶어.', true), output: classify('monthly_flow', '다음 달 흐름을 살펴보고 싶어.'), tools: ['SAJU:MONTHLY'], missing: [] },
  { id: 'v3-long-compatibility-missing-partner', input: plain('달새와 삼 년째 만나고 있어. 장기적인 궁합이 궁금해.', true), output: classify('long_term_compatibility', '장기적인 궁합이 궁금해.', { targetAliasEvidence: alias, recentSituationPresent: true }), tools: ['COMPATIBILITY:SAJU', 'COMPATIBILITY:TAROT'], missing: ['partnerBirthData'] },
  { id: 'v3-long-compatibility-complete-birth', input: plain('우리의 장기적인 궁합이 궁금해.', true, true), output: classify('long_term_compatibility', '우리의 장기적인 궁합이 궁금해.'), tools: ['COMPATIBILITY:SAJU'], missing: [] },
  { id: 'v3-decision-missing-context', input: plain('진로 선택을 타로로 보고 싶어.'), output: classify('career_decision', '진로 선택을 타로로 보고 싶어.', { explicitTool: 'TAROT', explicitToolQuote: '타로로 보고 싶어' }), tools: ['TAROT:DECISION_3'], missing: ['choices', 'recentSituation'] },
  { id: 'v3-decision-two-real-choices', input: plain('계약 갱신을 앞두고 있어. 직장을 유지할지 대학원에 진학할지 타로로 보고 싶어.'), output: classify('career_decision', '직장을 유지할지 대학원에 진학할지', { explicitTool: 'TAROT', explicitToolQuote: '타로로 보고 싶어', recentSituationPresent: true, choicesEvidence: [{ source: -1, quote: '직장을 유지할지' }, { source: -1, quote: '대학원에 진학할지' }] }), tools: ['TAROT:DECISION_3'], missing: [] },
  { id: 'v3-relationship-resolved-alias-period', input: plain('달새와 다음 달 관계가 어떻게 흘러갈지 궁금해.'), output: classify('relationship_flow', '다음 달 관계가 어떻게 흘러갈지', { targetAliasEvidence: alias, periodPresent: true }), tools: ['TAROT:RELATIONSHIP_3'], missing: [] },
  { id: 'v3-explicit-saju-daily', input: plain('오늘 운세는 사주로 보고 싶어.'), output: classify('daily_fortune', '오늘 운세', { explicitTool: 'SAJU', explicitToolQuote: '사주로 보고 싶어' }), tools: ['SAJU:DAILY'], missing: ['ownBirthData'] },
  { id: 'v3-general-concern', input: plain('요즘 마음이 복잡해서 그냥 이야기하고 싶어.'), output: classify('general_concern', '그냥 이야기하고 싶어.'), tools: [], missing: [] },
  { id: 'v3-small-talk', input: plain('안녕, 오늘은 가볍게 수다 떨고 싶어.'), output: classify('small_talk', '가볍게 수다 떨고 싶어.'), tools: [], missing: [] },
];


const originalExpectations = [
  { requestPurposes: ['RECALL'], intents: ['small_talk', 'general_concern'], explicitTool: null },
  { requestPurposes: ['RECALL'], intents: ['small_talk', 'general_concern'], explicitTool: null },
  { requestPurposes: ['MEMORY_CONTROL'], intents: ['small_talk', 'general_concern'], explicitTool: null },
  { requestPurposes: ['PREFERENCE_SHARING'], intents: ['small_talk', 'general_concern'], explicitTool: null },
  { requestPurposes: ['FORTUNE_EXPLORATION'], intents: ['natal_character'], explicitTool: null, missingSlots: ['ownBirthData'] },
  { requestPurposes: ['FORTUNE_EXPLORATION'], intents: ['general_concern', 'relationship_flow', 'career_decision'], explicitTool: 'TAROT', missingByIntent: { general_concern: [], relationship_flow: ['targetPerson'], career_decision: ['choices'] } },
  { requestPurposes: ['FORTUNE_EXPLORATION'], intents: ['target_feelings'], explicitTool: 'TAROT', missingSlots: ['targetPerson', 'recentSituation'] },
  { requestPurposes: ['FORTUNE_EXPLORATION'], intents: ['daily_fortune'], explicitTool: 'TAROT', missingSlots: [] },
];
const history = JSON.parse(readFileSync(new URL('./benchmark-runs/v5-focused/results.json', import.meta.url), 'utf8')).entries as { id: string; structuredOutput?: Record<string, unknown> }[];
export const INTENT_V3_CASES: readonly IntentEvaluationCase[] = [
  ...V5_INTENT_CASES.map((item, index): IntentEvaluationCase => {
    const { targetPersonPresent: _target, choicesPresent: _choices, ...retained } = history.find(entry => entry.id === item.id)!.structuredOutput!;
    return { id: item.id, origin: 'ORIGINAL_V5', input: item.input, expectedRecommendation: item.expected,
      mockClassification: { ...retained, targetAliasEvidence: unresolved, choicesEvidence: [] },
      expectedSlots: { ...originalExpectations[index]!, aliasState: 'UNRESOLVED', choiceCount: 0, highStakes: false },
      reviewChecks: [...item.reviewChecks, '선택지 둘을 암묵적으로 만들지 않음; 관련 원문 대안만 근거로 인정', '대상 언급을 별칭 확보로 바꾸지 않음; alias는 사용자 source에서 확인', '정상 NONE과 검증 실패 null을 별도 집계'] };
  }),
  ...missingMatrixCases.map((item): IntentEvaluationCase => ({
    id: item.id, origin: 'MATRIX_EXTENSION', input: item.input, mockClassification: item.output,
    expectedRecommendation: { recommendation: item.tools[0]?.split(':')[0] ?? 'NONE', modes: item.tools[0] ? [item.tools[0].split(':')[1]!] : [] },
    expectedSlots: { requestPurposes: [item.output.requestPurpose], intents: [item.output.intent], explicitTool: item.output.explicitTool,
      aliasState: item.id === 'v3-long-compatibility-missing-partner' || item.id === 'v3-relationship-resolved-alias-period' ? 'ALIAS' : 'UNRESOLVED',
      choiceCount: item.id === 'v3-decision-two-real-choices' ? 2 : 0, highStakes: false, exactTools: item.tools, missingSlots: item.missing },
    reviewChecks: ['Engineering §11.1 의도·도구·필요 슬롯 매핑', '선택지/별칭 인용의 출처뿐 아니라 실제 의미와 문맥 관련성 검토', '출생자료 값은 입력하지 않으며 availability boolean만 사용'] })),
];
if (INTENT_V3_CASES.length !== 18 || new Set(INTENT_V3_CASES.map(item => item.id)).size !== 18) throw Error('INTENT_V3_CORPUS_INVALID');
