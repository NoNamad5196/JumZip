// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TarotResult, tarotBasicMeaning, type DrawResult, type DrawCard } from '../../src/features/Tarot';
import { TAROT_MEANINGS } from '../../supabase/functions/_shared/domain/tarot';

afterEach(cleanup);
const card = (cardId: number, orientation: DrawCard['orientation'] = 'UPRIGHT', positionIndex = 0): DrawCard => ({ cardId, orientation, positionIndex, positionKey: 'CORE_MESSAGE' });
function result(cards: DrawCard[], extra: Partial<DrawResult> = {}): DrawResult {
  return { executionStatus: 'PARTIAL', consultationId: 'saved-consultation', drawGroupId: 'saved-draw', spreadType: cards.length === 1 ? 'ONE_CARD' : 'RELATIONSHIP_3', cards, interpretation: null, ...extra };
}
const show = (value: DrawResult, props: Partial<Parameters<typeof TarotResult>[0]> = {}) => render(<MemoryRouter><TarotResult result={value} {...props}/></MemoryRouter>);

describe('canonical card meaning fallback', () => {
  const cases = TAROT_MEANINGS.flatMap(meaning => (['UPRIGHT', 'REVERSED'] as const).map(orientation => ({ id: meaning.id, orientation, name: meaning.nameKo, expected: orientation === 'UPRIGHT' ? meaning.upright : meaning.reversed })));
  it.each(cases)('uses only the canonical selected direction for card$id $orientation', ({ id, orientation, name, expected }) => {
    const stored = card(id, orientation);
    const basic = tarotBasicMeaning(stored);
    expect(basic).toEqual({ name, keywords: expected });
    const view = show(result([stored]), { display: 'chat' });
    const fallback = screen.getByRole('region', { name: '카드 기본 의미' });
    expect(within(fallback).getByRole('heading', { level: 5 }).textContent).toBe(`1. ${name} · ${orientation === 'UPRIGHT' ? '정방향' : '역방향'}`);
    expect(fallback.querySelector('.tarot-basic-keywords')?.textContent).toBe(expected.slice(0, 3).join(' · '));
    expect(within(fallback).getByText('AI가 작성한 해석이 아닌, 카드 자료의 정·역방향 키워드예요.')).toBeTruthy();
    expect(view.container.textContent).not.toContain(TAROT_MEANINGS[id]!.guidance.advice);
  });
  it('does not invent a meaning for an invalid ID or direction', () => {
    expect(tarotBasicMeaning(card(25))).toBeNull();
    expect(tarotBasicMeaning({ ...card(9), orientation: 'INVALID' as DrawCard['orientation'] })).toBeNull();
  });
  it('keeps successful interpretation views unchanged and uses detail display by default', () => {
    const value = result([card(2)], { executionStatus: 'SUCCEEDED', interpretation: { messageId: 'ai-message', content: '저장된 AI 해석' } });
    const view = show(value);
    expect(screen.queryByRole('region', { name: '카드 기본 의미' })).toBeNull();
    expect(view.container.querySelector('.tarot-inline-chat')).toBeNull();
    expect(screen.getByRole('heading', { name: 'The High Priestess' })).toBeTruthy();
    expect(screen.getByAltText('The High Priestess, 정방향')).toBeTruthy();
    expect(screen.getByText('UPRIGHT · 정방향')).toBeTruthy();
  });
  it.each(['PARTIAL', 'UNKNOWN', 'SUCCEEDED'])('shows basic meaning for missing interpretation in %s without changing status', executionStatus => {
    const value = result([card(9, 'REVERSED')], { executionStatus }); const before = JSON.stringify(value);
    show(value);
    expect(screen.getByRole('region', { name: '카드 기본 의미' }).querySelector('.tarot-basic-keywords')?.textContent).toBe('고립 · 회피 · 과도한 폐쇄 · 외로움 · 방향 상실');
    expect(JSON.stringify(value)).toBe(before); expect(value.interpretation).toBeNull();
  });
  it.each([
    ['LLM_TIMEOUT', 'AI 해석 응답이 늦어져 멈췄어요.'],
    ['LLM_RATE_LIMITED', 'AI 해석 요청이 잠시 제한됐어요.'],
    ['LLM_UNAVAILABLE', 'AI 해석 서비스에 지금 연결하기 어려워요.'],
    ['LLM_INVALID_RESPONSE', 'AI 해석을 완료하지 못했어요.'],
  ])('distinguishes known failure reason %s without exposing raw remote text', (reason, message) => {
    const partialError = { code: 'TAROT_INTERPRETATION_FAILED', retryable: true, details: { reason }, message: 'REMOTE_PRIVATE_CANARY' };
    const view = show(result([card(0)], { partialError }));
    expect(view.container.querySelector('.tarot-interpretation-status')?.textContent).toContain(message);
    expect(view.container.textContent).not.toContain('REMOTE_PRIVATE_CANARY');
    expect(screen.getByRole('region', { name: '카드 기본 의미' })).toBeTruthy();
  });
  it('does not turn an unknown missing interpretation into a timeout or rate-limit diagnosis', () => {
    const view = show(result([card(0)], { executionStatus: 'UNKNOWN', partialError: undefined }));
    expect(view.container.querySelector('.tarot-interpretation-status')?.textContent).toContain('AI 해석이 아직 없어요.');
    expect(view.container.textContent).not.toContain('요청이 잠시 제한');
  });
});

