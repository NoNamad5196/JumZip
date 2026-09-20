import type { FullSajuResult } from '../domain/full-saju.ts';
import type { SajuBirthInput } from '../domain/saju.ts';
import type { SajuCompatibilityResult } from '../domain/saju-compatibility.ts';
import type { PersonaReply } from '../llm/reply.ts';
import type { PersonaPromptInput } from '../persona/prompt.ts';
import type { Repository, ClaimedRequest } from '../persistence/repository.ts';
import type { SajuRepository } from '../persistence/saju.ts';
import type { CompatibilityRepository, CompatibilitySnapshot } from '../persistence/compatibility.ts';
import type { AuthenticatedUser, ActionOutput } from '../http/handler.ts';
import { ApiFailure, safeFailure, partialFailureDetails } from '../http/errors.ts';
import { sajuCalculationFailure } from './saju.ts';
import { payloadHash, type CompatibilityRequest } from '../validation/requests.ts';
import { verifyLocation } from './location.ts';

export type SajuCompatibilityRequest = Extract<CompatibilityRequest, { action: 'CALCULATE_SAJU' }> | (Extract<CompatibilityRequest, { action: 'RETRY_INTERPRETATION' }> & { targetType: 'SAJU' });
export interface CompatibilityDependencies {
  readings: CompatibilityRepository; births: Pick<SajuRepository, 'readUserBirthProfile'>; executions: Pick<Repository, 'complete' | 'fail' | 'context'>;
  calculatePerson(input: SajuBirthInput, asOf: Date): FullSajuResult | Promise<FullSajuResult>;
  calculateCompatibility(input: { personA: FullSajuResult; personB: FullSajuResult }): SajuCompatibilityResult;
  interpretationData(result: SajuCompatibilityResult): unknown; generate(input: PersonaPromptInput): Promise<PersonaReply>;
  verifyLocation?: typeof verifyLocation; now?: () => Date;
}
export function compatibilityInlineResult(snapshot: CompatibilitySnapshot) {
  return { executionStatus: snapshot.interpretation ? 'SUCCEEDED' as const : 'PARTIAL' as const,
    compatibilityReadingId: snapshot.compatibilityReadingId, conversationId: snapshot.conversationId, consultationId: snapshot.consultationId,
    engineVersion: snapshot.result.engineVersion, ruleVersion: snapshot.result.ruleVersion, conventionVersion: snapshot.result.conventionVersion,
    summary: snapshot.result.summary, uncertaintyFlags: snapshot.result.uncertaintyFlags, interpretation: snapshot.interpretation };
}
export function createCompatibilityActionExecutor(dependencies: CompatibilityDependencies) {
  return async (input: SajuCompatibilityRequest, user: AuthenticatedUser): Promise<ActionOutput> => {
    const claim = await dependencies.readings.begin({ user_id: user.id, operation: `compatibility.${input.action}`, request_id: input.requestId,
      payload_hash: await payloadHash(input), conversation_id: input.conversationId,
      ...(input.action === 'CALCULATE_SAJU' ? { consultation_id: input.consultationId } : { reading_id: input.targetId }) });
    if (claim.replay) {
      if (claim.replay.error) { const error = claim.replay.error; throw new ApiFailure(error.code, claim.replay.httpStatus, error.message, error.retryable, error.details); }
      return { data: claim.replay.data, status: claim.replay.httpStatus };
    }
    let saved: CompatibilitySnapshot | undefined;
    try {
      if (input.action === 'RETRY_INTERPRETATION') {
        if (!claim.resource) throw new ApiFailure('NOT_FOUND', 404, '저장된 궁합 결과를 찾지 못했습니다.');
        saved = claim.resource;
      } else {
        const [personAInput, related] = await Promise.all([
          input.personA.birthProfileId ? dependencies.births.readUserBirthProfile(user.id, input.personA.birthProfileId) : Promise.resolve(input.personA.input!),
          input.personB.relatedPersonId ? dependencies.readings.readRelatedBirthProfile(user.id, input.personB.relatedPersonId) : Promise.resolve({ input: input.personB.input!, alias: input.personB.alias ?? '' }),
        ]);
        if (input.personB.saveRelatedPerson && (!related.alias.trim() || related.alias.trim().length > 40)) throw new ApiFailure('COMPATIBILITY_INPUT_INCOMPLETE', 400, '저장할 관련인의 이름을 1~40자로 입력해 주세요.');
        const verify = dependencies.verifyLocation ?? verifyLocation;
        const [aLocation, bLocation] = await Promise.all([
          input.personA.birthProfileId ? personAInput.location : verify(personAInput.location),
          input.personB.relatedPersonId ? related.input.location : verify(related.input.location),
        ]);
        const verifiedA = { ...personAInput, location: aLocation }, verifiedB = { ...related.input, location: bLocation };
        const asOf = dependencies.now?.() ?? new Date();
        const [personA, personB] = await Promise.all([
          dependencies.calculatePerson({ ...verifiedA, gender: verifiedA.gender ?? undefined }, asOf),
          dependencies.calculatePerson({ ...verifiedB, gender: verifiedB.gender ?? undefined }, asOf),
        ]);
        const result = dependencies.calculateCompatibility({ personA, personB });
        // Only derived charts/results are durable by default. Raw partner birth input has no
        // snapshot argument and cannot enter claim/consultation/message metadata.
        saved = await dependencies.readings.save({ executionId: claim.executionId, result,
          personAProfileInput: input.personA.saveProfile ? verifiedA : null,
          personBProfileInput: input.personB.saveRelatedPerson ? verifiedB : null,
          personBAlias: input.personB.saveRelatedPerson ? related.alias.trim() : null,
          relatedPersonId: input.personB.saveRelatedPerson ? input.personB.relatedPersonId ?? null : null });
      }
      const context = await dependencies.executions.context(user.id, { ...claim, resource: undefined } as ClaimedRequest);
      const reply = await dependencies.generate({ ...context, characterId: claim.characterId,
        currentMessage: '두 사람의 저장된 원국으로 관계에서 맞춰 볼 점과 차이를 설명해 주세요.',
        currentTask: '저장된 궁합 계산의 근거만 해석한다. 관계의 성공 확률이나 운명적 결론을 만들지 않고, 불확실성을 유지하며 대화와 행동을 제안한다.',
        toolResult: dependencies.interpretationData(saved.result) });
      const data = { ...compatibilityInlineResult(saved), executionStatus: 'SUCCEEDED', interpretation: { content: reply.content, segments: reply.segments } };
      return { data: await dependencies.executions.complete({ executionId: claim.executionId, content: reply.content, segments: reply.segments,
        model: reply.metadata.model, promptVersion: reply.metadata.promptVersion, data }), status: input.action === 'CALCULATE_SAJU' ? 201 : 200 };
    } catch (error) {
      let failure = sajuCalculationFailure(error);
      if (!saved && failure.code === 'INTERNAL_ERROR') failure = new ApiFailure('COMPATIBILITY_CALCULATION_FAILED', 500, '궁합 계산을 완료하지 못했습니다.', false);
      if (saved) {
        if (['NOT_FOUND', 'AUTH_REQUIRED', 'AUTH_EXPIRED', 'FORBIDDEN'].includes(failure.code)) throw failure;
        const partialError = { code: 'COMPATIBILITY_INTERPRETATION_FAILED', message: '궁합 결과는 저장됐지만 해석을 받지 못했습니다.', retryable: true,
          details: { compatibilityReadingId: saved.compatibilityReadingId, ...partialFailureDetails(failure) } };
        const cached = await dependencies.executions.fail(claim.executionId, partialError, 200).catch(writeError => {
          const writeFailure = safeFailure(writeError);
          if (['NOT_FOUND', 'AUTH_REQUIRED', 'AUTH_EXPIRED', 'FORBIDDEN'].includes(writeFailure.code)) throw writeFailure;
          return null;
        });
        const completed = cached as { executionStatus?: string; interpretation?: CompatibilitySnapshot['interpretation'] } | null;
        if (completed?.executionStatus === 'SUCCEEDED' && completed.interpretation) return { data: compatibilityInlineResult({ ...saved, interpretation: completed.interpretation }), status: 200 };
        return { data: { ...compatibilityInlineResult(saved), executionStatus: 'PARTIAL', interpretation: null, partialError }, status: 200 };
      }
      await dependencies.executions.fail(claim.executionId, failure.toJSON(), failure.status).catch(() => null);
      throw failure;
    }
  };
}
