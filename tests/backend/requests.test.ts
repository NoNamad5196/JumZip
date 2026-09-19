import { describe, expect, it } from 'vitest';
import { birthInputSchema, chatRequestSchema, tarotRequestSchema, sajuRequestSchema, compatibilityRequestSchema, payloadHash, canonicalJson } from '../../supabase/functions/_shared/validation/requests.ts';

const id = '20000000-0000-4000-8000-000000000001';
const base = { schemaVersion: 1, requestId: id, conversationId: id, consultationId: null } as const;
const draw = { ...base, action: 'DRAW', spreadType: 'GENERAL_3', mode: 'NORMAL', question: '앞으로의 흐름', clientTimezone: 'Asia/Seoul' };
const birth = { calendarType: 'SOLAR', leapMonth: false, birthDate: '1999-03-14', birthTime: null, birthTimeUnknown: true,
  location: { name: '서울', country: 'South Korea', latitude: 37.5, longitude: 127, timezone: 'Asia/Seoul' }, gender: null };
describe('strict Edge request contracts', () => {
  it('rejects authority overrides and unknown fields', () => {
    for (const key of ['characterId', 'modelId', 'cards', 'userId', 'systemPrompt']) {
      expect(tarotRequestSchema.safeParse({ ...draw, [key]: 'injected' }).success).toBe(false);
    }
  });
  it('limits free text and requires request UUID v4', () => {
    expect(chatRequestSchema.safeParse({ ...base, action: 'SEND', message: 'a'.repeat(4001) }).success).toBe(false);
    expect(chatRequestSchema.safeParse({ ...base, action: 'SEND', message: '  ' }).success).toBe(false);
    expect(tarotRequestSchema.safeParse({ ...draw, requestId: '20000000-0000-1000-8000-000000000001' }).success).toBe(false);
  });
  it('does not accept fixed UTC offsets as IANA zones', () => {
    expect(tarotRequestSchema.safeParse({ ...draw, clientTimezone: '+09:00' }).success).toBe(false);
    expect(tarotRequestSchema.safeParse(draw).success).toBe(true);
  });
  it('never substitutes noon for unknown birth time', () => {
    expect(birthInputSchema.safeParse(birth).success).toBe(true);
    expect(birthInputSchema.safeParse({ ...birth, birthTime: '12:00' }).success).toBe(false);
    expect(birthInputSchema.safeParse({ ...birth, birthTimeUnknown: false }).success).toBe(false);
    expect(birthInputSchema.safeParse({ ...birth, birthDate: '1999-02-30' }).success).toBe(false);
  });
  it('requires exactly one saved or inline birth profile', () => {
    const input = { ...base, action: 'CALCULATE', subject: { birthProfileId: id, input: birth } };
    expect(sajuRequestSchema.safeParse(input).success).toBe(false);
    expect(sajuRequestSchema.safeParse({ ...input, subject: { input: birth } }).success).toBe(true);
  });
  it('defaults related-person storage to false', () => {
    const input = compatibilityRequestSchema.parse({ ...base, action: 'CALCULATE_SAJU', personA: { birthProfileId: id }, personB: { alias: '민지', input: birth } });
    if (input.action === 'CALCULATE_SAJU') expect(input.personB.saveRelatedPerson).toBe(false);
  });
  it('rejects results resubmitted on interpretation retry', () => {
    expect(tarotRequestSchema.safeParse({ schemaVersion: 1, requestId: id, conversationId: id, action: 'RETRY_INTERPRETATION', drawGroupId: id, cards: [] }).success).toBe(false);
  });
  it('hashes normalized semantic payload independent of key order and request id', async () => {
    const first = tarotRequestSchema.parse(draw);
    const second = tarotRequestSchema.parse({ ...Object.fromEntries(Object.entries(draw).reverse()), question: ' 앞으로의 흐름 ', requestId: '20000000-0000-4000-8000-000000000002' });
    expect(await payloadHash(first)).toBe(await payloadHash(second));
    expect(await payloadHash(first)).not.toBe(await payloadHash(tarotRequestSchema.parse({ ...draw, question: '다른 질문' })));
    expect(canonicalJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  });
});
