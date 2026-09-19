import type { CharacterId } from '../persona/config.ts';
import type { TarotCard } from '../domain/tarot.ts';
export interface ToolReference { cardId: number; orientation: 'UPRIGHT' | 'REVERSED'; positionIndex: number }
export interface ValidatedReply { text: string; toolReferences: ToolReference[] }
export type ValidationResult = { ok: true; value: ValidatedReply } | { ok: false; issues: string[] };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export interface ChatValidationOptions { characterId: CharacterId; expectedCards?: readonly TarotCard[]; toolResult?: unknown; currentMessage?: string }

/** Deliberately narrow factual checks. These detect unsupported numerical claims observed
 * in the actual baseline; they do not certify natural-language semantics or persona quality. */
function groundedNumberIssues(text: string, options: ChatValidationOptions): string[] {
  const tool = options.toolResult;
  if (!object(tool) || !['SAJU', 'SAJU_COMPATIBILITY'].includes(String(tool.kind))) return [];
  const issues: string[] = [];
  const asksProbability = /확률|성공률|퍼센트|[％%]/u.test(options.currentMessage ?? '');
  for (const clause of text.split(/[!?。！？\n]+|(?<!\d)\.(?!\d)/u)) {
    const outcome = /확률|성공률|성공|결혼|궁합/u.test(clause);
    const measurement = /오행|비중|분포|강약/u.test(clause);
    const percentages = [...clause.matchAll(/(\d+(?:\.\d+)?)\s*(?:[%％]|퍼센트)/gu)].map(match => Number(match[1]));
    // Quoting the 0–100 scale while explicitly declining it is not an invented estimate.
    const deniesScale = percentages.every(value => value === 0 || value === 100) && /(?:바꾸|환산|표현|계산|보장|말할).{0,8}(?:없|못|않)|(?:수치|확률).{0,8}(?:없|아니)/u.test(clause);
    if (percentages.length && (outcome || asksProbability && !measurement) && !deniesScale) issues.push('UNSUPPORTED_PROBABILITY');
    if (asksProbability && !measurement && /^\s*\d+(?:\.\d+)?\s*(?:점)?\s*(?:정도|쯤|수준|야|입니다|예요|이에요|$)/u.test(clause)) issues.push('UNSUPPORTED_PROBABILITY');
  }
  const scoreValues: number[] = [];
  if (object(tool.strength) && typeof tool.strength.score === 'number') scoreValues.push(tool.strength.score);
  if (object(tool.possible_values) && Array.isArray(tool.possible_values.score)) scoreValues.push(...tool.possible_values.score.filter((value): value is number => typeof value === 'number' && Number.isFinite(value)));
  for (const match of text.matchAll(/(?:강약\s*)?점수\s*(?:는|가|이|:|=)?\s*(\d+(?:\.\d+)?)/gu)) {
    if (tool.kind === 'SAJU_COMPATIBILITY' || !scoreValues.includes(Number(match[1]))) issues.push('TOOL_SCORE_CHANGED');
  }
  for (const match of text.matchAll(/(?:강약\s*)?점수\s*(?:는|가|이|:|=)?\s*(\d+(?:\.\d+)?)\s*[~～–-]\s*(\d+(?:\.\d+)?)/gu)) {
    const low = Number(match[1]), high = Number(match[2]);
    if (scoreValues.some(score => score < low || score > high)) issues.push('TOOL_SCORE_POSSIBILITIES_CHANGED');
  }
  return issues;
}

/** Validates structure and explicit references. Semantic/persona quality still needs the benchmark. */
export function validateChatOutput(raw: string, options: ChatValidationOptions): ValidationResult {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return { ok: false, issues: ['JSON_REQUIRED'] }; }
  if (!object(value) || Object.keys(value).some(key => !['text', 'toolReferences'].includes(key))) return { ok: false, issues: ['RESPONSE_SCHEMA_INVALID'] };
  if (typeof value.text !== 'string' || value.text.trim().length < 1 || value.text.length > 6000 || !Array.isArray(value.toolReferences)) return { ok: false, issues: ['RESPONSE_SCHEMA_INVALID'] };
  const text = value.text.trim();
  const issues: string[] = [];
  issues.push(...groundedNumberIssues(text, options));
  if (/<\/?(?:think|script|system)>|\[INST\]|<\|(?:im_start|im_end|system)\|>/.test(text)) issues.push('MODEL_CONTROL_TEXT');
  if (/(?:저는|나는)\s*(?:AI|인공지능|언어 모델|ChatGPT)|(?:고객님|분석 결과입니다|상담 결과입니다)/.test(text)) issues.push('PERSONA_BREAK');
  if (/(?:운명이\s*정해졌|무조건\s*(?:된다|됩니다|성공|합격)|100\s*%\s*(?:확실|보장)|나만\s*있으면\s*돼)/.test(text)) issues.push('FORBIDDEN_CERTAINTY_OR_DEPENDENCY');
  if (options.characterId === 'BOMI' && /(?:나랑\s*(?:사귀|키스)|내\s*남자친구|내\s*여자친구)/.test(text)) issues.push('BOMI_RELATIONSHIP_BOUNDARY');
  const references: ToolReference[] = [];
  for (const ref of value.toolReferences) {
    if (!object(ref) || Object.keys(ref).some(key => !['cardId', 'orientation', 'positionIndex'].includes(key)) || !Number.isInteger(ref.cardId) || (ref.cardId as number) < 0 || (ref.cardId as number) > 21 || !['UPRIGHT', 'REVERSED'].includes(ref.orientation as string) || !Number.isInteger(ref.positionIndex) || (ref.positionIndex as number) < 0 || (ref.positionIndex as number) > 2) {
      issues.push('TOOL_REFERENCE_INVALID'); break;
    }
    references.push(ref as unknown as ToolReference);
  }
  const expected = options.expectedCards ?? [];
  if (references.length !== expected.length || expected.some((card, index) => card.cardId !== references[index]?.cardId || card.orientation !== references[index]?.orientation || card.positionIndex !== references[index]?.positionIndex)) issues.push('TOOL_RESULT_CHANGED');
  return issues.length ? { ok: false, issues: [...new Set(issues)] } : { ok: true, value: { text, toolReferences: references } };
}

/** UI reveal uses the completed, validated response; it does not stream unvalidated model tokens. */
export function segmentReply(text: string): string[] {
  return text.split(/(?<=[.!?。！？])\s+|\n+/u).map(line => line.trim()).filter(Boolean);
}
