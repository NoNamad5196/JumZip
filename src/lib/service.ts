import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import type { CharacterId, Envelope } from '../../supabase/functions/_shared/contracts';
export type { CharacterId, Envelope, TarotCard, TarotResult, ChatResult } from '../../supabase/functions/_shared/contracts';
export type { Session };
export type Profile = { id: string; display_name: string; memory_enabled: boolean; preferred_character: CharacterId | null; last_seen_at: string };
export type Conversation = { id: string; character_id: CharacterId; title: string; created_at: string; last_message_at: string | null; relationship_state: Record<string, unknown>; summary: string | null };
export type Message = { id: string; conversation_id: string; consultation_id: string | null; sender: 'USER' | 'ASSISTANT' | 'SYSTEM'; type: string; content: string; request_id: string | null; reply_to_message_id: string | null; metadata: Record<string, any>; created_at: string };
export type Memory = { id: string; content: string; scope: 'GLOBAL' | 'CHARACTER'; character_id: CharacterId | null; category: string; subject: string; disabled_at: string | null; importance: number; created_at: string };
export type ReadingSummary = { id: string; title: string | null; fortune_type: string; result_summary: string | null; created_at: string; conversation_id: string; character_id: CharacterId };
export type ReadingDetail = ReadingSummary & { question: string; tarot_draw_groups: unknown[]; saju_readings: unknown[]; saju_compatibility_readings: unknown[] };
export type HistoryCursor = { createdAt: string; id: string };
export type ConversationCursor = { lastMessageAt: string | null; id: string };
export type HistoryPage<T, C = HistoryCursor> = { items: T[]; nextCursor: C | null };
export type DeletionKind = 'CONSULTATION' | 'CONVERSATION';
export type DeletionOptions = { memoryIds?: string[] };
export type BirthInputValue = { calendarType: 'SOLAR' | 'LUNAR'; leapMonth: boolean; birthDate: string; birthTime?: string | null; birthTimeUnknown: boolean; location: { providerId?: string; name: string; country?: string; latitude: number; longitude: number; timezone: string; provider?: string }; gender?: string | null };
export type BirthProfile = { id: string; owner_type: 'USER' | 'RELATED_PERSON'; related_person_id: string | null; calendar_type: 'SOLAR' | 'LUNAR'; leap_month: boolean; birth_date: string; birth_time: string | null; unknown_birth_time: boolean; city: string; country: string; latitude: number; longitude: number; timezone: string; location_provider_id: string | null; gender: string | null };
export type RelatedPerson = { id: string; display_name: string; relation: string | null; gender: string | null; memory_opt_in: boolean };
export const capabilities = { sajuFull: true, tarot: true, memory: true, compatibilityTarot: true, compatibilitySaju: true } as const;
export class ServiceError extends Error {
  constructor(public code: string, message: string, public retryable = false, public details?: Record<string, unknown>) { super(message); this.name = 'ServiceError'; }
}
const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
export const captchaSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY?.trim() || '';
export const authProviders = {
  google: import.meta.env.VITE_AUTH_GOOGLE_ENABLED === 'true',
  email: import.meta.env.VITE_AUTH_EMAIL_ENABLED === 'true',
} as const;
export const supabase: SupabaseClient | null = url && anonKey ? createClient(url, anonKey, { auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }) : null;
function db(): SupabaseClient { if (!supabase) throw new ServiceError('NOT_CONFIGURED', '서비스 연결을 준비하고 있어요. 잠시 후 다시 방문해 주세요.'); return supabase; }
function check(error: { message: string; code?: string } | null) {
  if (!error) return;
  const message = error.code === 'captcha_failed'
    ? '보안 확인을 완료하지 못했어요. 새 확인 절차를 마친 뒤 다시 시도해 주세요.'
    : '정보를 불러오거나 저장하지 못했어요. 다시 시도해 주세요.';
  throw new ServiceError(error.code || 'DATABASE_ERROR', message, true);
}
async function userId() { const session = await service.getSession(); if (!session) throw new ServiceError('UNAUTHORIZED', '먼저 시작 화면에서 로그인해 주세요.'); return session.user.id; }
async function touch() { const { error } = await db().rpc('touch_activity'); check(error); }
function isEnvelope(value: unknown): value is Envelope<unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>, meta = result.meta as Record<string, unknown> | undefined;
  if (!meta || typeof meta !== 'object' || meta.schemaVersion !== 1 || typeof meta.requestId !== 'string' || typeof meta.createdAt !== 'string') return false;
  if (result.ok === true) return Object.hasOwn(result, 'data');
  if (result.ok !== false || !result.error || typeof result.error !== 'object' || Array.isArray(result.error)) return false;
  const error = result.error as Record<string, unknown>;
  return typeof error.code === 'string' && typeof error.message === 'string' && typeof error.retryable === 'boolean';
}
function pageLimit(value: number) { return Number.isFinite(value) ? Math.min(200, Math.max(1, Math.floor(value))) : 100; }
function cursorId(value: string) {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) throw new ServiceError('INVALID_CURSOR', '기록을 새로 불러와 주세요.');
  return value;
}
function cursorDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new ServiceError('INVALID_CURSOR', '기록을 새로 불러와 주세요.');
  return `"${value}"`;
}
function olderThan(cursor: HistoryCursor) {
  const at = cursorDate(cursor.createdAt), id = cursorId(cursor.id);
  return `created_at.lt.${at},and(created_at.eq.${at},id.lt.${id})`;
}
function datedPage<T extends { id: string; created_at: string }>(rows: T[], limit: number): HistoryPage<T> {
  const items = rows.slice(0, limit), last = items.at(-1);
  return { items, nextCursor: rows.length > limit && last ? { createdAt: last.created_at, id: last.id } : null };
}
// PostgREST quoted filter values preserve commas, parentheses, quotes and backslashes.
function literalSearch(value: string) {
  const pattern = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return `"${pattern.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
async function messagesPage(column: 'conversation_id' | 'consultation_id', id: string, before: HistoryCursor | null, pageSize: number): Promise<HistoryPage<Message>> {
  const limit = pageLimit(pageSize);
  let query = db().from('messages').select('*').eq(column, id).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit + 1);
  if (before) query = query.or(olderThan(before));
  const { data, error } = await query; check(error);
  const page = datedPage<Message>(data || [], limit);
  return { ...page, items: page.items.reverse() };
}
export const service = {
  configured: !!supabase,
  captchaConfigured: !!captchaSiteKey,
  authProviders,
  capabilities,
  async getSession(): Promise<Session | null> { if (!supabase) return null; const { data, error } = await supabase.auth.getSession(); check(error); return data.session; },
  onAuthStateChange(callback: (session: Session | null) => void) { if (!supabase) return () => {}; const { data } = supabase.auth.onAuthStateChange((_event, session) => callback(session)); return () => data.subscription.unsubscribe(); },
  async signInAnonymously(captchaToken?: string) { const { data, error } = await db().auth.signInAnonymously({ options: { captchaToken } }); check(error); return data.session; },
  async signInWithOtp(email: string, captchaToken?: string) { const { error } = await db().auth.signInWithOtp({ email, options: { emailRedirectTo: `${location.origin}/auth`, shouldCreateUser: true, captchaToken } }); check(error); },
  async verifyOtp(email: string, token: string) { const { data, error } = await db().auth.verifyOtp({ email, token, type: 'email' }); check(error); return data.session; },
  async linkEmail(email: string) { const { error } = await db().auth.updateUser({ email }, { emailRedirectTo: `${location.origin}/auth` }); check(error); },
  async linkOAuth(provider: 'google' | 'github') { const { error } = await db().auth.linkIdentity({ provider, options: { redirectTo: `${location.origin}/auth` } }); check(error); },
  async signInWithOAuth(provider: 'google' | 'github') {
    const session = await this.getSession();
    if (session?.user.is_anonymous) throw new ServiceError('LINK_REQUIRED', '지금까지의 기록을 유지하려면 계정 연결을 이용해 주세요.');
    const { error } = await db().auth.signInWithOAuth({ provider, options: { redirectTo: `${location.origin}/auth` } }); check(error);
  },
  async signOut() { const { error } = await db().auth.signOut(); check(error); },
  async loadProfile(): Promise<Profile | null> { const id = await userId(); await touch(); const { data, error } = await db().from('profiles').select('*').eq('id', id).maybeSingle(); check(error); return data; },
  async updateProfile(patch: Partial<Pick<Profile, 'display_name' | 'memory_enabled' | 'preferred_character'>>) { const id = await userId(); const { data, error } = await db().from('profiles').update(patch).eq('id', id).select().single(); check(error); return data as Profile; },
  async listBirthProfiles(): Promise<BirthProfile[]> { const { data, error } = await db().from('birth_profiles').select('*').order('created_at'); check(error); return data || []; },
  async saveBirthProfile(input: BirthInputValue, birthProfileId?: string, relatedPersonId?: string): Promise<BirthProfile> {
    const id = await userId(); const values = { calendar_type: input.calendarType, leap_month: input.leapMonth, birth_date: input.birthDate, birth_time: input.birthTimeUnknown ? null : input.birthTime, unknown_birth_time: input.birthTimeUnknown, city: input.location.name, country: input.location.country || '', latitude: input.location.latitude, longitude: input.location.longitude, timezone: input.location.timezone, location_provider: input.location.provider || 'Open-Meteo', location_provider_id: input.location.providerId || null, location_resolved_at: new Date().toISOString(), gender: input.gender || null };
    if (relatedPersonId) { const { error } = await db().from('related_people').update({ birth_data_opt_in: true }).eq('id', relatedPersonId); check(error); }
    const query = birthProfileId ? db().from('birth_profiles').update(values).eq('id', birthProfileId) : db().from('birth_profiles').insert({ ...values, user_id: id, owner_type: relatedPersonId ? 'RELATED_PERSON' : 'USER', related_person_id: relatedPersonId || null });
    const { data, error } = await query.select().single(); check(error); return data;
  },
  async deleteBirthProfile(id: string) { const { error } = await db().from('birth_profiles').delete().eq('id', id); check(error); },
  async listRelatedPeople(): Promise<RelatedPerson[]> { const { data, error } = await db().from('related_people').select('*').order('created_at'); check(error); return data || []; },
  async saveRelatedPerson(patch: { display_name: string; relation?: string | null; gender?: string | null; memory_opt_in?: boolean }, id?: string): Promise<RelatedPerson> { const user_id = await userId(); const query = id ? db().from('related_people').update(patch).eq('id', id) : db().from('related_people').insert({ ...patch, user_id }); const { data, error } = await query.select().single(); check(error); return data; },
  async deleteRelatedPerson(id: string) { const { error } = await db().from('related_people').delete().eq('id', id); check(error); },
  async listConversations(): Promise<Conversation[]> { const { data, error } = await db().from('conversations').select('*').order('last_message_at', { ascending: false, nullsFirst: false }).limit(100); check(error); return data || []; },
  async listConversationsPage(before: ConversationCursor | null = null, pageSize = 30): Promise<HistoryPage<Conversation, ConversationCursor>> {
    const limit = pageLimit(pageSize);
    let query = db().from('conversations').select('*').order('last_message_at', { ascending: false, nullsFirst: false }).order('id', { ascending: false }).limit(limit + 1);
    if (before) {
      const id = cursorId(before.id);
      query = before.lastMessageAt === null
        ? query.is('last_message_at', null).lt('id', id)
        : query.or(`last_message_at.lt.${cursorDate(before.lastMessageAt)},and(last_message_at.eq.${cursorDate(before.lastMessageAt)},id.lt.${id}),last_message_at.is.null`);
    }
    const { data, error } = await query; check(error);
    const rows = (data || []) as Conversation[], items = rows.slice(0, limit), last = items.at(-1);
    return { items, nextCursor: rows.length > limit && last ? { lastMessageAt: last.last_message_at, id: last.id } : null };
  },
  async getConversation(id: string): Promise<Conversation | null> { const { data, error } = await db().from('conversations').select('*').eq('id', id).maybeSingle(); check(error); return data; },
  async createConversation(characterId: CharacterId): Promise<Conversation> { const id = await userId(); const { data, error } = await db().from('conversations').insert({ user_id: id, character_id: characterId }).select().single(); check(error); await touch(); return data; },
  async updateConversation(id: string, patch: { title: string }) { const { error } = await db().from('conversations').update({ title: patch.title }).eq('id', id); check(error); },
  async deleteConversation(id: string, options: DeletionOptions = {}) { const { error } = await db().rpc('delete_history_with_memories', { p_kind: 'CONVERSATION', p_record_id: id, p_memory_ids: options.memoryIds ?? [] }); check(error); },
  async listMessages(conversationId: string): Promise<Message[]> { const { data, error } = await db().from('messages').select('*').eq('conversation_id', conversationId).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(1000); check(error); return (data || []).reverse(); },
  async listMessagesPage(conversationId: string, before: HistoryCursor | null = null, pageSize = 100): Promise<HistoryPage<Message>> { return messagesPage('conversation_id', conversationId, before, pageSize); },
  async listConsultationMessages(consultationId: string): Promise<Message[]> {
    const pages: Message[][] = []; let cursor: HistoryCursor | null = null;
    do { const page = await messagesPage('consultation_id', consultationId, cursor, 200); pages.push(page.items); cursor = page.nextCursor; } while (cursor);
    return pages.reverse().flat();
  },
  async listReadings(): Promise<ReadingSummary[]> { const { data, error } = await db().from('consultations').select('id,title,fortune_type,result_summary,created_at,conversation_id,character_id').order('created_at', { ascending: false }).limit(200); check(error); return data || []; },
  async listReadingsPage(options: { cursor?: HistoryCursor | null; search?: string; fortuneType?: string; pageSize?: number } = {}): Promise<HistoryPage<ReadingSummary>> {
    const limit = pageLimit(options.pageSize ?? 30), conditions: string[] = [];
    let query = db().from('consultations').select('id,title,fortune_type,result_summary,created_at,conversation_id,character_id').order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit + 1);
    if (options.fortuneType && options.fortuneType !== 'ALL') query = query.eq('fortune_type', options.fortuneType);
    if (options.cursor) conditions.push(olderThan(options.cursor));
    const search = options.search?.trim().slice(0, 200);
    if (search) { const value = literalSearch(search); conditions.push(`title.imatch.${value},result_summary.imatch.${value}`); }
    if (conditions.length) query = query.or(`and(${conditions.map((condition) => `or(${condition})`).join(',')})`);
    const { data, error } = await query; check(error);
    return datedPage<ReadingSummary>(data || [], limit);
  },
  async updateReadingTitle(id: string, title: string) { const { error } = await db().from('consultations').update({ title }).eq('id', id); check(error); },
  async deleteReading(id: string, options: DeletionOptions = {}) { const { error } = await db().rpc('delete_history_with_memories', { p_kind: 'CONSULTATION', p_record_id: id, p_memory_ids: options.memoryIds ?? [] }); check(error); },
  async getDeletionMemories(kind: DeletionKind, id: string): Promise<Memory[]> {
    const items: Memory[] = []; let cursor: HistoryCursor | null = null;
    do {
      let query = db().rpc('history_deletion_memories', { p_kind: kind, p_record_id: id }).select('*')
        .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(201);
      if (cursor) query = query.or(olderThan(cursor));
      const { data, error } = await query; check(error);
      const page = datedPage<Memory>(data || [], 200);
      items.push(...page.items); cursor = page.nextCursor;
    } while (cursor);
    return items;
  },
  async getReading(consultationId: string): Promise<ReadingDetail | null> { const { data, error } = await db().from('consultations').select('*,tarot_draw_groups(*,tarot_draws(*)),saju_readings(*),saju_compatibility_readings(*)').eq('id', consultationId).maybeSingle(); check(error); return data; },
  async listMemories(): Promise<Memory[]> { const { data, error } = await db().from('memories').select('*').order('created_at', { ascending: false }); check(error); return data || []; },
  async updateMemory(id: string, patch: { content?: string; disabled_at?: string | null }) { const { error } = await db().from('memories').update(patch).eq('id', id); check(error); },
  async deleteMemory(id: string) { const { error } = await db().from('memories').delete().eq('id', id); check(error); },
  async execute<T>(endpoint: 'chat' | 'tarot' | 'saju' | 'compatibility' | 'account', body: object): Promise<Envelope<T>> {
    const session = await service.getSession(); if (!session) throw new ServiceError('UNAUTHORIZED', '로그인이 필요해요.');
    const payload = { schemaVersion: 1, requestId: crypto.randomUUID(), ...body };
    const send = async () => fetch(`${url}/functions/v1/${endpoint}`, { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}`, apikey: anonKey!, 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(105_000) });
    let response: Response;
    try { response = await send(); } catch { if (endpoint === 'account') throw new ServiceError('NETWORK_ERROR', '처리 결과를 확인하지 못했어요. 로그인 상태를 확인해 주세요.'); try { response = await send(); } catch { throw new ServiceError('NETWORK_ERROR', '연결이 끊겼어요. 다시 시도해 주세요.', true); } }
    let decoded: unknown; try { decoded = await response.json(); } catch { throw new ServiceError('INVALID_RESPONSE', '서버 응답을 확인하지 못했어요.', true); }
    if (!isEnvelope(decoded)) throw new ServiceError(response.ok ? 'INVALID_RESPONSE' : 'SERVER_ERROR', '서버 응답을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.', true);
    const result = decoded as Envelope<T>;
    if (!result.ok) throw new ServiceError(result.error.code, result.error.message, result.error.retryable, result.error.details);
    if (!response.ok) throw new ServiceError('SERVER_ERROR', '서버에 연결하지 못했어요.', true);
    if (endpoint === 'account' && (body as {action?: string}).action === 'DELETE_ACCOUNT') { await supabase?.auth.signOut({ scope: 'local' }); }
    return result;
  },
};
