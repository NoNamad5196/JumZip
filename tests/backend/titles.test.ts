import { describe, expect, it, vi } from 'vitest';
import type { LLMProvider } from '../../supabase/functions/_shared/llm/provider.ts';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createTitleMaintenance, maintainTitles, type TitleClaim, type TitleMaintenance } from '../../supabase/functions/_shared/orchestration/titles.ts';

const messages = [{ role: 'user' as const, content: '새 취미를 찾고 싶어' }, { role: 'assistant' as const, content: '어떤 활동이 마음에 들어?' }, { role: 'user' as const, content: '그림을 배우고 싶어' }];
const target: TitleClaim = { targetType: 'CONVERSATION', targetId: 'conversation', claimId: 'lease', messages };
function fixture() {
  const deps: TitleMaintenance = { claim: vi.fn().mockResolvedValue([target]), generate: vi.fn().mockResolvedValue('새 취미를 찾는 시간'), apply: vi.fn().mockResolvedValue(true) };
  return deps;
}
describe('best effort AI title generation', () => {
  it('applies only the SQL claimed owner/target/lease after sufficient messages', async () => {
    const deps = fixture(); await maintainTitles(deps, 'owner', 'conversation', 'consultation');
    expect(deps.claim).toHaveBeenCalledWith('owner', 'conversation', 'consultation');
    expect(deps.apply).toHaveBeenCalledWith('owner', target, '새 취미를 찾는 시간');
  });
  it('does no model work when SQL skips a custom title, active lease or early conversation', async () => {
    const deps = fixture(); vi.mocked(deps.claim).mockResolvedValue([]);
    await maintainTitles(deps, 'owner', 'conversation', 'consultation'); expect(deps.generate).not.toHaveBeenCalled();
    vi.mocked(deps.claim).mockResolvedValue([{ ...target, messages: messages.slice(0, 2) }]);
    await maintainTitles(deps, 'owner', 'conversation', 'consultation'); expect(deps.generate).not.toHaveBeenCalled();
  });
  it('keeps title failure independent and never forces an update after a user edit invalidates the lease', async () => {
    const deps = fixture(); vi.mocked(deps.claim).mockResolvedValue([target, { ...target, targetType: 'CONSULTATION', targetId: 'consultation' }]);
    vi.mocked(deps.generate).mockRejectedValueOnce(new Error('unavailable')); vi.mocked(deps.apply).mockResolvedValue(false);
    await expect(maintainTitles(deps, 'owner', 'conversation', 'consultation')).resolves.toBeUndefined();
    expect(deps.apply).toHaveBeenCalledTimes(1);
  });
  it('excludes private or sensitive user turns and their assistant echoes from title prompts', async () => {
    const deps = fixture(); vi.mocked(deps.claim).mockResolvedValue([{ ...target, messages: [
      { role: 'user', content: '기억하지 마. 개인적인 이야기야' }, { role: 'assistant', content: '그 개인적인 이야기였구나' }, ...messages,
    ] }]);
    await maintainTitles(deps, 'owner', 'conversation', 'consultation');
    expect(deps.generate).toHaveBeenCalledExactlyOnceWith(messages);
    vi.mocked(deps.claim).mockResolvedValue([{ ...target, messages: [{ role: 'user', content: '출생일은 1995-02-03이야' }, { role: 'assistant', content: '1995년 이야기구나' }, ...messages] }]);
    await maintainTitles(deps, 'owner', 'conversation', 'consultation');
    expect(JSON.stringify(vi.mocked(deps.generate).mock.calls)).not.toContain('1995');
  });
  it('rejects sensitive or multiline provider output before any persistence', async () => {
    const deps = fixture();
    for (const bad of ['1995-02-03 출생 상담', '이야기\n제목', 'a'.repeat(61), '']) {
      vi.mocked(deps.generate).mockResolvedValue(bad); await maintainTitles(deps, 'owner', 'conversation', 'consultation');
    }
    expect(deps.apply).not.toHaveBeenCalled();
  });
  it('strictly validates the structured title response and calls only the service RPC signature', async () => {
    const provider = { generateStructured: vi.fn().mockImplementation(async request => request.validate({ title: '취미 이야기' })) } as unknown as LLMProvider;
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const deps = createTitleMaintenance({ rpc } as unknown as SupabaseClient, provider);
    expect(await deps.generate(messages)).toBe('취미 이야기');
    const input = vi.mocked(provider.generateStructured).mock.calls[0]![0];
    expect(() => input.validate({ title: '제목', extra: true })).toThrow();
    await deps.apply('owner', target, '취미 이야기');
    expect(rpc).toHaveBeenCalledWith('apply_generated_title', { p_user_id: 'owner', p_target_type: 'CONVERSATION', p_target_id: 'conversation', p_claim_id: 'lease', p_title: '취미 이야기' });
  });
});
