import { describe, expect, it, vi } from 'vitest';
import { createSajuActionExecutor, type SajuDependencies } from '../../supabase/functions/_shared/orchestration/saju.ts';
import type { FullSajuResult } from '../../supabase/functions/_shared/domain/full-saju.ts';
import type { SajuRequest } from '../../supabase/functions/_shared/validation/requests.ts';
import type { SajuSnapshot, SajuClaim, SajuFocus } from '../../supabase/functions/_shared/persistence/saju.ts';
import { ApiFailure } from '../../supabase/functions/_shared/http/errors.ts';

const id = '30000000-0000-4000-8000-000000000001';
const birth = { calendarType: 'SOLAR' as const, leapMonth: false, birthDate: '1999-03-14', birthTime: null, birthTimeUnknown: true,
  location: { name: '서울', country: '대한민국', latitude: 37.566, longitude: 126.9784, timezone: 'Asia/Seoul' }, gender: null };
const result: FullSajuResult = { status: 'LIMITED', fullCalculationReady: true, engineVersion: 'manseryeok-2.0.0', ruleVersion: 'JumZipSajuRules-v1', conventionVersion: 'JumZipSajuConvention-v1',
  pillars: { year: { heavenlyStem: '壬', earthlyBranch: '子' }, month: { heavenlyStem: '甲', earthlyBranch: '寅' }, day: { heavenlyStem: '甲', earthlyBranch: '辰' }, hour: null },
  hiddenStems: { year: [], month: [], day: [], hour: null }, tenGods: { year: null, month: null, day: null, hour: null }, elements: null, relations: [], gongmang: null,
  strength: { score: 80, grade: '강', rawScore: 79.6396, components: null, reasons: [], limited: true }, gyeokguk: null,
  yongsin: { element: 'METAL', reasonCodes: [] }, heesin: { element: 'EARTH', reasonCodes: [] }, twelveStages: { year: null, month: null, day: null, hour: null }, shinsal: [],
  daewoon: null, sewoon: null, monthlyFortune: null, possible_values: { charts: [], score: [80], grade: ['강'], yongsin: ['METAL'], heesin: ['EARTH'], gongmang: [], daewoon: [] }, uncertaintyFlags: ['BIRTH_TIME_UNKNOWN'] };
