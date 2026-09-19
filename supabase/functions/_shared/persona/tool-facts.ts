import { getTarotMeaning, TAROT_MEANING_VERSION, TAROT_SPREADS, type TarotCard } from '../domain/tarot.ts';

const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const labels: Readonly<Record<string, string>> = {
  STEM_COMBINATION: '천간합', SIX_COMBINATION: '육합', TRINE: '삼합', DIRECTIONAL: '방합',
  CLASH: '충', HARM: '해', BREAK: '파', PUNISHMENT: '형', SELF_PUNISHMENT: '자형',
};
const positionLabels = Object.fromEntries(Object.values(TAROT_SPREADS).flat().map(({ key, label }) => [key, label]));
const elementLabels = { WOOD: '목', FIRE: '화', EARTH: '토', METAL: '금', WATER: '수' } as const;
type Element = keyof typeof elementLabels;
const elements = Object.keys(elementLabels) as Element[];
const isRatio = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
const percent = (ratio: number): number => Math.round(ratio * 1_000) / 10;
function inputAvailability(value: unknown, knownUnknownClock: boolean) {
  const row = record(value);
  return { calendarDate: row?.calendarDate === 'PROVIDED' ? 'PROVIDED' : 'NOT_RECORDED',
    clockTime: row?.clockTime === 'PROVIDED' ? 'PROVIDED' : row?.clockTime === 'UNKNOWN' || knownUnknownClock ? 'UNKNOWN' : 'NOT_RECORDED' };
}

/** Descriptive arithmetic only: no notion of favorable, strong, weak or compatibility
 * is inferred here. Ties use original ratios; percentages are rounded for speech only. */
function describeDistribution(value: unknown) {
  const row = record(value);
  if (!row || !elements.every(element => isRatio(row[element]))) return null;
  const proportions = elements.map(element => ({ element, label: elementLabels[element], proportion: row[element] as number, percent: percent(row[element] as number) }));
  const max = Math.max(...proportions.map(item => item.proportion));
  const min = Math.min(...proportions.map(item => item.proportion));
  return { proportions, maximumElements: proportions.filter(item => item.proportion === max).map(item => item.label),
    minimumElements: proportions.filter(item => item.proportion === min).map(item => item.label),
    zeroElements: proportions.filter(item => item.proportion === 0).map(item => item.label), percentageDecimals: 1 };
}
function oneRatio(value: unknown): number | null {
  if (!Array.isArray(value) || !value.length || !value.every(isRatio)) return null;
  return value.every(item => item === value[0]) ? value[0] as number : null;
}
function describeCompatibility(value: unknown) {
  if (!Array.isArray(value)) return null;
  const personA: Partial<Record<Element, number>> = {}, personB: Partial<Record<Element, number>> = {};
  const comparisons = elements.map(element => {
    const row = value.map(record).find(item => item?.element === element);
    const a = oneRatio(row?.possiblePersonAProportions), b = oneRatio(row?.possiblePersonBProportions);
    if (a !== null) personA[element] = a;
    if (b !== null) personB[element] = b;
    // With more than one possible value, keep this comparison unresolved. Do not
    // manufacture a joint A/B chart from independently projected marginals.
    return { element, label: elementLabels[element], personAPercent: a === null ? null : percent(a), personBPercent: b === null ? null : percent(b),
      comparison: a === null || b === null ? null : a > b ? 'A가 더 많음' : a < b ? 'B가 더 많음' : '동일',
      statement: a === null || b === null ? '미확정: 원래 후보 비율을 보존한다.' : `${elementLabels[element]} 비중: A ${percent(a)}%, B ${percent(b)}%. ${a !== b && percent(a) === percent(b) ? '반올림 표시는 같지만 원 비율에서는 ' : ''}${a > b ? 'A가 더 많다' : a < b ? 'B가 더 많다' : '같다'}.` };
  });
  return { personA: describeDistribution(personA), personB: describeDistribution(personB), comparisons,
    scope: '실제 비중의 최대·최소·비교만 표시한다. 용신·희신, 강약 등급, 성격, 관계 성공 여부를 새로 판단한 것이 아니다.' };
}

/** A prompt-only view of canonical facts. It neither recalculates nor mutates stored
 * results; orientation semantics always come from the selected canonical deck row.
 * Caller scrubs private birth fields before passing a snapshot here. */
