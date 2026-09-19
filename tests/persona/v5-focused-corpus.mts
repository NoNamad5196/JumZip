/** Frozen synthetic regression selection. This does not replace original core60/supp24.
 * Existing selections keep their original IDs and inputs. New contrasts are labelled.
 * No user profiles, account identifiers or external calls are used here. */
import { PERSONA_BENCHMARK_CASES } from '../../supabase/functions/_shared/persona/benchmark.ts';
import type { PersonaPromptInput } from '../../supabase/functions/_shared/persona/prompt.ts';
import type { IntentInput } from '../../supabase/functions/_shared/llm/intent.ts';
import { buildTarotInterpretationData } from '../../supabase/functions/_shared/domain/tarot.ts';
import { calculateSajuCompatibility, buildCompatibilityInterpretationData } from '../../supabase/functions/_shared/domain/saju-compatibility.ts';
import { SAJU_SUPPLEMENTAL_CASES, SUPPLEMENTAL_FIXTURES } from './saju-benchmark-corpus.ts';

export const V5_FOCUSED_CORPUS_VERSION = 'JumZipV5Focused-v1';
export interface FocusedReplyCase {
  id: string; origin: 'ORIGINAL_CORE' | 'ORIGINAL_SUPPLEMENT' | 'NEW_CONTRAST';
  input: PersonaPromptInput; reviewChecks: readonly string[];
}
export interface FocusedIntentCase {
  id: string; input: IntentInput;
  expected: { recommendation: 'NONE' | 'TAROT' | 'SAJU'; modes: readonly string[] };
  reviewChecks: readonly string[];
}
const original = (id: string, characterId: PersonaPromptInput['characterId'], supplement = false): FocusedReplyCase => {
  const source = (supplement ? SAJU_SUPPLEMENTAL_CASES : PERSONA_BENCHMARK_CASES).find(item => item.id === id);
  if (!source) throw Error('FOCUSED_ORIGINAL_MISSING');
  return { id: `${id}:${characterId}`, origin: supplement ? 'ORIGINAL_SUPPLEMENT' : 'ORIGINAL_CORE',
    input: { ...structuredClone(source.input), characterId }, reviewChecks: [...source.reviewChecks] };
};
const memory = { id: '11111111-1111-4111-8111-111111111111', scope: 'GLOBAL' as const, category: 'PREFERENCE', subject: 'USER',
  content: '종이별 접기를 오래 즐기고 있으며, 꾸준히 만드는 종이별을 가장 좋아함', importance: 5 };
const recall = '내가 오래 즐겨 온 취미가 무엇이었는지 기억하고 있으면 말해 줘.';
const commonRecall = { relationshipState: 'FIRST_MEETING' as const, recentMessages: [], summary: '', memories: [memory] };
const tarot = (hermitUpright: boolean, swapped: boolean) => ({ kind: 'TAROT', cards: buildTarotInterpretationData([
  { cardId: swapped ? 9 : 6, orientation: swapped && !hermitUpright ? 'REVERSED' : 'UPRIGHT', positionIndex: 0, positionKey: 'YOUR_ATTITUDE' },
  { cardId: swapped ? 6 : 9, orientation: !swapped && !hermitUpright ? 'REVERSED' : 'UPRIGHT', positionIndex: 1, positionKey: 'THEIR_ATTITUDE' },
  { cardId: 14, orientation: 'UPRIGHT', positionIndex: 2, positionKey: 'RELATIONSHIP_DIRECTION' },
]) });
// Preserve a genuinely missing provenance field. Do not backfill it from null pillars.
const removeAvailability = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(removeAvailability);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !['inputAvailability', 'calculationUncertainty'].includes(key)).map(([key, child]) => [key, removeAvailability(child)]));
  return value;
};
const legacy = removeAvailability(structuredClone(SAJU_SUPPLEMENTAL_CASES.find(item => item.id === 's03-correlated-boundary')!.input.toolResult));
const reversedPeople = buildCompatibilityInterpretationData(calculateSajuCompatibility({ personA: SUPPLEMENTAL_FIXTURES.unknown, personB: SUPPLEMENTAL_FIXTURES.known }));