const snapshot: SajuSnapshot = { readingId: 'persisted-reading', conversationId: id, consultationId: id, result, interpretation: null };
const claim: SajuClaim = { executionId: 'execution', characterId: 'SANI', conversationId: id, consultationId: id };
const request: Extract<SajuRequest, { action: 'CALCULATE' }> = { schemaVersion: 1, requestId: id, action: 'CALCULATE', conversationId: id, consultationId: null, subject: { input: birth, saveProfile: false } };
const user = { id: 'owner', isAnonymous: true };
function fixture() {
  const deps: SajuDependencies = {
    readings: { begin: vi.fn().mockResolvedValue(claim), save: vi.fn().mockResolvedValue(snapshot), readUserBirthProfile: vi.fn().mockResolvedValue(birth), readFocus: vi.fn().mockResolvedValue('GENERAL') },
    executions: { complete: vi.fn().mockImplementation(async input => input.data), fail: vi.fn().mockResolvedValue(null), context: vi.fn().mockResolvedValue({ recentMessages: [], memories: [], summary: '' }) },
    calculate: vi.fn().mockReturnValue(result), interpretationData: vi.fn().mockReturnValue({ pillars: result.pillars, uncertaintyFlags: result.uncertaintyFlags }),
    generate: vi.fn().mockResolvedValue({ content: '저장된 원국에 대한 해석', segments: ['저장된 원국에 대한 해석'], metadata: { model: 'configured', promptVersion: 'persona-v1' }, repaired: false }),
    verifyLocation: vi.fn().mockResolvedValue({ ...birth.location, providerId: '1835848' }), now: vi.fn(() => new Date('2026-09-20T00:00:00Z')),
  };
  return { deps, execute: createSajuActionExecutor(deps) };
}
describe('Saju immutable snapshot orchestration', () => {
  it('keeps provider rate limiting distinct after a chart is safely saved', async () => {
    const { deps, execute } = fixture();
    vi.mocked(deps.generate).mockRejectedValue({ code: 'LLM_RATE_LIMITED' });
    const response = await execute(request, user);
    expect(response.status).toBe(200);
    expect(response.data).toMatchObject({ executionStatus: 'PARTIAL', readingId: snapshot.readingId, interpretation: null, partialError: { details: { readingId: snapshot.readingId, reason: 'LLM_RATE_LIMITED' } } });
    expect(deps.executions.complete).not.toHaveBeenCalled();
  });
  it.each<SajuFocus>(['GENERAL', 'YEAR_FLOW', 'MONTH_FLOW', 'CAREER', 'RELATIONSHIP'])('preserves the original %s focus from a partial calculation through interpretation retry', async focus => {
    const { deps, execute } = fixture();
    const timing = { asOf: '2026-09-19T00:00:00.000Z', precision: 'MINUTE' as const, periodBasis: 'SOLAR_TERM' as const,
      calendarLabel: { year: 2026, month: 9 }, activeDaewoonStatus: 'UNRESOLVED' as const };
    const persisted = { ...snapshot, result: { ...result, timing } };
    vi.mocked(deps.calculate).mockReturnValue(persisted.result);
    vi.mocked(deps.readings.save).mockResolvedValue(persisted);
    vi.mocked(deps.generate).mockRejectedValueOnce({ code: 'LLM_TIMEOUT' });
    const first = await execute({ ...request, focus }, user);
    expect(first.data).toMatchObject({ executionStatus: 'PARTIAL', readingId: persisted.readingId });
    expect(deps.readings.begin).toHaveBeenCalledWith(expect.objectContaining({ focus }));
    expect(deps.readings.readFocus).not.toHaveBeenCalled();
    const originalPrompt = vi.mocked(deps.generate).mock.calls[0]![0];
    expect(originalPrompt.currentMessage).toBe(`사주 상담: ${focus}`);
    const unchanged = JSON.stringify(persisted);
    vi.clearAllMocks();
    vi.mocked(deps.readings.begin).mockResolvedValue({ ...claim, resource: persisted });
    vi.mocked(deps.readings.readFocus).mockResolvedValue(focus);
    const retry = await execute({ schemaVersion: 1, requestId: '30000000-0000-4000-8000-000000000002', action: 'RETRY_INTERPRETATION', conversationId: id, readingId: persisted.readingId }, user);
    expect(retry.status).toBe(200);
    expect(retry.data).toMatchObject({ executionStatus: 'SUCCEEDED', inlineResult: { currentFlow: { timing } } });
    expect(deps.readings.readFocus).toHaveBeenCalledExactlyOnceWith(user.id, { consultationId: persisted.consultationId, conversationId: persisted.conversationId });
    expect(deps.generate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ currentMessage: originalPrompt.currentMessage, currentTask: originalPrompt.currentTask, toolResult: originalPrompt.toolResult }));
    expect(deps.interpretationData).toHaveBeenCalledExactlyOnceWith(persisted.result);
    for (const fn of [deps.calculate, deps.verifyLocation!, deps.now!, deps.readings.readUserBirthProfile, deps.readings.save]) expect(fn).not.toHaveBeenCalled();
    expect(JSON.stringify(persisted)).toBe(unchanged);
  });
  it.each([
    ['invalid focus', new ApiFailure('SAJU_INPUT_INCOMPLETE', 422, '저장된 상담 주제를 확인해 주세요.')],
    ['deleted consultation', new ApiFailure('NOT_FOUND', 404, '상담을 찾지 못했습니다.')],
    ['another owner', new ApiFailure('NOT_FOUND', 404, '상담을 찾지 못했습니다.')],
    ['database read failure', new ApiFailure('INTERNAL_ERROR', 500, '요청을 처리하지 못했습니다.', true)],
  ] as const)('fails explicitly before inference when focus lookup reports %s', async (_reason, failure) => {
    const { deps, execute } = fixture();
    vi.mocked(deps.readings.begin).mockResolvedValue({ ...claim, resource: snapshot });
    vi.mocked(deps.readings.readFocus).mockRejectedValue(failure);
    await expect(execute({ schemaVersion: 1, requestId: id, action: 'RETRY_INTERPRETATION', conversationId: id, readingId: snapshot.readingId }, user)).rejects.toBe(failure);
    expect(deps.executions.fail).toHaveBeenCalledExactlyOnceWith(claim.executionId, failure.toJSON(), failure.status);
    for (const fn of [deps.generate, deps.executions.context, deps.executions.complete, deps.calculate, deps.now!, deps.verifyLocation!, deps.readings.readUserBirthProfile, deps.readings.save]) expect(fn).not.toHaveBeenCalled();
  });
  it('returns a completed retry replay before reading focus or invoking inference', async () => {
    const { deps, execute } = fixture();
    const data = { readingId: snapshot.readingId, executionStatus: 'SUCCEEDED' };
    vi.mocked(deps.readings.begin).mockResolvedValue({ ...claim, replay: { data, httpStatus: 200 } });
    expect(await execute({ schemaVersion: 1, requestId: id, action: 'RETRY_INTERPRETATION', conversationId: id, readingId: snapshot.readingId }, user)).toEqual({ data, status: 200 });
    for (const fn of [deps.readings.readFocus, deps.generate, deps.executions.context, deps.calculate, deps.now!, deps.verifyLocation!]) expect(fn).not.toHaveBeenCalled();
  });
  it.each(['complete', 'fail'] as const)('never returns a deleted Saju snapshot when the %s RPC reports NOT_FOUND', async phase => {
    const { deps, execute } = fixture();
    const gone = new ApiFailure('NOT_FOUND', 404, '삭제된 상담입니다.');
    vi.mocked(deps.executions[phase]).mockRejectedValue(gone);
    if (phase === 'fail') vi.mocked(deps.generate).mockRejectedValue({ code: 'LLM_TIMEOUT' });
    await expect(execute(request, user)).rejects.toBe(gone);
    if (phase === 'complete') expect(deps.executions.fail).not.toHaveBeenCalled();
    else expect(deps.executions.complete).not.toHaveBeenCalled();
  });
  it('validates provenance, calculates once and persists before requesting interpretation', async () => {
    const { deps, execute } = fixture(); const response = await execute(request, user);
    const calls = [deps.readings.begin, deps.verifyLocation!, deps.calculate, deps.readings.save, deps.generate].map(fn => vi.mocked(fn).mock.invocationCallOrder[0]!);
    expect(calls).toEqual([...calls].sort((a, b) => a - b));
    expect(deps.readings.save).toHaveBeenCalledWith(expect.objectContaining({ result, profileInput: null }));
    expect(deps.readings.begin).toHaveBeenCalledWith(expect.objectContaining({ focus: 'GENERAL' }));
    expect(deps.generate).toHaveBeenCalledWith(expect.objectContaining({ currentMessage: '사주 상담: GENERAL' }));
    expect(response.status).toBe(201); expect(response.data).toMatchObject({ readingId: snapshot.readingId, inlineResult: { dayMaster: '甲木', pillars: { hour: null } }, uncertaintyFlags: ['BIRTH_TIME_UNKNOWN'] });
    expect(response.data).not.toHaveProperty('result'); expect(response.data).not.toHaveProperty('birthProfileSnapshot');
    expect(JSON.stringify(vi.mocked(deps.generate).mock.calls)).not.toContain(birth.birthDate);
  });
  it('persists a birth profile only with explicit saveProfile consent', async () => {
    const { deps, execute } = fixture(); await execute({ ...request, subject: { ...request.subject, saveProfile: true } }, user);
    expect(deps.readings.save).toHaveBeenCalledWith(expect.objectContaining({ profileInput: { ...birth, location: { ...birth.location, providerId: '1835848' } } }));
  });
  it('threads the verified birth location and one server instant into deterministic timing calculation', async () => {
    const { deps, execute } = fixture();
    await execute({ ...request, subject: { ...request.subject, input: { ...birth, location: { ...birth.location, name: 'untrusted display label' } } } }, user);
    const [input, asOf] = vi.mocked(deps.calculate).mock.calls[0]!;
    expect(input.location).toEqual({ ...birth.location, providerId: '1835848' });
    expect(asOf.toISOString()).toBe('2026-09-20T00:00:00.000Z');
  });
  it('retains the old unresolved timing snapshot on interpretation retry after a rule upgrade', async () => {
    const { deps, execute } = fixture();
    const oldTiming = { asOf: '2026-09-19T00:00:00.000Z', precision: 'MINUTE' as const, periodBasis: 'SOLAR_TERM' as const,
      calendarLabel: { year: 2026, month: 9 }, activeDaewoonStatus: 'UNRESOLVED' as const };
    const old = { ...snapshot, result: { ...result, timing: oldTiming } };
    vi.mocked(deps.readings.begin).mockResolvedValue({ ...claim, resource: old });
    const before = JSON.stringify(old);
    const response = await execute({ schemaVersion: 1, requestId: id, action: 'RETRY_INTERPRETATION', conversationId: id, readingId: old.readingId }, user);
    expect(deps.calculate).not.toHaveBeenCalled(); expect(deps.verifyLocation).not.toHaveBeenCalled();
    expect(deps.interpretationData).toHaveBeenCalledWith(old.result);
    expect(response.data).toMatchObject({ inlineResult: { currentFlow: { timing: oldTiming } } });
    expect(JSON.stringify(old)).toBe(before);
  });
  it('reuses the saved server-verified location without another provider lookup', async () => {
    const { deps, execute } = fixture(); await execute({ ...request, subject: { birthProfileId: id, saveProfile: false } }, user);
    expect(deps.readings.readUserBirthProfile).toHaveBeenCalledWith(user.id, id); expect(deps.verifyLocation).not.toHaveBeenCalled();
  });
  it('keeps the deterministic reading visible when interpretation and failure-status write both fail', async () => {
    const { deps, execute } = fixture(); vi.mocked(deps.generate).mockRejectedValue({ code: 'LLM_TIMEOUT' }); vi.mocked(deps.executions.fail).mockRejectedValue(new Error('database unavailable'));
    const response = await execute(request, user);
    expect(response.status).toBe(200); expect(response.data).toMatchObject({ executionStatus: 'PARTIAL', readingId: snapshot.readingId, interpretation: null, partialError: { code: 'SAJU_INTERPRETATION_FAILED', retryable: true } });
    expect(deps.executions.complete).not.toHaveBeenCalled(); expect(deps.calculate).toHaveBeenCalledTimes(1);
  });
  it('retries using only the persisted result, never the resolver, profile or engine', async () => {
    const { deps, execute } = fixture(); vi.mocked(deps.readings.begin).mockResolvedValue({ ...claim, resource: snapshot });
    await execute({ schemaVersion: 1, requestId: id, action: 'RETRY_INTERPRETATION', conversationId: id, readingId: snapshot.readingId }, user);
    expect(deps.calculate).not.toHaveBeenCalled(); expect(deps.verifyLocation).not.toHaveBeenCalled(); expect(deps.readings.readUserBirthProfile).not.toHaveBeenCalled(); expect(deps.readings.save).not.toHaveBeenCalled();
    expect(deps.interpretationData).toHaveBeenCalledWith(result);
  });
  it('replays a completed request without any external work', async () => {
    const { deps, execute } = fixture(); vi.mocked(deps.readings.begin).mockResolvedValue({ ...claim, replay: { data: { readingId: 'original' }, httpStatus: 201 } });
    expect(await execute(request, user)).toEqual({ data: { readingId: 'original' }, status: 201 });
    expect(deps.calculate).not.toHaveBeenCalled(); expect(deps.generate).not.toHaveBeenCalled(); expect(deps.verifyLocation).not.toHaveBeenCalled(); expect(deps.readings.readFocus).not.toHaveBeenCalled();
  });
  it('does not persist rejected civil-time or unresolved location inputs', async () => {
    const { deps, execute } = fixture(); vi.mocked(deps.calculate).mockImplementation(() => { throw { code: 'SAJU_CONVENTION_UNSUPPORTED', reason: 'NONEXISTENT_CIVIL_TIME' }; });
    await expect(execute(request, user)).rejects.toMatchObject({ code: 'SAJU_CONVENTION_UNSUPPORTED', status: 422, details: { reason: 'NONEXISTENT_CIVIL_TIME' } });
    expect(deps.readings.save).not.toHaveBeenCalled(); expect(deps.generate).not.toHaveBeenCalled();
  });
  it('rejects missing retry resources and never silently recalculates', async () => {
    const { deps, execute } = fixture();
    await expect(execute({ schemaVersion: 1, requestId: id, action: 'RETRY_INTERPRETATION', conversationId: id, readingId: 'missing' }, user)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(deps.calculate).not.toHaveBeenCalled(); expect(deps.generate).not.toHaveBeenCalled(); expect(deps.readings.readFocus).not.toHaveBeenCalled();
  });
});
