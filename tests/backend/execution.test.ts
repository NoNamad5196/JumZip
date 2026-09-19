import { describe, expect, it, vi } from 'vitest';
import { createActionExecutor, localDate } from '../../supabase/functions/_shared/orchestration/execute.ts';
import { ApiFailure } from '../../supabase/functions/_shared/http/errors.ts';
import type { Repository, ClaimedRequest, DrawSnapshot } from '../../supabase/functions/_shared/persistence/repository.ts';
import type { TarotRequest, ChatRequest, SajuRequest } from '../../supabase/functions/_shared/validation/requests.ts';
import type { PersonaReply } from '../../supabase/functions/_shared/llm/reply.ts';

const uuid = '20000000-0000-4000-8000-000000000001';
const user = { id: 'owner', isAnonymous: true };
const draw: DrawSnapshot = { drawGroupId: 'persisted-draw', consultationId: uuid, conversationId: uuid, question: '질문', spreadType: 'ONE_CARD', mode: 'NORMAL',
  cards: [{ cardId: 6, orientation: 'REVERSED', positionIndex: 0, positionKey: 'CORE_MESSAGE' }], interpretation: null };
const claim: ClaimedRequest = { executionId: 'execution', conversationId: uuid, consultationId: uuid, characterId: 'SANI', userMessage: { id: 'saved-user-message', content: '지금 고민이 있어', createdAt: '2026-09-20T00:00:00Z' } };
const reply: PersonaReply = { content: '질문에 연결한 해석', segments: ['질문에 연결한 해석'], repaired: false,
  metadata: { model: 'configured-model', promptVersion: 'JumZipPersona-v1', provider: 'openai-compatible', generatedAt: '2026-09-20T00:00:00Z' } };
const drawRequest: TarotRequest = { schemaVersion: 1, requestId: uuid, action: 'DRAW', conversationId: uuid, consultationId: null, question: '질문', spreadType: 'ONE_CARD', mode: 'NORMAL', clientTimezone: 'Asia/Seoul' };
const chatRequest: ChatRequest = { schemaVersion: 1, requestId: uuid, action: 'SEND', conversationId: uuid, consultationId: null, message: '지금 고민이 있어' };
function fixture() {
  const repo: Repository = {
    beginChat: vi.fn().mockResolvedValue({ ...claim }), beginFortune: vi.fn().mockResolvedValue({ ...claim }),
    saveDraw: vi.fn().mockResolvedValue({ ...draw }), complete: vi.fn().mockImplementation(async params => params.data), fail: vi.fn().mockResolvedValue(null),
    context: vi.fn().mockResolvedValue({ recentMessages: [], summary: '', memories: [] }), deleteAccount: vi.fn().mockResolvedValue(undefined),
  };
  const generate = vi.fn().mockResolvedValue(reply);
  return { repo, generate, execute: createActionExecutor({ repository: repo, generate, now: () => new Date('2026-09-19T16:00:00Z') }) };
}

