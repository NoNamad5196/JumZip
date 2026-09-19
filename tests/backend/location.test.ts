import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveLocation, verifyLocation } from '../../supabase/functions/_shared/orchestration/location.ts';

afterEach(() => vi.useRealTimers());

const location = { providerId: '1835848', name: '서울', country: '대한민국', latitude: 37.566, longitude: 126.9784, timezone: 'Asia/Seoul' };
const provider = { id: 1835848, name: '서울', country: '대한민국', latitude: location.latitude, longitude: location.longitude, timezone: location.timezone };
describe('Saju resolver trust boundary', () => {
  it('bounds both lookup and verification bodies even when the provider stalls or lies about length', async () => {
    const oversized = vi.fn<typeof fetch>().mockImplementation(async () => new Response(new Uint8Array(131_073), { headers: { 'Content-Length': '1' } }));
    await expect(resolveLocation('서울', 5, oversized)).rejects.toMatchObject({ code: 'SAJU_LOCATION_UNRESOLVED', status: 502 });
    vi.useFakeTimers(); const stalled = vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream({ cancel: () => new Promise<void>(() => {}) })));
    const outcome = verifyLocation(location, stalled).catch(error => error); await vi.advanceTimersByTimeAsync(5001);
    expect(await outcome).toMatchObject({ code: 'SAJU_LOCATION_UNRESOLVED', status: 502 });
  });
  it('uses the fixed provider ID endpoint and returns authoritative names, never browser-selected labels', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(provider)));
    expect(await verifyLocation({ ...location, name: 'arbitrary label' }, fetcher)).toEqual(location);
    expect(String(fetcher.mock.calls[0]![0])).toBe('https://geocoding-api.open-meteo.com/v1/get?id=1835848&language=ko&format=json');
  });
  it('rejects forged coordinates and timezone despite a real provider identifier', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify(provider)));
    for (const input of [{ ...location, longitude: 120 }, { ...location, timezone: 'UTC' }]) await expect(verifyLocation(input, fetcher)).rejects.toMatchObject({ code: 'SAJU_LOCATION_UNRESOLVED', status: 400 });
  });
  it('checks legacy saved profiles against current resolver results', async () => {
    const { providerId: _id, ...legacy } = location;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ results: [provider] })));
    expect(await verifyLocation(legacy, fetcher)).toEqual(location);
    expect(String(fetcher.mock.calls[0]![0])).toContain('/v1/search?');
  });
  it('does not accept arbitrary provider URLs or expose upstream errors', async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(verifyLocation({ ...location, providerId: 'https://internal/' }, fetcher)).rejects.toMatchObject({ code: 'SAJU_LOCATION_UNRESOLVED' });
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockRejectedValue(new Error('secret upstream detail'));
    await expect(verifyLocation(location, fetcher)).rejects.toMatchObject({ code: 'SAJU_LOCATION_UNRESOLVED', message: '출생 도시를 확인하지 못했습니다.' });
  });
});
