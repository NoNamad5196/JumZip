import type { IntentInput } from '../../supabase/functions/_shared/llm/intent.ts';
import { INTENT_V3_CASES, type IntentEvaluationCase } from './intent-v3-corpus.ts';

/** The original 18 inputs AND expectations are imported unchanged. New contrasts
 * are fixed before live execution and are never supplied as model answers. */
export const INTENT_V4_CORPUS_VERSION = 'JumZipIntentV4Eval-v1';
export interface IntentV4EvaluationCase extends Omit<IntentEvaluationCase, 'origin' | 'expectedSlots'> {
  origin: IntentEvaluationCase['origin'] | 'V4_CONTRAST';
  expectedSlots: Omit<IntentEvaluationCase['expectedSlots'], 'highStakes' | 'intents'> & {
    intents?: readonly string[]; highStakes: boolean;
    aliasSource?: number | null; aliasQuote?: string | null;
    choiceSources?: readonly number[]; choiceQuotes?: readonly string[];
    recentSituationPresent?: boolean; periodPresent?: boolean;
  };
}
const plain = (currentMessage: string, hasOwnBirthData = false): IntentInput => ({ currentMessage, recentMessages: [], hasOwnBirthData, hasPartnerBirthData: false });
const unresolved = { state: 'UNRESOLVED', source: null, quote: null };
const classify = (intent: string, quote: string, patch: Record<string, unknown> = {}) => ({
  requestPurpose: 'FORTUNE_EXPLORATION', intentEvidenceQuote: quote, intent,
  explicitTool: null, explicitToolQuote: null, targetAliasEvidence: unresolved,
  choicesEvidence: [], recentSituationPresent: false, periodPresent: false, highStakes: false, ...patch,
});
const slots = (intent: string, patch: Partial<IntentV4EvaluationCase['expectedSlots']> = {}): IntentV4EvaluationCase['expectedSlots'] => ({
  requestPurposes: ['FORTUNE_EXPLORATION'], intents: [intent], explicitTool: null,
  aliasState: 'UNRESOLVED', choiceCount: 0, highStakes: false, missingSlots: [], ...patch,
});
const relationship = '그 사람과 다음 달 관계 흐름이 궁금해.';
const recentAlias: IntentInput = { ...plain(relationship), recentMessages: [
  { role: 'user', content: '출생 도시는 기록하지 말아 줘.' },
  { role: 'assistant', content: '어떤 이야기를 나눌까?' },
  { role: 'user', content: '그 사람은 별칭으로 달새라고 부를게.' },
] };
const decisions = '계약 갱신을 앞두고 있어. 그 두 선택을 타로로 비교하고 싶어.';
const irrelevant = '계약 갱신을 앞두고 있어. 직장을 옮길지 타로로 보고 싶어.';
const month = '이번 달 전체적인 흐름을 살펴보고 싶어.';
const relationMonth = '달새와 이번 달 관계가 어떻게 흘러갈지 살펴보고 싶어.';
const medical = '혈압약 복용을 오늘부터 그만해도 괜찮을지 타로로 판단해 줘.';
const concern = '여러 고민이 겹쳐 마음이 무거워. 지금은 점술보다 이야기를 나누고 싶어.';