describe('authoritative execution ordering and recovery', () => {
  it.each(['tarot', 'compatibility'] as const)('propagates authoritative deletion during %s completion instead of returning a stale partial snapshot', async endpoint => {
    const { repo, execute } = fixture();
    const gone = new ApiFailure('NOT_FOUND', 404, '삭제된 상담입니다.');
    vi.mocked(repo.complete).mockRejectedValue(gone);
    const input = endpoint === 'tarot' ? drawRequest : { schemaVersion: 1 as const, requestId: uuid, action: 'DRAW_TAROT' as const, conversationId: uuid, consultationId: null, question: '질문', targetPersonAlias: '합성 상대' };
    await expect(execute(endpoint, input, user)).rejects.toBe(gone);
    expect(repo.fail).not.toHaveBeenCalled();
  });
  it.each(['tarot', 'compatibility'] as const)('propagates authoritative deletion detected by the %s failure-status write', async endpoint => {
    const { repo, generate, execute } = fixture();
    generate.mockRejectedValue({ code: 'LLM_TIMEOUT' });
    const gone = new ApiFailure('NOT_FOUND', 404, '삭제된 상담입니다.');
    vi.mocked(repo.fail).mockRejectedValue(gone);
    const input = endpoint === 'tarot' ? drawRequest : { schemaVersion: 1 as const, requestId: uuid, action: 'DRAW_TAROT' as const, conversationId: uuid, consultationId: null, question: '질문', targetPersonAlias: '합성 상대' };
    await expect(execute(endpoint, input, user)).rejects.toBe(gone);
    expect(repo.complete).not.toHaveBeenCalled();
  });
  it('passes recommendation as choice guidance and stores it without executing any suggested tool', async () => {
    const { repo, generate } = fixture();
    const recommendation = { recommendedTools: [{ tool: 'SAJU' as const, mode: 'NATAL' as const, reason: '성향을 살펴볼 수 있어요', missingSlots: ['본인 출생 정보'] }] };
    const recommend = vi.fn().mockResolvedValue(recommendation);
    const execute = createActionExecutor({ repository: repo, generate, recommend });
    const response = await execute('chat', chatRequest, user);
    expect(response.data).toMatchObject({ recommendation });
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ currentTask: expect.stringContaining('사용자가 직접 선택') }));
    expect(repo.beginFortune).not.toHaveBeenCalled(); expect(repo.saveDraw).not.toHaveBeenCalled();
    expect(repo.complete).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ recommendation }) }));
  });
  it('keeps ordinary Persona chat available when optional intent extraction fails', async () => {
    const { repo, generate } = fixture(); const recommend = vi.fn().mockRejectedValue(new Error('classifier unavailable'));
    const response = await createActionExecutor({ repository: repo, generate, recommend })('chat', chatRequest, user);
    expect(response.status).toBe(201); expect(response.data).toMatchObject({ recommendation: null });
    expect(generate).toHaveBeenCalledOnce(); expect(repo.fail).not.toHaveBeenCalled();
  });
  it('commits immutable draw before calling Persona and only sends persisted cards', async () => {
    const { repo, generate, execute } = fixture();
    await execute('tarot', drawRequest, user);
    expect(vi.mocked(repo.saveDraw).mock.invocationCallOrder[0]).toBeLessThan(generate.mock.invocationCallOrder[0]!);
    const prompt = generate.mock.calls[0]![0];
    expect(prompt.toolResult.cards[0]).toMatchObject(draw.cards[0]!);
    expect(vi.mocked(repo.complete).mock.calls[0]![0].model).toBe('configured-model');
  });
  it('returns partial success with preserved draw when LLM fails', async () => {
    const { repo, generate, execute } = fixture(); generate.mockRejectedValue({ code: 'LLM_TIMEOUT' });
    const result = await execute('tarot', drawRequest, user);
    expect(result.status).toBe(200); expect(result.data).toMatchObject({ executionStatus: 'PARTIAL', drawGroupId: 'persisted-draw', cards: draw.cards, interpretation: null });
    expect(repo.complete).not.toHaveBeenCalled(); expect(repo.fail).toHaveBeenCalledWith('execution', expect.objectContaining({ code: 'TAROT_INTERPRETATION_FAILED' }), 200);
  });
  it('retries interpretation from stored snapshot with no new draw', async () => {
    const { repo, generate, execute } = fixture(); vi.mocked(repo.beginFortune).mockResolvedValue({ ...claim, resource: draw });
    await execute('tarot', { schemaVersion: 1, requestId: uuid, conversationId: uuid, action: 'RETRY_INTERPRETATION', drawGroupId: 'persisted-draw' }, user);
    expect(repo.saveDraw).not.toHaveBeenCalled(); expect(generate.mock.calls[0]![0].toolResult.cards[0]).toMatchObject(draw.cards[0]!);
  });
  it('keeps partial cards visible even if the later failure-status write fails', async () => {
    const { repo, generate, execute } = fixture(); generate.mockRejectedValue({ code: 'LLM_TIMEOUT' }); vi.mocked(repo.fail).mockRejectedValue(new Error('database temporarily unavailable'));
    const result = await execute('tarot', drawRequest, user);
    expect(result.status).toBe(200); expect(result.data).toMatchObject({ executionStatus: 'PARTIAL', drawGroupId: draw.drawGroupId, cards: draw.cards });
  });
  it('REDRAW uses server source spread and retains the original group', async () => {
    const { repo, execute } = fixture(); vi.mocked(repo.beginFortune).mockResolvedValue({ ...claim, source: draw });
    await execute('tarot', { schemaVersion: 1, requestId: uuid, conversationId: uuid, consultationId: uuid, action: 'REDRAW', sourceDrawGroupId: draw.drawGroupId }, user);
    expect(repo.saveDraw).toHaveBeenCalledWith(expect.objectContaining({ spreadType: draw.spreadType, sourceDrawGroupId: draw.drawGroupId, question: draw.question }));
  });
  it('rejects Daily redraw before drawing or calling LLM', async () => {
    const { repo, generate, execute } = fixture(); vi.mocked(repo.beginFortune).mockResolvedValue({ ...claim, source: { ...draw, mode: 'DAILY' } });
    await expect(execute('tarot', { schemaVersion: 1, requestId: uuid, conversationId: uuid, consultationId: uuid, action: 'REDRAW', sourceDrawGroupId: draw.drawGroupId }, user)).rejects.toMatchObject({ code: 'TAROT_DAILY_REDRAW_NOT_ALLOWED' });
    expect(repo.saveDraw).not.toHaveBeenCalled(); expect(generate).not.toHaveBeenCalled();
  });
  it('reuses same-day partial Daily draw without regenerating interpretation', async () => {
    const { repo, generate, execute } = fixture(); vi.mocked(repo.beginFortune).mockResolvedValue({ ...claim, resource: { ...draw, mode: 'DAILY' } });
    const result = await execute('tarot', { ...drawRequest, mode: 'DAILY' }, user);
    expect(result.data).toMatchObject({ executionStatus: 'PARTIAL', drawGroupId: draw.drawGroupId });
    expect(repo.saveDraw).not.toHaveBeenCalled(); expect(generate).not.toHaveBeenCalled();
  });
  it('a concurrent Daily loser uses the RPC winner and never calls LLM twice', async () => {
    const { repo, generate, execute } = fixture(); vi.mocked(repo.saveDraw).mockResolvedValue({ ...draw, mode: 'DAILY', reused: true } as DrawSnapshot);
    await execute('tarot', { ...drawRequest, mode: 'DAILY' }, user);
    expect(generate).not.toHaveBeenCalled(); expect(repo.complete).toHaveBeenCalledWith(expect.objectContaining({ content: null }));
  });
  it('successful replay does not invoke engine or LLM', async () => {
    const { repo, generate, execute } = fixture(); vi.mocked(repo.beginFortune).mockResolvedValue({ ...claim, replay: { data: draw, httpStatus: 200 } });
    expect((await execute('tarot', drawRequest, user)).data).toEqual(draw);
    expect(repo.saveDraw).not.toHaveBeenCalled(); expect(generate).not.toHaveBeenCalled();
  });
  it('failed replay returns its cached error and preserves the retry pointer', async () => {
    const { repo, generate, execute } = fixture(); vi.mocked(repo.beginChat).mockResolvedValue({ ...claim, replay: { error: { code: 'LLM_TIMEOUT', message: '만료', retryable: true, details: { userMessageId: 'saved-user-message' } }, httpStatus: 504 } });
    await expect(execute('chat', chatRequest, user)).rejects.toMatchObject({ code: 'LLM_TIMEOUT', details: { userMessageId: 'saved-user-message' } }); expect(generate).not.toHaveBeenCalled();
  });
  it('Chat failures keep the saved message and explicit retry never resends its content for insertion', async () => {
    const { repo, generate, execute } = fixture(); generate.mockRejectedValue(new ApiFailure('LLM_TIMEOUT', 504, '만료', true));
    await expect(execute('chat', chatRequest, user)).rejects.toMatchObject({ details: { userMessageId: 'saved-user-message' } });
    expect(repo.complete).not.toHaveBeenCalled();
    await expect(execute('chat', { schemaVersion: 1, requestId: uuid, conversationId: uuid, action: 'RETRY_RESPONSE', userMessageId: 'saved-user-message' }, user)).rejects.toBeInstanceOf(ApiFailure);
    expect(vi.mocked(repo.beginChat).mock.calls[1]![0]).toMatchObject({ retry_message_id: 'saved-user-message' });
    expect(vi.mocked(repo.beginChat).mock.calls[1]![0]).not.toHaveProperty('message');
  });
  it('does not write birth data or invent Saju rules', async () => {
    const { repo, generate, execute } = fixture();
    const request: SajuRequest = { schemaVersion: 1, requestId: uuid, action: 'CALCULATE', conversationId: uuid, consultationId: null, subject: { birthProfileId: uuid, saveProfile: false } };
    await expect(execute('saju', request, user)).rejects.toMatchObject({ code: 'SAJU_CALCULATION_FAILED', details: { reason: 'NOT_CONFIGURED' }, retryable: false });
    expect(repo.beginFortune).not.toHaveBeenCalled(); expect(generate).not.toHaveBeenCalled();
  });
  it('deletes only the authenticated user and skips ordinary execution idempotency', async () => {
    const { repo, execute } = fixture();
    expect((await execute('account', { schemaVersion: 1, requestId: uuid, action: 'DELETE_ACCOUNT', confirmation: 'DELETE' }, user)).data).toEqual({ deleted: true });
    expect(repo.deleteAccount).toHaveBeenCalledWith('owner'); expect(repo.beginChat).not.toHaveBeenCalled();
  });
  it('derives the date on the server in the supplied IANA timezone', () => {
    expect(localDate(new Date('2026-09-19T16:00:00Z'), 'Asia/Seoul')).toBe('2026-09-20');
    expect(localDate(new Date('2026-09-19T16:00:00Z'), 'America/Los_Angeles')).toBe('2026-09-19');
  });
  it('does not turn a committed reply into failure when background maintenance cannot start', async () => {
    const { repo, generate } = fixture();
    const afterReply = vi.fn(() => { throw new Error('background unavailable'); });
    const execute = createActionExecutor({ repository: repo, generate, afterReply });
    const result = await execute('chat', chatRequest, user);
    expect(result.status).toBe(201); expect(repo.complete).toHaveBeenCalledTimes(1); expect(repo.fail).not.toHaveBeenCalled();
    expect(afterReply.mock.invocationCallOrder[0]).toBeGreaterThan(vi.mocked(repo.complete).mock.invocationCallOrder[0]!);
  });
  it('immediately excludes remembered context for an explicit do-not-remember turn', async () => {
    const { repo, generate, execute } = fixture();
    vi.mocked(repo.beginChat).mockResolvedValue({ ...claim, userMessage: { ...claim.userMessage!, content: '기억하지 마. 지금만 이야기하고 싶어.' } });
    vi.mocked(repo.context).mockResolvedValue({ recentMessages: [], summary: '기존 요약', memories: [{ id: 'old', scope: 'GLOBAL', subject: 'USER', content: '기억', category: 'GOAL', importance: 3 }] });
    await execute('chat', chatRequest, user);
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ summary: '', memories: [] }));
  });
});
