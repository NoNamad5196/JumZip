import assert from 'node:assert/strict';
import { readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { buildRelease, root, sha256 } from '../prepare-chat-reliability-release.mjs';

const stage = resolve(process.argv[2] ?? '');
if (!process.argv[2] || process.argv.length > 4 || process.argv[3] && process.argv[3] !== '--save-report') throw Error('STAGE_ARGUMENT_REQUIRED');
if (dirname(stage) !== resolve(root, 'supabase/.temp') || !basename(stage).startsWith('chat-reliability-v4-1-') || realpathSync(stage) !== stage) throw Error('UNSAFE_STAGE_PATH');
// This process cannot reach a network. Every transport below is an injected double.
let blockedNetworkRequests = 0;
globalThis.fetch = async () => { blockedNetworkRequests++; throw Error('OFFLINE_NETWORK_FORBIDDEN'); };
const { report: expected, original } = buildRelease();
const manifest = JSON.parse(readFileSync(resolve(stage, 'release-manifest.json'), 'utf8'));
assert.deepEqual(manifest, expected);
const paths = readdirSync(resolve(stage, 'supabase'), { recursive: true, withFileTypes: true }).filter(x => x.isFile()).map(x => resolve(x.parentPath, x.name));
assert.equal(paths.length, 54);
for (const file of manifest.files) assert.equal(sha256(readFileSync(resolve(stage, file.path))), file.sha256);
const importStage = path => import(pathToFileURL(resolve(stage, 'supabase/functions/_shared', path)).href);
const [{ createOpenAICompatibleProvider, LLMError, safeLLMDiagnostic }, { generatePersonaReply }, { validateChatOutput }, contracts, { buildPersonaMessages, GLOBAL_PERSONA_RULES }, { safeFailure, partialFailureDetails }] = await Promise.all([
  importStage('llm/provider.ts'), importStage('llm/reply.ts'), importStage('llm/validator.ts'), importStage('llm/chat-contract.ts'), importStage('persona/prompt.ts'), importStage('http/errors.ts'),
]);
const passed = [];
let deployedProvider, deployedPrompt;
const check = async (name, fn) => { await fn(); passed.push(name); };
const schema = contracts.CHAT_RESPONSE_SCHEMA;
const messages = Object.freeze([Object.freeze({ role: 'system', content: '서버 규칙' }), Object.freeze({ role: 'user', content: '원래 질문\n사용자 CANARY_USER' })]);
const completion = (content, finish_reason = 'stop') => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason }], model: '@cf/qwen/qwen3-30b-a3b-fp8', usage: { prompt_tokens: 12, completion_tokens: 20 } }));
const providerWith = outputs => {
  const requests = [];
  const provider = createOpenAICompatibleProvider({ baseUrl: 'https://offline.invalid/v1', model: '@cf/qwen/qwen3-30b-a3b-fp8', structuredFormat: 'json_object', fetchImpl: async (_url, init) => {
    requests.push(JSON.parse(init.body)); const next = outputs.shift(); if (next === undefined) throw Error('UNPLANNED_DOUBLE_REQUEST'); return next instanceof Response ? next : completion(next);
  } });
  return { provider, requests };
};
await check('staged TypeScript: all release TS files', () => {
  const options = ts.convertCompilerOptionsFromJson({ target: 'ES2022', lib: ['ES2022', 'DOM', 'DOM.Iterable'], module: 'ESNext', moduleResolution: 'Bundler', allowImportingTsExtensions: true, noEmit: true, strict: true, skipLibCheck: true, types: ['node'] }, root).options;
  const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram(paths.filter(path => path.endsWith('.ts')), options));
  assert.deepEqual(diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), []);
});
await check('DEFAULT schema and persona rules equal deployed v4 exactly', async () => {
  const oldProvider = original.get('supabase/functions/_shared/llm/provider.ts').toString('utf8');
  const definition = oldProvider.slice(oldProvider.indexOf('export const CHAT_RESPONSE_SCHEMA'), oldProvider.indexOf('// Bound decoded'));
  const js = ts.transpileModule(definition, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const old = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
  assert.deepEqual(schema, old.CHAT_RESPONSE_SCHEMA);
  const oldProviderJs = ts.transpileModule(oldProvider, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  deployedProvider = await import(`data:text/javascript;base64,${Buffer.from(oldProviderJs).toString('base64')}`);
  const oldPrompt = original.get('supabase/functions/_shared/persona/prompt.ts').toString('utf8');
  const start = oldPrompt.indexOf('export const GLOBAL_PERSONA_RULES = `') + 'export const GLOBAL_PERSONA_RULES = `'.length;
  assert.equal(GLOBAL_PERSONA_RULES, oldPrompt.slice(start, oldPrompt.indexOf('`;', start)));
  const oldPromptJs = ts.transpileModule(oldPrompt, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
    .replaceAll("'./config.ts'", JSON.stringify(pathToFileURL(resolve(stage, 'supabase/functions/_shared/persona/config.ts')).href))
    .replaceAll("'./context.ts'", JSON.stringify(pathToFileURL(resolve(stage, 'supabase/functions/_shared/persona/context.ts')).href))
    .replaceAll("'./tool-facts.ts'", JSON.stringify(pathToFileURL(resolve(stage, 'supabase/functions/_shared/persona/tool-facts.ts')).href));
  deployedPrompt = await import(`data:text/javascript;base64,${Buffer.from(oldPromptJs).toString('base64')}`);
});
await check('two real synthetic v4 captures now pass selected text-only contract', () => {
  const capture = JSON.parse(readFileSync(resolve(root, 'scripts/chat-reliability-release/captured-v4-recall.json'), 'utf8'));
  assert.equal(capture.responses.length, 2);
  for (const row of capture.responses) {
    assert.equal(sha256(row.content), row.contentSha256); assert.equal(row.finishReason, 'stop');
    assert.deepEqual(validateChatOutput(row.content, { characterId: 'BOMI' }), { ok: false, issues: ['RESPONSE_SCHEMA_INVALID'] });
    const result = validateChatOutput(row.content, { characterId: 'BOMI', toolResult: null, contract: contracts.selectChatResponseContract(null) });
    assert.equal(result.ok, true); assert.equal(result.value.text, JSON.parse(row.content).text); assert.deepEqual(result.value.toolReferences, []);
  }
});
await check('only null/undefined select TEXT_ONLY; non-null values retain DEFAULT', () => {
  for (const value of [null, undefined]) assert.equal(contracts.selectChatResponseContract(value), 'TEXT_ONLY_V1');
  for (const value of [{}, false, 0, '', { cards: [] }, { kind: 'SAJU' }, { cards: [{ cardId: 9 }] }]) {
    assert.equal(contracts.selectChatResponseContract(value), 'DEFAULT');
    assert.deepEqual(validateChatOutput('{"text":"안녕"}', { characterId: 'BOMI', toolResult: value, contract: 'TEXT_ONLY_V1' }), { ok: false, issues: ['RESPONSE_CONTRACT_MISMATCH'] });
  }
});
await check('text-only keeps safety checks and refuses extra tool fields', () => {
  for (const [text, issue] of [['나는 AI야', 'PERSONA_BREAK'], ['<script>secret</script>', 'MODEL_CONTROL_TEXT'], ['무조건 성공이야', 'FORBIDDEN_CERTAINTY_OR_DEPENDENCY'], ['나랑 사귀자', 'BOMI_RELATIONSHIP_BOUNDARY']]) {
    const result = validateChatOutput(JSON.stringify({ text }), { characterId: 'BOMI', contract: 'TEXT_ONLY_V1' });
    assert.equal(result.ok, false); assert.ok(result.issues.includes(issue));
  }
  assert.equal(validateChatOutput('{"text":"안녕","toolReferences":[]}', { characterId: 'BOMI', contract: 'TEXT_ONLY_V1' }).ok, false);
});
await check('transport: initial text-only retains Qwen/schema/900 and public reply shape', async () => {
  const { provider, requests } = providerWith(['{"text":"안녕! 오늘 어땠어?"}']);
  const result = await generatePersonaReply(provider, { characterId: 'BOMI', currentMessage: '안녕' });
  assert.equal(requests.length, 1); assert.equal(result.repaired, false); assert.equal(result.metadata.promptVersion, 'JumZipPersona-v4.1');
  assert.deepEqual(Object.keys(result).sort(), ['content', 'metadata', 'repaired', 'segments']);
  assert.equal(requests[0].max_tokens, 900); assert.equal(requests[0].model, '@cf/qwen/qwen3-30b-a3b-fp8');
  assert.equal(requests[0].chat_template_kwargs, undefined); assert.ok(requests[0].messages[0].content.includes('/no_think'));
  assert.ok(requests[0].messages[1].content.includes(JSON.stringify(contracts.TEXT_ONLY_RESPONSE_SCHEMA)));
});
await check('transport: one text-only repair preserves original user and trusted system boundary', async () => {
  const { provider, requests } = providerWith(['invalid CANARY_ASSISTANT', '{"text":"다시 이야기해 보자."}']);
  const first = await provider.generateChat(messages, 'TEXT_ONLY_V1');
  await provider.repairChat(messages, first.content, ['JSON_REQUIRED', 'CANARY_ERROR'], 'TEXT_ONLY_V1');
  assert.equal(requests.length, 2); const sent = requests[1].messages;
  assert.deepEqual(sent.at(-1), messages.at(-1)); assert.equal(sent.at(-2).content, first.content);
  assert.equal(sent.filter(x => x.content === messages.at(-1).content).length, 2);
  assert.ok(sent.filter(x => x.role === 'system').every(x => !/CANARY_USER|CANARY_ASSISTANT|CANARY_ERROR/.test(x.content)));
  assert.equal(messages[0].content, '서버 규칙'); assert.equal(requests[1].temperature, 0.15);
});
const cards = [{ cardId: 9, orientation: 'REVERSED', positionIndex: 0, positionKey: 'CARD' }];
await check('transport: DEFAULT Tarot stays refs-only, identical cards retained through repair', async () => {
  const before = JSON.stringify(cards);
  const refs = cards.map(({ cardId, orientation, positionIndex }) => ({ cardId, orientation, positionIndex }));
  const good = JSON.stringify({ text: '혼자 고립되지 않도록 작은 연결부터 살펴보자.', toolReferences: refs });
  const { provider, requests } = providerWith(['{"text":"누락","toolReferences":[]}', good]);
  const input = { characterId: 'SANI', currentMessage: '카드 해석해 줘', toolResult: { cards } };
  const reply = await generatePersonaReply(provider, input);
  assert.equal(reply.repaired, true); assert.equal(requests.length, 2); assert.equal(JSON.stringify(cards), before);
  for (const request of requests) assert.ok(request.messages[1].content.includes(JSON.stringify(schema)));
  assert.equal(validateChatOutput(good, { characterId: 'SANI', expectedCards: cards, toolResult: { cards } }).ok, true);
  assert.equal(validateChatOutput(good.replace('REVERSED', 'UPRIGHT'), { characterId: 'SANI', expectedCards: cards }).ok, false);
  assert.deepEqual(buildPersonaMessages(input), deployedPrompt.buildPersonaMessages(input));
  let oldBody;
  const old = deployedProvider.createOpenAICompatibleProvider({ baseUrl: 'https://offline.invalid/v1', model: '@cf/qwen/qwen3-30b-a3b-fp8', structuredFormat: 'json_object', fetchImpl: async (_url, init) => { oldBody = JSON.parse(init.body); return completion(good); } });
  await old.generateChat(deployedPrompt.buildPersonaMessages(input));
  assert.deepEqual(requests[0], oldBody);
});
await check('transport: DEFAULT Saju retains empty refs and grounded-number checks', async () => {
  const toolResult = { kind: 'SAJU', strength: { score: 37 } };
  const input = { characterId: 'SANI', currentMessage: '점수 알려줘', toolResult };
  const { provider, requests } = providerWith(['{"text":"점수는 37이야.","toolReferences":[]}']);
  const reply = await generatePersonaReply(provider, input);
  assert.equal(reply.repaired, false); assert.equal(requests.length, 1); assert.ok(requests[0].messages[1].content.includes(JSON.stringify(schema)));
  assert.deepEqual(validateChatOutput('{"text":"점수는 99야.","toolReferences":[]}', { characterId: 'SANI', toolResult }), { ok: false, issues: ['TOOL_SCORE_CHANGED'] });
  assert.deepEqual(buildPersonaMessages(input), deployedPrompt.buildPersonaMessages(input));
});
await check('structured repair remains generic with original final user; no optional mapper', async () => {
  const { provider, requests } = providerWith(['{"kind":0}', '{"kind":"ok"}']);
  assert.equal(await provider.generateStructured({ messages, schema: { type: 'object' }, validate: value => { if (value.kind !== 'ok') throw Error('UNTRUSTED_EXCEPTION'); return value.kind; } }), 'ok');
  assert.equal(requests.length, 2); assert.deepEqual(requests[1].messages.at(-1), messages.at(-1));
  assert.ok(requests[1].messages.some(x => x.role === 'system' && x.content.includes('STRUCTURED_VALIDATION_FAILED')));
  assert.ok(requests[1].messages.every(x => !x.content.includes('UNTRUSTED_EXCEPTION')));
});
await check('failed repair produces safe attempts/stage/finish diagnostics, never raw data', async () => {
  const { provider, requests } = providerWith(['CANARY_PRIVATE_BODY', 'CANARY_PRIVATE_BODY']);
  await assert.rejects(() => generatePersonaReply(provider, { characterId: 'BOMI', currentMessage: '안녕' }), error => {
    assert.deepEqual(error.diagnostic, { stage: 'PARSE', issues: ['JSON_REQUIRED'], attempts: 2, finishReason: 'stop' });
    assert.ok(!JSON.stringify(safeFailure(error)).includes('CANARY')); return true;
  });
  assert.equal(requests.length, 2);
});
await check('transport rate limit preserves true safe reason through all PARTIAL wrappers', async () => {
  const { provider, requests } = providerWith([new Response('CANARY_UPSTREAM_SECRET', { status: 429 })]);
  await assert.rejects(() => provider.generateChat(messages), error => {
    const failure = safeFailure(error); assert.equal(failure.code, 'LLM_UNAVAILABLE');
    assert.deepEqual(partialFailureDetails(failure), { reason: 'LLM_RATE_LIMITED', kind: 'TRANSPORT', issues: ['HTTP_RATE_LIMITED'], attempts: 1, finishReason: null });
    assert.ok(!JSON.stringify(failure).includes('CANARY')); return true;
  });
  assert.equal(requests.length, 1);
  for (const name of ['execute', 'saju', 'compatibility']) assert.ok(readFileSync(resolve(stage, `supabase/functions/_shared/orchestration/${name}.ts`), 'utf8').includes('...partialFailureDetails(failure)'));
});
await check('diagnostic spoofing cannot promote raw values; missing final user fails before repair HTTP', async () => {
  assert.equal(safeLLMDiagnostic({ stage: { toString: () => 'VALIDATION' }, attempts: 1, issues: ['JSON_REQUIRED'] }), undefined);
  const error = new LLMError('LLM_INVALID_RESPONSE', true, { stage: 'VALIDATION', attempts: 2, issues: ['CANARY', 'JSON_REQUIRED'], finishReason: 'CANARY' });
  assert.deepEqual(error.diagnostic, { stage: 'VALIDATION', attempts: 2, issues: ['JSON_REQUIRED'], finishReason: 'OTHER' });
  const { provider, requests } = providerWith([]);
  await assert.rejects(() => provider.repairChat([{ role: 'system', content: 'system' }], 'bad', ['JSON_REQUIRED']), error => error.diagnostic.issues.includes('REPAIR_USER_MESSAGE_MISSING'));
  assert.equal(requests.length, 0);
});
await check('body byte cap and timeout survive narrow provider port', async () => {
  const oversized = createOpenAICompatibleProvider({ baseUrl: 'https://offline.invalid', model: 'model', fetchImpl: async () => new Response('x'.repeat(128001)) });
  await assert.rejects(() => oversized.generateChat(messages), error => error.diagnostic.issues.includes('RESPONSE_BODY_TOO_LARGE'));
  const hanging = createOpenAICompatibleProvider({ baseUrl: 'https://offline.invalid', model: 'model', initialTimeoutMs: 5, fetchImpl: async () => new Response(new ReadableStream({ cancel: () => new Promise(() => {}) })) });
  await assert.rejects(() => hanging.generateChat(messages), error => error.code === 'LLM_TIMEOUT' && error.diagnostic.issues.includes('REQUEST_TIMEOUT'));
});
await check('no-tool prompt changes output block only; tool prompt still has deployed v4 instructions', () => {
  const input = { characterId: 'BOMI', currentMessage: '안녕' };
  assert.ok(!buildPersonaMessages(input)[0].content.includes('"toolReferences":[]'));
  assert.ok(buildPersonaMessages({ ...input, toolResult: { cards } })[0].content.startsWith(GLOBAL_PERSONA_RULES));
});
assert.equal(blockedNetworkRequests, 0);
for (const file of manifest.files) assert.equal(sha256(readFileSync(resolve(stage, file.path))), file.sha256);
const result = { status: 'OFFLINE_CHECKS_PASSED', stage, stagedTypecheckPassed: true, checks: passed, checksPassed: passed.length, verifiedFiles: 54, sourceFrozen: true, networkRequests: 0, modelRequests: 0, transport: 'INJECTED_FETCH_DOUBLES', capturedResponses: 2, semanticQuality: 'NOT_EVALUATED', deployed: false };
if (process.argv[3] === '--save-report') writeFileSync(resolve(stage, 'offline-verification.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(result));
