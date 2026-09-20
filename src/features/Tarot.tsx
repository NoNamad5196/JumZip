import { useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Link } from 'react-router-dom';
import { Icon, Notice } from '../components/ui';
import { TAROT_MEANINGS, TAROT_SPREADS } from '../../supabase/functions/_shared/domain/tarot';

const tarotNames = ['The Fool','The Magician','The High Priestess','The Empress','The Emperor','The Hierophant','The Lovers','The Chariot','Strength','The Hermit','Wheel of Fortune','Justice','The Hanged Man','Death','Temperance','The Devil','The Tower','The Star','The Moon','The Sun','Judgement','The World'];
export const tarotImage = (id: number) => `/assets/tarot/major/${String(id).padStart(2, '0')}_${tarotNames[id]?.replaceAll(' ', '_')}.png`;
export type DrawCard = { cardId: number; orientation: 'UPRIGHT' | 'REVERSED'; positionIndex: number; positionKey?: string; positionName?: string };
export type DrawResult = { executionStatus: string; conversationId?: string; consultationId: string; drawGroupId: string; spreadType: string; cards: DrawCard[]; mode?: string; interpretation?: { messageId: string; content: string } | null; partialError?: { code: string; retryable?: boolean } };
const positionNames: Record<string, string> = { CURRENT_SITUATION: '현재 상황', KEY_VARIABLE: '핵심 변수 / 걸림돌', DIRECTION_ADVICE: '앞으로의 방향 / 조언', SUPPORTING_FORCE: '현재 선택을 밀어주는 힘', RISK: '주의해야 할 리스크', PRACTICAL_DIRECTION: '가장 현실적인 방향', USER_ATTITUDE: '나의 마음', OTHER_ATTITUDE: '상대의 마음', TARGET_ATTITUDE: '상대의 마음', RELATIONSHIP_FLOW: '관계의 흐름', PAST: '지나온 흐름', PRESENT: '지금의 상황', FUTURE: '앞으로의 방향', CURRENT: '지금의 상황', GUIDANCE: '지금 필요한 조언', ANSWER: '지금 필요한 한마디', OPTION_A: '선택 A', OPTION_B: '선택 B', ADVICE: '선택을 위한 조언', SITUATION: '현재 상황' };
const canonicalPositionNames = Object.fromEntries(Object.values(TAROT_SPREADS).flat().map(position => [position.key, position.label]));
const positionName = (card: DrawCard) => card.positionName || canonicalPositionNames[card.positionKey || ''] || positionNames[card.positionKey || ''] || `${card.positionIndex + 1}번째 카드`;
const orientationName = (card: DrawCard) => card.orientation === 'REVERSED' ? '역방향' : '정방향';

