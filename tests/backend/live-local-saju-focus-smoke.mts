/** Opt-in local Auth/Postgres/RPC integration, with an explicit generator double.
 * No hosted env is loaded. Default invocation only prints the zero-network plan. */
import { createClient } from '@supabase/supabase-js';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createSajuActionExecutor } from '../../supabase/functions/_shared/orchestration/saju.ts';
import { createSajuRepository, type SajuFocus } from '../../supabase/functions/_shared/persistence/saju.ts';
import { createRepository } from '../../supabase/functions/_shared/persistence/repository.ts';
import { calculateFullSajuWithTiming } from '../../supabase/functions/_shared/domain/fortune-timing.ts';
import { buildSajuInterpretationData } from '../../supabase/functions/_shared/domain/full-saju.ts';
import { canonicalJson, sajuRequestSchema, type SajuRequest } from '../../supabase/functions/_shared/validation/requests.ts';
import { ApiFailure } from '../../supabase/functions/_shared/http/errors.ts';
import type { PersonaPromptInput } from '../../supabase/functions/_shared/persona/prompt.ts';

const TARGET = 'http://127.0.0.1:54321';
const MARKER = 'JumZip local Saju focus retry integration';
const LEDGER = 'test-results/pending-local-saju-focus-cleanup.json';
const EVIDENCE = 'docs/evidence/backend-local-saju-focus.json';
const AS_OF = '2026-09-20T00:00:00.000Z';
const FOCI: readonly SajuFocus[] = ['GENERAL', 'CAREER', 'RELATIONSHIP', 'YEAR_FLOW', 'MONTH_FLOW'];
const TABLES = ['profiles', 'conversations', 'consultations', 'messages', 'tarot_draw_groups', 'tarot_draws', 'birth_profiles', 'saju_readings', 'saju_compatibility_readings', 'related_people', 'memories', 'memory_suppressions', 'request_executions', 'rate_limit_buckets', 'daily_draw_claims'];
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const SOURCE_FILES = [
  'tests/backend/live-local-saju-focus-smoke.mts',
  'supabase/functions/_shared/orchestration/saju.ts',
  'supabase/functions/_shared/persistence/saju.ts',
  'supabase/functions/_shared/persistence/repository.ts',
  'supabase/functions/_shared/domain/full-saju.ts',
  'supabase/functions/_shared/domain/fortune-timing.ts',
  'supabase/functions/_shared/validation/requests.ts',
];
const plan = {
  target: TARGET, mode: 'LOCAL_DATABASE_INTEGRATION_WITH_GENERATOR_DOUBLE',
  focusCases: FOCI, identities: 3, sajuQuotaByIdentity: [4, 4, 2],
  sequence: 'CALCULATE → injected timeout/PARTIAL → RETRY_INTERPRETATION/success double → same request UUID replay',
  actualComponents: ['local Auth', 'Supabase REST', 'Postgres RPCs', 'createSajuRepository', 'createRepository', 'Saju orchestrator', 'pure Saju engine'],
  boundaries: ['exact owner/conversation/type filters', 'missing and invalid stored focus', 'unchanged calculation/asOf', 'replay without calculation/generation/focus query'],
  doubles: ['Only the interpretation generator: first timeout, then clearly labeled synthetic text.'],
  seededProvenance: 'Synthetic birth profile has a server-verified location marker; location-provider verification is not exercised.',
  modelRequests: 0, externalRequests: 0, edgeRequests: 0,
  cleanup: 'Immediate secret-free synthetic-ID ledger; finally verify Auth404 and zero rows in 15 owned tables.',
  runCommand: 'JUMZIP_RUN_LOCAL_SAJU_FOCUS=LOCAL node --experimental-transform-types tests/backend/live-local-saju-focus-smoke.mts --run',
  permission: 'Run only after Main confirms backend source freeze and gives local execution GO.',
};

const digest = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex');
const sourceHashes = () => Object.fromEntries([...SOURCE_FILES,
  ...readdirSync('supabase/migrations').filter(name => name.endsWith('.sql')).sort().map(name => `supabase/migrations/${name}`),
].map(path => [path, createHash('sha256').update(readFileSync(path, 'utf8').replace(/\r\n/g, '\n')).digest('hex')]));
const object = (value: unknown): Record<string, any> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw Error('UNEXPECTED_RESULT_SHAPE');
  return value as Record<string, any>;
};
const safeError = (error: unknown) => error instanceof ApiFailure
  ? { code: /^[A-Z0-9_]{1,80}$/.test(error.code) ? error.code : 'UNEXPECTED_FAILURE', status: error.status }
  : { code: error instanceof Error && /^[A-Z0-9_]{1,100}$/.test(error.message) ? error.message : 'UNEXPECTED_FAILURE' };

