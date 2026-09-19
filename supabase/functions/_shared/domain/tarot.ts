/** Canonical meanings transcribed from the JumZip Tarot Meaning Dataset v1.
 * https://app.notion.com/p/3e07cdef782d812f9b8dec7646d863fe
 * Domain-specific prose is shared guidance; missing reversed domain prose is not invented.
 */
export type SpreadType = 'ONE_CARD' | 'GENERAL_3' | 'RELATIONSHIP_3' | 'DECISION_3';
export type Orientation = 'UPRIGHT' | 'REVERSED';
export interface TarotCard {
  readonly cardId: number;
  readonly orientation: Orientation;
  readonly positionIndex: number;
  readonly positionKey: string;
}
export interface TarotMeaning {
  readonly id: number;
  readonly slug: string;
  readonly nameKo: string;
  readonly nameEn: string;
  readonly upright: readonly string[];
  readonly reversed: readonly string[];
  readonly guidance: Readonly<{ love: string; career: string; advice: string }>;
}
type MeaningRow = readonly [string, string, string, string, string, string, string, string];
const rows: readonly MeaningRow[] = [
  ['the_fool', '광대', 'The Fool', '새 출발,자유,가능성,모험,순수', '무모함,준비 부족,회피,경솔함,불안정', '새로운 감정/관계의 시작.', '새 기회.', '두려움만으로 멈추지 말되 준비 없이 뛰지는 않는다.'],
  ['the_magician', '마법사', 'The Magician', '실행력,기술,의지,자원 활용,주도권', '과장,조작,능력 낭비,실행 부족,허세', '적극적 표현/매력.', '가진 능력을 실제 결과로 연결.', '이미 가진 도구를 사용한다.'],
  ['the_high_priestess', '여사제', 'The High Priestess', '직감,숨은 정보,관찰,내면,침묵', '혼란,직감 무시,비밀,과도한 의심,단절', '드러나지 않은 감정.', '아직 정보가 부족함.', '성급한 결론보다 관찰.'],
  ['the_empress', '여황제', 'The Empress', '풍요,애정,성장,돌봄,창조', '과보호,의존,정체,자기돌봄 부족,과잉', '따뜻한 관계/성장.', '창작과 성과의 확장.', '키우되 소진되지 않는다.'],
  ['the_emperor', '황제', 'The Emperor', '안정,구조,책임,통제,리더십', '권위주의,경직,통제 상실,고집,압박', '안정 욕구와 경계.', '체계/책임.', '기준은 세우되 상대를 지배하지 않는다.'],
  ['the_hierophant', '교황', 'The Hierophant', '전통,규범,조언,공식화,배움', '관습 거부,독단,형식 피로,다른 길,가치 충돌', '관계 정의/공식화.', '멘토·조직 규칙.', '규칙의 이유를 확인한다.'],
  ['the_lovers', '연인', 'The Lovers', '선택,연결,끌림,가치 일치,관계', '불일치,갈등,선택 회피,유혹,관계 균열', '강한 연결과 선택.', '가치에 맞는 결정.', '감정만이 아니라 무엇을 선택하는지 본다.'],
  ['the_chariot', '전차', 'The Chariot', '추진,승부,집중,통제,전진', '방향 상실,과속,충돌,통제 실패,지연', '관계를 움직이려는 강한 의지.', '목표 집중.', '속도보다 방향을 먼저 고정한다.'],
  ['strength', '힘', 'Strength', '용기,인내,자기통제,부드러운 힘,회복', '자신감 저하,억압,감정 폭발,지침,불안', '감정 조절과 신뢰.', '버티는 힘.', '강압보다 꾸준함.'],
  ['the_hermit', '은둔자', 'The Hermit', '성찰,거리두기,탐색,독립,깊이', '고립,회피,과도한 폐쇄,외로움,방향 상실', '잠시 생각할 시간.', '집중/연구.', '혼자 있는 것과 도망치는 것을 구분한다.'],
  ['wheel_of_fortune', '운명의 수레바퀴', 'Wheel of Fortune', '전환,기회,흐름 변화,우연,사이클', '반복 패턴,지연,통제 불가,불운 체감,변화 저항', '관계 국면 전환.', '예상 밖 변화.', '바꿀 수 없는 흐름에 맞춰 행동을 조정한다.'],
  ['justice', '정의', 'Justice', '균형,책임,사실,공정,결과', '불공정,책임 회피,편향,오판,불균형', '말과 행동의 균형.', '계약/평가/결과.', '원하는 답보다 사실을 본다.'],
  ['the_hanged_man', '매달린 사람', 'The Hanged Man', '멈춤,관점 전환,기다림,내려놓음,희생', '의미 없는 지연,집착,정체,희생 강요,버티기', '지금 밀어붙이기보다 관점 변화.', '보류/재검토.', '멈춤의 이유를 찾는다.'],
  ['death', '죽음', 'Death', '종료,변화,전환,정리,재시작', '변화 거부,미련,지연된 끝,반복,정체', '관계 형태의 큰 변화.', '오래된 단계 종료.', '끝나야 시작되는 것을 인정한다.'],
  ['temperance', '절제', 'Temperance', '조율,균형,회복,인내,중간지점', '극단,조급함,불균형,과잉,조율 실패', '천천히 맞춰가는 관계.', '협업/조정.', '극단적 선택보다 조합.'],
  ['the_devil', '악마', 'The Devil', '집착,욕망,유혹,의존,얽힘', '해방,인식,거리두기,중독 탈피,통제 회복', '강한 끌림과 집착 구분.', '금전/권력 유혹.', '내가 스스로 묶여 있는 지점을 확인한다.'],
  ['the_tower', '탑', 'The Tower', '충격,붕괴,폭로,급변,재구성', '붕괴 회피,내부 균열,불안 지속,늦어진 변화,피해 축소', '숨겨진 문제가 드러남.', '계획 급변.', '무너진 구조를 억지로 원상복구하지 않는다.'],
  ['the_star', '별', 'The Star', '희망,회복,영감,신뢰,가능성', '낙담,기대 과잉,자신감 저하,방향 상실,회복 지연', '관계 회복의 여지.', '장기적 희망.', '희망을 구체적 행동과 연결한다.'],
  ['the_moon', '달', 'The Moon', '불확실성,감정,환상,숨은 두려움,직감', '혼란 해소,진실 노출,불안 감소,착각 깨짐,현실 확인', '오해/불확실한 신호.', '정보 부족.', '느낌을 사실로 확정하지 않는다.'],
  ['the_sun', '태양', 'The Sun', '명확함,기쁨,활력,성공,공개', '지연된 기쁨,과신,피로,기대와 현실 차이,부분 성과', '솔직함과 긍정성.', '성과가 드러남.', '좋은 흐름을 실제 행동으로 확장한다.'],
  ['judgement', '심판', 'Judgement', '각성,결론,재평가,부름,두 번째 기회', '결정 회피,자기비판,과거 집착,판단 지연,기회 외면', '관계를 다시 판단하는 시점.', '평가/복귀/전환.', '과거 경험을 결론에 반영한다.'],
  ['the_world', '세계', 'The World', '완성,통합,성취,마무리,다음 단계', '미완성,마지막 과제,지연,닫히지 않은 문제,성취감 부족', '한 단계 완성/정착.', '프로젝트 결실.', '끝맺음을 명확히 하고 다음 단계로 간다.'],
];

