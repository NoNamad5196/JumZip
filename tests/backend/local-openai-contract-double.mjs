// Local HTTP transport double, never a model or an upstream proxy.
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const MODEL = 'jumzip-http-contract-double-v9';
export const CANDIDATE = { persona: 'JumZipPersona-v9', intent: 'JumZipIntent-v4' };
export const TARGET = 'http://127.0.0.1:54321';
export const MESSAGES = {
  CHAT_NONE: '안녕, 오늘은 가볍게 수다 떨고 싶어.',
  CHAT_RECOMMENDATION: '진로 선택을 타로로 보고 싶어.',
};
export const SCENARIOS = [
  { id: 'CHAT_NONE', outputs: ['INTENT_NONE', 'CHAT_VALID'] },
  { id: 'CHAT_RECOMMENDATION', outputs: ['INTENT_TAROT', 'CHAT_VALID'] },
  { id: 'TAROT_REPAIR', outputs: ['TAROT_BAD_SPAN', 'TAROT_VALID'] },
  { id: 'TAROT_PARTIAL', outputs: ['TAROT_MALFORMED', 'TAROT_MALFORMED'] },
  { id: 'TAROT_RETRY', outputs: ['TAROT_VALID'] },
  { id: 'RETRY_REPLAY', outputs: [] },
  { id: 'SAJU_FOCUS_RETRY', outputs: ['SAJU_FOCUS_VALID'] },
];
export const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export function pathsFor(runName) {
  if (!/^[a-z][a-z0-9-]{0,47}$/.test(runName)) throw Error('INVALID_RUN_NAME');
  const directory = resolve('test-results/local-edge-contract', runName);
  return { directory, privateFile: join(directory, 'control.local.json'), envFile: join(directory, 'edge.env.local'),
    ledgerFile: join(directory, 'pending-cleanup.json'), reportFile: join(directory, 'report.json') };
}
export function sourceHashes() {
  const files = [];
  const walk = directory => { for (const item of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) walk(path); else if (path.endsWith('.ts')) files.push(path);
  } };
  walk('supabase/functions');
  files.push(...readdirSync('supabase/migrations').filter(name => name.endsWith('.sql')).map(name => 'supabase/migrations/' + name),
    'tests/backend/local-openai-contract-double.mjs', 'tests/backend/live-local-edge-contract-smoke.mjs');
  return Object.fromEntries(files.sort().map(path => [path.replaceAll('\\', '/'), digest(readFileSync(path, 'utf8').replaceAll('\r\n', '\n'))]));
}
export const PLAN = {
  target: TARGET, provider: '127.0.0.1 temporary port, synthetic HTTP responses only', model: MODEL,
  candidate: CANDIDATE,
  scenarios: SCENARIOS, maximumEdgeRequests: 7, maximumProviderHTTP: 10, actualModelCalls: 0, externalRequests: 0,
  sajuSeed: 'One pure-engine synthetic YEAR_FLOW reading saved as injected PARTIAL through local RPCs, then actual Edge retry; no external location lookup.',
  flags: { recommendations: true, titles: false, memoryMaintenance: false },
  serviceChange: 'Main switches only local functions serve to a newly generated private env, then restores the previous local env. This harness never starts/stops Supabase or llama.',
  cleanup: 'Two marked disposable Auth identities, immediate ledger, finally Auth404 and zero rows in fifteen owned tables.',
  evidenceScope: 'Actual localhost HTTP/Auth/Edge/Postgres wiring. No Persona semantic quality or Cloudflare-specific thinking option validation.',
};
const safeCode = error => error instanceof Error && /^[A-Z0-9_]{3,100}$/.test(error.message) ? error.message : 'DOUBLE_INTERNAL_FAILURE';
const assert = (condition, code) => { if (!condition) throw Error(code); };

