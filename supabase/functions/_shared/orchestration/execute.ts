import type { SupabaseClient } from '@supabase/supabase-js';
import type { ActionRequest, ChatRequest, TarotRequest, CompatibilityRequest, Endpoint, SajuRequest } from '../validation/requests.ts';
import { payloadHash } from '../validation/requests.ts';
import type { AuthenticatedUser, ActionOutput } from '../http/handler.ts';
import { ApiFailure, safeFailure, partialFailureDetails } from '../http/errors.ts';
import { createRepository, type Repository, type ClaimedRequest, type DrawSnapshot, type BeginParams } from '../persistence/repository.ts';
import { drawTarot, buildTarotInterpretationData } from '../domain/tarot.ts';
import { createOpenAICompatibleProvider } from '../llm/provider.ts';
import { createOpenAIBudget } from '../llm/budget.ts';
import { generatePersonaReply, type PersonaReply } from '../llm/reply.ts';
import { extractToolRecommendation, type Recommendation } from '../llm/intent.ts';
import type { PersonaPromptInput } from '../persona/prompt.ts';
import { resolveLocation } from './location.ts';
import { hasMemoryOptOut } from './privacy.ts';
import { createMemoryMaintenance, maintainMemory, MEMORY_PROVIDER_LIMITS } from './memory.ts';
import { createTitleMaintenance, maintainTitles } from './titles.ts';
import { scheduleReplyMaintenance, type MaintenanceTask, type BackgroundRuntime } from './maintenance.ts';
import { buildSajuInterpretationData } from '../domain/full-saju.ts';
import { calculateFullSajuWithTiming } from '../domain/fortune-timing.ts';
import { createSajuRepository } from '../persistence/saju.ts';
import { createSajuActionExecutor } from './saju.ts';
import { createCompatibilityRepository } from '../persistence/compatibility.ts';
import { createCompatibilityActionExecutor, type SajuCompatibilityRequest } from './compatibility.ts';
import { calculateSajuCompatibility, buildCompatibilityInterpretationData } from '../domain/saju-compatibility.ts';
import { databaseFailure } from '../persistence/repository.ts';

