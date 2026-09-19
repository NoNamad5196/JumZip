import type { SpreadType } from './tarot.ts';

export type FortuneTool = 'NONE' | 'TAROT' | 'SAJU' | 'SAJU_COMPATIBILITY' | 'TAROT_COMPATIBILITY';
export type Intent = 'target_feelings' | 'relationship_flow' | 'long_term_compatibility' | 'daily_fortune' | 'yearly_flow' | 'monthly_flow' | 'natal_character' | 'career_decision' | 'general_concern' | 'small_talk';
export interface IntentSnapshot {
  intent: Intent;
  explicitTool?: Exclude<FortuneTool, 'NONE'>;
  targetPerson?: string;
  recentSituation?: string;
  period?: string;
  choices?: readonly string[];
  hasOwnBirthData?: boolean;
  hasPartnerBirthData?: boolean;
}
export interface ToolRecommendation {
  tool: FortuneTool;
  spreadType?: SpreadType;
  mode?: 'DAILY' | 'NATAL' | 'SEWOON' | 'MONTHLY';
  missingInformation: readonly string[];
  alternative?: Exclude<FortuneTool, 'NONE'>;
  reason: string;
}

/** A recommendation does not execute a tool. Explicit user choices take precedence. */
export function recommendTool(input: IntentSnapshot): ToolRecommendation {
  let result: ToolRecommendation;
  const relationshipMissing = [!input.targetPerson && 'targetPerson', !input.recentSituation && 'recentSituation'].filter(Boolean) as string[];
  switch (input.intent) {
    case 'target_feelings': result = { tool: 'TAROT', spreadType: 'RELATIONSHIP_3', missingInformation: relationshipMissing, reason: '지금의 감정과 관계 태도는 관계 타로 세 장으로 살펴볼 수 있어요.' }; break;
    case 'relationship_flow': result = { tool: 'TAROT', spreadType: 'RELATIONSHIP_3', missingInformation: [!input.targetPerson && 'targetPerson', !input.period && 'period'].filter(Boolean) as string[], reason: '단기 관계 흐름과 다음 행동을 함께 살펴봐요.' }; break;
    case 'long_term_compatibility': result = { tool: 'SAJU_COMPATIBILITY', missingInformation: [!input.hasOwnBirthData && 'ownBirthData', !input.hasPartnerBirthData && 'partnerBirthData'].filter(Boolean) as string[], alternative: !input.hasPartnerBirthData ? 'TAROT_COMPATIBILITY' : undefined, reason: '장기 궁합은 두 사람의 출생정보를 바탕으로 살펴봐요.' }; break;
    case 'daily_fortune': result = { tool: 'TAROT', spreadType: 'ONE_CARD', mode: 'DAILY', missingInformation: [], reason: '오늘 필요한 조언을 한 장으로 살펴봐요.' }; break;
    case 'yearly_flow': case 'monthly_flow': result = { tool: 'SAJU', mode: input.intent === 'yearly_flow' ? 'SEWOON' : 'MONTHLY', missingInformation: input.hasOwnBirthData ? [] : ['ownBirthData'], reason: '절기와 원국을 바탕으로 장기적인 흐름을 살펴봐요.' }; break;
    case 'natal_character': result = { tool: 'SAJU', mode: 'NATAL', missingInformation: input.hasOwnBirthData ? [] : ['ownBirthData'], reason: '타고난 성향은 원국의 구조를 바탕으로 살펴봐요.' }; break;
    case 'career_decision': result = { tool: 'TAROT', spreadType: 'DECISION_3', missingInformation: [(!input.choices || input.choices.length < 2) && 'choices', !input.recentSituation && 'recentSituation'].filter(Boolean) as string[], alternative: 'SAJU', reason: '선택을 밀어주는 힘과 현실적인 위험을 세 장으로 살펴봐요.' }; break;
    case 'general_concern': result = { tool: 'NONE', missingInformation: ['coreConcern'], alternative: 'TAROT', reason: '지금 가장 신경 쓰이는 이야기부터 나눠요.' }; break;
    case 'small_talk': result = { tool: 'NONE', missingInformation: [], reason: '점술 없이 편하게 이야기를 이어가요.' }; break;
    default: throw new RangeError('INTENT_INVALID');
  }
  if (!input.explicitTool || input.explicitTool === result.tool) return result;
  switch (input.explicitTool) {
    case 'TAROT': return { tool: 'TAROT', spreadType: input.intent === 'daily_fortune' ? 'ONE_CARD' : input.intent === 'career_decision' ? 'DECISION_3' : ['target_feelings', 'relationship_flow', 'long_term_compatibility'].includes(input.intent) ? 'RELATIONSHIP_3' : 'GENERAL_3', missingInformation: [], ...(input.intent === 'daily_fortune' ? { mode: 'DAILY' as const } : {}), reason: '직접 선택한 타로로 이어가요.' };
    case 'SAJU': return { tool: 'SAJU', mode: input.intent === 'daily_fortune' ? 'DAILY' : input.intent === 'monthly_flow' ? 'MONTHLY' : input.intent === 'yearly_flow' ? 'SEWOON' : 'NATAL', missingInformation: input.hasOwnBirthData ? [] : ['ownBirthData'], reason: '직접 선택한 사주로 이어가요.' };
    case 'TAROT_COMPATIBILITY': return { tool: 'TAROT_COMPATIBILITY', spreadType: 'RELATIONSHIP_3', missingInformation: relationshipMissing, reason: '출생정보 없이 관계의 태도와 흐름을 살펴봐요.' };
    case 'SAJU_COMPATIBILITY': return { tool: 'SAJU_COMPATIBILITY', missingInformation: [!input.hasOwnBirthData && 'ownBirthData', !input.hasPartnerBirthData && 'partnerBirthData'].filter(Boolean) as string[], alternative: 'TAROT_COMPATIBILITY', reason: '선택한 궁합에는 두 사람의 출생정보가 필요해요.' };
  }
}
