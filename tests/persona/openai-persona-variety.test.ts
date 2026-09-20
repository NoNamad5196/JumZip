import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { posix, resolve } from 'node:path';
import ts from 'typescript';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const prefix = 'supabase/functions/_shared/';
const ids = ['persona/config.ts', 'persona/context.ts', 'persona/prompt.ts', 'persona/tool-facts.ts', 'domain/tarot.ts', 'llm/provider.ts', 'llm/validator.ts', 'llm/reply.ts'];
const baseline = new Map<string, string>();
const overlays = new Map<string, string>();
const modules = new Map<string, Promise<any>>();
const urls = new Map<string, Promise<string>>();
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

async function moduleUrl(id: string, candidate: boolean): Promise<string> {
  const key = `${candidate}:${id}`;
  if (!urls.has(key)) urls.set(key, (async () => {
    const source = candidate && overlays.has(id) ? overlays.get(id)! : baseline.get(id)!;
    if (source === undefined) throw Error(`UNKNOWN_MODULE:${id}`);
    let js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }, reportDiagnostics: true }).outputText;
    const imports = [...js.matchAll(/from\s+(['"])(\.[^'"]+)\1/g)];
    for (const match of imports) {
      const target = posix.normalize(posix.join(posix.dirname(id), match[2]));
      js = js.replace(match[0], `from ${JSON.stringify(await moduleUrl(target, candidate))}`);
    }
    return `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`;
  })());
  return urls.get(key)!;
}
async function load(id: string, candidate: boolean): Promise<any> {
  const key = `${candidate}:${id}`;
  if (!modules.has(key)) modules.set(key, moduleUrl(id, candidate).then(url => import(/* @vite-ignore */ url)));
  return modules.get(key)!;
}
const profileFrom = (system: string) => JSON.parse(system.split('캐릭터 설정:\n')[1].split('\n\n말투만 참고하는')[0]);
const stablePersona = (persona: any) => ({ ...persona, speakingStyle: { ...persona.speakingStyle, rhythm: undefined, sentenceLength: undefined, reaction: undefined, questioning: undefined }, memoryReferenceStyle: undefined });

beforeAll(() => {
  const manifest = JSON.parse(readFileSync(resolve('docs/evidence/edge-saju-focus-release.json'), 'utf8'));
  expect(manifest.promptVersion).toBe('JumZipPersona-v4');
  expect(manifest.intentVersion).toBe('JumZipIntent-v1');
  for (const id of ids) {
    const item = manifest.files.find((file: { path: string }) => file.path === prefix + id);
    const bytes = execFileSync('git', ['cat-file', 'blob', item.stagedGitBlob], { stdio: ['ignore', 'pipe', 'pipe'] });
    expect(hash(bytes)).toBe(item.sha256);
    baseline.set(id, bytes.toString('utf8'));
  }
  for (const [id, name] of [['persona/config.ts', 'config'], ['persona/prompt.ts', 'prompt'], ['llm/reply.ts', 'reply']]) overlays.set(id, readFileSync(resolve(`scripts/openai-fallback-release/${name}.ts.txt`), 'utf8').replaceAll('\r\n', '\n'));
});

describe('minimal deployed-v4.2 persona variety overlay, offline only', () => {
  it('changes only delivery guidance, retaining three identities, boundaries, intimacy and examples', async () => {
    const old = await load('persona/config.ts', false), next = await load('persona/config.ts', true);
    expect(Object.keys(next.PERSONAS)).toEqual(['BOMI', 'SANI', 'ARANG']);
    for (const id of Object.keys(old.PERSONAS)) {
      expect(stablePersona(next.PERSONAS[id])).toEqual(stablePersona(old.PERSONAS[id]));
      expect(next.PERSONAS[id].speakingStyle.rhythm).not.toContain('→');
      expect(next.PERSONAS[id].speakingStyle.sentenceLength).not.toContain('2~4');
      expect(next.PERSONAS[id].memoryReferenceStyle).not.toEqual(old.PERSONAS[id].memoryReferenceStyle);
    }
    expect(next.PERSONA_UI_COPY).toEqual(old.PERSONA_UI_COPY);
  });

  it('preserves every original safety, grounding and JSON-contract rule byte-for-byte', async () => {
    const old = await load('persona/prompt.ts', false), next = await load('persona/prompt.ts', true);
    const removed = ['보통 짧은 2~4문장과 핵심 질문 하나면 충분하다.', '공통 공감 상투어('];
    const added = ['사용자 요청에 맞는 길이와 구조로 답한다.', '공감은 사용자가 드러낸 감정과 상황에 필요한 때만 전한다.', '실제 최근 assistant 메시지의', '가상 말투 예문은 어조와 거리감만 참고한다.'];
    const previousLines = old.GLOBAL_PERSONA_RULES.split('\n');
    const nextLines = next.GLOBAL_PERSONA_RULES.split('\n');
    expect(previousLines.filter((line: string) => removed.some(start => line.startsWith(start)))).toHaveLength(2);
    expect(nextLines.filter((line: string) => added.some(start => line.startsWith(start)))).toHaveLength(4);
    expect(nextLines.filter((line: string) => !added.some(start => line.startsWith(start)))).toEqual(previousLines.filter((line: string) => !removed.some(start => line.startsWith(start))));
  });

  it('preserves actual history, selected memories and untrusted boundaries for every persona/state', async () => {
    const old = await load('persona/prompt.ts', false), next = await load('persona/prompt.ts', true);
    const recentMessages = [{ role: 'user', content: 'CANARY_USER: 오늘 발표를 마쳤어.' }, { role: 'assistant', content: 'CANARY_ASSISTANT: 발표를 끝냈구나. 지금은 어때?' }];
    for (const characterId of ['BOMI', 'SANI', 'ARANG']) for (const relationshipState of ['FIRST_MEETING', 'ACQUAINTANCE', 'FAMILIAR', 'CLOSE']) {
      const input = { characterId, relationshipState, currentMessage: '질문 없이 짧게 축하해 줘.', recentMessages, memories: [{ id: 'm1', scope: 'GLOBAL', category: 'PREFERENCE', subject: 'USER', content: '짧은 답변을 좋아한다.' }, { id: 'm2', scope: 'GLOBAL', content: '삭제된 기억 CANARY_DELETED', deletedAt: '2026-09-20' }] };
      const before = old.buildPersonaMessages(input), after = next.buildPersonaMessages(input);
      expect(after.slice(1)).toEqual(before.slice(1));
      expect(after.at(-1)).toEqual({ role: 'user', content: input.currentMessage });
      expect(after[0].content).not.toMatch(/CANARY_USER|CANARY_ASSISTANT|CANARY_DELETED/);
      expect(JSON.stringify(after)).not.toContain('CANARY_DELETED');
      const previousProfile = profileFrom(before[0].content), nextProfile = profileFrom(after[0].content);
      expect({ ...nextProfile, speechDNA: undefined, memoryReferenceStyle: undefined }).toEqual({ ...previousProfile, speechDNA: undefined, memoryReferenceStyle: undefined });
      expect(after[0].content.split('말투만 참고하는 독립 가상 예문(실제 대화 아님):\n')[1].split('\n가상 예문 끝.')[0]).toEqual(before[0].content.split('말투만 참고하는 독립 가상 예문(실제 대화 아님):\n')[1].split('\n가상 예문 끝.')[0]);
    }
  });

  it('retains tool facts, direction, privacy scrubbing and explicit caller task unchanged', async () => {
    const old = await load('persona/prompt.ts', false), next = await load('persona/prompt.ts', true);
    const input = { characterId: 'SANI', currentMessage: '이 카드의 뜻만 알려줘.', currentTask: '저장된 카드 한 장을 해석한다.', toolResult: { cards: [{ cardId: 9, orientation: 'REVERSED', positionIndex: 0, positionKey: 'CARD' }], birthDate: 'SYNTHETIC_PRIVATE_BIRTH', location: { name: 'SYNTHETIC_PRIVATE_CITY' } } };
    const before = old.buildPersonaMessages(input), after = next.buildPersonaMessages(input);
    expect(after.slice(1)).toEqual(before.slice(1));
    expect(after[0].content).toContain(`현재 작업: ${input.currentTask}`);
    expect(JSON.stringify(after)).not.toMatch(/SYNTHETIC_PRIVATE_BIRTH|SYNTHETIC_PRIVATE_CITY/);
    expect(JSON.stringify(after)).toContain('REVERSED');
  });

  it('makes question-free endings and history-aware response selection explicit without a phrase bank', async () => {
    const { buildPersonaMessages } = await load('persona/prompt.ts', true);
    const system = buildPersonaMessages({ characterId: 'BOMI', currentMessage: '고마워. 질문은 하지 않아도 돼.' })[0].content;
    expect(system).toContain('질문으로 끝낼 필요는 없다');
    expect(system).toContain('답변에 꼭 필요한 정보가 없을 때만 하나');
    expect(system).toContain('실제 최근 assistant 메시지');
    expect(system).toContain('단어만 바꾸거나 준비된 문구를 번갈아 고르지 말고');
    expect(system).toContain('예문의 첫 문장·종결문·질문 수·답변 순서를 복제하지 않는다');
    expect(system).not.toContain('2~4문장');
    expect(overlays.get('persona/prompt.ts')).not.toMatch(/Math\.random|crypto\.getRandomValues/);
  });

  it('sends final interaction guidance after examples and caller task without promoting user preferences to system text', async () => {
    const { generatePersonaReply } = await load('llm/reply.ts', true);
    const requests = [
      'CANARY_STYLE_A: 답을 찾으려는 건 아니야. 묻지 말고 잠깐 들어줘.',
      'CANARY_STYLE_B: 해결책 없이 짧게 맞장구만 해 줘.',
      'CANARY_STYLE_C: 필요한 건 물어봐도 좋아. 같이 정리해 보자.',
    ];
    for (const characterId of ['BOMI', 'SANI', 'ARANG']) for (const currentMessage of requests) {
      const recentMessages = [{ role: 'assistant', content: 'CANARY_OLD_QUESTION: 자세히 말해 줄래?' }];
      const currentTask = '사용자의 고민을 정리하고 필요한 사항을 확인한다.';
      const generateChat = vi.fn(async () => ({ content: JSON.stringify({ text: '응.', toolReferences: [] }), model: 'synthetic-offline-model' }));
      await generatePersonaReply({ generateChat, repairChat: vi.fn() }, { characterId, currentMessage, currentTask, recentMessages });
      const messages = generateChat.mock.calls[0] as unknown as [Array<{ role: string; content: string }>];
      const sent = messages[0], system = sent[0].content;
      const suffixIndex = system.lastIndexOf('답변 직전 확인할 대화 방식:');
      expect(suffixIndex).toBeGreaterThan(system.indexOf(`현재 작업: ${currentTask}`));
      expect(suffixIndex).toBeGreaterThan(system.indexOf('가상 예문 끝.'));
      expect(system.slice(suffixIndex)).toContain('마지막 질문·확인 질문·더 말해 달라는 요구 없이 끝낸다');
      expect(system.slice(suffixIndex)).toContain('조언을 원하지 않는다고 밝히면 행동 지시·해결책·휴식이나 보상 권유를 덧붙이지 않는다');
      expect(system.slice(suffixIndex)).toContain('사용자가 질문을 원하는 경우까지 질문을 금지하는 규칙은 아니다');
      expect(system.slice(suffixIndex)).toContain('안전 안내와 도구 원자료·JSON 출력 계약을 바꾸지 않는다');
      expect(system).not.toMatch(/CANARY_STYLE_|CANARY_OLD_QUESTION/);
      expect(sent.at(-1)).toEqual({ role: 'user', content: currentMessage });
      expect(sent).toContainEqual(recentMessages[0]);
    }
  });

  it('validates question-free ordinary and Tarot replies with original v4 contracts and v4.2 metadata', async () => {
    const { generatePersonaReply } = await load('llm/reply.ts', true);
    const cards = [{ cardId: 9, orientation: 'REVERSED', positionIndex: 0, positionKey: 'CARD' }];
    for (const [input, value] of [
      [{ characterId: 'BOMI', currentMessage: '발표를 마쳤어. 축하만 해줘.' }, { text: '발표 끝낸 거 축하해!', toolReferences: [] }],
      [{ characterId: 'SANI', currentMessage: '카드의 뜻만 알려줘.', toolResult: { cards } }, { text: '혼자 고립되지 않도록 작은 연결부터 살펴보자.', toolReferences: [{ cardId: 9, orientation: 'REVERSED', positionIndex: 0 }] }],
    ]) {
      const generateChat = vi.fn(async () => ({ content: JSON.stringify(value), model: 'synthetic-offline-model' }));
      const repairChat = vi.fn();
      const result = await generatePersonaReply({ generateChat, repairChat }, input);
      expect(result.content).toBe(value.text);
      expect(result.metadata.promptVersion).toBe('JumZipPersona-v4.2');
      expect(result.repaired).toBe(false);
      expect(repairChat).not.toHaveBeenCalled();
      expect(Object.keys(result).sort()).toEqual(['content', 'metadata', 'repaired', 'segments']);
    }
  });

  it('does not relax schema or persona safety and retains exactly one controlled repair', async () => {
    const { generatePersonaReply } = await load('llm/reply.ts', true);
    const valid = JSON.stringify({ text: '발표 끝낸 거 축하해!', toolReferences: [] });
    for (const invalid of ['{"text":"안녕!"}', '{"text":"나는 AI야","toolReferences":[]}']) {
      const generateChat = vi.fn(async () => ({ content: invalid, model: 'synthetic' }));
      const repairChat = vi.fn(async () => ({ content: valid, model: 'synthetic' }));
      const result = await generatePersonaReply({ generateChat, repairChat }, { characterId: 'BOMI', currentMessage: '발표를 마쳤어.' });
      expect(result.repaired).toBe(true);
      expect(generateChat).toHaveBeenCalledOnce();
      expect(repairChat).toHaveBeenCalledOnce();
      repairChat.mockResolvedValue({ content: invalid, model: 'synthetic' });
      await expect(generatePersonaReply({ generateChat, repairChat }, { characterId: 'BOMI', currentMessage: '안녕' })).rejects.toMatchObject({ code: 'LLM_INVALID_RESPONSE' });
      expect(repairChat).toHaveBeenCalledTimes(2);
    }
  });

  it('changes only the version marker in reply orchestration and imports no v12 contracts', () => {
    expect(overlays.get('llm/reply.ts')!.replace("JumZipPersona-v4.2", "JumZipPersona-v4")).toBe(baseline.get('llm/reply.ts'));
    expect([...overlays.values()].join('\n')).not.toMatch(/TEXT_ONLY_V1|TAROT_EVIDENCE_V1|interpretationEvidence|diagnoseValidationError/);
    for (const source of overlays.values()) expect(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }, reportDiagnostics: true }).diagnostics).toEqual([]);
  });
});