export const TAROT_MEANING_VERSION = 'JumZipTarotMeanings-v1';
export const TAROT_MEANINGS: readonly TarotMeaning[] = Object.freeze(rows.map((row, id) => Object.freeze({
  id, slug: row[0], nameKo: row[1], nameEn: row[2],
  upright: Object.freeze(row[3].split(',')), reversed: Object.freeze(row[4].split(',')),
  guidance: Object.freeze({ love: row[5], career: row[6], advice: row[7] }),
})));

export interface SpreadPosition { readonly key: string; readonly label: string }
const positions = (...values: readonly [string, string][]): readonly SpreadPosition[] =>
  Object.freeze(values.map(([key, label]) => Object.freeze({ key, label })));
export const TAROT_SPREADS: Readonly<Record<SpreadType, readonly SpreadPosition[]>> = Object.freeze({
  ONE_CARD: positions(['CORE_MESSAGE', '핵심 메시지 / 지금 필요한 조언']),
  GENERAL_3: positions(['CURRENT_SITUATION', '현재 상황'], ['KEY_VARIABLE', '핵심 변수 / 걸림돌'], ['DIRECTION_ADVICE', '앞으로의 방향 / 조언']),
  RELATIONSHIP_3: positions(['YOUR_ATTITUDE', '사용자의 마음 / 태도'], ['THEIR_ATTITUDE', '상대의 마음 / 태도'], ['RELATIONSHIP_DIRECTION', '관계의 흐름 / 조언']),
  DECISION_3: positions(['SUPPORTING_FORCE', '현재 선택을 밀어주는 힘'], ['RISK', '주의해야 할 리스크'], ['PRACTICAL_DIRECTION', '가장 현실적인 방향']),
});

