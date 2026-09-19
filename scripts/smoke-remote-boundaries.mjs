import { randomUUID } from 'node:crypto';

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
function noRawBirthFields(value) {
  if (Array.isArray(value)) return value.every(noRawBirthFields);
  if (!value || typeof value !== 'object') return true;
  return Object.entries(value).every(([key, child]) => !/^(birthdate|birthtime|birthprofilesnapshot|birthprofile|rawinput|input|latitude|longitude|location|city|timezone|calendartype|leapmonth|gender)$/.test(key.replace(/[^a-z]/gi, '').toLowerCase()) && noRawBirthFields(child));
}
function interpretation(result, label, assert) {
  assert(result.ok && ['SUCCEEDED', 'PARTIAL'].includes(result.data?.executionStatus), `${label} returns canonical persisted result`);
  if (result.data.executionStatus === 'SUCCEEDED') assert(typeof result.data.interpretation?.messageId === 'string' && Boolean(result.data.interpretation?.content), `${label} includes persisted interpretation message ID`);
  else assert(result.data.interpretation === null && result.data.partialError?.retryable === true, `${label} exposes partial-result retry`);
}

export async function checkHttpBoundaries({ url, anon, user, conversationId, assert }) {
  const origin = 'http://127.0.0.1:5173';
  async function request(options = {}) {
    const response = await fetch(`${url}/functions/v1/chat`, { method: options.method ?? 'POST',
      headers: { apikey: anon, 'Content-Type': 'application/json', Origin: origin,
        ...(options.token === null ? {} : { Authorization: `Bearer ${options.token ?? user.token}` }), ...options.headers },
      body: options.method === 'OPTIONS' ? undefined : JSON.stringify({ schemaVersion: 1, requestId: randomUUID(), action: 'SEND', conversationId, consultationId: null, message: 'test', ...options.body }),
      signal: AbortSignal.timeout(20_000) }).catch(() => { throw new Error('Remote HTTP boundary transport failed.'); });
    let body = {};
    if (response.status !== 204) { try { body = await response.json(); } catch { throw new Error('Remote HTTP boundary did not return JSON.'); } }
    return { ...body, status: response.status, headers: response.headers };
  }
  const preflight = await request({ method: 'OPTIONS', token: null });
  assert(preflight.status === 204 && preflight.headers.get('access-control-allow-origin') === origin, 'allowed CORS preflight needs no user token');
  const forbidden = await request({ method: 'OPTIONS', token: null, headers: { Origin: 'https://untrusted.example' } });
  assert(forbidden.status === 403 && forbidden.error?.code === 'FORBIDDEN' && !forbidden.headers.has('access-control-allow-origin'), 'untrusted origin receives no CORS access');
  const missing = await request({ token: null });
  assert(missing.status === 401 && missing.error?.code === 'AUTH_REQUIRED', 'missing bearer token is rejected');
  const invalid = await request({ token: 'invalid-jwt' });
  assert(invalid.status === 401 && ['AUTH_REQUIRED', 'AUTH_EXPIRED'].includes(invalid.error?.code), 'invalid bearer token is rejected');
  const wrongType = await request({ headers: { 'Content-Type': 'text/plain' } });
  assert(wrongType.status === 400 && wrongType.error?.code === 'VALIDATION_ERROR', 'non-JSON requests are rejected');
  const unknown = await request({ body: { userId: randomUUID() } });
  assert(unknown.status === 400 && unknown.error?.code === 'VALIDATION_ERROR', 'strict schema rejects browser-supplied owner fields');
  const oversized = await request({ body: { message: 'x'.repeat(33_000) } });
  assert(oversized.status === 400 && oversized.error?.code === 'VALIDATION_ERROR', 'request body above 32 KiB is rejected');
  assert(oversized.headers.get('cache-control') === 'no-store' && oversized.meta?.schemaVersion === 1, 'Edge error envelope is versioned and not cacheable');
  const rate = await user.client.rpc('consume_location_rate_limit', { p_user_id: user.id });
  const execution = await user.client.rpc('begin_saju_compatibility_request', { p_params: { user_id: user.id } });
  assert(Boolean(rate.error) && Boolean(execution.error), 'browser cannot execute service-only rate or compatibility RPCs');
}

