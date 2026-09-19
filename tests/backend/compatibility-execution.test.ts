import { describe, expect, it, vi } from 'vitest';
import { createCompatibilityActionExecutor, type CompatibilityDependencies, type SajuCompatibilityRequest } from '../../supabase/functions/_shared/orchestration/compatibility.ts';
import { calculateFullSaju } from '../../supabase/functions/_shared/domain/full-saju.ts';
import { calculateSajuCompatibility, buildCompatibilityInterpretationData } from '../../supabase/functions/_shared/domain/saju-compatibility.ts';
import type { CompatibilitySnapshot, CompatibilityClaim } from '../../supabase/functions/_shared/persistence/compatibility.ts';
import { ApiFailure } from '../../supabase/functions/_shared/http/errors.ts';

const id = '40000000-0000-4000-8000-000000000001';
const inputA = { calendarType: 'SOLAR' as const, leapMonth: false, birthDate: '1992-10-24', birthTime: '05:30', birthTimeUnknown: false,
  location: { name: '서울', country: '대한민국', latitude: 37.5665, longitude: 126.978, timezone: 'Asia/Seoul' }, gender: 'MALE' as const };
const inputB = { ...inputA, birthDate: '1995-08-21', birthTime: '08:20', gender: 'FEMALE' as const,
  location: { ...inputA.location, name: '부산', latitude: 35.1796, longitude: 129.0756 } };
const personA = calculateFullSaju(inputA), personB = calculateFullSaju(inputB);
const result = calculateSajuCompatibility({ personA, personB });
const snapshot: CompatibilitySnapshot = { compatibilityReadingId: 'saved-compatibility', conversationId: id, consultationId: id, result, interpretation: null };
const claim: CompatibilityClaim = { executionId: 'execution', characterId: 'ARANG', conversationId: id, consultationId: id };
const request: Extract<SajuCompatibilityRequest, { action: 'CALCULATE_SAJU' }> = { schemaVersion: 1, requestId: id, action: 'CALCULATE_SAJU', conversationId: id, consultationId: null,
  personA: { input: inputA, saveProfile: false }, personB: { input: inputB, alias: '민지', saveRelatedPerson: false } };