describe('chat Tarot display preserves the saved draw', () => {
  it('supplies compact layout hooks with all3 cards sorted visually, canonical names and preserved orientation', () => {
    const value = result([
      { ...card(14, 'UPRIGHT', 2), positionKey: 'RELATIONSHIP_DIRECTION' },
      { ...card(9, 'REVERSED', 1), positionKey: 'THEIR_ATTITUDE' },
      { ...card(6, 'UPRIGHT', 0), positionKey: 'YOUR_ATTITUDE' },
    ]);
    for (const item of value.cards) Object.freeze(item); Object.freeze(value.cards); Object.freeze(value);
    const before = JSON.stringify(value); const onRetry = vi.fn(), onRedraw = vi.fn();
    const view = show(value, { display: 'chat', onRetry, onRedraw });
    expect(view.container.querySelectorAll('.tarot-inline-chat > .tarot-cards > .tarot-card')).toHaveLength(3);
    expect(Array.from(view.container.querySelectorAll('.tarot-card h4')).map(item => item.textContent)).toEqual(['연인', '은둔자', '절제']);
    expect(screen.getByAltText('The Hermit, 역방향').classList.contains('reversed')).toBe(true);
    expect(screen.getByText('사용자의 마음 / 태도')).toBeTruthy(); expect(screen.getByText('상대의 마음 / 태도')).toBeTruthy(); expect(screen.getByText('관계의 흐름 / 조언')).toBeTruthy();
    expect(screen.getByRole('link', { name: '결과 자세히 보기' }).getAttribute('href')).toBe('/reading/saved-consultation');
    expect(onRetry).not.toHaveBeenCalled(); expect(onRedraw).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '해석 다시 받기' }));
    expect(onRetry).toHaveBeenCalledTimes(1); expect(onRedraw).not.toHaveBeenCalled();
    expect(JSON.stringify(value)).toBe(before);
  });
  it('keeps one-card and export controls separate, while pending or nonretryable errors cannot auto retry', () => {
    const onRetry = vi.fn(), onRedraw = vi.fn();
    const view = show(result([card(0)], { mode: 'DAILY', partialError: { code: 'LLM_UNAVAILABLE', retryable: false } }), { display: 'chat', onRetry, onRedraw, showDetails: false });
    expect(view.container.querySelector('.tarot-inline-chat .tarot-cards.single')).toBeTruthy();
    expect(screen.queryByRole('link', { name: '결과 자세히 보기' })).toBeNull(); expect(screen.queryByRole('button', { name: '새로 뽑기' })).toBeNull();
    const retry = screen.getByRole('button', { name: '해석 다시 받기' }) as HTMLButtonElement;
    expect(retry.disabled).toBe(true); fireEvent.click(retry); expect(onRetry).not.toHaveBeenCalled();
    expect(view.container.querySelector('.tarot-actions')?.getAttribute('data-export')).toBe('hide');
  });
});
