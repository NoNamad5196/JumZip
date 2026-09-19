import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { verifiedStoredBirthProfile } from '../../supabase/functions/_shared/persistence/saju.ts';

const stored = { id: 'profile', calendar_type: 'SOLAR', leap_month: false, birth_date: '1995-02-03', birth_time: '12:30:00', unknown_birth_time: false,
  city: '서울', country: '대한민국', latitude: 37.566, longitude: 126.978, timezone: 'Asia/Seoul', gender: null, location_verified_at: null };
const location = { name: stored.city, country: stored.country, latitude: stored.latitude, longitude: stored.longitude, timezone: stored.timezone };
function fixture(recorded = true) {
  const rpc = vi.fn().mockResolvedValue({ data: recorded, error: null });
  const verify = vi.fn().mockResolvedValue({ ...location, providerId: '1835848' });
  return { rpc, verify, client: { rpc } as unknown as SupabaseClient };
}
describe('server-owned saved birth location verification', () => {
  it('reuses the verified snapshot even if the external provider is unavailable', async () => {
    const { rpc, verify, client } = fixture(); verify.mockRejectedValue(new Error('provider unavailable'));
    const birth = await verifiedStoredBirthProfile(client, 'owner', { ...stored, location_verified_at: '2026-09-20T00:00:00Z' }, verify);
    expect(birth.location).toEqual(location); expect(birth.birthTime).toBe('12:30');
    expect(verify).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
  });
  it('verifies a legacy snapshot once and CAS-records only its canonical location', async () => {
    const { rpc, verify, client } = fixture();
    await verifiedStoredBirthProfile(client, 'owner', stored, verify);
    expect(verify).toHaveBeenCalledExactlyOnceWith(location);
    expect(rpc).toHaveBeenCalledExactlyOnceWith('record_verified_birth_location', { p_user_id: 'owner', p_profile_id: 'profile', p_expected_location: location, p_verified_location: { ...location, providerId: '1835848' } });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain(stored.birth_date);
  });
  it('carries a saved localized city provider ID into verification and CAS instead of searching its translated name', async () => {
    const { rpc, verify, client } = fixture();
    const birth = await verifiedStoredBirthProfile(client, 'owner', { ...stored, location_provider_id: '1835848' }, verify);
    expect(verify).toHaveBeenCalledExactlyOnceWith({ ...location, providerId: '1835848' });
    expect(rpc).toHaveBeenCalledWith('record_verified_birth_location', expect.objectContaining({ p_expected_location: { ...location, providerId: '1835848' } }));
    expect(birth.location.providerId).toBe('1835848');
  });
  it('rejects concurrent edits instead of marking a changed location as verified', async () => {
    const { verify, client } = fixture(false);
    await expect(verifiedStoredBirthProfile(client, 'owner', stored, verify)).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
  });
  it('does not mark or return an unverified snapshot when the resolver fails', async () => {
    const { rpc, verify, client } = fixture(); verify.mockRejectedValue(new Error('provider unavailable'));
    await expect(verifiedStoredBirthProfile(client, 'owner', stored, verify)).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });
});
