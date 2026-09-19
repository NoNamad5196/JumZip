import type { SupabaseClient } from '@supabase/supabase-js';
import type { SajuCompatibilityResult } from '../domain/saju-compatibility.ts';
import type { ClaimedRequest } from './repository.ts';
import { databaseFailure } from './repository.ts';
import { BIRTH_PROFILE_FIELDS, verifiedStoredBirthProfile } from './saju.ts';
import { ApiFailure } from '../http/errors.ts';
import type { BirthInput } from '../validation/requests.ts';
import { verifyLocation } from '../orchestration/location.ts';

export interface CompatibilitySnapshot {
  compatibilityReadingId: string; conversationId: string; consultationId: string; result: SajuCompatibilityResult;
  interpretation: { messageId: string; content: string; segments?: string[] } | null;
}
export interface CompatibilityClaim extends Omit<ClaimedRequest, 'resource' | 'source'> { resource?: CompatibilitySnapshot }
export interface CompatibilityRepository {
  begin(params: { user_id: string; operation: string; request_id: string; payload_hash: string; conversation_id: string; consultation_id?: string | null; reading_id?: string }): Promise<CompatibilityClaim>;
  save(input: { executionId: string; result: SajuCompatibilityResult; personAProfileInput: BirthInput | null; personBProfileInput: BirthInput | null; personBAlias: string | null; relatedPersonId: string | null }): Promise<CompatibilitySnapshot>;
  readRelatedBirthProfile(userId: string, relatedPersonId: string): Promise<{ input: BirthInput; alias: string }>;
}
export function createCompatibilityRepository(client: SupabaseClient, verify: typeof verifyLocation = verifyLocation): CompatibilityRepository {
  return {
    async begin(params) { const { data, error } = await client.rpc('begin_saju_compatibility_request', { p_params: params }); if (error) throw databaseFailure(error); return data as CompatibilityClaim; },
    async save(input) {
      const { data, error } = await client.rpc('save_saju_compatibility', { p_execution_id: input.executionId, p_result: input.result,
        p_person_a_profile_input: input.personAProfileInput, p_person_b_profile_input: input.personBProfileInput,
        p_person_b_alias: input.personBAlias, p_related_person_id: input.relatedPersonId });
      if (error) throw databaseFailure(error); return data as CompatibilitySnapshot;
    },
    async readRelatedBirthProfile(userId, relatedPersonId) {
      const person = await client.from('related_people').select('id,display_name,birth_data_opt_in').eq('id', relatedPersonId).eq('user_id', userId).maybeSingle();
      if (person.error) throw databaseFailure(person.error);
      if (!person.data) throw new ApiFailure('NOT_FOUND', 404, '관련인 정보를 찾지 못했습니다.');
      if (!person.data.birth_data_opt_in) throw new ApiFailure('FORBIDDEN', 403, '관련인의 출생 정보 저장 동의를 확인해 주세요.');
      const profile = await client.from('birth_profiles').select(BIRTH_PROFILE_FIELDS)
        .eq('user_id', userId).eq('owner_type', 'RELATED_PERSON').eq('related_person_id', relatedPersonId).maybeSingle();
      if (profile.error) throw databaseFailure(profile.error);
      if (!profile.data) throw new ApiFailure('COMPATIBILITY_INPUT_INCOMPLETE', 400, '관련인의 출생 정보를 입력해 주세요.');
      return { input: await verifiedStoredBirthProfile(client, userId, profile.data, verify), alias: person.data.display_name };
    },
  };
}
