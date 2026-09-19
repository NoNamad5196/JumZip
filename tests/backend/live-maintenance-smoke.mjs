// Prepare-only: node --experimental-transform-types tests/backend/live-maintenance-smoke.mjs --plan
// Authorized live invocation after migration/provider approval:
// node --experimental-transform-types --env-file=.env.server.local tests/backend/live-maintenance-smoke.mjs
import { createClient } from '@supabase/supabase-js';
import { randomUUID, createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createOpenAICompatibleProvider } from '../../supabase/functions/_shared/llm/provider.ts';
import { createMemoryMaintenance, maintainMemory, MEMORY_PROVIDER_LIMITS } from '../../supabase/functions/_shared/orchestration/memory.ts';
import { createRepository } from '../../supabase/functions/_shared/persistence/repository.ts';
import { summaryTurns, privateTurn, repeatedPreference, relatedTurn } from './live-maintenance-fixtures.mjs';

const LIMIT_NEURONS = 250, MAX_HTTP = 14, MAX_INITIAL = 7;
const rates = {
  '@cf/qwen/qwen3-30b-a3b-fp8': { input: 4625, output: 30475 },
  '@cf/google/gemma-4-26b-a4b-it': { input: 9091, output: 27273 },
};
const plan = { scope: 'Real structured extraction/summary plus remote owner consent/persistence; synthetic USER fixture rows only. No Chat reply, intent, title, public signup or background-hook claim.',
  userFixtureCount: summaryTurns.length, expectedInitialCalls: 6, maximumInitialCalls: MAX_INITIAL, maximumHttpCallsIncludingRepair: MAX_HTTP, maximumAccountedNeurons: LIMIT_NEURONS,
  providerLimits: MEMORY_PROVIDER_LIMITS,
  stages: ['three extraction batches, with real summary after seventeen USER turns', 'private turn: zero provider calls', 'profile OFF: zero provider calls and empty derived reply context',
    'disable/delete an actually extracted USER memory, repeat preference, inspect suppression', 'related-person opt-in and real extraction', 'related-person withdrawal and repeat: blocked before provider', 'verified cleanup'],
  reserveBasis: 'Before each HTTP request reserve complete serialized UTF-8 body bytes as input tokens plus configured maximum output tokens, at official model neuron/token rates. Missing usage retains the reserve; no unaccounted retry.' };
if (process.argv.includes('--plan')) {
  if (summaryTurns.length !== 17 || summaryTurns.some(text => text.length > 3000)) throw new Error('Synthetic fixture invalid.');
  console.log(JSON.stringify(plan, null, 2));
} else {
  await live();
}

