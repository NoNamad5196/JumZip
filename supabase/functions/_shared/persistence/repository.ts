import type { SupabaseClient } from '@supabase/supabase-js';
import type { CharacterId, ApiError, SpreadType, TarotCard } from '../contracts/index.ts';
import type { ContextMessage, ContextMemory } from '../persona/context.ts';
import type { RelationshipState } from '../persona/config.ts';
import { hasBlockedRelatedAlias } from '../persona/memory.ts';
import { buildTarotInterpretationData } from '../domain/tarot.ts';
import { buildSajuInterpretationData, type FullSajuResult } from '../domain/full-saju.ts';
import { buildCompatibilityInterpretationData, type SajuCompatibilityResult } from '../domain/saju-compatibility.ts';
import { ApiFailure } from '../http/errors.ts';

export interface DrawSnapshot {
  drawGroupId: string; consultationId: string; conversationId?: string;
  spreadType: SpreadType; mode: 'NORMAL' | 'DAILY'; question: string;
  cards: readonly TarotCard[];
  interpretation: { messageId: string; content: string; segments?: string[] } | null;
  executionStatus?: 'PARTIAL' | 'SUCCEEDED';
}
export interface ClaimedRequest {
  executionId: string; conversationId: string; characterId: CharacterId; consultationId: string;
  userMessage?: { id: string; content: string; createdAt: string };
  resource?: DrawSnapshot;
  source?: DrawSnapshot;
  replay?: { data?: unknown; error?: ApiError; httpStatus: number };
}
export interface BeginParams {
  user_id: string; operation: string; request_id: string; payload_hash: string; conversation_id: string;
  consultation_id?: string | null; message?: string; retry_message_id?: string; draw_group_id?: string;
  source_draw_group_id?: string; question?: string; spread_type?: SpreadType; mode?: 'NORMAL' | 'DAILY'; local_date?: string | null;
}
export interface SaveDrawParams {
  executionId: string; cards: readonly TarotCard[]; spreadType: SpreadType; mode: 'NORMAL' | 'DAILY'; localDate: string | null;
  question: string; sourceDrawGroupId?: string;
}
export interface CompleteParams {
  executionId: string; content: string | null; segments: string[]; model: string | null; promptVersion: string | null; data: unknown;
}
export interface Repository {
  beginChat(params: BeginParams): Promise<ClaimedRequest>;
  beginFortune(params: BeginParams): Promise<ClaimedRequest>;
  saveDraw(params: SaveDrawParams): Promise<DrawSnapshot>;
  complete(params: CompleteParams): Promise<unknown>;
  fail(executionId: string, error: ApiError, httpStatus: number): Promise<unknown | null>;
  context(userId: string, claim: ClaimedRequest): Promise<{ recentMessages: ContextMessage[]; summary: string; memories: ContextMemory[]; toolResult?: unknown; relationshipState?: RelationshipState }>;
  deleteAccount(userId: string): Promise<void>;
}
const rpcCodes: Record<string, { status: number; message: string; retryable?: boolean }> = {
  VALIDATION_ERROR: { status: 400, message: '입력값을 확인해 주세요.' },
  AUTH_REQUIRED: { status: 401, message: '인증이 필요합니다.' }, AUTH_EXPIRED: { status: 401, message: '인증이 만료되었습니다.' },
  FORBIDDEN: { status: 403, message: '접근할 수 없는 요청입니다.' }, NOT_FOUND: { status: 404, message: '상담을 찾지 못했습니다.' },
  RATE_LIMITED: { status: 429, message: '잠시 후 다시 시도해 주세요.', retryable: true },
  IDEMPOTENCY_KEY_REUSED: { status: 409, message: '다른 내용으로 사용된 요청 번호입니다.' },
  REQUEST_IN_PROGRESS: { status: 409, message: '같은 요청이 처리 중입니다.', retryable: true },
  CONFLICT: { status: 409, message: '현재 상태에서는 요청을 진행할 수 없습니다.' },
  TAROT_DAILY_REDRAW_NOT_ALLOWED: { status: 409, message: '오늘의 타로는 다시 뽑을 수 없습니다.' },
  LLM_TIMEOUT: { status: 504, message: '응답 생성 시간이 초과되었습니다.', retryable: true },
  LLM_UNAVAILABLE: { status: 502, message: '응답 서비스에 연결하지 못했습니다.', retryable: true },
  LLM_INVALID_RESPONSE: { status: 502, message: '응답 형식을 확인하지 못했습니다.', retryable: true },
  TAROT_DRAW_FAILED: { status: 500, message: '카드를 저장하지 못했습니다.', retryable: true },
  SAJU_INPUT_INCOMPLETE: { status: 400, message: '출생 정보를 확인해 주세요.' },
  SAJU_LOCATION_UNRESOLVED: { status: 400, message: '출생 도시를 다시 선택해 주세요.' },
  SAJU_CONVENTION_UNSUPPORTED: { status: 422, message: '지원하지 않는 출생 시각 또는 계산 방식입니다.' },
  SAJU_CALCULATION_FAILED: { status: 500, message: '사주 계산 결과를 저장하지 못했습니다.', retryable: true },
  COMPATIBILITY_INPUT_INCOMPLETE: { status: 400, message: '궁합에 필요한 출생 정보를 확인해 주세요.' },
  COMPATIBILITY_CALCULATION_FAILED: { status: 500, message: '궁합 계산 결과를 저장하지 못했습니다.', retryable: true },
  INTERNAL_ERROR: { status: 500, message: '요청을 처리하지 못했습니다.', retryable: true },
};
export function databaseFailure(error: { message?: string; code?: string; details?: string }): ApiFailure {
  const rule = rpcCodes[error.message ?? ''];
  if (rule) {
    const details: Record<string, unknown> = {};
    // SQL error details are still untrusted: whitelist only safe retry pointers, never row/payload text.
    try {
      const parsed = JSON.parse(error.details ?? '{}') as Record<string, unknown>;
      for (const key of ['userMessageId', 'drawGroupId', 'readingId', 'compatibilityReadingId', 'consultationId', 'executionId']) {
        if (typeof parsed[key] === 'string' && /^[0-9a-f-]{36}$/i.test(parsed[key])) details[key] = parsed[key];
      }
      if (typeof parsed.retryAfterSeconds === 'number' && parsed.retryAfterSeconds >= 0) details.retryAfterSeconds = parsed.retryAfterSeconds;
    } catch { /* Do not expose raw SQL details. */ }
    return new ApiFailure(error.message!, rule.status, rule.message, rule.retryable, Object.keys(details).length ? details : undefined);
  }
  return new ApiFailure('INTERNAL_ERROR', 500, '상담 데이터를 처리하지 못했습니다.', true);
}
export function createRepository(client: SupabaseClient): Repository {
  const rpc = async <T>(name: string, parameters: Record<string, unknown>): Promise<T> => {
    const { data, error } = await client.rpc(name, parameters);
    if (error) throw databaseFailure(error);
    return data as T;
  };
  return {
    beginChat: params => rpc<ClaimedRequest>('begin_chat_request', { p_params: params }),
    beginFortune: params => rpc<ClaimedRequest>('begin_fortune_request', { p_params: params }),
    saveDraw: params => rpc<DrawSnapshot>('save_tarot_draw', {
      p_execution_id: params.executionId, p_cards: params.cards, p_spread_type: params.spreadType,
      p_mode: params.mode, p_local_date: params.localDate, p_question: params.question,
      p_source_draw_group_id: params.sourceDrawGroupId ?? null,
    }),
    complete: params => rpc('complete_execution', { p_execution_id: params.executionId,
      p_assistant_content: params.content, p_segments: params.segments, p_model_id: params.model,
      p_prompt_version: params.promptVersion, p_data: params.data,
    }),
    fail: (executionId, error, httpStatus) => rpc('fail_execution', { p_execution_id: executionId, p_error: error, p_http_status: httpStatus }),
    async context(userId, claim) {
      // These service-role reads have explicit owner and fixed conversation filters.
      const [turns, conversation, profile, memoryPrivacy] = await Promise.all([
        client.from('messages').select('created_at').eq('user_id', userId).eq('conversation_id', claim.conversationId).eq('sender', 'USER').order('created_at', { ascending: false }).order('id', { ascending: false }).limit(17),
        client.from('conversations').select('summary,relationship_state').eq('user_id', userId).eq('id', claim.conversationId).single(),
        client.from('profiles').select('memory_enabled').eq('id', userId).single(),
        // RPC aggregation supplies the complete owner-scoped list without the
        // PostgREST table row cap silently dropping a known blocked identity.
        client.rpc('memory_context_state', { p_user_id: userId, p_conversation_id: claim.conversationId }),
      ]);
      if (turns.error || conversation.error || profile.error || memoryPrivacy.error || !Array.isArray(memoryPrivacy.data?.blockedRelatedPeople)) throw new ApiFailure('INTERNAL_ERROR', 500, '대화 맥락을 불러오지 못했습니다.', true);
      const blocked = memoryPrivacy.data.blockedRelatedPeople as { id: string; alias: string }[];
      const blockedSubjects = new Set(blocked.map(person => `RELATED_PERSON:${person.id}`));
      let messageQuery = client.from('messages').select('id,sender,content,created_at').eq('user_id', userId).eq('conversation_id', claim.conversationId).order('created_at', { ascending: false }).order('id', { ascending: false });
      const earliest = turns.data?.at(-1)?.created_at;
      if (earliest) messageQuery = messageQuery.gte('created_at', earliest);
      const selectedMemories = (scope: 'GLOBAL' | 'CHARACTER', limit: number) => {
        if (!profile.data?.memory_enabled) return Promise.resolve({ data: [], error: null });
        let query = client.from('memories').select('id,scope,character_id,content,category,subject,importance,updated_at,disabled_at')
          .eq('user_id', userId).eq('scope', scope).is('disabled_at', null);
        if (scope === 'CHARACTER') query = query.eq('character_id', claim.characterId);
        return query.order('importance', { ascending: false }).order('updated_at', { ascending: false }).order('id', { ascending: true }).limit(limit);
      };
      const [messages, globalMemories, characterMemories, tool] = await Promise.all([
        messageQuery.limit(200),
        selectedMemories('GLOBAL', 4),
        selectedMemories('CHARACTER', 2),
        client.from('messages').select('metadata').eq('user_id', userId).eq('conversation_id', claim.conversationId)
          .eq('consultation_id', claim.consultationId).in('type', ['TAROT', 'TAROT_DRAW', 'SAJU', 'SAJU_SNAPSHOT', 'COMPATIBILITY', 'COMPATIBILITY_SAJU', 'COMPATIBILITY_SNAPSHOT']).order('created_at', { ascending: false }).limit(1),
      ]);
      if (messages.error || globalMemories.error || characterMemories.error || tool.error) throw new ApiFailure('INTERNAL_ERROR', 500, '대화 맥락을 불러오지 못했습니다.', true);
      const snapshot = tool.data?.[0]?.metadata?.tarot as DrawSnapshot | undefined;
      let toolResult: unknown = snapshot?.cards ? { drawGroupId: snapshot.drawGroupId, spreadType: snapshot.spreadType, cards: buildTarotInterpretationData(snapshot.cards) } : undefined;
      const readingId = tool.data?.[0]?.metadata?.saju?.readingId;
      if (typeof readingId === 'string') {
        const reading = await client.from('saju_readings').select('result_snapshot').eq('user_id', userId).eq('consultation_id', claim.consultationId).eq('id', readingId).maybeSingle();
        if (reading.error) throw new ApiFailure('INTERNAL_ERROR', 500, '저장된 사주 자료를 불러오지 못했습니다.', true);
        if (reading.data?.result_snapshot) toolResult = buildSajuInterpretationData(reading.data.result_snapshot as FullSajuResult);
      }
      const compatibilityId = tool.data?.[0]?.metadata?.compatibility?.compatibilityReadingId;
      if (typeof compatibilityId === 'string') {
        const reading = await client.from('saju_compatibility_readings').select('result_snapshot').eq('user_id', userId).eq('consultation_id', claim.consultationId).eq('id', compatibilityId).maybeSingle();
        if (reading.error) throw new ApiFailure('INTERNAL_ERROR', 500, '저장된 궁합 자료를 불러오지 못했습니다.', true);
        if (reading.data?.result_snapshot) toolResult = buildCompatibilityInterpretationData(reading.data.result_snapshot as SajuCompatibilityResult);
      }
      return {
        relationshipState: parseRelationshipStage(conversation.data?.relationship_state),
        recentMessages: [...(messages.data ?? [])].reverse().filter(row => ['USER', 'ASSISTANT'].includes(row.sender)).map(row => ({ id: row.id, role: row.sender.toLowerCase() as 'user' | 'assistant', content: row.content })),
        summary: profile.data?.memory_enabled && !hasBlockedRelatedAlias(conversation.data?.summary ?? '', blocked) ? conversation.data?.summary ?? '' : '',
        // A pre-existing row may have been attributed to USER before this alias
        // became a known non-consenting person. Exclude it without deleting it.
        memories: [...(globalMemories.data ?? []), ...(characterMemories.data ?? [])]
          .filter(row => !blockedSubjects.has(row.subject) && !hasBlockedRelatedAlias(row.content, blocked))
          .map(row => ({ id: row.id, scope: row.scope, characterId: row.character_id, content: row.content, category: row.category, subject: row.subject, importance: row.importance, updatedAt: row.updated_at, disabled: Boolean(row.disabled_at) })),
        ...(toolResult ? { toolResult } : {}),
      };
    },
    async deleteAccount(userId) {
      const { error } = await client.auth.admin.deleteUser(userId, false);
      if (error) throw new ApiFailure('ACCOUNT_DELETE_FAILED', 500, '계정을 삭제하지 못했습니다.', false);
    },
  };
}
export function parseRelationshipStage(value: unknown): RelationshipState {
  const stage = value && typeof value === 'object' && 'stage' in value ? value.stage : undefined;
  return typeof stage === 'string' && ['FIRST_MEETING', 'ACQUAINTANCE', 'FAMILIAR', 'CLOSE'].includes(stage) ? stage as RelationshipState : 'FIRST_MEETING';
}
