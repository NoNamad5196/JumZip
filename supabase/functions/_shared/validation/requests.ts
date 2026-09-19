import { z } from 'zod';

const id = z.string().uuid();
const requestId = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
const text = z.string().trim().min(1).max(4_000);
const common = { schemaVersion: z.literal(1), requestId };
const conversation = { conversationId: id };
const consultation = { consultationId: id.nullable() };
export const timezoneSchema = z.string().max(100).refine(value => {
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return value.includes('/') || value === 'UTC'; }
  catch { return false; }
}, 'IANA timezone required');
const spread = z.enum(['ONE_CARD', 'GENERAL_3', 'RELATIONSHIP_3', 'DECISION_3']);

export const locationSchema = z.strictObject({
  providerId: z.string().max(150).optional(), name: z.string().trim().min(1).max(200),
  country: z.string().trim().min(1).max(100), admin1: z.string().max(200).optional(),
  latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), timezone: timezoneSchema,
});
export const birthInputSchema = z.strictObject({
  calendarType: z.enum(['SOLAR', 'LUNAR']), leapMonth: z.boolean(),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  birthTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).nullable(), birthTimeUnknown: z.boolean(),
  location: locationSchema, gender: z.enum(['MALE', 'FEMALE']).nullable(),
}).superRefine((input, ctx) => {
  if (input.birthTimeUnknown !== (input.birthTime === null)) ctx.addIssue({ code: 'custom', path: ['birthTime'], message: 'Unknown time must be null; known time must be supplied.' });
  const [year, month, day] = input.birthDate.split('-').map(Number) as [number, number, number];
  if (month < 1 || month > 12 || day < 1 || day > (input.calendarType === 'LUNAR' ? 30 : 31)) ctx.addIssue({ code: 'custom', path: ['birthDate'], message: 'Invalid birth date.' });
  if (input.calendarType === 'SOLAR') {
    if (input.leapMonth) ctx.addIssue({ code: 'custom', path: ['leapMonth'], message: 'Leap month applies to lunar dates only.' });
    const parsed = new Date(`${input.birthDate}T00:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.getUTCFullYear() !== year || parsed.getUTCMonth() + 1 !== month || parsed.getUTCDate() !== day) ctx.addIssue({ code: 'custom', path: ['birthDate'], message: 'Invalid solar date.' });
  }
});
export type BirthInput = z.infer<typeof birthInputSchema>;
const subject = z.strictObject({ birthProfileId: id.nullable().optional(), input: birthInputSchema.nullable().optional(), saveProfile: z.boolean().default(false) })
  .refine(value => Boolean(value.birthProfileId) !== Boolean(value.input), 'Exactly one birthProfileId or input is required.');
const relatedPerson = z.strictObject({ relatedPersonId: id.nullable().optional(), alias: z.string().trim().min(1).max(100).optional(), input: birthInputSchema.nullable().optional(), saveRelatedPerson: z.boolean().default(false) })
  .refine(value => Boolean(value.relatedPersonId) !== Boolean(value.input), 'Exactly one relatedPersonId or input is required.');

export const chatRequestSchema = z.discriminatedUnion('action', [
  z.strictObject({ ...common, ...conversation, ...consultation, action: z.literal('SEND'), message: text }),
  z.strictObject({ ...common, ...conversation, action: z.literal('RETRY_RESPONSE'), userMessageId: id }),
]);
export const tarotRequestSchema = z.discriminatedUnion('action', [
  z.strictObject({ ...common, ...conversation, ...consultation, action: z.literal('DRAW'), spreadType: spread, question: text, mode: z.enum(['NORMAL', 'DAILY']), clientTimezone: timezoneSchema }),
  z.strictObject({ ...common, ...conversation, action: z.literal('REDRAW'), consultationId: id, sourceDrawGroupId: id }),
  z.strictObject({ ...common, ...conversation, action: z.literal('RETRY_INTERPRETATION'), drawGroupId: id }),
]);
export const sajuRequestSchema = z.discriminatedUnion('action', [
  z.strictObject({ ...common, action: z.literal('RESOLVE_LOCATION'), query: z.string().trim().min(2).max(100), limit: z.number().int().min(1).max(8).default(8) }),
  z.strictObject({ ...common, ...conversation, ...consultation, action: z.literal('CALCULATE'), subject, focus: z.enum(['GENERAL', 'CAREER', 'RELATIONSHIP', 'YEAR_FLOW', 'MONTH_FLOW']).optional() }),
  z.strictObject({ ...common, ...conversation, action: z.literal('RETRY_INTERPRETATION'), readingId: id }),
]);
export const compatibilityRequestSchema = z.discriminatedUnion('action', [
  z.strictObject({ ...common, ...conversation, ...consultation, action: z.literal('CALCULATE_SAJU'), personA: subject, personB: relatedPerson }),
  z.strictObject({ ...common, ...conversation, ...consultation, action: z.literal('DRAW_TAROT'), targetPersonAlias: z.string().trim().min(1).max(100), question: text }),
  z.strictObject({ ...common, ...conversation, action: z.literal('RETRY_INTERPRETATION'), targetType: z.enum(['SAJU', 'TAROT']), targetId: id }),
]);
export const accountRequestSchema = z.strictObject({ ...common, action: z.literal('DELETE_ACCOUNT'), confirmation: z.literal('DELETE') });
export const requestSchemas = { chat: chatRequestSchema, tarot: tarotRequestSchema, saju: sajuRequestSchema, compatibility: compatibilityRequestSchema, account: accountRequestSchema };
export type Endpoint = keyof typeof requestSchemas;
export type ChatRequest = z.infer<typeof chatRequestSchema>;
export type TarotRequest = z.infer<typeof tarotRequestSchema>;
export type SajuRequest = z.infer<typeof sajuRequestSchema>;
export type CompatibilityRequest = z.infer<typeof compatibilityRequestSchema>;
export type AccountRequest = z.infer<typeof accountRequestSchema>;
export type ActionRequest = ChatRequest | TarotRequest | SajuRequest | CompatibilityRequest | AccountRequest;

/** Stable semantic hashing excludes only the trace/request identifier, never user content. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().filter(key => (value as Record<string, unknown>)[key] !== undefined).map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
}
export async function payloadHash(request: ActionRequest): Promise<string> {
  const { requestId: _requestId, ...semantic } = request;
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(semantic)));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
