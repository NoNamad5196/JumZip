import { describe, expect, it } from 'vitest';
import { recommendTool, type Intent } from '../../supabase/functions/_shared/domain/router.ts';

describe('frozen recommendation matrix', () => {
  it.each<[Intent, string, string | undefined]>([
    ['target_feelings', 'TAROT', 'RELATIONSHIP_3'], ['relationship_flow', 'TAROT', 'RELATIONSHIP_3'],
    ['daily_fortune', 'TAROT', 'ONE_CARD'], ['career_decision', 'TAROT', 'DECISION_3'],
    ['yearly_flow', 'SAJU', undefined], ['monthly_flow', 'SAJU', undefined], ['natal_character', 'SAJU', undefined],
    ['long_term_compatibility', 'SAJU_COMPATIBILITY', undefined], ['small_talk', 'NONE', undefined], ['general_concern', 'NONE', undefined],
  ])('%s suggests %s without executing it', (intent, tool, spread) => {
    expect(recommendTool({ intent })).toMatchObject({ tool });
    expect(recommendTool({ intent }).spreadType).toBe(spread);
  });
  it('offers tarot compatibility when partner birth data is unavailable', () => {
    expect(recommendTool({ intent: 'long_term_compatibility', hasOwnBirthData: true })).toMatchObject({ tool: 'SAJU_COMPATIBILITY', missingInformation: ['partnerBirthData'], alternative: 'TAROT_COMPATIBILITY' });
  });
  it('honors explicit Saju daily selection and requests only missing own birth information', () => {
    expect(recommendTool({ intent: 'daily_fortune', explicitTool: 'SAJU' })).toMatchObject({ tool: 'SAJU', mode: 'DAILY', missingInformation: ['ownBirthData'] });
    expect(recommendTool({ intent: 'daily_fortune', explicitTool: 'SAJU', hasOwnBirthData: true }).missingInformation).toEqual([]);
  });
  it('does not ask for birth data after the user explicitly selects tarot', () => {
    expect(recommendTool({ intent: 'natal_character', explicitTool: 'TAROT' })).toMatchObject({ tool: 'TAROT', spreadType: 'GENERAL_3', missingInformation: [] });
  });
  it('requests only the missing relationship or decision context and clears it once supplied', () => {
    expect(recommendTool({ intent: 'target_feelings', targetPerson: 'friend' }).missingInformation).toEqual(['recentSituation']);
    expect(recommendTool({ intent: 'relationship_flow', targetPerson: 'friend', period: 'this month' }).missingInformation).toEqual([]);
    expect(recommendTool({ intent: 'career_decision', choices: ['stay'], recentSituation: 'choosing a project' }).missingInformation).toEqual(['choices']);
    expect(recommendTool({ intent: 'career_decision', choices: ['stay', 'change'], recentSituation: 'choosing a project' }).missingInformation).toEqual([]);
  });
  it('keeps both-person birth requirements isolated to Saju compatibility', () => {
    expect(recommendTool({ intent: 'long_term_compatibility', hasOwnBirthData: true, hasPartnerBirthData: true })).toMatchObject({ tool: 'SAJU_COMPATIBILITY', missingInformation: [] });
    expect(recommendTool({ intent: 'long_term_compatibility', explicitTool: 'TAROT_COMPATIBILITY', targetPerson: 'friend', recentSituation: 'new relationship' })).toMatchObject({ tool: 'TAROT_COMPATIBILITY', spreadType: 'RELATIONSHIP_3', missingInformation: [] });
  });
});