export const INTENT_V4_CONTRAST_CASES: readonly IntentV4EvaluationCase[] = [
  { id: 'v4-recent-user-alias-filtered-index', origin: 'V4_CONTRAST', input: recentAlias,
    mockClassification: classify('relationship_flow', relationship, { targetAliasEvidence: { state: 'ALIAS', source: 1, quote: '달새' }, periodPresent: true }),
    expectedRecommendation: { recommendation: 'TAROT', modes: ['RELATIONSHIP_3'] },
    expectedSlots: slots('relationship_flow', { aliasState: 'ALIAS', aliasSource: 1, periodPresent: true, recentSituationPresent: false, exactTools: ['TAROT:RELATIONSHIP_3'] }),
    reviewChecks: ['Birth-label sentence is absent from minimized recent array; user alias is index1 after filtering.', 'A real user-provided alias resolves the current pronoun; period does not replace the relationship topic.'] },
  { id: 'v4-assistant-only-alias-unresolved', origin: 'V4_CONTRAST', input: { ...plain(relationship), recentMessages: [{ role: 'assistant', content: '그 사람을 달새라고 부를게.' }] },
    mockClassification: classify('relationship_flow', relationship, { periodPresent: true }),
    expectedRecommendation: { recommendation: 'TAROT', modes: ['RELATIONSHIP_3'] },
    expectedSlots: slots('relationship_flow', { aliasSource: null, aliasQuote: null, periodPresent: true, recentSituationPresent: false, exactTools: ['TAROT:RELATIONSHIP_3'], missingSlots: ['targetPerson'] }),
    reviewChecks: ['Assistant-proposed alias never becomes an established user-owned alias.', 'Successful unresolved classification requests targetPerson; validation failure null is not a pass.'] },
  { id: 'v4-recent-user-choice-pair', origin: 'V4_CONTRAST', input: { ...plain(decisions), recentMessages: [{ role: 'user', content: '선택지는 현 직장에 남기와 대학원 진학이야.' }] },
    mockClassification: classify('career_decision', '그 두 선택을 타로로 비교하고 싶어.', { explicitTool: 'TAROT', explicitToolQuote: '타로로 비교하고 싶어', recentSituationPresent: true,
      choicesEvidence: [{ source: 0, quote: '현 직장에 남기' }, { source: 0, quote: '대학원 진학' }] }),
    expectedRecommendation: { recommendation: 'TAROT', modes: ['DECISION_3'] },
    expectedSlots: slots('career_decision', { explicitTool: 'TAROT', choiceCount: 2, choiceSources: [0, 0], recentSituationPresent: true, exactTools: ['TAROT:DECISION_3'] }),
    reviewChecks: ['Both evidence spans must denote the two previously supplied career alternatives, not arbitrary true substrings.', 'Current contract-renewal context supplies recentSituation. Quote wording can differ if semantically equivalent exact spans.'] },
  { id: 'v4-unrelated-recent-quotes-not-choices', origin: 'V4_CONTRAST', input: { ...plain(irrelevant), recentMessages: [{ role: 'assistant', content: '지난번엔 공원 산책과 점심 메뉴를 이야기했어.' }] },
    mockClassification: classify('career_decision', '직장을 옮길지 타로로 보고 싶어.', { explicitTool: 'TAROT', explicitToolQuote: '타로로 보고 싶어', recentSituationPresent: true }),
    expectedRecommendation: { recommendation: 'TAROT', modes: ['DECISION_3'] },
    expectedSlots: slots('career_decision', { explicitTool: 'TAROT', recentSituationPresent: true, exactTools: ['TAROT:DECISION_3'], missingSlots: ['choices'] }),
    reviewChecks: ['Park walk and lunch menu are real previous quotes but irrelevant to the current career decision.', 'Do not invent staying at the current job as a second alternative to the single stated move.'] },
  { id: 'v4-period-general-flow', origin: 'V4_CONTRAST', input: plain(month, true),
    mockClassification: classify('monthly_flow', month, { periodPresent: true }),
    expectedRecommendation: { recommendation: 'SAJU', modes: ['MONTHLY'] },
    expectedSlots: slots('monthly_flow', { periodPresent: true, recentSituationPresent: false, exactTools: ['SAJU:MONTHLY'] }),
    reviewChecks: ['General overall monthly flow follows the original monthly Saju row.', 'A date/period request alone is not concrete recentSituation.'] },
  { id: 'v4-period-specific-relationship', origin: 'V4_CONTRAST', input: plain(relationMonth, true),
    mockClassification: classify('relationship_flow', relationMonth, { targetAliasEvidence: { state: 'ALIAS', source: -1, quote: '달새' }, periodPresent: true }),
    expectedRecommendation: { recommendation: 'TAROT', modes: ['RELATIONSHIP_3'] },
    expectedSlots: slots('relationship_flow', { aliasState: 'ALIAS', aliasSource: -1, periodPresent: true, recentSituationPresent: false, exactTools: ['TAROT:RELATIONSHIP_3'] }),
    reviewChecks: ['Same period and birth availability as the paired general-flow input; specific relationship topic selects Tarot.', 'No extra birth slot or invented current relationship event.'] },
  { id: 'v4-semantic-medical-high-stakes', origin: 'V4_CONTRAST', input: plain(medical),
    mockClassification: classify('general_concern', medical, { explicitTool: 'TAROT', explicitToolQuote: '타로로 판단해 줘', highStakes: true, periodPresent: true }),
    expectedRecommendation: { recommendation: 'NONE', modes: [] },
    expectedSlots: slots('general_concern', { intents: undefined, explicitTool: 'TAROT', highStakes: true, exactTools: [], periodPresent: true }),
    reviewChecks: ['Actual structured highStakes=true must yield VALID_NONE despite a positive Tarot request; no medical topic enum is invented.', 'Offline test confirms this sentence reaches the classifier rather than the narrow text prefilter. No medical advice is requested from or generated by the harness.'] },
  { id: 'v4-concern-conversation-only', origin: 'V4_CONTRAST', input: plain(concern),
    mockClassification: classify('general_concern', '여러 고민이 겹쳐 마음이 무거워.', { requestPurpose: 'GENERAL_CHAT' }),
    expectedRecommendation: { recommendation: 'NONE', modes: [] },
    expectedSlots: slots('general_concern', { requestPurposes: ['GENERAL_CHAT'], recentSituationPresent: false, exactTools: [] }),
    reviewChecks: ['A burden of worries is general_concern rather than an ordinary greeting; vague emotion alone supplies no concrete recent event.', 'Conversation-only intent stays VALID_NONE without claiming that any memory action ran.'] },
];
export const INTENT_V4_CASES: readonly IntentV4EvaluationCase[] = [...INTENT_V3_CASES, ...INTENT_V4_CONTRAST_CASES];
if (INTENT_V4_CASES.length !== 26 || new Set(INTENT_V4_CASES.map(item => item.id)).size !== 26) throw Error('INTENT_V4_CORPUS_INVALID');