function requestSchema(body) {
  assert(body.response_format?.type === 'json_object', 'EXPECTED_JSON_OBJECT');
  const schemaMessage = body.messages.find(item => item.role === 'system' && item.content.startsWith('출력은 다음 JSON Schema'));
  assert(schemaMessage, 'SERVER_SCHEMA_MISSING');
  return JSON.parse(schemaMessage.content.slice(schemaMessage.content.indexOf('\n') + 1));
}
function conversationCards(body) {
  const context = body.messages.find(item => item.role === 'user' && item.content.startsWith('actualConversationContext:'));
  assert(context, 'ACTUAL_CONTEXT_MISSING');
  const tool = JSON.parse(context.content.slice(context.content.indexOf('\n') + 1)).toolResult;
  assert(tool?.cards?.length === 1 && tool.requiredToolReferences?.length === 1, 'PERSISTED_ONE_CARD_REQUIRED');
  const card = tool.cards[0];
  assert(Number.isInteger(card.cardId) && ['UPRIGHT', 'REVERSED'].includes(card.orientation) && card.positionIndex === 0
    && typeof card.activeMeaning?.[0] === 'string', 'CANONICAL_CARD_FIELDS_REQUIRED');
  const references = [{ cardId: card.cardId, orientation: card.orientation, positionIndex: card.positionIndex }];
  assert(JSON.stringify(references) === JSON.stringify(tool.requiredToolReferences), 'REQUIRED_REFERENCES_CHANGED');
  return { card, references };
}
export function buildSyntheticOutput(body, output, stage, stageIndex) {
  assert(body.model === MODEL && body.stream === false && Array.isArray(body.messages), 'PROVIDER_REQUEST_CONTRACT');
  const schema = requestSchema(body);
  const isIntent = output.startsWith('INTENT_');
  const isRepair = stage.startsWith('TAROT_') && stageIndex === 1;
  assert(body.max_tokens === (isIntent ? 350 : 900), 'OUTPUT_TOKEN_CAP_CHANGED');
  assert(body.temperature === (isIntent ? 0.1 : isRepair ? 0.15 : 0.65), 'TEMPERATURE_CHANGED');
  assert(!Object.hasOwn(body, 'chat_template_kwargs'), 'LOCAL_ENDPOINT_HAS_CLOUDFLARE_OPTION');
  const required = schema.required;
  if (isIntent) {
    assert(required?.includes('targetAliasEvidence') && required.includes('choicesEvidence') && !required.includes('choicesPresent'), 'INTENT_EVIDENCE_SCHEMA_REQUIRED');
    assert(body.messages.some(item => item.role === 'system' && item.content.includes(CANDIDATE.intent)), 'INTENT_VERSION_CHANGED');
    const payload = JSON.parse(body.messages.at(-1).content);
    assert(payload.currentMessage === MESSAGES[stage], 'SYNTHETIC_INTENT_INPUT_CHANGED');
    const none = output === 'INTENT_NONE';
    return { content: JSON.stringify({ requestPurpose: none ? 'GENERAL_CHAT' : 'FORTUNE_EXPLORATION',
      intentEvidenceQuote: none ? '가볍게 수다 떨고 싶어' : '진로 선택을 타로로 보고 싶어', intent: none ? 'small_talk' : 'career_decision',
      explicitTool: none ? null : 'TAROT', explicitToolQuote: none ? null : '타로로 보고 싶어',
      targetAliasEvidence: { state: 'UNRESOLVED', source: null, quote: null }, choicesEvidence: [],
      recentSituationPresent: false, periodPresent: false, highStakes: false }), metadata: { contract: 'INTENT_SLOT_EVIDENCE', promptVersion: CANDIDATE.intent, schemaSha256: digest(schema), repair: false } };
  }
  if (output === 'CHAT_VALID' || output === 'SAJU_FOCUS_VALID') {
    assert(JSON.stringify(required) === JSON.stringify(['text', 'toolReferences']), 'DEFAULT_CHAT_SCHEMA_REQUIRED');
    if (output === 'SAJU_FOCUS_VALID') {
      assert(body.messages.at(-1).content === '사주 상담: YEAR_FLOW', 'STORED_SAJU_FOCUS_NOT_PRESERVED');
      const context = body.messages.find(item => item.role === 'user' && item.content.startsWith('actualConversationContext:'));
      const tool = context && JSON.parse(context.content.slice(context.content.indexOf('\n') + 1)).toolResult;
      assert(tool?.kind === 'SAJU' && !Array.isArray(tool.cards), 'SAJU_TOOL_PROJECTION_REQUIRED');
    }
    return { content: JSON.stringify({ text: '합성 응답으로 연결을 확인했어. 편하게 이야기해 줘.', toolReferences: [] }),
      metadata: { contract: 'DEFAULT', schemaSha256: digest(schema), repair: false, ...(output === 'SAJU_FOCUS_VALID' ? { storedFocus: 'YEAR_FLOW' } : {}) } };
  }
  assert(required?.includes('interpretationEvidence'), 'TAROT_EVIDENCE_SCHEMA_REQUIRED');
  if (isRepair) {
    const repair = body.messages.at(-1).content;
    assert(repair.includes('응답 검증에 실패했습니다.'), 'REPAIR_INSTRUCTION_MISSING');
    if (stage === 'TAROT_REPAIR') assert(repair.includes('TAROT_EVIDENCE_SPAN_MISSING')
      && repair.includes('/interpretationEvidence/0/textEvidence') && repair.includes('NOT_A_CONTIGUOUS_SUBSTRING_OF_TEXT'), 'PRECISE_SPAN_REPAIR_FEEDBACK_MISSING');
  }
  const { card, references } = conversationCards(body);
  const textEvidence = `${card.nameKo} ${card.orientationLabel}의 ${card.activeMeaning[0]}이라는 상징`;
  const value = { text: `${textEvidence}을 참고해 봐. 오늘 할 작은 행동 하나를 골라 보자.`, toolReferences: references };
  if (output === 'TAROT_VALID') value.interpretationEvidence = [{ positionIndex: 0, keywordIndices: [0], textEvidence }];
  if (output === 'TAROT_BAD_SPAN') value.interpretationEvidence = [{ positionIndex: 0, keywordIndices: [0], textEvidence: `${textEvidence} 본문에 없는 합성 구절` }];
  return { content: output === 'TAROT_MALFORMED' ? '{"text":' : JSON.stringify(value),
    metadata: { contract: 'TAROT_EVIDENCE_V1', schemaSha256: digest(schema), repair: isRepair, cards: references,
      responseKind: output, responseIncludesEvidence: Object.hasOwn(value, 'interpretationEvidence') } };
}