export function buildPersonaToolFacts(value: unknown): unknown {
  const tool = record(value);
  if (!tool) return value;
  if (Array.isArray(tool.cards)) {
    const cards = tool.cards.map(value => {
      const card = value as TarotCard;
      const meaning = getTarotMeaning(card.cardId);
      if (!['UPRIGHT', 'REVERSED'].includes(card.orientation)) throw new RangeError('ORIENTATION_INVALID');
      const subjectRole = card.positionKey === 'YOUR_ATTITUDE' ? 'USER' : card.positionKey === 'THEIR_ATTITUDE' ? 'OTHER_PERSON' : card.positionKey === 'RELATIONSHIP_DIRECTION' ? 'RELATIONSHIP' : 'QUESTION_CONTEXT';
      return { cardId: card.cardId, orientation: card.orientation, positionIndex: card.positionIndex, positionKey: card.positionKey,
        nameKo: meaning.nameKo, orientationLabel: card.orientation === 'UPRIGHT' ? '정방향' : '역방향', positionLabel: positionLabels[card.positionKey] ?? card.positionKey,
        activeMeaning: card.orientation === 'UPRIGHT' ? meaning.upright : meaning.reversed,
        symbolicFrame: { evidenceKind: 'SYMBOLIC_NOT_OBSERVED', subjectRole, meaningSource: 'activeMeaning', certainty: 'POSSIBILITY' },
        contextAdvice: meaning.guidance.advice, meaningVersion: TAROT_MEANING_VERSION };
    });
    return { ...tool, cards, requiredToolReferences: cards.map(({ cardId, orientation, positionIndex }) => ({ cardId, orientation, positionIndex })),
      interpretationContract: '현재 방향의 activeMeaning부터 해석한다. symbolicFrame의 대상과 가능성 수준을 유지한다. contextAdvice는 다음 행동을 검토하는 조언이지 현재 상태의 원인·필요를 입증하지 않는다. 상대의 욕구나 마음을 관찰한 사실처럼 말하지 않는다. requiredToolReferences는 재추첨 요청에도 저장된 카드 그대로 복사한다.' };
  }
  if (tool.kind !== 'SAJU' && tool.kind !== 'SAJU_COMPATIBILITY') return value;
  const annotate = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(annotate);
    const row = record(item); if (!row) return item;
    const copy = Object.fromEntries(Object.entries(row).map(([key, child]) => [key, annotate(child)]));
    if (typeof row.type === 'string' && labels[row.type]) copy.relationLabel = labels[row.type];
    return copy;
  };
  const result = annotate(tool) as Record<string, unknown>;
  const flags = Array.isArray(tool.uncertaintyFlags) ? tool.uncertaintyFlags : [];
  if (tool.kind === 'SAJU') {
    result.inputAvailability = inputAvailability(tool.inputAvailability, flags.includes('BIRTH_TIME_UNKNOWN'));
    result.calculationUncertainty ??= null;
  } else for (const [key, prefix] of [['personAInputContext', 'PERSON_A:'], ['personBInputContext', 'PERSON_B:']] as const) {
    const source = record(tool[key]);
    result[key] = { inputAvailability: inputAvailability(source?.inputAvailability, flags.includes(`${prefix}BIRTH_TIME_UNKNOWN`)), calculationUncertainty: source?.calculationUncertainty ?? null };
  }
  const possibilities = record(result.possible_values);
  if (possibilities && Array.isArray(possibilities.score) && possibilities.score.every(item => typeof item === 'number')) {
    result.possible_values = { ...possibilities, score: [...possibilities.score].sort((a, b) => a - b) };
  }
  result.unconfirmedFields = Object.entries(result).filter(([, item]) => item === null).map(([key]) => key);
  result.inputStatusContract = 'inputAvailability는 원자료 값이 아닌 입력 상태다. PROVIDED는 이미 제공됨, UNKNOWN은 시각 미상, NOT_RECORDED는 상태 기록이 없음이다. NOT_RECORDED를 사용자 미입력으로 단정하지 않는다. calculationUncertainty는 계산 경계·후보의 제한이며 날짜 입력의 유무와 다르다.';
  if (tool.kind === 'SAJU_COMPATIBILITY') {
    result.descriptiveElementFacts = describeCompatibility(tool.elementComplement);
    result.availableEvidence = ['dayMasterRelation: 두 일간의 관계', 'elementComplement: A와 B 각각의 실제 오행 비율 및 균형 역할', 'spousePalaceRelations/stemRelations/branchRelations: 위치가 표시된 관계', 'timing: 대운·연운·월운에 따른 관계 활성화 근거'];
    result.unavailableOutputs = ['결혼할 날짜·월', '결혼 성공 확률', '전체 궁합 점수'];
    result.interpretationContract = '관계 활성화는 결혼 시기를 계산한 결과가 아니다. 출생시간을 추가해도 이 제품은 unavailableOutputs를 계산하지 않는다. A와 B의 오행 비율을 정확히 비교하고 용신·희신을 실제 많은 오행으로 바꾸지 않는다. 이름은 실제 대화 자료의 A/B 대응만 따른다.';
  } else {
    result.descriptiveElementFacts = describeDistribution(tool.elements);
    result.interpretationContract = 'elements는 실제 오행 비율이고 yongsin/heesin은 도움이 되는 균형 역할이다. 둘을 혼동하지 않는다. null과 possible_values는 미확정 사실로 유지하고, 가능한 점수는 나열하되 연속 범위나 하나의 확정 점수로 바꾸지 않는다. 현재 알려진 주는 그대로 보존한다.';
  }
  return result;
}
