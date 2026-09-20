// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { Onboarding } from '../../src/features/AccountPages';

const mocked = vi.hoisted(() => ({ renderId: null as string | null, sdkId: null as string | null, anonymous: true, signup: vi.fn(), update: vi.fn(), current: vi.fn() }));
vi.mock('../../src/lib/service', () => ({ service: { configured: true, captchaConfigured: false, signInAnonymously: mocked.signup, updateProfile: mocked.update, getSession: mocked.current } }));
vi.mock('../../src/features/session', () => ({
  useSession: () => ({ session: mocked.renderId ? { user: { id: mocked.renderId, is_anonymous: mocked.anonymous } } : null, loading: false }),
  useProfile: () => ({ data: {} }), errorMessage: (error: unknown) => error instanceof Error ? error.message : '오류',
}));
vi.mock('../../src/lib/Captcha', () => ({ Captcha: () => null }));
function Probe() { return <output data-testid="route">{useLocation().pathname}</output>; }
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = () => <QueryClientProvider client={client}><MemoryRouter initialEntries={['/onboarding?character=sani']}><Probe /><Onboarding key={mocked.renderId || 'guest'} /></MemoryRouter></QueryClientProvider>;
  const view = render(tree());
  return { client, changeIdentity(id: string | null) { mocked.sdkId = id; mocked.renderId = id; view.rerender(tree()); } };
}
function deferred<T = unknown>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function settle(callback: () => void) { await act(async () => { callback(); await Promise.resolve(); }); }
async function submit() { fireEvent.change(screen.getByRole('textbox', { name: '이름 또는 닉네임' }), { target: { value: 'A의 별칭' } }); fireEvent.click(screen.getByRole('button', { name: '산이와 이야기 시작하기' })); await act(async () => { await Promise.resolve(); }); }
beforeEach(() => {
  mocked.renderId = null; mocked.sdkId = null; mocked.anonymous = true;
  mocked.signup.mockReset(); mocked.current.mockReset().mockImplementation(async () => mocked.sdkId ? { user: { id: mocked.sdkId } } : null);
  mocked.update.mockReset().mockImplementation(async (_patch, expectedUserId) => { if (mocked.sdkId !== expectedUserId) throw Error('SESSION_CHANGED'); });
});
afterEach(cleanup);

describe('onboarding owner binding with mocked Auth/service boundaries', () => {
  it('finishes the original nickname save through the intended guest → created-A remount', async () => {
    const signup = deferred(); mocked.signup.mockReturnValue(signup.promise);
    const view = mount(); const invalidation = vi.spyOn(view.client, 'invalidateQueries'); await submit();
    await waitFor(() => expect(mocked.signup).toHaveBeenCalledTimes(1)); view.changeIdentity('A');
    await settle(() => signup.resolve({ user: { id: 'A' } }));
    await waitFor(() => expect(screen.getByTestId('route').textContent).toBe('/chat/sani'));
    expect(mocked.update).toHaveBeenCalledWith({ display_name: 'A의 별칭', memory_enabled: true, preferred_character: 'SANI' }, 'A');
    expect(invalidation).toHaveBeenCalledWith({ queryKey: ['profile', 'A'] });
  });
  it('never substitutes current B for the A UID returned by signup', async () => {
    const signup = deferred(); mocked.signup.mockReturnValue(signup.promise);
    const view = mount(); const invalidation = vi.spyOn(view.client, 'invalidateQueries'); await submit();
    await waitFor(() => expect(mocked.signup).toHaveBeenCalled()); view.changeIdentity('B');
    await settle(() => signup.resolve({ user: { id: 'A' } }));
    await waitFor(() => expect(mocked.update).toHaveBeenCalledWith(expect.any(Object), 'A'));
    expect(mocked.update).not.toHaveBeenCalledWith(expect.any(Object), 'B'); expect(invalidation).not.toHaveBeenCalled();
    expect(screen.getByTestId('route').textContent).toBe('/onboarding'); expect(screen.queryByText('SESSION_CHANGED')).toBeNull();
    expect((screen.getByRole('textbox', { name: '이름 또는 닉네임' }) as HTMLInputElement).value).toBe('');
  });
  it('uses an existing linked A without starting anonymous signup', async () => {
    mocked.renderId = 'A'; mocked.sdkId = 'A'; mocked.anonymous = false;
    mount(); await submit(); await waitFor(() => expect(screen.getByTestId('route').textContent).toBe('/chat/sani'));
    expect(mocked.signup).not.toHaveBeenCalled(); expect(mocked.update).toHaveBeenCalledWith(expect.any(Object), 'A');
  });
  it('ignores a saved A result when B becomes current before the cache/navigation stage', async () => {
    mocked.renderId = 'A'; mocked.sdkId = 'A'; const save = deferred(); mocked.update.mockReturnValue(save.promise);
    const view = mount(); const invalidation = vi.spyOn(view.client, 'invalidateQueries'); await submit();
    await waitFor(() => expect(mocked.update).toHaveBeenCalledWith(expect.any(Object), 'A')); view.changeIdentity('B'); view.client.setQueryData(['profile', 'B'], { display_name: 'B unchanged' });
    await settle(() => save.resolve(undefined));
    expect(invalidation).not.toHaveBeenCalled(); expect(view.client.getQueryData(['profile', 'B'])).toEqual({ display_name: 'B unchanged' }); expect(screen.getByTestId('route').textContent).toBe('/onboarding');
  });
  it('checks identity again if it changes during the scoped profile refresh', async () => {
    mocked.renderId = 'A'; mocked.sdkId = 'A'; const refresh = deferred<void>();
    const view = mount(); const invalidation = vi.spyOn(view.client, 'invalidateQueries').mockReturnValue(refresh.promise); await submit();
    await waitFor(() => expect(invalidation).toHaveBeenCalledWith({ queryKey: ['profile', 'A'] })); view.changeIdentity('B'); await settle(() => refresh.resolve());
    expect(screen.getByTestId('route').textContent).toBe('/onboarding'); expect(invalidation).toHaveBeenCalledTimes(1);
  });
  it('fails closed if signup does not return a session rather than updating an unspecified owner', async () => {
    mocked.signup.mockResolvedValue(null); mount(); await submit();
    await screen.findByText('로그인 상태를 확인하지 못했어요. 다시 시작해 주세요.'); expect(mocked.update).not.toHaveBeenCalled(); expect(screen.getByTestId('route').textContent).toBe('/onboarding');
  });
  it('retains the nickname and permits retry after an active signup failure', async () => {
    mocked.signup.mockRejectedValue(new Error('보안 확인을 다시 해주세요.')); mount(); await submit();
    await screen.findByText('보안 확인을 다시 해주세요.'); expect((screen.getByRole('textbox', { name: '이름 또는 닉네임' }) as HTMLInputElement).value).toBe('A의 별칭');
    expect((screen.getByRole('button', { name: '산이와 이야기 시작하기' }) as HTMLButtonElement).disabled).toBe(false); expect(mocked.update).not.toHaveBeenCalled();
  });
});