async function live() {
  const { SUPABASE_URL: url, SUPABASE_ANON_KEY: anon, SUPABASE_SERVICE_ROLE_KEY: secret, LLM_BASE_URL: baseUrl, LLM_API_KEY: apiKey } = process.env;
  const model = process.argv.find(value => value.startsWith('--model='))?.slice('--model='.length) ?? process.env.LLM_MODEL;
  if (!url || !anon || !secret || !baseUrl || !apiKey || !rates[model]) throw new Error('Private test configuration or supported model is missing.');
  const pricing = rates[model];
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(url, secret, options);
  const ledgerPath = 'test-results/pending-maintenance-smoke-cleanup.json';
  const ids = new Set(), checks = [], observations = [], responses = [];
  let stage = 'SETUP', httpCalls = 0, initialCalls = 0, accountedNeurons = 0, measuredNeurons = 0, allUsageMeasured = true, halted = false;
  const report = () => ({ at: new Date().toISOString(), ...plan, model, httpCalls, initialCalls, accountedNeurons, measuredNeurons, allUsageMeasured, checks, observations, pendingCleanupCount: ids.size });
  const safeSave = () => {
    mkdirSync('test-results', { recursive: true }); mkdirSync('docs/evidence', { recursive: true });
    writeFileSync('test-results/maintenance-smoke.json', JSON.stringify(report(), null, 2));
    writeFileSync('test-results/maintenance-smoke-synthetic-responses.json', JSON.stringify(responses, null, 2));
    writeFileSync('docs/evidence/backend-maintenance-smoke.json', JSON.stringify(report(), null, 2));
  };
  const saveLedger = () => { mkdirSync('test-results', { recursive: true }); writeFileSync(ledgerPath, JSON.stringify({ at: new Date().toISOString(), ids: [...ids] }, null, 2)); };
  const assert = (condition, name) => { checks.push({ name, passed: Boolean(condition) }); if (!condition) throw new Error(name); console.log(`PASS ${name}`); };
  const read = async query => { const result = await query; if (result.error) throw new Error('TEST_DATABASE_FAILURE'); return result.data; };
  async function cleanup(id) {
    const found = await admin.auth.admin.getUserById(id);
    if (!found.error) {
      if (found.data.user?.user_metadata?.test_run !== 'JumZip maintenance smoke' || !/^jumzip-maintenance-smoke-[0-9a-f-]+@example\.com$/i.test(found.data.user?.email ?? '')) return false;
      if ((await admin.auth.admin.deleteUser(id, false)).error) return false;
    } else if (found.error.status !== 404) return false;
    const absent = await admin.auth.admin.getUserById(id);
    if (absent.data.user || absent.error?.status !== 404) return false;
    for (const table of ['profiles', 'messages', 'conversations', 'consultations', 'memories', 'memory_suppressions', 'related_people', 'birth_profiles', 'request_executions']) {
      const result = await admin.from(table).select(table === 'profiles' ? 'id' : 'user_id', { head: true, count: 'exact' }).eq(table === 'profiles' ? 'id' : 'user_id', id);
      if (result.error || result.count) return false;
    }
    ids.delete(id); saveLedger(); return true;
  }
  const provider = createOpenAICompatibleProvider({ baseUrl, apiKey, model, structuredFormat: 'json_object', ...MEMORY_PROVIDER_LIMITS,
    async fetchImpl(endpoint, init) {
      const body = JSON.parse(init.body);
      const repair = body.messages.some(message => message.role === 'assistant');
      const reserve = (Buffer.byteLength(init.body, 'utf8') * pricing.input + body.max_tokens * pricing.output) / 1_000_000;
      if (halted || httpCalls >= MAX_HTTP || !repair && initialCalls >= MAX_INITIAL || accountedNeurons + reserve > LIMIT_NEURONS) { halted = true; throw new Error('SMOKE_BUDGET_STOP'); }
      httpCalls += 1; if (!repair) initialCalls += 1; accountedNeurons += reserve;
      const started = Date.now();
      try {
        const result = await fetch(endpoint, init);
        const payload = await result.clone().json();
        const usage = payload.usage;
        const tokensKnown = Number.isFinite(usage?.prompt_tokens) && Number.isFinite(usage?.completion_tokens);
        const tokenCost = tokensKnown ? (usage.prompt_tokens * pricing.input + usage.completion_tokens * pricing.output) / 1_000_000 : null;
        const measured = Number.isFinite(usage?.neurons) && usage.neurons >= 0 ? usage.neurons : null;
        const charged = measured !== null ? Math.max(measured, tokenCost ?? 0) : tokenCost ?? reserve;
        accountedNeurons += charged - reserve;
        if (measured !== null) measuredNeurons += measured; else allUsageMeasured = false;
        const item = { stage, attempt: httpCalls, repair, httpStatus: result.status, latencyMs: Date.now() - started, reservedNeurons: reserve, chargedNeurons: charged,
          measuredNeurons: measured, estimated: measured === null, promptTokens: tokensKnown ? usage.prompt_tokens : null, completionTokens: tokensKnown ? usage.completion_tokens : null,
          finishReason: payload.choices?.[0]?.finish_reason ?? null };
        observations.push(item);
        responses.push({ ...item, syntheticContent: payload.choices?.[0]?.message?.content ?? null });
        if (!result.ok || charged > reserve || accountedNeurons > LIMIT_NEURONS) halted = true;
        safeSave();
        return result;
      } catch {
        // Retain the full pre-call reserve when transport/accounting is uncertain.
        halted = true; allUsageMeasured = false;
        observations.push({ stage, attempt: httpCalls, repair, outcome: 'TRANSPORT_OR_ACCOUNTING_FAILED', reservedNeurons: reserve }); safeSave();
        throw new Error('TEST_PROVIDER_FAILURE');
      }
    },
  });
  try {
    if (existsSync(ledgerPath)) {
      for (const id of JSON.parse(readFileSync(ledgerPath, 'utf8')).ids ?? []) {
        if (typeof id !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) throw new Error('Invalid cleanup ledger.');
        ids.add(id);
      }
      for (const id of [...ids]) assert(await cleanup(id), 'previous maintenance fixture cleanup verified');
    }
    const email = `jumzip-maintenance-smoke-${randomUUID()}@example.com`;
    const created = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { test_run: 'JumZip maintenance smoke' } });
    if (created.error || !created.data.user) throw new Error('Disposable creation failed.');
    const id = created.data.user.id; ids.add(id); saveLedger();
    const client = createClient(url, anon, options);
    const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
    if (link.error || link.data.user?.id !== id || !link.data.properties?.hashed_token) throw new Error('Disposable link failed.');
    const session = await client.auth.verifyOtp({ type: 'magiclink', token_hash: link.data.properties.hashed_token });
    if (session.error || session.data.user?.id !== id) throw new Error('Disposable verification failed.');
    const conversation = await read(client.from('conversations').insert({ user_id: id, character_id: 'BOMI' }).select('id').single());
    const conv = conversation.id;
    const maintenance = createMemoryMaintenance(admin, provider);
    const current = () => maintenance.store.state(id, conv);
    assert(Array.isArray((await current()).blockedRelatedPeople), 'remote consent-state contract is available');
    const rows = () => read(client.from('memories').select('id,subject,content,disabled_at').eq('user_id', id));
    async function addSources(texts) {
      // Separate writes use authoritative server timestamps after the preceding
      // consent transaction. Do not invent future times or one shared batch time.
      const inserted = [];
      for (const content of texts) inserted.push(await read(admin.from('messages').insert({ user_id: id, conversation_id: conv, sender: 'USER', type: 'TEXT', content }).select('id,created_at').single()));
      return inserted;
    }
    const original = await addSources(summaryTurns);
    for (let batch = 1; batch <= 3; batch++) {
      stage = `SUMMARY_BATCH_${batch}`;
      await maintainMemory(maintenance, id, conv, 'BOMI');
      const after = await current();
      assert(after.lastExtractedMessageId === original[Math.min(batch * 8, 17) - 1].id, `real extraction batch ${batch} commits its source cursor`);
      if (batch < 3) assert(!after.summary, `summary is not compacted before seventeen USER turns (batch ${batch})`);
    }
    const compacted = await current();
    assert(Boolean(compacted.summary && compacted.summary.length <= 1600 && compacted.summary.includes('종이')), 'real model produces a persisted grounded seventeen-turn summary');
    assert(Boolean(compacted.summaryCursorAt), 'summary cursor is persisted');
    let stored = await rows();
    assert(stored.some(row => row.subject === 'USER' && !row.disabled_at && row.content.includes('종이별')), 'actual extractor persists the synthetic preference');
    const unchanged = await read(admin.from('messages').select('sender,content').eq('user_id', id).order('created_at'));
    assert(unchanged.length === 17 && unchanged.every(row => row.sender === 'USER') && createHash('sha256').update(JSON.stringify(unchanged.map(row => row.content))).digest('hex') === createHash('sha256').update(JSON.stringify(summaryTurns)).digest('hex'), 'summary compaction preserves every original USER row without a seeded assistant');

    stage = 'PRIVATE_TURN'; const privateSource = await addSources([privateTurn]); const beforePrivate = httpCalls;
    await maintainMemory(maintenance, id, conv, 'BOMI');
    assert(httpCalls === beforePrivate && (await current()).lastExtractedMessageId === privateSource[0].id, 'private turn advances cursor without any provider call');
    assert(!(await rows()).some(row => /은빛|모빌/.test(row.content)), 'private source is absent from memory');

    stage = 'PROFILE_OFF'; await read(client.from('profiles').update({ memory_enabled: false }).eq('id', id));
    const beforeOff = httpCalls; await maintainMemory(maintenance, id, conv, 'BOMI');
    assert(httpCalls === beforeOff && !(await current()).summary, 'profile OFF does no provider work and clears summary');
    const context = await createRepository(admin).context(id, { executionId: randomUUID(), conversationId: conv, characterId: 'BOMI', consultationId: randomUUID() });
    assert(context.memories.length === 0 && context.summary === '', 'profile OFF excludes derived context without depending on recall response');
    await read(client.from('profiles').update({ memory_enabled: true }).eq('id', id));

    stage = 'DELETE_MEMORY'; stored = await rows();
    const own = stored.filter(row => row.subject === 'USER').map(row => row.id);
    assert(own.length > 0, 'withdrawal test uses actual extracted rows');
    await read(client.from('memories').update({ disabled_at: new Date().toISOString() }).in('id', own));
    const disabledContext = await createRepository(admin).context(id, { executionId: randomUUID(), conversationId: conv, characterId: 'BOMI', consultationId: randomUUID() });
    assert(!disabledContext.memories.some(row => own.includes(row.id)), 'disabled actual memory is excluded from reply context');
    await read(client.from('memories').delete().in('id', own));
    await addSources([repeatedPreference]); await maintainMemory(maintenance, id, conv, 'BOMI');
    assert(!(await rows()).some(row => row.subject === 'USER') && !(await current()).summary, 'fresh repeated preference cannot revive deleted USER memory or old summary');

    stage = 'RELATED_OPT_IN';
    const related = await read(client.from('related_people').insert({ user_id: id, display_name: '솔새', relation: '친구', memory_opt_in: true }).select('id,birth_data_opt_in').single());
    assert(!related.birth_data_opt_in, 'related memory opt-in does not grant birth-data storage consent');
    await addSources([relatedTurn]); await maintainMemory(maintenance, id, conv, 'BOMI');
    const subject = `RELATED_PERSON:${related.id}`;
    assert((await rows()).some(row => row.subject === subject && row.content.includes('바람개비')), 'actual extractor persists the consenting related-person preference');

    stage = 'RELATED_WITHDRAWAL'; await read(client.from('related_people').update({ memory_opt_in: false }).eq('id', related.id));
    assert(!(await rows()).some(row => row.subject === subject), 'related withdrawal immediately removes their structured memory');
    await addSources([relatedTurn]); const beforeRevoked = httpCalls; await maintainMemory(maintenance, id, conv, 'BOMI');
    assert(httpCalls === beforeRevoked && !(await rows()).some(row => row.subject === subject), 'known withdrawn alias is excluded before provider and cannot be re-extracted');
    assert(initialCalls <= MAX_INITIAL && httpCalls <= MAX_HTTP && accountedNeurons <= LIMIT_NEURONS, 'actual provider work stays within approved call and neuron limits');
  } catch (error) {
    process.exitCode = 1;
    const code = ['LLM_TIMEOUT', 'LLM_INVALID_RESPONSE', 'LLM_UNAVAILABLE', 'LLM_AUTH_FAILED', 'LLM_RATE_LIMITED'].includes(error?.code) ? error.code : halted ? 'SMOKE_BUDGET_OR_TRANSPORT_STOP' : 'SMOKE_ASSERTION_OR_SETUP_FAILED';
    const failed = checks.findLast(check => !check.passed)?.name ?? null;
    observations.push({ stage, outcome: 'FAILED', code, failedCheck: failed }); console.error(`FAIL ${stage}: ${code}`);
  } finally {
    for (const id of [...ids]) {
      let clean = false; try { clean = await cleanup(id); } catch { /* Retain ledger for verified recovery. */ }
      checks.push({ name: 'verified disposable maintenance account cleanup', passed: clean });
      if (!clean) process.exitCode = 1;
    }
    safeSave();
    console.log(JSON.stringify({ checksPassed: checks.filter(check => check.passed).length, checksFailed: checks.filter(check => !check.passed).length, httpCalls, initialCalls, accountedNeurons, measuredNeurons, pendingCleanupCount: ids.size }));
  }
}
