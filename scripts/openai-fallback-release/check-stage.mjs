import assert from 'node:assert/strict';
import { lstatSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { buildRelease, root, sha256 } from '../prepare-openai-fallback-release.mjs';

const stage = resolve(process.argv[2] ?? '');
if (!process.argv[2] || process.argv.length > 4 || process.argv[3] && process.argv[3] !== '--save-report') throw Error('STAGE_ARGUMENT_REQUIRED');
if (dirname(stage) !== resolve(root, 'supabase/.temp') || !basename(stage).startsWith('openai-fallback-v4-2-') || realpathSync(stage) !== stage || lstatSync(stage).isSymbolicLink()) throw Error('UNSAFE_STAGE_PATH');
// All requests below use an injected transport. Unexpected default fetch fails closed.
let blockedNetworkRequests = 0;
globalThis.fetch = async () => { blockedNetworkRequests++; throw Error('OFFLINE_NETWORK_FORBIDDEN'); };
const { report: expected, original } = buildRelease();
const manifestPath = resolve(stage, 'release-manifest.json');
const manifestBytes = readFileSync(manifestPath);
const manifest = JSON.parse(manifestBytes);
assert.deepEqual(manifest, expected);
const inventory = readdirSync(resolve(stage, 'supabase'), { recursive: true, withFileTypes: true });
assert.ok(inventory.every(item => !item.isSymbolicLink()), 'STAGE_SYMLINK_FORBIDDEN');
const paths = inventory.filter(item => item.isFile()).map(item => resolve(item.parentPath, item.name));
assert.deepEqual(paths.toSorted(), manifest.files.map(file => resolve(stage, file.path)).toSorted());
assert.equal(paths.length, 54);
const verifyFiles = () => {
  for (const file of manifest.files) {
    const bytes = readFileSync(resolve(stage, file.path));
    assert.equal(sha256(bytes), file.sha256, `STAGE_HASH_MISMATCH:${file.path}`);
    if (!file.changed) assert.deepEqual(bytes, original.get(file.path));
  }
  assert.equal(sha256(readFileSync(manifestPath)), sha256(manifestBytes));
};
verifyFiles();
assert.equal(manifest.files.filter(file => !file.changed).length, 47);
const modifiedPaths = ['http/errors.ts', 'llm/provider.ts', 'llm/reply.ts', 'orchestration/execute.ts', 'persona/config.ts', 'persona/prompt.ts'].map(path => 'supabase/functions/_shared/' + path).sort();
assert.deepEqual(manifest.files.filter(file => file.changed && !file.added).map(file => file.path).sort(), modifiedPaths);
assert.deepEqual(manifest.files.filter(file => file.added).map(file => file.path), ['supabase/functions/_shared/llm/budget.ts']);
assert.equal(manifest.paidScope, 'USER_FACING_REPLY_ONLY');
assert.equal(manifest.secondaryModel, 'gpt-5.6-luna');
assert.ok(!/gemini|generativelanguage/i.test(readFileSync(resolve(stage, 'supabase/functions/_shared/llm/provider.ts'), 'utf8')));
const importStage = path => import(pathToFileURL(resolve(stage, 'supabase/functions/_shared', path)).href);
const [{ createOpenAICompatibleProvider, CHAT_RESPONSE_SCHEMA }, { generatePersonaReply }, { validateChatOutput }, { buildPersonaMessages }, { createOpenAIBudget }, { safeFailure }] = await Promise.all([
  importStage('llm/provider.ts'), importStage('llm/reply.ts'), importStage('llm/validator.ts'), importStage('persona/prompt.ts'), importStage('llm/budget.ts'), importStage('http/errors.ts'),
]);
const oldProviderJs = ts.transpileModule(original.get('supabase/functions/_shared/llm/provider.ts').toString('utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const deployedProvider = await import(`data:text/javascript;base64,${Buffer.from(oldProviderJs).toString('base64')}`);
const primary = { baseUrl: 'https://api.cloudflare.com/client/v4/accounts/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/ai/v1', model: '@cf/qwen/qwen3-30b-a3b-fp8', apiKey: 'synthetic-primary-key' };
const fallback = { baseUrl: 'https://api.openai.com/v1', model: 'gpt-5.6-luna', apiKey: 'synthetic-secondary-key' };
const greetingInput = { characterId: 'BOMI', currentMessage: '안녕. 오늘 처음 이야기하러 왔어.' };
const greeting = JSON.stringify({ text: '안녕! 오늘 어떤 이야기를 나눠 볼까?', toolReferences: [] });
const completion = (content, model) => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], ...(model ? { model } : {}), usage: { prompt_tokens: 12, completion_tokens: 20 } }));
const limit = () => new Response('SYNTHETIC_ERROR_BODY', { status: 429 });
let mockRequests = 0;
const providerWith = (outputs, options = {}) => {
  const requests = [], reservations = [], settlements = [], events = [];
  const reserve = async request => { reservations.push(request); events.push('reserve'); return { async settle(usage) { settlements.push(usage); events.push('settle'); } }; };
  const provider = createOpenAICompatibleProvider({ ...primary, fallback: { ...fallback, reserve }, structuredFormat: 'json_object', ...options, fetchImpl: async (url, init) => {
    mockRequests++; events.push(String(url).startsWith(fallback.baseUrl) ? 'paid-fetch' : 'primary-fetch');
    requests.push({ url: String(url), body: JSON.parse(init.body), authorization: new Headers(init.headers).get('authorization'), redirect: init.redirect, signal: init.signal });
    const next = outputs.shift();
    if (next === undefined) throw Error('UNPLANNED_DOUBLE_REQUEST');
    if (next instanceof Error) throw next;
    return next instanceof Response ? next : completion(next);
  } });
  return { provider, requests, reservations, settlements, events };
};
const passed = [];
const check = async (name, fn) => { await fn(); passed.push(name); };
await check('exact 54 files, six modified and one added, 47 deployed files byte-identical', () => verifyFiles());
await check('staged TypeScript: all release TS files', () => {
  const options = ts.convertCompilerOptionsFromJson({ target: 'ES2022', lib: ['ES2022', 'DOM', 'DOM.Iterable'], module: 'ESNext', moduleResolution: 'Bundler', allowImportingTsExtensions: true, noEmit: true, strict: true, skipLibCheck: true, types: ['node'] }, root).options;
  const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram(paths.filter(path => path.endsWith('.ts')), options));
  assert.deepEqual(diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), []);
});
await check('primary success preserves v4 schema, serialized prompt and 900-token request', async () => {
  assert.deepEqual(CHAT_RESPONSE_SCHEMA, deployedProvider.CHAT_RESPONSE_SCHEMA);
  const { provider, requests } = providerWith([completion(greeting, primary.model)]);
  const reply = await generatePersonaReply(provider, greetingInput);
  assert.equal(reply.metadata.promptVersion, 'JumZipPersona-v4.2');
  assert.equal(reply.metadata.model, primary.model);
  assert.equal(reply.repaired, false);
  assert.equal(requests.length, 1);
  let oldBody;
  const old = deployedProvider.createOpenAICompatibleProvider({ ...primary, structuredFormat: 'json_object', fetchImpl: async (_url, init) => { oldBody = JSON.parse(init.body); return completion(greeting, primary.model); } });
  await old.generateChat(buildPersonaMessages(greetingInput));
  assert.deepEqual(requests[0].body, oldBody);
  assert.equal(requests[0].body.max_tokens, 900);
});
await check('CF429 then OpenAI Luna greeting validates through actual v4 reply and separates credentials', async () => {
  const { provider, requests } = providerWith([limit(), greeting]);
  const reply = await generatePersonaReply(provider, greetingInput);
  assert.equal(reply.content, JSON.parse(greeting).text);
  assert.equal(reply.metadata.model, fallback.model);
  assert.equal(reply.metadata.promptVersion, 'JumZipPersona-v4.2');
  assert.equal(reply.repaired, false);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, `${primary.baseUrl}/chat/completions`);
  assert.equal(requests[1].url, `${fallback.baseUrl}/chat/completions`);
  assert.equal(requests[0].authorization, `Bearer ${primary.apiKey}`);
  assert.equal(requests[1].authorization, `Bearer ${fallback.apiKey}`);
  assert.equal(requests[0].signal, requests[1].signal);
  assert.ok(requests.every(request => request.redirect === 'error'));
  assert.deepEqual(requests[1].body.messages, requests[0].body.messages.slice(1));
  assert.deepEqual(requests[1].body.response_format, requests[0].body.response_format);
  assert.equal(requests[1].body.model, fallback.model);
  assert.equal(requests[1].body.reasoning_effort, 'none');
  assert.equal(requests[1].body.max_completion_tokens, 900);
  assert.equal(requests[1].body.max_tokens, undefined);
  assert.equal(requests[1].body.store, false);
  assert.equal(requests[1].body.service_tier, 'default');
  assert.equal(requests[1].body.temperature, undefined);
  assert.ok(!JSON.stringify(reply).includes('synthetic-'));
});
await check('one-card Tarot retains golden references and orientation through OpenAI Luna fallback', async () => {
  const cards = Object.freeze([Object.freeze({ cardId: 9, orientation: 'REVERSED', positionIndex: 0, positionKey: 'CARD' })]);
  const references = [{ cardId: 9, orientation: 'REVERSED', positionIndex: 0 }];
  const content = JSON.stringify({ text: '혼자 고립되지 않도록 작은 연결부터 살펴보자.', toolReferences: references });
  const input = { characterId: 'SANI', currentMessage: '이 카드의 의미를 알려줘.', toolResult: { cards } };
  const { provider, requests } = providerWith([limit(), content]);
  const reply = await generatePersonaReply(provider, input);
  assert.equal(reply.content, JSON.parse(content).text);
  assert.equal(reply.metadata.model, fallback.model);
  assert.equal(reply.repaired, false);
  assert.equal(requests.length, 2);
  assert.deepEqual(cards.map(({ cardId, orientation, positionIndex }) => ({ cardId, orientation, positionIndex })), references);
  assert.equal(validateChatOutput(content, { ...input, expectedCards: cards }).ok, true);
  assert.equal(validateChatOutput(content.replace('REVERSED', 'UPRIGHT'), { ...input, expectedCards: cards }).ok, false);
  assert.equal(validateChatOutput(JSON.stringify({ text: JSON.parse(content).text, toolReferences: [] }), { ...input, expectedCards: cards }).ok, false);
  assert.deepEqual(requests[1].body.messages, requests[0].body.messages.slice(1));
});
await check('ordinary v4 still rejects missing references and makes only one sticky secondary repair', async () => {
  const { provider, requests } = providerWith([limit(), '{"text":"안녕!"}', greeting]);
  const reply = await generatePersonaReply(provider, greetingInput);
  assert.equal(reply.repaired, true);
  assert.equal(requests.length, 3);
  assert.deepEqual(requests.map(request => request.body.model), [primary.model, fallback.model, fallback.model]);
  assert.equal(requests[2].body.messages.at(-2).content, '{"text":"안녕!"}');
  assert.ok(requests[2].body.messages.at(-1).content.includes('RESPONSE_SCHEMA_INVALID'));
  const failed = providerWith([limit(), '{"text":"안녕!"}', '{"text":"안녕!"}']);
  await assert.rejects(() => generatePersonaReply(failed.provider, greetingInput), error => error.code === 'LLM_INVALID_RESPONSE');
  assert.equal(failed.requests.length, 3);
});
await check('primary repair HTTP429 switches once without restarting the original logical answer', async () => {
  const { provider, requests } = providerWith(['{"text":"안녕!"}', limit(), greeting]);
  const reply = await generatePersonaReply(provider, greetingInput);
  assert.equal(reply.repaired, true);
  assert.equal(requests.length, 3);
  assert.deepEqual(requests.map(request => request.body.model), [primary.model, primary.model, fallback.model]);
  assert.deepEqual(requests[2].body.messages, requests[1].body.messages.slice(1));
});
await check('structured requests use the same fallback and a single total repair', async () => {
  const schema = { type: 'object', required: ['choice'], additionalProperties: false, properties: { choice: { type: 'string', enum: ['A'] } } };
  const input = { messages: [{ role: 'user', content: '합성 선택 A를 반환해 주세요.' }], schema, name: 'synthetic_choice', validate: value => { assert.equal(value.choice, 'A'); return value.choice; } };
  const { provider, requests } = providerWith([limit(), '{"choice":0}', '{"choice":"A"}']);
  assert.equal(await provider.generateStructured(input), 'A');
  assert.equal(requests.length, 3);
  assert.deepEqual(requests.map(request => request.body.model), [primary.model, fallback.model, fallback.model]);
  assert.ok(requests.every(request => request.body.messages.some(message => message.content.includes(JSON.stringify(schema)))));
  const failed = providerWith([limit(), '{"choice":0}', '{"choice":0}']);
  await assert.rejects(() => failed.provider.generateStructured(input), error => error.code === 'LLM_INVALID_RESPONSE');
  assert.equal(failed.requests.length, 3);
});
await check('non-rate failures do not invoke OpenAI Luna and a secondary429 stops at two sends', async () => {
  for (const [response, code] of [[new Response('', { status: 401 }), 'LLM_AUTH_FAILED'], [new Response('', { status: 403 }), 'LLM_AUTH_FAILED'], [new Response('', { status: 400 }), 'LLM_UNAVAILABLE'], [new Response('', { status: 503 }), 'LLM_UNAVAILABLE'], [new Response('not an envelope'), 'LLM_INVALID_RESPONSE'], [new Error('SYNTHETIC_NETWORK_FAILURE'), 'LLM_UNAVAILABLE']]) {
    const { provider, requests } = providerWith([response]);
    await assert.rejects(() => provider.generateChat(buildPersonaMessages(greetingInput)), error => error.code === code);
    assert.equal(requests.length, 1);
  }
  const { provider, requests } = providerWith([limit(), limit()]);
  await assert.rejects(() => generatePersonaReply(provider, greetingInput), error => error.code === 'LLM_RATE_LIMITED');
  assert.equal(requests.length, 2);
});
await check('fallback body cap and shared timeout reject incomplete transport', async () => {
  const oversized = providerWith([limit(), new Response('x'.repeat(128001))]);
  await assert.rejects(() => oversized.provider.generateChat(buildPersonaMessages(greetingInput)), error => error.code === 'LLM_INVALID_RESPONSE');
  assert.equal(oversized.requests.length, 2);
  const hanging = providerWith([limit(), new Response(new ReadableStream({ cancel: () => new Promise(() => {}) }))], { initialTimeoutMs: 15 });
  await assert.rejects(() => hanging.provider.generateChat(buildPersonaMessages(greetingInput)), error => error.code === 'LLM_TIMEOUT');
  assert.equal(hanging.requests.length, 2);
  assert.equal(hanging.requests[0].signal, hanging.requests[1].signal);
  assert.equal(hanging.requests[1].signal.aborted, true);
});
await check('every paid send reserves complete UTF8 bytes first and settles bounded reported usage', async () => {
  const { provider, requests, reservations, settlements, events } = providerWith([limit(), '{"text":"누락"}', greeting]);
  await generatePersonaReply(provider, greetingInput);
  assert.equal(reservations.length, 2);
  assert.equal(settlements.length, 2);
  assert.deepEqual(events, ['primary-fetch', 'reserve', 'paid-fetch', 'settle', 'reserve', 'paid-fetch', 'settle']);
  for (let i = 0; i < reservations.length; i++) {
    assert.deepEqual(reservations[i], { model: fallback.model, maxOutputTokens: 900, inputBytes: new TextEncoder().encode(JSON.stringify(requests[i + 1].body)).byteLength });
    assert.deepEqual(settlements[i], { promptTokens: 12, completionTokens: 20 });
  }
  const primarySuccess = providerWith([completion(greeting, primary.model)]);
  await generatePersonaReply(primarySuccess.provider, greetingInput);
  assert.equal(primarySuccess.reservations.length, 0);
});
await check('actual staged budget helper gates paid fetch and projects only reservation and usage fields', async () => {
  const rpcCalls = [], events = [];
  const reservationId = '11111111-1111-4111-8111-111111111111';
  const reserve = createOpenAIBudget({ rpc(name, params) {
    rpcCalls.push({ name, params }); events.push(name);
    return { abortSignal(signal) { assert.ok(signal instanceof AbortSignal); return Promise.resolve(name === 'reserve_openai_budget' ? { data: { reservationId, reservedMicros: 1000 }, error: null } : { data: null, error: null }); } };
  } });
  const { provider, requests } = providerWith([limit(), greeting], { fallback: { ...fallback, reserve: async request => { const result = await reserve(request); events.push('reserved'); return result; } } });
  await generatePersonaReply(provider, greetingInput);
  assert.equal(requests.length, 2);
  assert.deepEqual(events, ['reserve_openai_budget', 'reserved', 'settle_openai_budget']);
  assert.deepEqual(rpcCalls[0], { name: 'reserve_openai_budget', params: { p_model: fallback.model, p_input_bytes: new TextEncoder().encode(JSON.stringify(requests[1].body)).byteLength, p_max_output_tokens: 900 } });
  assert.deepEqual(rpcCalls[1], { name: 'settle_openai_budget', params: { p_reservation_id: reservationId, p_prompt_tokens: 12, p_completion_tokens: 20 } });
});
await check('budget rejection or malformed reservation fails closed before paid network and preserves safe public reason', async () => {
  for (const result of [{ error: { message: 'CANARY_PRIVATE_DATABASE_ERROR' }, data: null }, { error: null, data: { reservationId: 'invalid', reservedMicros: 1 } }, { error: null, data: { reservationId: '11111111-1111-4111-8111-111111111111', reservedMicros: 0 } }]) {
    let reservations = 0;
    const reserve = createOpenAIBudget({ rpc() { reservations++; return { abortSignal: async () => result }; } });
    const { provider, requests } = providerWith([limit()], { fallback: { ...fallback, reserve } });
    await assert.rejects(() => generatePersonaReply(provider, greetingInput), error => {
      assert.equal(error.code, 'LLM_BUDGET_EXCEEDED');
      const failure = safeFailure(error);
      assert.equal(failure.details.reason, 'LLM_BUDGET_EXCEEDED');
      assert.equal(failure.retryable, false);
      assert.ok(!JSON.stringify(failure).includes('CANARY'));
      return true;
    });
    assert.equal(requests.length, 1);
    assert.equal(reservations, 1);
  }
});
await check('unknown usage retains its hold and a denied repair never starts a second paid send', async () => {
  const noUsage = new Response(JSON.stringify({ choices: [{ message: { content: greeting }, finish_reason: 'stop' }] }));
  const missing = providerWith([limit(), noUsage]);
  const answer = await generatePersonaReply(missing.provider, greetingInput);
  assert.equal(answer.metadata.usage, undefined);
  assert.equal(missing.reservations.length, 1);
  assert.equal(missing.settlements.length, 0);
  let count = 0;
  const denied = providerWith([limit(), '{"text":"누락"}'], { fallback: { ...fallback, reserve: async () => {
    count++;
    if (count > 1) throw Object.assign(new Error('PRIVATE_DETAIL'), { code: 'LLM_BUDGET_EXCEEDED' });
    return { settle: async () => {} };
  } } });
  await assert.rejects(() => generatePersonaReply(denied.provider, greetingInput), error => error.code === 'LLM_BUDGET_EXCEEDED');
  assert.equal(denied.requests.length, 2);
  assert.equal(count, 2);
});
await check('late reservation and oversized input cannot start paid requests', async () => {
  let completeReservation;
  const pending = new Promise(resolve => { completeReservation = resolve; });
  const late = providerWith([limit()], { initialTimeoutMs: 15, fallback: { ...fallback, reserve: () => pending } });
  await assert.rejects(() => late.provider.generateChat(buildPersonaMessages(greetingInput)), error => error.code === 'LLM_TIMEOUT');
  completeReservation({ settle: async () => {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(late.requests.length, 1);
  const oversized = providerWith([limit()]);
  await assert.rejects(() => oversized.provider.generateChat([{ role: 'user', content: '가'.repeat(22000) }]), error => error.code === 'LLM_BUDGET_EXCEEDED');
  assert.equal(oversized.requests.length, 1);
  assert.equal(oversized.reservations.length, 0);
});
await check('runtime enables paid fallback only for user-facing generation; intent/title/memory stay primary-only', () => {
  const execute = readFileSync(resolve(stage, 'supabase/functions/_shared/orchestration/execute.ts'), 'utf8');
  const source = ts.createSourceFile('execute.ts', execute, ts.ScriptTarget.Latest, true);
  const calls = [];
  const walk = node => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'providerConfig') {
      let ancestor = node.parent;
      while (ancestor && !ts.isVariableDeclaration(ancestor) && !ts.isMethodDeclaration(ancestor)) ancestor = ancestor.parent;
      calls.push({ argument: node.arguments[0]?.getText(source), owner: ancestor?.name?.getText(source) });
    }
    ts.forEachChild(node, walk);
  };
  walk(source);
  assert.equal(calls.length, 4);
  assert.equal(calls.filter(call => call.argument === 'true').length, 1);
  assert.ok(calls.filter(call => call.argument !== 'true').every(call => call.argument === undefined || call.argument === 'false'));
  // The sole opt-in must be inside the generation closure, not any maintenance callback.
  const start = execute.indexOf('const generate =');
  const end = execute.indexOf('const saju =', start);
  assert.ok(start !== -1 && end > start && execute.slice(start, end).includes('providerConfig(true)'));
  assert.ok(execute.includes('reserve: createOpenAIBudget(client)'));
  assert.ok(execute.includes('allowPaidFallback = false'));
});
assert.equal(blockedNetworkRequests, 0);
verifyFiles();
const result = { status: 'OFFLINE_CHECKS_PASSED', stage, stageManifestSha256: sha256(manifestBytes), stagedTypecheckPassed: true, checks: passed, checksPassed: passed.length, verifiedFiles: 54, unchangedFiles: 47, sourceFrozen: true, networkRequests: 0, modelRequests: 0, mockRequests, transport: 'INJECTED_FETCH_DOUBLES', promptVersion: 'JumZipPersona-v4.2', intentVersion: 'JumZipIntent-v1', semanticQuality: 'NOT_EVALUATED', deployed: false };
if (process.argv[3] === '--save-report') writeFileSync(resolve(stage, 'offline-verification.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(result));