/** Only canonical selected-direction keywords; shared guidance is not reversed prose. */
export function tarotBasicMeaning(card: DrawCard) {
  const meaning = TAROT_MEANINGS.find(item => item.id === card.cardId);
  if (!meaning || !['UPRIGHT', 'REVERSED'].includes(card.orientation)) return null;
  return { name: meaning.nameKo, keywords: card.orientation === 'UPRIGHT' ? meaning.upright : meaning.reversed };
}
function interpretationStatus(result: DrawResult): string {
  // The API may wrap the provider reason in partialError.details. Keep the public
  // DrawResult shape unchanged and never render arbitrary remote error text.
  const error = result.partialError as { code?: string; details?: { reason?: unknown } } | undefined;
  const reason = typeof error?.details?.reason === 'string' ? error.details.reason : error?.code;
  if (reason === 'LLM_TIMEOUT') return 'AI 해석 응답이 늦어져 멈췄어요. 같은 카드로 해석을 다시 받을 수 있어요.';
  if (reason === 'LLM_RATE_LIMITED') return 'AI 해석 요청이 제한되어 있어요. 제한이 해제된 뒤 같은 카드로 다시 시도해 주세요.';
  if (error?.code === 'LLM_UNAVAILABLE' || ['LLM_UNAVAILABLE', 'LLM_NOT_CONFIGURED', 'LLM_AUTH_FAILED'].includes(reason ?? '')) return 'AI 해석 서비스를 이용할 수 없어요. 저장된 카드는 그대로 남아 있어요.';
  if (result.executionStatus === 'PARTIAL') return 'AI 해석을 완료하지 못했어요. 카드는 저장됐고, 다시 해석해도 같은 카드를 사용해요.';
  return 'AI 해석이 아직 없어요. 저장된 카드의 기본 의미를 먼저 살펴보세요.';
}
export function TarotResult({ result, pending, onRetry, onRedraw, onCopy, showDetails = true, display = 'detail' }: { result: DrawResult; pending?: boolean; onRetry?: () => void; onRedraw?: () => void; onCopy?: () => void; showDetails?: boolean; display?: 'chat' | 'detail' }) {
  const reduced = useReducedMotion();
  const compact = display === 'chat';
  const cards = [...result.cards].sort((a, b) => a.positionIndex - b.positionIndex);
  const showBasicMeaning = result.executionStatus === 'PARTIAL' || !result.interpretation?.content?.trim();
  return <section className={`tarot-inline${compact ? ' tarot-inline-chat' : ''}`} data-draw-group-id={result.drawGroupId} aria-label="저장된 타로 결과">
    <div className="tarot-inline-heading"><h3>{result.mode === 'DAILY' ? '오늘의 한 장' : cards.length === 1 ? '지금, 나에게 온 카드' : '세 장에 담긴 이야기'}</h3><span>YOUR CARDS · {String(cards.length).padStart(2, '0')}</span></div>
    <div className={`tarot-cards ${cards.length === 1 ? 'single' : ''}`}>
      {cards.map((card, i) => <motion.div className="tarot-card" key={`${result.drawGroupId}-${card.positionIndex}`} initial={reduced ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: reduced ? 0 : i * .12, duration: .35 }}>
        <small>{positionName(card)}</small>
        <img className={card.orientation === 'REVERSED' ? 'reversed' : ''} src={tarotImage(card.cardId)} alt={`${tarotNames[card.cardId]}, ${orientationName(card)}`} />
        <h4>{compact ? tarotBasicMeaning(card)?.name ?? tarotNames[card.cardId] : tarotNames[card.cardId]}</h4>
        <span>{compact ? orientationName(card) : `${card.orientation} · ${orientationName(card)}`}</span>
      </motion.div>)}
    </div>
    {showBasicMeaning && <>
      <div className="tarot-interpretation-status"><Notice>{interpretationStatus(result)}</Notice></div>
      <section className="tarot-basic-meanings" aria-label="카드 기본 의미">
        <h4>카드 기본 의미</h4>
        <p className="tarot-basic-disclaimer">AI가 작성한 해석이 아닌, 카드 자료의 정·역방향 키워드예요.</p>
        {cards.map(card => {
          const meaning = tarotBasicMeaning(card);
          return meaning && <article className="tarot-basic-meaning" key={card.positionIndex}>
            <h5>{card.positionIndex + 1}. {meaning.name} · {orientationName(card)}</h5>
            <p className="tarot-basic-keywords">{meaning.keywords.slice(0, compact ? 3 : undefined).join(' · ')}</p>
          </article>;
        })}
      </section>
    </>}
    <div className="tarot-actions" data-export="hide">
      {showDetails && <Link to={`/reading/${result.consultationId}`}><Icon name="arrow" size={15}/>결과 자세히 보기</Link>}
      {onRetry && <button type="button" disabled={pending || result.partialError?.retryable === false} onClick={onRetry}><Icon name="history" size={15} />해석 다시 받기</button>}
      {onRedraw && result.mode !== 'DAILY' && <button type="button" disabled={pending} onClick={onRedraw}><Icon name="cards" size={15} />새로 뽑기</button>}
      {onCopy && <button type="button" onClick={onCopy}><Icon name="copy" size={15} />결과 복사</button>}
    </div>
  </section>;
}
export const spreads = [ { id: 'ONE_CARD', title: '가볍게 한 장', description: '지금 필요한 짧은 힌트', count: '01' }, { id: 'GENERAL_3', title: '흐름을 보는 세 장', description: '현재 상황, 걸림돌, 앞으로의 조언', count: '03' }, { id: 'RELATIONSHIP_3', title: '관계의 세 장', description: '나와 상대, 우리 사이의 흐름', count: '03' }, { id: 'DECISION_3', title: '선택의 세 장', description: '추진력과 위험, 가장 현실적인 방향', count: '03' } ];
export function TarotPicker({ onDraw, pending, defaultQuestion = '', defaultSpread = 'GENERAL_3', daily = false }: { onDraw: (spread: string, question: string, mode: 'NORMAL' | 'DAILY') => void; pending: boolean; defaultQuestion?: string; defaultSpread?: string; daily?: boolean }) {
  const [spread, setSpread] = useState(daily ? 'ONE_CARD' : spreads.some((item)=>item.id===defaultSpread)?defaultSpread:'GENERAL_3'); const [question, setQuestion] = useState(defaultQuestion);
  return <form onSubmit={(e) => { e.preventDefault(); onDraw(spread, question.trim() || '지금 나에게 필요한 이야기를 알려줘', daily ? 'DAILY' : 'NORMAL'); }}><p style={{ marginBottom: 24 }}>{daily ? '하루에 한 번, 오늘을 위한 한 장. 다시 찾아와도 같은 카드가 기다려요.' : '궁금한 마음을 떠올려 보세요. 실제 카드를 뽑아 저장한 뒤, 함께 이야기를 풀어가요.'}</p><div className={`tarot-preview ${spread === 'ONE_CARD' ? 'single' : ''}`} aria-hidden="true">{Array.from({length: spread === 'ONE_CARD' ? 1 : 3}, (_, index) => <img key={index} src="/assets/tarot/back.png" alt=""/>)}</div>{!daily && <div className="chat-tool-selection">{spreads.map((s) => <button type="button" className={`tool-option ${spread === s.id ? 'active' : ''}`} key={s.id} aria-pressed={spread === s.id} onClick={() => setSpread(s.id)}><Icon name="cards" /><strong>{s.title}</strong><small>{s.description}</small></button>)}</div>}<label className="field" style={{ marginTop: 24 }}><span>어떤 마음으로 펼쳐볼까요? <small>선택</small></span><textarea maxLength={4000} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="요즘 마음에 걸리는 이야기를 적어주세요." rows={3} /></label><button type="submit" className="button primary wide" disabled={pending}>{pending ? '카드를 펼치고 있어요…' : daily ? '오늘의 카드 만나기' : '나의 카드 펼치기'}<Icon name="arrow" /></button><p className="birth-form-note">타로는 정해진 미래가 아닌, 지금을 돌아보는 작은 계기예요.</p></form>;
}