if (!process.argv.includes('--run')) console.log(JSON.stringify({ ...plan, sourceHashes: sourceHashes() }, null, 2));
else if (process.env.JUMZIP_RUN_LOCAL_SAJU_FOCUS !== 'LOCAL') {
  console.log(JSON.stringify({ status: 'NOT_RUN', code: 'EXPLICIT_LOCAL_OPT_IN_REQUIRED' })); process.exitCode = 1;
} else {
  try { await live(); }
  catch (error) { console.log(JSON.stringify({ status: 'FAILED', ...safeError(error), evidence: EVIDENCE })); process.exitCode = 1; }
}

async function live() {
  const before = sourceHashes();
  // stdout contains local keys. It remains in memory and is never logged or saved.
  const status = spawnSync(process.execPath, ['node_modules/supabase/dist/supabase.js', 'status', '-o', 'json'],
    { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  if (status.status !== 0) throw Error('LOCAL_STATUS_UNAVAILABLE');
  let config: Record<string, unknown>;
  try { config = object(JSON.parse(status.stdout)); } catch { throw Error('LOCAL_STATUS_INVALID'); }
  if (config.API_URL !== TARGET || typeof config.ANON_KEY !== 'string' || typeof config.SERVICE_ROLE_KEY !== 'string') throw Error('LOCAL_TARGET_REQUIRED');

  const nativeFetch = globalThis.fetch;
  const counts = { authRequests: 0, restRequests: 0, blockedDestinations: 0, modelRequests: 0, externalRequests: 0, edgeRequests: 0 };
  const guardedFetch: typeof fetch = (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.origin !== TARGET || url.username || url.password || !/^\/(auth|rest)\/v1(?:\/|$)/.test(url.pathname)) {
      counts.blockedDestinations += 1; throw Error('NONLOCAL_OR_EDGE_REQUEST_BLOCKED');
    }
    counts[url.pathname.startsWith('/auth/') ? 'authRequests' : 'restRequests'] += 1;
    const timeout = AbortSignal.timeout(20_000);
    return nativeFetch(input, { ...init, redirect: 'error', signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
  };
  globalThis.fetch = guardedFetch;
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: guardedFetch } };
  const admin = createClient(TARGET, config.SERVICE_ROLE_KEY, options);
  const readings = createSajuRepository(admin), executions = createRepository(admin);
  const pending = new Set<string>();
  const checks: { name: string; passed: boolean }[] = [];
  const cases: Record<string, unknown>[] = [];
  const cleanup: { authAbsent: boolean; emptyOwnedTables: number }[] = [];
  let stage = 'SETUP'; let failure: ReturnType<typeof safeError> | null = null; let completed = false;
  const ledger = () => {
    mkdirSync('test-results', { recursive: true });
    writeFileSync(LEDGER, JSON.stringify({ target: TARGET, marker: MARKER, ids: [...pending] }, null, 2) + '\n');
  };
  const required = (condition: unknown, name: string) => {
    checks.push({ name, passed: Boolean(condition) });
    if (!condition) throw Error('LOCAL_ASSERTION_FAILED');
  };
  const read = async <T,>(query: PromiseLike<{ data: T; error: unknown }>): Promise<NonNullable<T>> => {
    const result = await query; if (result.error || result.data === null) throw Error('LOCAL_DATABASE_QUERY_FAILED'); return result.data as NonNullable<T>;
  };
  const mutate = async (query: PromiseLike<{ error: unknown }>) => {
    if ((await query).error) throw Error('LOCAL_DATABASE_WRITE_FAILED');
  };
  const expectFailure = async (name: string, action: () => Promise<unknown>, code: string, httpStatus: number) => {
    let caught: unknown; try { await action(); } catch (error) { caught = error; }
    required(caught instanceof ApiFailure && caught.code === code && caught.status === httpStatus, name);
  };

  async function remove(id: string) {
    const found = await admin.auth.admin.getUserById(id);
    if (!found.error) {
      if (found.data.user?.user_metadata?.test_run !== MARKER || !/^jumzip-local-focus-[0-9a-f-]+@example\.com$/i.test(found.data.user?.email ?? '')) throw Error('CLEANUP_OWNERSHIP_GUARD');
      if ((await admin.auth.admin.deleteUser(id, false)).error) throw Error('LOCAL_CLEANUP_DELETE_FAILED');
    } else if (found.error.status !== 404) throw Error('LOCAL_CLEANUP_AUTH_LOOKUP_FAILED');
    const absent = await admin.auth.admin.getUserById(id);
    if (absent.data.user || absent.error?.status !== 404) throw Error('LOCAL_CLEANUP_AUTH_REMAINS');
    for (const table of TABLES) {
      const column = table === 'profiles' ? 'id' : 'user_id';
      const rows = await admin.from(table).select(column, { head: true, count: 'exact' }).eq(column, id);
      if (rows.error || rows.count !== 0) throw Error('LOCAL_CLEANUP_ROWS_REMAIN');
    }
    pending.delete(id); ledger(); cleanup.push({ authAbsent: true, emptyOwnedTables: TABLES.length });
  }

  async function identity() {
    const email = `jumzip-local-focus-${randomUUID()}@example.com`;
    const created = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { test_run: MARKER } });
    if (created.error || !created.data.user) throw Error('LOCAL_IDENTITY_CREATE_FAILED');
    const id = created.data.user.id; pending.add(id); ledger();
    await mutate(admin.from('profiles').update({ display_name: '합성검증', memory_enabled: false }).eq('id', id));
    const client = createClient(TARGET, config.ANON_KEY as string, options);
    const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
    if (link.error || link.data.user?.id !== id || !link.data.properties?.hashed_token) throw Error('LOCAL_IDENTITY_LINK_FAILED');
    const verified = await client.auth.verifyOtp({ type: 'magiclink', token_hash: link.data.properties.hashed_token });
    if (verified.error || verified.data.user?.id !== id || !verified.data.session) throw Error('LOCAL_IDENTITY_SESSION_FAILED');
    const authenticated = await client.auth.getUser(verified.data.session.access_token);
    if (authenticated.error || authenticated.data.user?.id !== id) throw Error('LOCAL_IDENTITY_VERIFY_FAILED');
    const conversation = await read(client.from('conversations').insert({ user_id: id, character_id: 'SANI', title: '합성 사주 focus 재시도' }).select('id').single());
    const birth = await read(admin.from('birth_profiles').insert({ user_id: id, owner_type: 'USER', calendar_type: 'SOLAR', leap_month: false,
      birth_date: '1990-05-10', birth_time: '12:30', unknown_birth_time: false, city: 'Seoul', country: 'South Korea',
      latitude: 37.5665, longitude: 126.978, timezone: 'Asia/Seoul', gender: 'MALE', location_provider: 'open-meteo',
      location_provider_id: '1835848', location_resolved_at: AS_OF, location_verified_at: AS_OF }).select('id').single());
    // No client, session or token escapes this function.
    return { id, isAnonymous: false, conversationId: conversation.id as string, profileId: birth.id as string };
  }

  try {
    if (existsSync(LEDGER)) {
      const old = object(JSON.parse(readFileSync(LEDGER, 'utf8')));
      if (old.target !== TARGET || old.marker !== MARKER || !Array.isArray(old.ids) || old.ids.some((id: unknown) => typeof id !== 'string' || !UUID.test(id))) throw Error('CLEANUP_LEDGER_MISMATCH');
      old.ids.forEach((id: string) => pending.add(id));
      for (const id of [...pending]) await remove(id);
    }
    const owners = [await identity(), await identity(), await identity()];
    const firstSnapshots: { consultationId: string; conversationId: string }[] = [];
    for (const [index, focus] of FOCI.entries()) {
      stage = focus; const owner = owners[Math.floor(index / 2)]!;
      const calls = { calculate: 0, generate: 0, readFocus: 0, readProfile: 0, save: 0, context: 0, now: 0 };
      const prompts: PersonaPromptInput[] = [];
      const execute = createSajuActionExecutor({
        readings: { ...readings,
          readFocus: async (userId, snapshot) => { calls.readFocus++; return readings.readFocus(userId, snapshot); },
          readUserBirthProfile: async (userId, profileId) => { calls.readProfile++; return readings.readUserBirthProfile(userId, profileId); },
          save: async input => { calls.save++; return readings.save(input); },
        },
        executions: { ...executions, context: async (userId, claim) => { calls.context++; return executions.context(userId, claim); } },
        calculate: (input, asOf) => { calls.calculate++; return calculateFullSajuWithTiming(input, asOf); },
        interpretationData: buildSajuInterpretationData,
        now: () => { calls.now++; return new Date(AS_OF); },
        generate: async input => {
          calls.generate++; prompts.push(input);
          if (calls.generate === 1) throw new ApiFailure('LLM_TIMEOUT', 504, '합성 timeout 대역', true);
          const content = `합성 생성기 대역: ${focus} 저장 자료 재사용 확인. 실제 모델 해석이 아닙니다.`;
          return { content, segments: [content], repaired: false, metadata: {
            model: 'TEST_DOUBLE_NO_MODEL', promptVersion: 'TEST_DOUBLE_FOCUS_V1', provider: 'openai-compatible', generatedAt: AS_OF,
          } };
        },
      });
      const request = sajuRequestSchema.parse({ schemaVersion: 1, action: 'CALCULATE', requestId: randomUUID(), conversationId: owner.conversationId,
        consultationId: null, subject: { birthProfileId: owner.profileId, saveProfile: false }, focus }) as Extract<SajuRequest, { action: 'CALCULATE' }>;
      const initial = object((await execute(request, owner)).data);
      required(initial.executionStatus === 'PARTIAL' && initial.interpretation === null && initial.partialError?.details?.reason === 'LLM_TIMEOUT', `${focus}: initial generator double yields stored PARTIAL`);
      const snapshot = { consultationId: initial.consultationId as string, conversationId: owner.conversationId };
      firstSnapshots.push(snapshot);
      const consultation = await read(admin.from('consultations').select('question').eq('id', snapshot.consultationId).eq('user_id', owner.id).single());
      required(consultation.question === focus && await readings.readFocus(owner.id, snapshot) === focus, `${focus}: actual owned DB focus matches exactly`);
      const fetchReading = () => read(admin.from('saju_readings').select('result_snapshot').eq('id', initial.readingId).eq('user_id', owner.id).eq('consultation_id', snapshot.consultationId).single());
      const savedBefore = (await fetchReading()).result_snapshot;
      required(savedBefore.timing?.asOf === AS_OF, `${focus}: actual snapshot preserves supplied server asOf`);
      const retry = sajuRequestSchema.parse({ schemaVersion: 1, action: 'RETRY_INTERPRETATION', requestId: randomUUID(), conversationId: owner.conversationId,
        readingId: initial.readingId }) as Extract<SajuRequest, { action: 'RETRY_INTERPRETATION' }>;
      const success = object((await execute(retry, owner)).data);
      required(success.executionStatus === 'SUCCEEDED' && success.readingId === initial.readingId, `${focus}: actual retry RPC completes original reading`);
      required(prompts.length === 2 && prompts.every(input => input.currentMessage === `사주 상담: ${focus}`), `${focus}: original and retry prompt keep exact focus`);
      required(digest(prompts[0]!.toolResult) === digest(prompts[1]!.toolResult), `${focus}: retry tool projection equals the initial persisted projection`);
      required(!canonicalJson(prompts).includes('1990-05-10') && !canonicalJson(prompts).includes('126.978'), `${focus}: generated context omits raw birth date and coordinates`);
      required(calls.calculate === 1 && calls.readProfile === 1 && calls.save === 1 && calls.now === 1 && calls.readFocus === 1, `${focus}: retry never recalculates, rereads birth profile, resaves or changes asOf`);
      const beforeReplay = { ...calls };
      const replay = object((await execute(retry, owner)).data);
      required(digest(replay) === digest(success) && digest(calls) === digest(beforeReplay), `${focus}: identical request UUID replays without application work`);
      const savedAfter = (await fetchReading()).result_snapshot;
      required(digest(savedAfter) === digest(savedBefore), `${focus}: DB deterministic snapshot is byte-canonically unchanged`);
      const rows = await read(admin.from('messages').select('id,model_id,prompt_version').eq('user_id', owner.id).eq('consultation_id', snapshot.consultationId).eq('sender', 'ASSISTANT'));
      required(rows.length === 1 && rows[0]?.model_id === 'TEST_DOUBLE_NO_MODEL' && rows[0]?.prompt_version === 'TEST_DOUBLE_FOCUS_V1', `${focus}: one explicitly labeled double message after replay`);
      cases.push({ focus, storedFocus: consultation.question, initialStatus: initial.executionStatus, retryStatus: success.executionStatus,
        replayStatus: replay.executionStatus, calls, snapshotSha256: digest(savedBefore), persistedAsOf: savedAfter.timing.asOf,
        engineVersion: savedAfter.engineVersion, ruleVersion: savedAfter.ruleVersion, conventionVersion: savedAfter.conventionVersion });
    }

    stage = 'FOCUS_QUERY_BOUNDARIES';
    const a = owners[0]!, b = owners[1]!, original = firstSnapshots[0]!;
    await expectFailure('readFocus rejects another owner through actual service-role filters', () => readings.readFocus(b.id, original), 'NOT_FOUND', 404);
    await expectFailure('readFocus rejects a wrong conversation through actual DB query', () => readings.readFocus(a.id, { ...original, conversationId: b.conversationId }), 'NOT_FOUND', 404);
    await expectFailure('readFocus rejects a missing consultation', () => readings.readFocus(a.id, { ...original, consultationId: randomUUID() }), 'NOT_FOUND', 404);
    const invalid = await read(admin.from('consultations').insert({ user_id: a.id, conversation_id: a.conversationId, character_id: 'SANI', fortune_type: 'CHAT', question: 'YEAR_FLOW' }).select('id').single());
    const invalidSnapshot = { consultationId: invalid.id as string, conversationId: a.conversationId };
    await expectFailure('readFocus rejects the wrong fortune type', () => readings.readFocus(a.id, invalidSnapshot), 'NOT_FOUND', 404);
    for (const [label, question] of [['empty', ''], ['lowercase', 'year_flow'], ['whitespace', 'YEAR_FLOW ']]) {
      await mutate(admin.from('consultations').update({ fortune_type: 'SAJU', question }).eq('id', invalid.id).eq('user_id', a.id));
      await expectFailure(`readFocus rejects ${label} focus without GENERAL fallback`, () => readings.readFocus(a.id, invalidSnapshot), 'SAJU_INPUT_INCOMPLETE', 422);
    }
    for (const [index, owner] of owners.entries()) {
      const buckets = await read(admin.from('rate_limit_buckets').select('count').eq('user_id', owner.id).eq('operation', 'SAJU'));
      required(buckets.reduce((sum, row) => sum + Number(row.count), 0) === plan.sajuQuotaByIdentity[index], `identity ${index + 1}: real quota unchanged by same-UUID replay`);
    }
    required(digest(sourceHashes()) === digest(before), 'scoped source and migration hashes remain frozen throughout integration');
    required(counts.blockedDestinations === 0, 'no code attempted external, model or Edge requests');
    completed = true;
  } catch (error) { failure = safeError(error); }
  finally {
    for (const id of [...pending]) {
      try { await remove(id); }
      catch { failure ??= { code: 'LOCAL_CLEANUP_INCOMPLETE' }; }
    }
    globalThis.fetch = nativeFetch;
    const report = { status: completed && !failure && pending.size === 0 ? 'PASS' : 'FAIL', at: new Date().toISOString(), target: TARGET, stage,
      scope: plan.mode, modelValidation: 'NOT_TESTED_GENERATOR_DOUBLE', actualEdgeHTTP: false, hostedDatabase: false,
      syntheticOnly: true, credentialsOrSessionsPersisted: false, rawIdentitiesReported: false,
      sourceHashes: before, sourceFrozen: digest(sourceHashes()) === digest(before), checks, cases, counts, cleanup,
      pendingCleanupCount: pending.size, failure, limitations: [
        'This is real local Supabase/Postgres integration, not a deployed Edge or LLM test.',
        'The model timeout and success are explicit generator doubles; semantic response quality is not evaluated.',
        'Synthetic verified-location profile seeding avoids external location-provider calls.',
        'Calculation equality verifies retry immutability; it is not an independent astronomical oracle.',
      ] };
    mkdirSync('docs/evidence', { recursive: true }); writeFileSync(EVIDENCE, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ status: report.status, checks: checks.length, passed: checks.filter(check => check.passed).length,
      focusCases: cases.length, modelRequests: 0, externalRequests: 0, cleanupVerified: cleanup.length, pendingCleanupCount: pending.size, evidence: EVIDENCE }));
  }
  if (failure || pending.size) throw Error(failure?.code ?? 'LOCAL_CLEANUP_INCOMPLETE');
}