export async function checkCompatibility({ admin, a, b, other, city, ownInput, api, conversation, assert, observations }) {
  const conv = await conversation(a, 'ARANG');
  const partnerInput = { ...ownInput, birthDate: '1995-08-21', birthTime: '08:20', gender: 'MALE' };
  const body = { action: 'CALCULATE_SAJU', conversationId: conv, consultationId: null, requestId: randomUUID(),
    personA: { input: ownInput, saveProfile: false }, personB: { input: partnerInput, alias: '테스트 관련인', saveRelatedPerson: false } };
  const injected = await admin.from('conversations').update({ summary: 'SMOKE_CONTEXT_BUDGET_'.repeat(1600) }).eq('id', conv).eq('user_id', a.id);
  assert(!injected.error, 'disposable oversized-context failure probe is prepared');
  let result;
  try { result = await api(a, 'compatibility', body); }
  finally {
    const restored = await admin.from('conversations').update({ summary: null }).eq('id', conv).eq('user_id', a.id);
    assert(!restored.error, 'disposable context failure probe is removed');
  }
  interpretation(result, 'compatibility calculation', assert);
  assert(result.data.executionStatus === 'PARTIAL' && result.data.partialError?.code === 'COMPATIBILITY_INTERPRETATION_FAILED'
    && ['INTERNAL_ERROR', 'LLM_UNAVAILABLE'].includes(result.data.partialError?.details?.reason), 'compatibility preserves deterministic result when interpretation cannot start');
  observations.push({ name: 'compatibility partial probe', requestedFailure: 'OVERSIZED_DISPOSABLE_CONTEXT', observedReason: result.data.partialError.details.reason,
    attribution: result.data.partialError.details.reason === 'LLM_UNAVAILABLE'
      ? 'Provider configuration/availability prevented inference; context rejection was not observed.'
      : 'Interpretation failed under an oversized test context; this does not claim a provider outage.' });
  const readingId = result.data.compatibilityReadingId;
  assert(Boolean(readingId) && result.data.ruleVersion === 'JumZipSajuRules-v1' && !('result' in result.data), 'compatibility API exposes versioned inline result');
  const stored = await a.client.from('saju_compatibility_readings').select('*').eq('id', readingId).single();
  assert(!stored.error && stored.data?.result_snapshot?.kind === 'SAJU_COMPATIBILITY' && Boolean(stored.data.result_snapshot.personA) && Boolean(stored.data.result_snapshot.personB), 'compatibility detail reload retains both derived charts');
  const reload = await a.client.from('messages').select('metadata').eq('conversation_id', conv).eq('type', 'COMPATIBILITY_SNAPSHOT');
  assert(!reload.error && reload.data?.length === 1 && reload.data[0].metadata?.compatibility?.compatibilityReadingId === readingId && reload.data[0].metadata.compatibility.executionStatus === 'PARTIAL', 'compatibility partial snapshot survives page reload');
  const consultation = await a.client.from('consultations').select('input').eq('id', result.data.consultationId).single();
  const execution = await admin.from('request_executions').select('response_data,error').eq('user_id', a.id).eq('request_id', body.requestId).single();
  const profiles = await a.client.from('birth_profiles').select('id');
  const related = await a.client.from('related_people').select('id');
  assert(!consultation.error && !execution.error && !profiles.error && !related.error && profiles.data.length === 0 && related.data.length === 0, 'without save consent compatibility creates no birth profiles or related people');
  const durable = [stored.data.result_snapshot, stored.data.a_chart_snapshot, stored.data.b_chart_snapshot, reload.data, consultation.data.input, execution.data.response_data, execution.data.error, result.data];
  assert(durable.every(noRawBirthFields) && !JSON.stringify(durable).includes(partnerInput.birthDate), 'raw partner birth fields are absent from derived readings and durable message/execution snapshots');
  const replay = await api(a, 'compatibility', body);
  assert(replay.ok && replay.data.compatibilityReadingId === readingId && same(replay.data.summary, result.data.summary), 'same compatibility request replays saved result');
  const changed = await api(a, 'compatibility', { ...body, personB: { ...body.personB, input: { ...partnerInput, birthTime: '08:21' } } });
  assert(changed.status === 409 && changed.error?.code === 'IDEMPOTENCY_KEY_REUSED', 'changed compatibility payload conflicts with reused request ID');
  const blocked = await b.client.from('saju_compatibility_readings').select('id').eq('id', readingId);
  assert(!blocked.error && blocked.data.length === 0, 'RLS hides another user compatibility reading');
  const foreign = await api(b, 'compatibility', { action: 'RETRY_INTERPRETATION', conversationId: other, targetType: 'SAJU', targetId: readingId });
  assert(foreign.status === 404, 'compatibility retry enforces resource ownership');

  // Synthetic active lease, not a claim that two live model calls raced. The denied
  // request rolls its transaction/quota back; account A still uses only four SAJU calls.
  const leaseId = randomUUID();
  const lease = await admin.from('request_executions').insert({ id: leaseId, user_id: a.id, request_id: randomUUID(), operation: 'compatibility.RETRY_INTERPRETATION',
    payload_hash: '0'.repeat(64), status: 'PARTIAL', resource_type: 'COMPATIBILITY_SAJU', resource_id: readingId,
    conversation_id: conv, consultation_id: result.data.consultationId, lease_expires_at: new Date(Date.now() + 60_000).toISOString() });
  assert(!lease.error, 'disposable active resource lease is prepared');
  try {
    const overlap = await api(a, 'compatibility', { action: 'RETRY_INTERPRETATION', conversationId: conv, targetType: 'SAJU', targetId: readingId });
    assert(overlap.status === 409 && overlap.error?.code === 'REQUEST_IN_PROGRESS', 'live resource lease blocks overlapping retry');
  } finally {
    const removed = await admin.from('request_executions').delete().eq('id', leaseId).eq('user_id', a.id);
    assert(!removed.error, 'disposable active resource lease is removed');
  }
  const retry = await api(a, 'compatibility', { action: 'RETRY_INTERPRETATION', conversationId: conv, targetType: 'SAJU', targetId: readingId });
  interpretation(retry, 'compatibility retry', assert);
  if (retry.data.executionStatus === 'PARTIAL') assert(['LLM_UNAVAILABLE', 'LLM_TIMEOUT', 'LLM_INVALID_RESPONSE'].includes(retry.data.partialError?.details?.reason), 'clean-context retry fails only with recognized inference error');
  const after = await a.client.from('saju_compatibility_readings').select('id,result_snapshot').eq('consultation_id', result.data.consultationId);
  assert(!after.error && after.data.length === 1 && same(after.data[0].result_snapshot, stored.data.result_snapshot) && retry.data.compatibilityReadingId === readingId && same(retry.data.summary, result.data.summary), 'compatibility retry never recalculates or replaces immutable derived result');

  // Explicit-save positive case uses account B's independent SAJU quota.
  const consented = await api(b, 'compatibility', { ...body, requestId: randomUUID(), conversationId: other,
    personB: { input: partnerInput, alias: '저장 동의 테스트', saveRelatedPerson: true } });
  interpretation(consented, 'explicit partner-save compatibility', assert);
  const people = await b.client.from('related_people').select('id,birth_data_opt_in,memory_opt_in');
  const births = await b.client.from('birth_profiles').select('related_person_id,birth_date,location_provider_id,location_verified_at').eq('owner_type', 'RELATED_PERSON');
  assert(!people.error && !births.error && people.data.length === 1 && births.data.length === 1
    && people.data[0].birth_data_opt_in === true && people.data[0].memory_opt_in === false && births.data[0].related_person_id === people.data[0].id
    && births.data[0].birth_date === partnerInput.birthDate && births.data[0].location_provider_id === city.providerId && Boolean(births.data[0].location_verified_at),
  'explicit partner birth save retains provider provenance without enabling memory consent');
  assert(noRawBirthFields(consented.data), 'explicit profile consent does not expose raw birth fields in compatibility response');
}

export async function checkLocationRate({ admin, user, api, assert }) {
  const bucket = new Date(); bucket.setUTCHours(0, 0, 0, 0);
  const seeded = await admin.from('rate_limit_buckets').upsert({ user_id: user.id, subject_key: user.id, operation: 'LOCATION_DAY', bucket_start: bucket.toISOString(), count: 500 }, { onConflict: 'subject_key,operation,bucket_start' });
  assert(!seeded.error, 'disposable location daily ceiling is prepared');
  const limited = await api(user, 'saju', { action: 'RESOLVE_LOCATION', query: 'Seoul', limit: 1 });
  assert(limited.status === 429 && limited.error?.code === 'RATE_LIMITED' && Number(limited.headers.get('retry-after')) > 0, 'location lookup enforces daily limit with Retry-After');
  const executions = await admin.from('request_executions').select('id').eq('user_id', user.id).eq('operation', 'saju.RESOLVE_LOCATION');
  assert(!executions.error && executions.data.length === 0, 'location lookup creates no fortune execution');
}
