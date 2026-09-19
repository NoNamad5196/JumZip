import { describe, expect, it } from 'vitest';
import { buildContext, refreshSummary, type ContextMemory, type ContextMessage } from '../../supabase/functions/_shared/persona/context.ts';
import { buildPersonaMessages } from '../../supabase/functions/_shared/persona/prompt.ts';
import { getPersona, PERSONA_UI_COPY } from '../../supabase/functions/_shared/persona/config.ts';

describe('bounded, scoped context', () => {
  const messages: ContextMessage[] = Array.from({ length: 20 }, (_, index) => [{ role: 'user' as const, content: `u${index}` }, { role: 'assistant' as const, content: `a${index}` }]).flat();
  const memories: ContextMemory[] = Array.from({ length: 8 }, (_, index) => ({ id: `g${index}`, scope: 'GLOBAL', content: `global${index}`, importance: index }));
  it('keeps 16 complete conversational turns, not just 16 messages', () => {
    const context = buildContext({ characterId: 'SANI', currentMessage: 'new', recentMessages: messages });
    expect(context.recentMessages).toHaveLength(32);
    expect(context.recentMessages[0]?.content).toBe('u4');
    expect(context.recentMessages.at(-1)?.content).toBe('a19');
    expect(context.shouldUpdateSummary).toBe(true);
    expect(messages).toHaveLength(40);
  });
  it('selects up to four globals and two current-character memories without deleted or forbidden memories', () => {
    const context = buildContext({ characterId: 'BOMI', currentMessage: 'hi', memories: [...memories,
      { id: 'b1', scope: 'CHARACTER', characterId: 'BOMI', content: 'b1' }, { id: 'b2', scope: 'CHARACTER', characterId: 'BOMI', content: 'b2' }, { id: 'b3', scope: 'CHARACTER', characterId: 'BOMI', content: 'b3' },
      { id: 'other', scope: 'CHARACTER', characterId: 'SANI', content: 'secret-other' }, { id: 'deleted', scope: 'GLOBAL', content: 'deleted', importance: 999, deletedAt: '2026-01-01' }, { id: 'never', scope: 'GLOBAL', content: 'never', importance: 999, doNotRemember: true },
    ] });
    expect(context.globalMemories.map(m => m.id)).toEqual(['g7', 'g6', 'g5', 'g4']);
    expect(context.characterMemories.map(m => m.id)).toEqual(['b1', 'b2']);
    expect(JSON.stringify(context)).not.toContain('secret-other');
    expect(JSON.stringify(context)).not.toContain('never');
  });
  it('drops oldest raw turns before memory while preserving question, summary and tool result', () => {
    const toolResult = { cards: [{ cardId: 1 }] };
    const context = buildContext({ characterId: 'SANI', currentMessage: 'keep-current', summary: 'keep-summary', toolResult, memories: memories.slice(0, 1), recentMessages: messages, budgetChars: 400 });
    expect(context.currentMessage).toBe('keep-current'); expect(context.summary).toBe('keep-summary'); expect(context.toolResult).toEqual(toolResult);
    expect(context.recentMessages.length).toBeLessThan(32);
    expect(context.globalMemories).toHaveLength(1);
    expect(context.exceedsBudget).toBe(false);
  });
  it('reports unavoidable budget overflow without silently deleting protected context', () => {
    const result = buildContext({ characterId: 'ARANG', currentMessage: 'very long current question', budgetChars: 1 });
    expect(result.exceedsBudget).toBe(true); expect(result.currentMessage).toBe('very long current question');
  });
  it('retains original messages and previous summary after a failed summarization', async () => {
    const result = await refreshSummary('previous', messages, async () => { throw new Error('offline'); });
    expect(result).toEqual({ summary: 'previous', updated: false }); expect(messages).toHaveLength(40);
  });
});

describe('three separate Korean Personas', () => {
  it('has distinct speech rhythm, boundaries and UI text', () => {
    expect(getPersona('BOMI').speakingStyle.rhythm).not.toBe(getPersona('SANI').speakingStyle.rhythm);
    expect(getPersona('ARANG').intimacyRules.FIRST_MEETING).toContain('존댓말');
    expect(getPersona('BOMI').forbiddenBehaviors.join(' ')).toContain('성적 표현');
    expect(new Set(Object.values(PERSONA_UI_COPY).map(p => p.interpretationRetry)).size).toBe(3);
  });
  it('builds a scoped prompt with current user message last and no fabricated tool result', () => {
    const messages = buildPersonaMessages({ characterId: 'ARANG', currentMessage: '안녕', relationshipState: 'FIRST_MEETING', memories: [{ id: 'other', scope: 'CHARACTER', characterId: 'BOMI', content: 'private-to-bomi' }] });
    expect(messages.at(-1)).toEqual({ role: 'user', content: '안녕' });
    expect(messages[0]?.content).toContain('아랑'); expect(JSON.stringify(messages)).not.toContain('private-to-bomi');
    expect(messages[0]?.content).toContain('결과를 새로 만들거나 수정');
  });
  it('removes raw structured birth/location fields while preserving authoritative engine facts', () => {
    const result = { pillars: { day: { heavenlyStem: '甲', earthlyBranch: '子' } }, strength: { score: 55 }, partner: { birthDate: '1990-05-15', birthTime: '07:05', location: { city: 'Seoul', latitude: 37.5, longitude: 127 } }, raw_birth_data: { birthday: '1990-05-15' } };
    const prompt = JSON.stringify(buildPersonaMessages({ characterId: 'ARANG', currentMessage: '계산된 성향을 설명해줘', toolResult: result }));
    expect(prompt).toContain('heavenlyStem'); expect(prompt).toContain('55');
    expect(prompt).not.toContain('1990-05-15'); expect(prompt).not.toContain('Seoul'); expect(prompt).not.toContain('latitude');
    expect(result.partner.birthDate).toBe('1990-05-15');
  });
});