export const V5_REPLY_CASES: readonly FocusedReplyCase[] = [
  ...(['BOMI', 'SANI', 'ARANG'] as const).map(character => original('10-retry-same-draw', character)),
  ...(['BOMI', 'SANI', 'ARANG'] as const).map(character => original('s03-correlated-boundary', character, true)),
  original('s02-unknown-hour', 'BOMI', true),
  original('s05-compatibility-evidence', 'ARANG', true),
  original('s06-compatibility-uncertain', 'ARANG', true), original('s07-no-invented-score', 'ARANG', true),
  { id: 'v5-hermit-upright-contrast:BOMI', origin: 'NEW_CONTRAST', input: { characterId: 'BOMI', currentMessage: '저장된 관계 카드를 쉬운 말로 설명해 줘.', toolResult: tarot(true, false) },
    reviewChecks: ['은둔자 정방향의 성찰/탐색을 역방향 회피로 단정하지 않음', '상대 위치라도 실제 마음이나 욕구를 확정하지 않음', '연인=나, 은둔자=상대, 절제=방향 보존'] },
  { id: 'v5-reversed-owner-contrast:SANI', origin: 'NEW_CONTRAST', input: { characterId: 'SANI', currentMessage: '내 태도와 상대 태도를 구분해서, 지금 카드가 짚는 부분을 말해 줘.', toolResult: tarot(false, true) },
    reviewChecks: ['은둔자 역방향은 이번에는 나의 위치이며 상대에게 옮기지 않음', '상대 위치 연인도 실제 호감의 증명이 아님', '회피/과도한 폐쇄를 건전한 고독 필요로 뒤집지 않음'] },
  { id: 'v5-legacy-provenance:ARANG', origin: 'NEW_CONTRAST', input: { characterId: 'ARANG', currentMessage: '저장된 결과에 입력 상태가 안 보이는데, 생년월일을 안 넣었다는 뜻이야?', toolResult: legacy },
    reviewChecks: ['상태 기록이 없음과 사용자 입력이 없음을 구분', '날짜 제공/미제공을 새로 확정하지 않음', '기존 후보와 null을 유지하고 출생 원자료를 복원하지 않음'] },
  { id: 'v5-ab-swapped-contrast:SANI', origin: 'NEW_CONTRAST', input: { characterId: 'SANI', currentMessage: '이번에는 A가 민수이고 B가 나야. 실제 오행 비중과 누구의 시주가 미상인지 구분해서 설명해 줘.', toolResult: reversedPeople },
    reviewChecks: ['A 민수가 시주 미상이고 B는 시주가 있는 component fixture', 'A 목 약48.3%/수35%, B 목80%이며 둘 다 목이 최대', '날짜 provenance 없는 합성 구조를 실제 사용자 출생일로 보강하지 않음'] },
  { id: 'v5-pure-recall:BOMI', origin: 'NEW_CONTRAST', input: { ...commonRecall, characterId: 'BOMI', currentMessage: recall },
    reviewChecks: ['실제 제공된 종이별 접기 선호만 회상', '새 사주/타로 결과나 도구 필요성을 만들지 않음', 'cards 없음에도 toolReferences 빈 배열을 정확히 반환'] },
  { id: 'v5-recall-explicit-tarot:ARANG', origin: 'NEW_CONTRAST', input: { ...commonRecall, characterId: 'ARANG', currentMessage: '내 취미 기억해? 이번 주 모임에서 먼저 인사할지 타로로도 보고 싶어.',
      currentTask: '타로를 요청했지만 아직 사용자가 추첨을 실행하지 않아 toolResult는 없다. 실제 제공된 기억에 답하고 도구 선택으로 안내한다. 추첨 결과를 만들지 않는다.' },
    reviewChecks: ['회상과 긍정적 타로 요청을 모두 존중', '종이별 선호 외 실제 모임 사실을 창작하지 않음', '아직 실행되지 않은 카드/방향/결과를 만들지 않음'] },
];
const plain = (currentMessage: string): IntentInput => ({ currentMessage, recentMessages: [], hasOwnBirthData: false, hasPartnerBirthData: false });
export const V5_INTENT_CASES: readonly FocusedIntentCase[] = [
  { id: 'v5-intent-pure-recall-no-profile', input: plain(recall), expected: { recommendation: 'NONE', modes: [] }, reviewChecks: ['실제 Qwen 오분류 질문 그대로', '취미 회상을 타고난 성향으로 바꾸지 않음', '분류 실패로 null인 것을 정상 무추천으로 집계하지 않음'] },
  { id: 'v5-intent-pure-recall-has-profile', input: { ...plain(recall), hasOwnBirthData: true }, expected: { recommendation: 'NONE', modes: [] }, reviewChecks: ['프로필 존재 boolean만 바꿔도 회상 목적은 같음', 'birth-data 존재로 사주 추천을 강제하지 않음'] },
  { id: 'v5-intent-memory-control', input: { ...plain('종이별을 좋아한다는 얘기는 이제 기억하지 마.'), recentMessages: [{ role: 'assistant', content: '타고난 성향을 사주로 살펴볼 수도 있어.' }] }, expected: { recommendation: 'NONE', modes: [] }, reviewChecks: ['기억 거부는 현재의 관리 요청', '과거 assistant의 사주 제안을 현재 선택으로 승격하지 않음', '삭제 실행 여부는 분류기가 주장하지 않음'] },
  { id: 'v5-intent-current-preference', input: plain('나는 요즘 조용히 종이별 접는 시간이 제일 좋아.'), expected: { recommendation: 'NONE', modes: [] }, reviewChecks: ['현재 선호 공유를 선천 성향 질문으로 확대하지 않음'] },
  { id: 'v5-intent-innate-character', input: plain('내가 타고난 기질이나 성향을 이해하고 싶어.'), expected: { recommendation: 'SAJU', modes: ['NATAL'] }, reviewChecks: ['선천적 성향에 대한 의미상 요청은 기존 natal 행렬로 연결', '단순 회상과 구분하며 없는 원국을 계산했다고 하지 않음'] },
  { id: 'v5-intent-recall-explicit-tarot', input: plain('내 취미 기억해? 이번 주 모임에서 먼저 인사할지 타로로도 보고 싶어.'), expected: { recommendation: 'TAROT', modes: ['GENERAL_3', 'RELATIONSHIP_3', 'DECISION_3'] }, reviewChecks: ['회상 단어가 있어도 현재 긍정적 타로 요청을 제거하지 않음', '원문 근거를 보존하고 실행은 하지 않음', '모임 질문의 세부 spread는 원래 행렬의 허용 범위로 검토'] },
  { id: 'v5-intent-target-remembers', input: plain('그 사람이 나를 기억하는지 타로로 보고 싶어.'), expected: { recommendation: 'TAROT', modes: ['RELATIONSHIP_3'] }, reviewChecks: ['그 사람의 기억/마음 질문을 내 메모리 회상과 구분', '도구가 상대의 실제 마음을 증명한다는 해석은 생성하지 않음'] },
  { id: 'v5-intent-forget-and-tarot', input: plain('그 얘기는 기억하지 말고, 오늘 운세는 타로로 보고 싶어.'), expected: { recommendation: 'TAROT', modes: ['DAILY'] }, reviewChecks: ['저장 거부와 긍정적 타로 요청을 각각 존중', '모든 기억 발화를 정규식으로 도구 금지하지 않음', '현재 canonical API의 오늘 운세 모드는 DAILY이며 내부 한 장 spread와 구분'] },
];
if (V5_REPLY_CASES.length !== 16 || V5_INTENT_CASES.length !== 8 || new Set([...V5_REPLY_CASES, ...V5_INTENT_CASES].map(item => item.id)).size !== 24) throw Error('V5_FOCUSED_COVERAGE_INVALID');
// Preserve priority failures even if the pre-call budget guard stops the later contrasts.
const priority = ['10-retry-same-draw:BOMI', 's03-correlated-boundary:ARANG', 'v5-intent-pure-recall-no-profile'];
export const V5_EXECUTION_ORDER: readonly string[] = [...priority,
  ...V5_REPLY_CASES.filter(item => item.origin !== 'NEW_CONTRAST' && !priority.includes(item.id)).map(item => item.id),
  ...V5_REPLY_CASES.filter(item => item.origin === 'NEW_CONTRAST').map(item => item.id),
  ...V5_INTENT_CASES.filter(item => !priority.includes(item.id)).map(item => item.id)];
if (V5_EXECUTION_ORDER.length !== 24 || new Set(V5_EXECUTION_ORDER).size !== 24) throw Error('V5_EXECUTION_ORDER_INVALID');
