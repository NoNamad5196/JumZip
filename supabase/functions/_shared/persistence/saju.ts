import type { SupabaseClient } from '@supabase/supabase-js';
import type { FullSajuResult } from '../domain/full-saju.ts';
import type { ClaimedRequest } from './repository.ts';
import { databaseFailure } from './repository.ts';
import { ApiFailure } from '../http/errors.ts';
import { birthInputSchema, type BirthInput } from '../validation/requests.ts';
import { verifyLocation } from '../orchestration/location.ts';

export interface SajuSnapshot {
  readingId: string; conversationId: string; consultationId: string;
  result: FullSajuResult;
  interpretation: { messageId: string; content: string; segments?: string[] } | null;
}
export interface SajuClaim extends Omit<ClaimedRequest, 'resource' | 'source'> { resource?: SajuSnapshot }
export interface SajuBeginParams {
  user_id: string; operation: string; request_id: string; payload_hash: string; conversation_id: string;
  consultation_id?: string | null; reading_id?: string; target_type: 'SAJU'; focus?: string;
}
export interface SajuRepository {
  begin(params: SajuBeginParams): Promise<SajuClaim>;
  save(input: { executionId: string; result: FullSajuResult; birthSnapshot: BirthInput; profileInput: BirthInput | null }): Promise<SajuSnapshot>;
  readUserBirthProfile(userId: string, profileId: string): Promise<BirthInput>;
}
export function parseStoredBirthProfile(data: Record<string, unknown>): BirthInput {
  const time = data.birth_time;
  if (time !== null && (typeof time !== 'string' || !/^\d{2}:\d{2}(?::00(?:\.0+)?)?$/.test(time))) throw new ApiFailure('SAJU_INPUT_INCOMPLETE', 400, '출생 시각을 분 단위로 다시 입력해 주세요.');
  const parsed = birthInputSchema.safeParse({ calendarType: data.calendar_type, leapMonth: data.leap_month,
    birthDate: data.birth_date, birthTime: typeof time === 'string' ? time.slice(0, 5) : null, birthTimeUnknown: data.unknown_birth_time,
    location: { ...(typeof data.location_provider_id === 'string' ? { providerId: data.location_provider_id } : {}), name: data.city, country: data.country, latitude: Number(data.latitude), longitude: Number(data.longitude), timezone: data.timezone }, gender: data.gender });
  if (!parsed.success) throw new ApiFailure('SAJU_INPUT_INCOMPLETE', 400, '저장된 출생 정보를 다시 확인해 주세요.');
  return parsed.data;
}
export const BIRTH_PROFILE_FIELDS = 'id,calendar_type,leap_month,birth_date,birth_time,unknown_birth_time,city,country,latitude,longitude,timezone,gender,location_provider_id,location_verified_at';
/** A location marker is writable only by server RPCs and is invalidated when its fields change.
 * CAS prevents a slow provider reply from marking a concurrently edited profile as verified. */
export async function verifiedStoredBirthProfile(client: SupabaseClient, userId: string, data: Record<string, unknown>, verify: typeof verifyLocation = verifyLocation): Promise<BirthInput> {
  const input = parseStoredBirthProfile(data);
  if (typeof data.location_verified_at === 'string' && Number.isFinite(Date.parse(data.location_verified_at))) return input;
  const location = await verify(input.location);
  const canonical = (value: BirthInput['location']) => ({ ...(value.providerId ? { providerId: value.providerId } : {}), name: value.name, country: value.country, latitude: value.latitude, longitude: value.longitude, timezone: value.timezone });
  const { data: recorded, error } = await client.rpc('record_verified_birth_location', {
    p_user_id: userId, p_profile_id: data.id, p_expected_location: canonical(input.location), p_verified_location: canonical(location),
  });
  if (error) throw databaseFailure(error);
  if (recorded !== true) throw new ApiFailure('CONFLICT', 409, '출생 도시 정보가 변경되었습니다. 다시 시도해 주세요.', true);
  return { ...input, location };
}
export function createSajuRepository(client: SupabaseClient, verify: typeof verifyLocation = verifyLocation): SajuRepository {
  return {
    async begin(params) {
      const { data, error } = await client.rpc('begin_saju_request', { p_params: params });
      if (error) throw databaseFailure(error);
      return data as SajuClaim;
    },
    async save(input) {
      const { data, error } = await client.rpc('save_saju_reading', { p_execution_id: input.executionId,
        p_result: input.result, p_birth_profile_snapshot: input.birthSnapshot, p_profile_input: input.profileInput });
      if (error) throw databaseFailure(error);
      return data as SajuSnapshot;
    },
    async readUserBirthProfile(userId, profileId) {
      const { data, error } = await client.from('birth_profiles').select(BIRTH_PROFILE_FIELDS)
        .eq('id', profileId).eq('user_id', userId).eq('owner_type', 'USER').maybeSingle();
      if (error) throw databaseFailure(error);
      if (!data) throw new ApiFailure('NOT_FOUND', 404, '저장된 출생 정보를 찾지 못했습니다.');
      return verifiedStoredBirthProfile(client, userId, data, verify);
    },
  };
}