export interface ExecutorDependencies {
  repository: Repository;
  generate(input: PersonaPromptInput): Promise<PersonaReply>;
  recommend?(input: Pick<PersonaPromptInput, 'currentMessage' | 'recentMessages'>, user: AuthenticatedUser): Promise<Recommendation | null>;
  resolveLocation?: typeof resolveLocation;
  now?: () => Date;
  afterReply?(user: AuthenticatedUser, claim: ClaimedRequest): void;
  saju?(input: Exclude<SajuRequest, { action: 'RESOLVE_LOCATION' }>, user: AuthenticatedUser): Promise<ActionOutput>;
  compatibility?(input: SajuCompatibilityRequest, user: AuthenticatedUser): Promise<ActionOutput>;
  consumeLocationRateLimit?(userId: string): Promise<void>;
}
export function localDate(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (name: string) => parts.find(item => item.type === name)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
function dataFromDraw(draw: DrawSnapshot) {
  return { executionStatus: draw.interpretation ? 'SUCCEEDED' as const : 'PARTIAL' as const,
    conversationId: draw.conversationId, consultationId: draw.consultationId,
    drawGroupId: draw.drawGroupId, spreadType: draw.spreadType, mode: draw.mode, cards: draw.cards,
    interpretation: draw.interpretation,
    ...(!draw.interpretation ? { partialError: { code: 'TAROT_INTERPRETATION_FAILED', message: '카드는 저장됐지만 해석을 받지 못했습니다.', retryable: true } } : {}),
  };
}
function replayResult(claim: ClaimedRequest): ActionOutput | undefined {
  if (!claim.replay) return undefined;
  if (claim.replay.error) {
    const error = claim.replay.error;
    throw new ApiFailure(error.code, claim.replay.httpStatus, error.message, error.retryable, error.details);
  }
  return { data: claim.replay.data, status: claim.replay.httpStatus };
}
export function createActionExecutor(dependencies: ExecutorDependencies) {
  const repo = dependencies.repository;
  const now = dependencies.now ?? (() => new Date());
  async function finishExisting(claim: ClaimedRequest, draw: DrawSnapshot): Promise<ActionOutput> {
    const data = dataFromDraw(draw);
    return { data: await repo.complete({ executionId: claim.executionId, content: null, segments: [], model: null, promptVersion: null, data }), status: 200 };
  }
  async function chat(input: ChatRequest, user: AuthenticatedUser): Promise<ActionOutput> {
    const claim = await repo.beginChat({ user_id: user.id, operation: `chat.${input.action}`, request_id: input.requestId,
      payload_hash: await payloadHash(input), conversation_id: input.conversationId,
      ...(input.action === 'SEND' ? { consultation_id: input.consultationId, message: input.message } : { retry_message_id: input.userMessageId }),
    });
    const replay = replayResult(claim); if (replay) return replay;
    try {
      if (!claim.userMessage) throw new ApiFailure('INTERNAL_ERROR', 500, '저장된 메시지를 확인하지 못했습니다.', true);
      const context = await repo.context(user.id, claim);
      if (hasMemoryOptOut(claim.userMessage.content)) { context.memories = []; context.summary = ''; }
      // Classification failure is optional guidance loss, never a failed chat or tool execution.
      const recommendation = await dependencies.recommend?.({ currentMessage: claim.userMessage.content, recentMessages: context.recentMessages }, user).catch(() => null) ?? null;
      const reply = await dependencies.generate({ ...context, characterId: claim.characterId,
        currentMessage: claim.userMessage.content, currentMessageId: claim.userMessage.id,
        ...(recommendation ? { currentTask: `현재 이야기에 자연스럽게 답한다. 다음은 서버의 도구 제안이며 실행 결과가 아니다: ${JSON.stringify(recommendation)}. 도구를 사용하기 전 사용자가 직접 선택해야 한다. 필요한 정보가 있으면 핵심 한 가지만 캐릭터 말투로 묻되 정확한 생년월일이나 생시는 채팅에 요구하지 않고 출생 정보 입력 화면으로 안내한다. 준비된 카드나 사주 결과를 꾸미지 않는다.` } : {}),
      });
      const data = { executionStatus: 'SUCCEEDED', conversationId: claim.conversationId, consultationId: claim.consultationId,
        userMessage: { id: claim.userMessage.id, createdAt: claim.userMessage.createdAt },
        assistantMessage: { characterId: claim.characterId, content: reply.content, segments: reply.segments }, recommendation,
      };
      const completed = await repo.complete({ executionId: claim.executionId, content: reply.content, segments: reply.segments,
        model: reply.metadata.model, promptVersion: reply.metadata.promptVersion, data });
      // Maintenance can neither delay this response nor reverse its committed success.
      try { dependencies.afterReply?.(user, claim); } catch { /* Best effort. */ }
      return { data: completed, status: input.action === 'SEND' ? 201 : 200 };
    } catch (error) {
      const failure = safeFailure(error);
      failure.details = { ...failure.details, ...(claim.userMessage ? { userMessageId: claim.userMessage.id } : {}), conversationId: claim.conversationId, consultationId: claim.consultationId };
      // Keep the saved user-message retry pointer even if the status write is temporarily unavailable.
      // The PENDING lease supplies crash recovery when this best-effort update cannot commit.
      await repo.fail(claim.executionId, failure.toJSON(), failure.status).catch(() => null);
      throw failure;
    }
  }
  async function tarot(input: TarotRequest | CompatibilityRequest, user: AuthenticatedUser, endpoint: 'tarot' | 'compatibility'): Promise<ActionOutput> {
    const params: BeginParams = { user_id: user.id, operation: `${endpoint}.${input.action}`, request_id: input.requestId,
      payload_hash: await payloadHash(input), conversation_id: input.conversationId };
    if (input.action === 'DRAW') Object.assign(params, { consultation_id: input.consultationId, question: input.question,
      spread_type: input.spreadType, mode: input.mode, local_date: input.mode === 'DAILY' ? localDate(now(), input.clientTimezone) : null });
    else if (input.action === 'DRAW_TAROT') Object.assign(params, { consultation_id: input.consultationId,
      question: `${input.targetPersonAlias}: ${input.question}`.slice(0, 4_000), spread_type: 'RELATIONSHIP_3', mode: 'NORMAL', local_date: null });
    else if (input.action === 'REDRAW') Object.assign(params, { consultation_id: input.consultationId, source_draw_group_id: input.sourceDrawGroupId });
    else if (input.action === 'RETRY_INTERPRETATION') Object.assign(params, { draw_group_id: 'drawGroupId' in input ? input.drawGroupId : input.targetId });
    else throw new ApiFailure('VALIDATION_ERROR', 400, '지원하지 않는 타로 요청입니다.');
    const claim = await repo.beginFortune(params);
    const replay = replayResult(claim); if (replay) return replay;
    let saved: DrawSnapshot | undefined;
    try {
      const explicitRetry = input.action === 'RETRY_INTERPRETATION';
      if (claim.resource && input.action === 'DRAW' && input.mode === 'DAILY') return await finishExisting(claim, claim.resource);
      if (explicitRetry) {
        if (!claim.resource) throw new ApiFailure('NOT_FOUND', 404, '저장된 카드를 찾지 못했습니다.');
        saved = claim.resource;
      } else {
        if (input.action === 'REDRAW' && (!claim.source || claim.source.mode === 'DAILY')) {
          throw new ApiFailure(claim.source ? 'TAROT_DAILY_REDRAW_NOT_ALLOWED' : 'NOT_FOUND', claim.source ? 409 : 404, '다시 뽑을 수 없는 카드입니다.');
        }
        const spreadType = input.action === 'REDRAW' ? claim.source!.spreadType : params.spread_type!;
        const question = input.action === 'REDRAW' ? claim.source!.question : params.question!;
        const mode = input.action === 'REDRAW' ? 'NORMAL' : params.mode!;
        // This is the only engine invocation: retry and persisted resource recovery never reach it.
        const cards = drawTarot(spreadType);
        saved = await repo.saveDraw({ executionId: claim.executionId, cards, spreadType, mode,
          localDate: params.local_date ?? null, question, ...(input.action === 'REDRAW' ? { sourceDrawGroupId: input.sourceDrawGroupId } : {}) });
        if ((saved as DrawSnapshot & { reused?: boolean }).reused) return await finishExisting(claim, saved);
      }
      const context = await repo.context(user.id, claim);
      const reply = await dependencies.generate({ ...context, characterId: claim.characterId, currentMessage: saved.question,
        currentTask: '저장된 타로 결과를 사용자의 질문과 연결해 캐릭터 말투로 해석하고, 구체적인 다음 행동을 하나 제안한다.',
        toolResult: { drawGroupId: saved.drawGroupId, spreadType: saved.spreadType, cards: buildTarotInterpretationData(saved.cards) },
      });
      const data = { ...dataFromDraw(saved), executionStatus: 'SUCCEEDED', interpretation: { content: reply.content, segments: reply.segments } };
      delete (data as Record<string, unknown>).partialError;
      return { data: await repo.complete({ executionId: claim.executionId, content: reply.content, segments: reply.segments,
        model: reply.metadata.model, promptVersion: reply.metadata.promptVersion, data }), status: explicitRetry ? 200 : 201 };
    } catch (error) {
      const failure = safeFailure(error);
      if (saved) {
        // A durable result can disappear while inference is running. Authority
        // loss takes precedence over returning our previously read snapshot.
        if (['NOT_FOUND', 'AUTH_REQUIRED', 'AUTH_EXPIRED', 'FORBIDDEN'].includes(failure.code)) throw failure;
        const partialError = { code: endpoint === 'compatibility' ? 'COMPATIBILITY_INTERPRETATION_FAILED' : 'TAROT_INTERPRETATION_FAILED', message: '카드는 저장됐지만 해석을 받지 못했습니다.', retryable: true,
          details: { drawGroupId: saved.drawGroupId, ...partialFailureDetails(failure) } };
        // TX B already committed PARTIAL + its resource pointer. Never hide those cards merely
        // because the follow-up failure-status write is unavailable.
        const cached = await repo.fail(claim.executionId, partialError, 200).catch(writeError => {
          const writeFailure = safeFailure(writeError);
          if (['NOT_FOUND', 'AUTH_REQUIRED', 'AUTH_EXPIRED', 'FORBIDDEN'].includes(writeFailure.code)) throw writeFailure;
          return null;
        });
        return { data: cached ?? { ...dataFromDraw(saved), executionStatus: 'PARTIAL', interpretation: null, partialError }, status: 200 };
      }
      await repo.fail(claim.executionId, failure.toJSON(), failure.status).catch(() => null);
      throw failure;
    }
  }
  return async (endpoint: Endpoint, input: ActionRequest, user: AuthenticatedUser): Promise<ActionOutput> => {
    if (endpoint === 'account' && input.action === 'DELETE_ACCOUNT') {
      await repo.deleteAccount(user.id); return { data: { deleted: true } };
    }
    if (endpoint === 'chat' && (input.action === 'SEND' || input.action === 'RETRY_RESPONSE')) return chat(input, user);
    if (endpoint === 'tarot') return tarot(input as TarotRequest, user, 'tarot');
    if (endpoint === 'compatibility' && (input.action === 'DRAW_TAROT' || (input.action === 'RETRY_INTERPRETATION' && 'targetType' in input && input.targetType === 'TAROT'))) return tarot(input, user, 'compatibility');
    if (endpoint === 'saju' && input.action === 'RESOLVE_LOCATION') {
      if (!dependencies.consumeLocationRateLimit) throw new ApiFailure('INTERNAL_ERROR', 503, '도시 검색 요청 제한 설정이 필요합니다.', false);
      await dependencies.consumeLocationRateLimit(user.id);
      return { data: await (dependencies.resolveLocation ?? resolveLocation)(input.query, input.limit) };
    }
    if (endpoint === 'saju' && (input.action === 'CALCULATE' || input.action === 'RETRY_INTERPRETATION')) {
      if (!dependencies.saju) throw new ApiFailure('SAJU_CALCULATION_FAILED', 500, '사주 계산 연결 설정이 필요합니다.', false, { reason: 'NOT_CONFIGURED' });
      return dependencies.saju(input as Exclude<SajuRequest, { action: 'RESOLVE_LOCATION' }>, user);
    }
    if (endpoint === 'compatibility' && (input.action === 'CALCULATE_SAJU' || input.action === 'RETRY_INTERPRETATION' && 'targetType' in input && input.targetType === 'SAJU')) {
      if (!dependencies.compatibility) throw new ApiFailure('COMPATIBILITY_CALCULATION_FAILED', 500, '궁합 계산 연결 설정이 필요합니다.', false, { reason: 'NOT_CONFIGURED' });
      return dependencies.compatibility(input as SajuCompatibilityRequest, user);
    }
    if (endpoint === 'saju' || endpoint === 'compatibility') {
      // Compatibility is a separate deterministic engine, not an invented score from Saju.
      throw new ApiFailure(endpoint === 'saju' ? 'SAJU_CALCULATION_FAILED' : 'COMPATIBILITY_CALCULATION_FAILED', 500,
        '궁합 계산 연결 설정이 필요합니다.', false, { reason: 'NOT_CONFIGURED' });
    }
    throw new ApiFailure('VALIDATION_ERROR', 400, '지원하지 않는 요청입니다.');
  };
}
export function createExecutor(client: SupabaseClient, environment: (name: string) => string | undefined) {
  const repository = createRepository(client);
  return async (endpoint: Endpoint, request: ActionRequest, user: AuthenticatedUser, deadlineAt = Date.now() + 100_000): Promise<ActionOutput> => {
    const providerConfig = (allowPaidFallback = false) => ({ baseUrl: environment('LLM_BASE_URL') ?? '', model: environment('LLM_MODEL') ?? '', apiKey: environment('LLM_API_KEY'),
      structuredFormat: environment('LLM_STRUCTURED_FORMAT') === 'json_object' ? 'json_object' as const : 'json_schema' as const,
      ...(allowPaidFallback && environment('LLM_FALLBACK_ENABLED') === 'true' ? { fallback: {
        baseUrl: environment('LLM_FALLBACK_BASE_URL') ?? '', model: environment('LLM_FALLBACK_MODEL') ?? '', apiKey: environment('LLM_FALLBACK_API_KEY') ?? '',
        reserve: createOpenAIBudget(client),
      } } : {}) });
    const generate = (input: PersonaPromptInput) => {
      // Lazy initialization preserves the authoritative draw even when inference is unconfigured.
      const provider = createOpenAICompatibleProvider({ ...providerConfig(true), ...inferenceTimeouts(deadlineAt) });
      return generatePersonaReply(provider, input);
  };
  const saju = createSajuActionExecutor({ readings: createSajuRepository(client), executions: repository, calculate: calculateFullSajuWithTiming,
    interpretationData: buildSajuInterpretationData, generate });
  const compatibility = createCompatibilityActionExecutor({ readings: createCompatibilityRepository(client), births: createSajuRepository(client), executions: repository,
    calculatePerson: calculateFullSajuWithTiming, calculateCompatibility: calculateSajuCompatibility,
    interpretationData: buildCompatibilityInterpretationData, generate });
  return createActionExecutor({ repository, generate, saju, compatibility,
    async recommend(input, currentUser) {
      if (environment('TOOL_RECOMMENDATIONS_ENABLED') === 'false' || deadlineAt - Date.now() < 25_000) return null;
      const ownBirth = await client.from('birth_profiles').select('id').eq('user_id', currentUser.id).eq('owner_type', 'USER').limit(1).maybeSingle();
      const provider = createOpenAICompatibleProvider({ ...providerConfig(), initialTimeoutMs: 8_000, repairTimeoutMs: 3_000, maxOutputTokens: 350 });
      // A saved unrelated person's profile must not be treated as the intended partner.
      // Chat has no selected relatedPersonId; the explicit tool form resolves that identity.
      return extractToolRecommendation(provider, { ...input, hasOwnBirthData: !ownBirth.error && Boolean(ownBirth.data), hasPartnerBirthData: false });
    },
    async consumeLocationRateLimit(userId) {
      const { error } = await client.rpc('consume_location_rate_limit', { p_user_id: userId });
      if (error) throw databaseFailure(error);
    },
    afterReply(user, claim) {
      const runtime = (globalThis as unknown as { EdgeRuntime?: BackgroundRuntime }).EdgeRuntime;
      const work: MaintenanceTask[] = [];
      if (environment('MEMORY_MAINTENANCE_ENABLED') !== 'false') {
        work.push({ task: 'MEMORY', run: async () => {
          const provider = createOpenAICompatibleProvider({ ...providerConfig(), ...MEMORY_PROVIDER_LIMITS });
          await maintainMemory(createMemoryMaintenance(client, provider), user.id, claim.conversationId, claim.characterId);
        } });
      }
      if (environment('TITLE_GENERATION_ENABLED') !== 'false') {
        work.push({ task: 'TITLE', run: async () => {
          const provider = createOpenAICompatibleProvider({ ...providerConfig(), initialTimeoutMs: 8_000, repairTimeoutMs: 3_000, maxOutputTokens: 120 });
          await maintainTitles(createTitleMaintenance(client, provider), user.id, claim.conversationId, claim.consultationId);
        } });
      }
      scheduleReplyMaintenance(runtime, work);
    },
  })(endpoint, request, user);
  };
}

/** Reserve ten seconds for the final database write, within the total request budget. */
export function inferenceTimeouts(deadlineAt: number, now = Date.now()) {
  const remaining = Math.min(90_000, deadlineAt - now - 10_000);
  if (!Number.isFinite(remaining) || remaining < 2_000) throw new ApiFailure('LLM_TIMEOUT', 504, '응답 생성 시간이 초과되었습니다.', true);
  const initialTimeoutMs = Math.floor(remaining * 2 / 3);
  return { initialTimeoutMs, repairTimeoutMs: Math.floor(remaining - initialTimeoutMs) };
}