async function startDouble(runName, requestedPort) {
  assert(process.env.JUMZIP_LOCAL_EDGE_DOUBLE === 'LOCAL', 'EXPLICIT_DOUBLE_OPT_IN_REQUIRED');
  const paths = pathsFor(runName);
  assert(!existsSync(paths.privateFile) && !existsSync(paths.envFile), 'DOUBLE_PRIVATE_FILE_OVERWRITE_REFUSED');
  const before = sourceHashes();
  assert(readFileSync('supabase/functions/_shared/llm/reply.ts', 'utf8').includes(`PERSONA_PROMPT_VERSION = '${CANDIDATE.persona}'`), 'PERSONA_VERSION_MISMATCH');
  assert(readFileSync('supabase/functions/_shared/llm/intent.ts', 'utf8').includes(`INTENT_PROMPT_VERSION = '${CANDIDATE.intent}'`), 'INTENT_VERSION_MISMATCH');
  const key = randomBytes(32).toString('hex');
  const attempts = [], failures = [];
  let currentStage = -1, withinStage = 0, totalRequests = 0;
  const status = () => ({ kind: 'JUMZIP_SYNTHETIC_HTTP_DOUBLE', model: MODEL, stage: SCENARIOS[currentStage]?.id ?? null,
    withinStage, providerRequests: totalRequests, attempts, failures, sourceHash: digest(before), sourceFrozen: digest(sourceHashes()) === digest(before) });
  const server = createServer(async (req, res) => {
    const send = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
    if (req.method === 'GET' && req.url === '/health') return send(200, { kind: 'JUMZIP_SYNTHETIC_HTTP_DOUBLE', model: MODEL });
    if (req.headers.authorization !== `Bearer ${key}`) return send(401, { error: 'DOUBLE_AUTH_REQUIRED' });
    if (req.method === 'GET' && req.url === '/__status') return send(200, status());
    try {
      assert(req.method === 'POST' && ['/__control', '/v1/chat/completions'].includes(req.url), 'DOUBLE_ROUTE_INVALID');
      let bytes = 0; const chunks = [];
      for await (const chunk of req) { bytes += chunk.length; assert(bytes <= 128_000, 'DOUBLE_REQUEST_TOO_LARGE'); chunks.push(chunk); }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (req.url === '/__control') {
        if (body.action === 'STOP') { send(200, { stopping: true }); server.close(); return; }
        assert(body.action === 'NEXT' && currentStage + 1 < SCENARIOS.length, 'DOUBLE_CONTROL_INVALID');
        assert(currentStage < 0 || withinStage === SCENARIOS[currentStage].outputs.length, 'PREVIOUS_STAGE_INCOMPLETE');
        assert(body.stage === SCENARIOS[currentStage + 1].id, 'SCENARIO_ORDER_CHANGED');
        currentStage++; withinStage = 0; return send(200, status());
      }
      totalRequests++;
      assert(totalRequests <= 10, 'DOUBLE_PROVIDER_HTTP_CAP');
      const scenario = SCENARIOS[currentStage], output = scenario?.outputs[withinStage];
      assert(output && !failures.length, 'UNEXPECTED_PROVIDER_REQUEST');
      const reply = buildSyntheticOutput(body, output, scenario.id, withinStage);
      const previous = attempts.at(-1);
      if (reply.metadata.repair) assert(previous?.schemaSha256 === reply.metadata.schemaSha256
        && JSON.stringify(previous.cards) === JSON.stringify(reply.metadata.cards), 'REPAIR_CONTRACT_OR_CARDS_CHANGED');
      attempts.push({ stage: scenario.id, output, index: withinStage, requestBytes: bytes, ...reply.metadata }); withinStage++;
      return send(200, { model: MODEL, choices: [{ message: { role: 'assistant', content: reply.content }, finish_reason: 'stop' }] });
    } catch (error) { const code = safeCode(error); failures.push({ stage: SCENARIOS[currentStage]?.id ?? null, code }); send(500, { error: code }); }
  });
  server.requestTimeout = 5000; server.headersTimeout = 5000;
  await new Promise((resolveStart, reject) => { server.once('error', reject); server.listen(requestedPort, '127.0.0.1', resolveStart); });
  const port = server.address().port;
  try {
    mkdirSync(paths.directory, { recursive: true });
    writeFileSync(paths.privateFile, JSON.stringify({ runName, key, port, pid: process.pid, sourceHash: digest(before), model: MODEL }), { flag: 'wx' });
    writeFileSync(paths.envFile, [`LLM_BASE_URL=http://host.docker.internal:${port}/v1`, `LLM_API_KEY=${key}`, `LLM_MODEL=${MODEL}`,
      'LLM_STRUCTURED_FORMAT=json_object', 'TOOL_RECOMMENDATIONS_ENABLED=true', 'TITLE_GENERATION_ENABLED=false', 'MEMORY_MAINTENANCE_ENABLED=false',
      'ALLOWED_ORIGINS=http://127.0.0.1:5173,http://localhost:5173', ''].join('\n'), { flag: 'wx' });
  } catch { server.close(); throw Error('DOUBLE_PRIVATE_FILES_WRITE_FAILED'); }
  const timer = setTimeout(() => server.close(), 15 * 60_000);
  server.on('close', () => { clearTimeout(timer); console.log(JSON.stringify({ status: 'DOUBLE_STOPPED', providerRequests: totalRequests, failures: failures.length })); });
  process.once('SIGINT', () => server.close()); process.once('SIGTERM', () => server.close());
  console.log(JSON.stringify({ status: 'DOUBLE_READY', address: `127.0.0.1:${port}`, envFile: paths.envFile, runName, actualModelCalls: 0,
    next: 'Main must verify container /health reachability and switch only local functions serve before the separately gated harness.' }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv.includes('--serve')) console.log(JSON.stringify(PLAN, null, 2));
  else {
    const runName = process.argv.find(value => value.startsWith('--run-name='))?.slice(11) ?? 'candidate-v9';
    const port = Number(process.argv.find(value => value.startsWith('--port='))?.slice(7) ?? 0);
    try { assert(Number.isInteger(port) && (port === 0 || port >= 1024 && port <= 65535), 'INVALID_PORT'); await startDouble(runName, port); }
    catch (error) { console.log(JSON.stringify({ status: 'NOT_STARTED', code: safeCode(error) })); process.exitCode = 1; }
  }
}