const user = { id: 'owner', isAnonymous: true };
function fixture() {
  const deps: CompatibilityDependencies = {
    readings: { begin: vi.fn().mockResolvedValue(claim), save: vi.fn().mockResolvedValue(snapshot), readRelatedBirthProfile: vi.fn().mockResolvedValue({ input: inputB, alias: '민지' }) },
    births: { readUserBirthProfile: vi.fn().mockResolvedValue(inputA) },
    executions: { complete: vi.fn().mockImplementation(async input => input.data), fail: vi.fn().mockResolvedValue(null), context: vi.fn().mockResolvedValue({ recentMessages: [], memories: [], summary: '' }) },
    calculatePerson: vi.fn().mockReturnValueOnce(personA).mockReturnValueOnce(personB), calculateCompatibility: vi.fn().mockReturnValue(result),
    interpretationData: buildCompatibilityInterpretationData,
    generate: vi.fn().mockResolvedValue({ content: '두 사람의 차이를 이야기해 봐요', segments: ['두 사람의 차이를 이야기해 봐요'], metadata: { model: 'configured', promptVersion: 'persona-v1' }, repaired: false }),
    verifyLocation: vi.fn().mockImplementation(async location => location), now: () => new Date('2026-09-20T00:00:00Z'),
  };
  return { deps, execute: createCompatibilityActionExecutor(deps) };
}
describe('compatibility snapshot and partner birth privacy', () => {
  it('persists only derived charts by default and commits before interpretation', async () => {
    const { deps, execute } = fixture(); const response = await execute(request, user);
    expect(deps.readings.save).toHaveBeenCalledWith({ executionId: 'execution', result, personAProfileInput: null, personBProfileInput: null, personBAlias: null, relatedPersonId: null });
    expect(vi.mocked(deps.readings.save).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(deps.generate).mock.invocationCallOrder[0]!);
    const durable = JSON.stringify([vi.mocked(deps.readings.begin).mock.calls, vi.mocked(deps.readings.save).mock.calls, vi.mocked(deps.executions.complete).mock.calls]);
    for (const raw of [inputB.birthDate, inputB.birthTime, inputB.location.name, String(inputB.location.latitude), String(inputB.location.longitude)]) expect(durable).not.toContain(raw);
    const prompt = JSON.stringify(vi.mocked(deps.generate).mock.calls); expect(prompt).not.toContain(inputB.birthDate); expect(prompt).not.toContain(inputB.location.name);
    expect(response.status).toBe(201); expect(response.data).toMatchObject({ compatibilityReadingId: snapshot.compatibilityReadingId, summary: result.summary }); expect(response.data).not.toHaveProperty('result');
  });
  it('uses one server instant for both calculated people', async () => {
    const { deps, execute } = fixture(); await execute(request, user);
    const calls = vi.mocked(deps.calculatePerson).mock.calls;
    expect(calls).toHaveLength(2); expect(calls[0]![1]).toBe(calls[1]![1]); expect(calls[0]![1].toISOString()).toBe('2026-09-20T00:00:00.000Z');
  });
  it('passes partner raw input only to an explicitly consented atomic profile save', async () => {
    const { deps, execute } = fixture(); await execute({ ...request, personB: { ...request.personB, saveRelatedPerson: true } }, user);
    expect(deps.readings.save).toHaveBeenCalledWith(expect.objectContaining({ personAProfileInput: null, personBProfileInput: inputB, personBAlias: '민지', relatedPersonId: null }));
    expect(result).not.toHaveProperty('birthDate'); expect(result.personB).not.toHaveProperty('input');
  });
  it('does not invent a noon hour when either partner reports unknown birth time', async () => {
    const { deps, execute } = fixture(); await execute({ ...request, personB: { ...request.personB, input: { ...inputB, birthTime: null, birthTimeUnknown: true } } }, user);
    expect(vi.mocked(deps.calculatePerson).mock.calls[1]![0]).toMatchObject({ birthTime: null, birthTimeUnknown: true });
  });
  it('loads saved profiles with owner and related-person checks but does not re-save them implicitly', async () => {
    const { deps, execute } = fixture(); await execute({ ...request, personA: { birthProfileId: id, saveProfile: false }, personB: { relatedPersonId: id, saveRelatedPerson: false } }, user);
    expect(deps.births.readUserBirthProfile).toHaveBeenCalledWith(user.id, id); expect(deps.readings.readRelatedBirthProfile).toHaveBeenCalledWith(user.id, id);
    expect(deps.verifyLocation).not.toHaveBeenCalled();
    expect(deps.readings.save).toHaveBeenCalledWith(expect.objectContaining({ personAProfileInput: null, personBProfileInput: null, relatedPersonId: null }));
  });
  it('stops before calculation and persistence when related-person consent is absent', async () => {
    const { deps, execute } = fixture(); vi.mocked(deps.readings.readRelatedBirthProfile).mockRejectedValue(new ApiFailure('FORBIDDEN', 403, '동의 필요'));
    await expect(execute({ ...request, personB: { relatedPersonId: id, saveRelatedPerson: false } }, user)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(deps.calculatePerson).not.toHaveBeenCalled(); expect(deps.readings.save).not.toHaveBeenCalled();
  });
  it('preserves the saved derived result when inference and its failure-status write fail', async () => {
    const { deps, execute } = fixture(); vi.mocked(deps.generate).mockRejectedValue({ code: 'LLM_TIMEOUT' }); vi.mocked(deps.executions.fail).mockRejectedValue(new Error('database unavailable'));
    const response = await execute(request, user);
    expect(response.status).toBe(200); expect(response.data).toMatchObject({ executionStatus: 'PARTIAL', compatibilityReadingId: snapshot.compatibilityReadingId, summary: result.summary, interpretation: null, partialError: { code: 'COMPATIBILITY_INTERPRETATION_FAILED' } });
  });
  it('retries interpretation from the stored compatibility result without resolving or recalculating either person', async () => {
    const { deps, execute } = fixture(); vi.mocked(deps.readings.begin).mockResolvedValue({ ...claim, resource: snapshot });
    await execute({ schemaVersion: 1, requestId: id, action: 'RETRY_INTERPRETATION', conversationId: id, targetType: 'SAJU', targetId: snapshot.compatibilityReadingId }, user);
    expect(deps.calculatePerson).not.toHaveBeenCalled(); expect(deps.calculateCompatibility).not.toHaveBeenCalled(); expect(deps.verifyLocation).not.toHaveBeenCalled(); expect(deps.readings.save).not.toHaveBeenCalled();
  });
  it('preserves both legacy timing snapshots when retrying compatibility after a timing-rule rollout', async () => {
    const { deps, execute } = fixture();
    const timing = { asOf: '2026-09-19T00:00:00.000Z', precision: 'MINUTE' as const, periodBasis: 'SOLAR_TERM' as const,
      calendarLabel: { year: 2026, month: 9 }, activeDaewoonStatus: 'UNRESOLVED' as const };
    const oldResult = { ...result, personA: { ...result.personA, timing }, personB: { ...result.personB, timing },
      summary: { ...result.summary, timing: { ...result.summary.timing,
        personA: { ...result.summary.timing.personA, metadata: timing }, personB: { ...result.summary.timing.personB, metadata: timing } } } };
    const old = { ...snapshot, result: oldResult };
    vi.mocked(deps.readings.begin).mockResolvedValue({ ...claim, resource: old });
    const before = JSON.stringify(old);
    const response = await execute({ schemaVersion: 1, requestId: id, action: 'RETRY_INTERPRETATION', conversationId: id, targetType: 'SAJU', targetId: old.compatibilityReadingId }, user);
    expect(response.data).toMatchObject({ summary: { timing: { personA: { metadata: timing }, personB: { metadata: timing } } } });
    expect(deps.calculatePerson).not.toHaveBeenCalled(); expect(deps.calculateCompatibility).not.toHaveBeenCalled();
    expect(deps.readings.save).not.toHaveBeenCalled(); expect(JSON.stringify(old)).toBe(before);
  });
});