/** Rejection sampling avoids modulo bias. Production always uses Web Crypto, never Math.random. */
export function secureRandomInt(exclusiveMax: number): number {
  if (!Number.isInteger(exclusiveMax) || exclusiveMax < 1 || exclusiveMax > 0x1_0000_0000) {
    throw new RangeError('RANDOM_BOUND_INVALID');
  }
  const range = 0x1_0000_0000;
  const limit = range - (range % exclusiveMax);
  const buffer = new Uint32Array(1);
  let value: number;
  do { globalThis.crypto.getRandomValues(buffer); value = buffer[0]!; } while (value >= limit);
  return value % exclusiveMax;
}

export function drawTarot(spread: SpreadType, randomInt: (exclusiveMax: number) => number = secureRandomInt): readonly TarotCard[] {
  if (!Object.hasOwn(TAROT_SPREADS, spread)) throw new RangeError('SPREAD_INVALID');
  const deck = TAROT_MEANINGS.map(({ id }) => id);
  const takeRandom = (max: number): number => {
    const value = randomInt(max);
    if (!Number.isInteger(value) || value < 0 || value >= max) throw new RangeError('RANDOM_SOURCE_INVALID');
    return value;
  };
  return Object.freeze(TAROT_SPREADS[spread].map((position, positionIndex) => {
    const [cardId] = deck.splice(takeRandom(deck.length), 1);
    return Object.freeze({ cardId: cardId!, orientation: takeRandom(2) === 0 ? 'UPRIGHT' as const : 'REVERSED' as const, positionIndex, positionKey: position.key });
  }));
}

export function getTarotMeaning(cardId: number): TarotMeaning {
  if (!Number.isInteger(cardId) || cardId < 0 || cardId >= TAROT_MEANINGS.length) throw new RangeError('CARD_ID_INVALID');
  return TAROT_MEANINGS[cardId]!;
}

export function buildTarotInterpretationData(cards: readonly TarotCard[]) {
  return cards.map(card => {
    const meaning = getTarotMeaning(card.cardId);
    if (card.orientation !== 'UPRIGHT' && card.orientation !== 'REVERSED') throw new RangeError('ORIENTATION_INVALID');
    return { ...card, nameKo: meaning.nameKo, nameEn: meaning.nameEn,
      keywords: card.orientation === 'UPRIGHT' ? meaning.upright : meaning.reversed,
      sharedGuidance: meaning.guidance, meaningVersion: TAROT_MEANING_VERSION };
  });
}
