import type { FullSajuResult } from '../domain/full-saju.ts';
import type { SajuBirthInput } from '../domain/saju.ts';
import type { PersonaReply } from '../llm/reply.ts';
import type { PersonaPromptInput } from '../persona/prompt.ts';
import type { Repository, ClaimedRequest } from '../persistence/repository.ts';
import type { SajuRepository, SajuSnapshot, SajuClaim, SajuFocus } from '../persistence/saju.ts';
import type { AuthenticatedUser, ActionOutput } from '../http/handler.ts';
import { ApiFailure, safeFailure, partialFailureDetails } from '../http/errors.ts';
import { payloadHash, type SajuRequest } from '../validation/requests.ts';
import { verifyLocation } from './location.ts';

export interface SajuDependencies {
  readings: SajuRepository; executions: Pick<Repository, 'complete' | 'fail' | 'context'>;
  calculate(input: SajuBirthInput, asOf: Date): FullSajuResult | Promise<FullSajuResult>;
  interpretationData(result: FullSajuResult): unknown;
  generate(input: PersonaPromptInput): Promise<PersonaReply>;
  verifyLocation?: typeof verifyLocation;
  now?: () => Date;
}
const stemElement: Record<string, string> = { 甲: '木', 乙: '木', 丙: '火', 丁: '火', 戊: '土', 己: '土', 庚: '金', 辛: '金', 壬: '水', 癸: '水' };
export function sajuInlineResult(snapshot: SajuSnapshot) {
  const result = snapshot.result; const dayStem = result.pillars.day?.heavenlyStem;
  return { executionStatus: snapshot.interpretation ? 'SUCCEEDED' as const : 'PARTIAL' as const,
    conversationId: snapshot.conversationId, consultationId: snapshot.consultationId, readingId: snapshot.readingId,
    engineVersion: result.engineVersion, ruleVersion: result.ruleVersion, conventionVersion: result.conventionVersion,
    uncertaintyFlags: result.uncertaintyFlags,
    inlineResult: { dayMaster: dayStem ? `${dayStem}${stemElement[dayStem]}` : null, pillars: result.pillars, elements: result.elements,
      currentFlow: { daewoon: result.daewoon, sewoon: result.sewoon, monthlyFortune: result.monthlyFortune,
        ...(result.timing ? { timing: result.timing } : {}) } },
    interpretation: snapshot.interpretation,
  };
}
export function sajuCalculationFailure(error: unknown): ApiFailure {
  if (error instanceof ApiFailure) return error;
  const domain = error as { code?: string; reason?: string };
  const messages: Record<string, [number, string]> = {
    SAJU_INPUT_INCOMPLETE: [400, '출생 정보를 확인해 주세요.'], SAJU_LOCATION_UNRESOLVED: [400, '출생 도시를 다시 선택해 주세요.'],
    SAJU_CONVENTION_UNSUPPORTED: [422, '지원하지 않는 출생 시각 또는 계산 방식입니다.'], SAJU_CALCULATION_FAILED: [500, '사주 원국을 계산하지 못했습니다.'],
  };
  const rule = domain?.code ? messages[domain.code] : undefined;
  if (!rule) return safeFailure(error);
  return new ApiFailure(domain.code!, rule[0], rule[1], false, typeof domain.reason === 'string' && /^[A-Z0-9_]{1,80}$/.test(domain.reason) ? { reason: domain.reason } : undefined);
}
export function createSajuActionExecutor(dependencies: SajuDependencies) {
  return async (input: Exclude<SajuRequest, { action: 'RESOLVE_LOCATION' }>, user: AuthenticatedUser): Promise<ActionOutput> => {
    const claim: SajuClaim = await dependencies.readings.begin({ user_id: user.id, operation: `saju.${input.action}`, request_id: input.requestId,
      payload_hash: await payloadHash(input), conversation_id: input.conversationId, target_type: 'SAJU',
      ...(input.action === 'CALCULATE' ? { consultation_id: input.consultationId, focus: input.focus ?? 'GENERAL' } : { reading_id: input.readingId }) });
    if (claim.replay) {
      if (claim.replay.error) { const error = claim.replay.error; throw new ApiFailure(error.code, claim.replay.httpStatus, error.message, error.retryable, error.details); }
      return { data: claim.replay.data, status: claim.replay.httpStatus };
    }
    let saved: SajuSnapshot | undefined;
    try {
      let focus: SajuFocus;
      if (input.action === 'RETRY_INTERPRETATION') {
        if (!claim.resource) throw new ApiFailure('NOT_FOUND', 404, '저장된 사주 원국을 찾지 못했습니다.');
        // Resolve the owned original focus before enabling the saved-result fallback.
        focus = await dependencies.readings.readFocus(user.id, { consultationId: claim.resource.consultationId, conversationId: claim.resource.conversationId });
        saved = claim.resource;
      } else {
        focus = input.focus ?? 'GENERAL';
        const verified = input.subject.birthProfileId
          ? await dependencies.readings.readUserBirthProfile(user.id, input.subject.birthProfileId)
          : { ...input.subject.input!, location: await (dependencies.verifyLocation ?? verifyLocation)(input.subject.input!.location) };
        const result = await dependencies.calculate({ ...verified, gender: verified.gender ?? undefined }, dependencies.now?.() ?? new Date());
        if (!result.fullCalculationReady || !result.ruleVersion) throw new ApiFailure('SAJU_CALCULATION_FAILED', 500, '사주 규칙 적용 결과를 확인하지 못했습니다.');
        // TX B: the full immutable deterministic result commits before any LLM call.
        saved = await dependencies.readings.save({ executionId: claim.executionId, result, birthSnapshot: verified,
          profileInput: input.subject.saveProfile ? verified : null });
      }
      const context = await dependencies.executions.context(user.id, { ...claim, resource: undefined } as ClaimedRequest);
      const reply = await dependencies.generate({ ...context, characterId: claim.characterId,
        currentMessage: `사주 상담: ${focus}`,
        currentTask: '저장된 사주 계산 자료만 해석한다. 불확실한 기둥이나 결과를 확정하지 않고, 점술의 상징적 참고임을 유지하며 다음 행동을 제안한다.',
        toolResult: dependencies.interpretationData(saved.result) });
      const data = { ...sajuInlineResult(saved), executionStatus: 'SUCCEEDED', interpretation: { content: reply.content, segments: reply.segments } };
      return { data: await dependencies.executions.complete({ executionId: claim.executionId, content: reply.content, segments: reply.segments,
        model: reply.metadata.model, promptVersion: reply.metadata.promptVersion, data }), status: input.action === 'CALCULATE' ? 201 : 200 };
    } catch (error) {
      const failure = sajuCalculationFailure(error);
      if (saved) {
        if (['NOT_FOUND', 'AUTH_REQUIRED', 'AUTH_EXPIRED', 'FORBIDDEN'].includes(failure.code)) throw failure;
        const partialError = { code: 'SAJU_INTERPRETATION_FAILED', message: '사주 원국은 저장됐지만 해석을 받지 못했습니다.', retryable: true, details: { readingId: saved.readingId, ...partialFailureDetails(failure) } };
        const cached = await dependencies.executions.fail(claim.executionId, partialError, 200).catch(writeError => {
          const writeFailure = safeFailure(writeError);
          if (['NOT_FOUND', 'AUTH_REQUIRED', 'AUTH_EXPIRED', 'FORBIDDEN'].includes(writeFailure.code)) throw writeFailure;
          return null;
        });
        const completed = cached as { executionStatus?: string; interpretation?: SajuSnapshot['interpretation'] } | null;
        if (completed?.executionStatus === 'SUCCEEDED' && completed.interpretation) return { data: sajuInlineResult({ ...saved, interpretation: completed.interpretation }), status: 200 };
        return { data: { ...sajuInlineResult(saved), executionStatus: 'PARTIAL', interpretation: null, partialError }, status: 200 };
      }
      await dependencies.executions.fail(claim.executionId, failure.toJSON(), failure.status).catch(() => null);
      throw failure;
    }
  };
}
