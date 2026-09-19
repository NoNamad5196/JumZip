import { z } from 'zod';
import { locationSchema } from '../validation/requests.ts';
import { ApiFailure } from '../http/errors.ts';
import { createBoundedFetch } from '../http/network.ts';

const providerLocation = z.object({
  id: z.number().int(), name: z.string(), country: z.string(), admin1: z.string().optional(),
  latitude: z.number(), longitude: z.number(), timezone: z.string(),
});
const providerResult = z.object({ results: z.array(providerLocation).optional() });
type Location = z.infer<typeof locationSchema>;
const normalize = (item: z.infer<typeof providerLocation>): Location => locationSchema.parse({ providerId: String(item.id), name: item.name, country: item.country,
  ...(item.admin1 ? { admin1: item.admin1 } : {}), latitude: item.latitude, longitude: item.longitude, timezone: item.timezone });

/** Official Open-Meteo geocoding endpoint; no browser-provided URL or arbitrary proxy. */
export async function resolveLocation(query: string, limit: number, fetchImpl: typeof fetch = fetch) {
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.searchParams.set('name', query); url.searchParams.set('count', String(limit));
  url.searchParams.set('language', 'ko'); url.searchParams.set('format', 'json');
  try {
    const response = await createBoundedFetch({ fetchImpl, timeoutMs: 5_000, maxBytes: 131_072 })(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('GEOCODING_UNAVAILABLE');
    const data = providerResult.parse(await response.json());
    const locations = (data.results ?? []).map(normalize);
    return { locations };
  } catch { throw new ApiFailure('SAJU_LOCATION_UNRESOLVED', 502, '출생 도시를 확인하지 못했습니다.', true); }
}

/** Validate resolver provenance for fresh input or an unverified saved profile. Already
 * verified server snapshots are reused by persistence without another provider request. */
export async function verifyLocation(input: Location, fetchImpl: typeof fetch = fetch): Promise<Location> {
  let choices: Location[];
  if (input.providerId) {
    if (!/^[1-9]\d{0,11}$/.test(input.providerId)) throw new ApiFailure('SAJU_LOCATION_UNRESOLVED', 400, '출생 도시를 다시 선택해 주세요.');
    const url = new URL('https://geocoding-api.open-meteo.com/v1/get');
    url.searchParams.set('id', input.providerId); url.searchParams.set('language', 'ko'); url.searchParams.set('format', 'json');
    try {
      const response = await createBoundedFetch({ fetchImpl, timeoutMs: 5_000, maxBytes: 131_072 })(url, { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('GEOCODING_UNAVAILABLE');
      const location = normalize(providerLocation.parse(await response.json()));
      if (location.providerId !== input.providerId) throw new Error('GEOCODING_ID_MISMATCH');
      choices = [location];
    } catch { throw new ApiFailure('SAJU_LOCATION_UNRESOLVED', 502, '출생 도시를 확인하지 못했습니다.', true); }
  } else {
    // Legacy/saved profiles lack providerId. A matching authoritative search result is required.
    choices = (await resolveLocation(`${input.name}, ${input.country}`, 100, fetchImpl)).locations;
  }
  const match = choices.find(location => location.timezone === input.timezone
    && Math.abs(location.latitude - input.latitude) < .00001 && Math.abs(location.longitude - input.longitude) < .00001);
  if (!match) throw new ApiFailure('SAJU_LOCATION_UNRESOLVED', 400, '출생 도시 정보를 다시 선택해 주세요.', false, { reason: 'RESOLVER_SNAPSHOT_MISMATCH' });
  return match;
}
