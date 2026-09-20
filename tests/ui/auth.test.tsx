// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthPage } from '../../src/features/AccountPages';

const mocked = vi.hoisted(() => ({
  session: null as { user: { id: string; is_anonymous: boolean; email?: string } } | null,
  loading: false,
  providers: { google: true, email: false },
  link: vi.fn(), signIn: vi.fn(), email: vi.fn(), linkEmail: vi.fn(), signOut: vi.fn(),
}));
vi.mock('../../src/lib/service', () => ({ service: {
  configured: true, captchaConfigured: false, authProviders: mocked.providers,
  linkOAuth: mocked.link, signInWithOAuth: mocked.signIn, signInWithOtp: mocked.email,
  linkEmail: mocked.linkEmail, signOut: mocked.signOut,
} }));
vi.mock('../../src/features/session', () => ({
  useSession: () => ({ session: mocked.session, loading: mocked.loading, error: null }),
  useProfile: () => ({ data: {} }), errorMessage: (error: unknown) => error instanceof Error ? error.message : '오류',
}));
vi.mock('../../src/lib/Captcha', () => ({ Captcha: () => null }));
function mount(path = '/auth') { return render(<MemoryRouter initialEntries={[path]}><AuthPage /></MemoryRouter>); }
beforeEach(() => {
  mocked.session = null; mocked.loading = false; mocked.providers.google = true; mocked.providers.email = false;
  for (const fn of [mocked.link, mocked.signIn, mocked.email, mocked.linkEmail, mocked.signOut]) fn.mockReset().mockResolvedValue(undefined);
  sessionStorage.clear(); window.history.replaceState({}, '', '/');
});
afterEach(cleanup);
describe('Google authentication entry and anonymous continuity', () => {
  it('links an anonymous identity without signing into a different account or clearing its draft', async () => {
    mocked.session = { user: { id: 'existing-anonymous-user', is_anonymous: true } };
    sessionStorage.setItem('jumzip-draft:existing-anonymous-user:BOMI:conversation-1', '남겨둘 이야기');
    mount(); fireEvent.click(screen.getByRole('button', { name: 'Google로 계정 연결' }));
    await waitFor(() => expect(mocked.link).toHaveBeenCalledWith('google', 'existing-anonymous-user'));
    expect(mocked.signIn).not.toHaveBeenCalled(); expect(mocked.signOut).not.toHaveBeenCalled();
    expect(mocked.session.user.id).toBe('existing-anonymous-user');
    expect(sessionStorage.getItem('jumzip-draft:existing-anonymous-user:BOMI:conversation-1')).toBe('남겨둘 이야기');
    expect(screen.queryByRole('textbox', { name: '이메일' })).toBeNull();
    expect(screen.queryByRole('button', { name: /GitHub/ })).toBeNull();
  });
  it('starts ordinary Google login only when no anonymous session exists', async () => {
    mount(); fireEvent.click(screen.getByRole('button', { name: 'Google로 로그인' }));
    await waitFor(() => expect(mocked.signIn).toHaveBeenCalledWith('google'));
    expect(mocked.link).not.toHaveBeenCalled();
  });
  it('binds an email link to the current anonymous UID', async () => {
    mocked.session = { user: { id: 'existing-anonymous-user', is_anonymous: true } };
    mocked.providers.google = false; mocked.providers.email = true;
    mount(); fireEvent.change(screen.getByRole('textbox', { name: '이메일' }), { target: { value: 'fixture@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: '이메일로 계정 연결' }));
    await waitFor(() => expect(mocked.linkEmail).toHaveBeenCalledWith('fixture@example.com', 'existing-anonymous-user'));
    expect(mocked.email).not.toHaveBeenCalled(); expect(mocked.signOut).not.toHaveBeenCalled();
  });
  it('offers no unconfigured provider action and retains the guest entry', () => {
    mocked.providers.google = false; mount();
    expect(screen.getByText(/계정 연결을 준비하고 있어요/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Google|이메일|GitHub/ })).toBeNull();
    expect(screen.getByRole('link', { name: /가입 없이 시작하기/ }).getAttribute('href')).toBe('/onboarding');
    expect(mocked.signIn).not.toHaveBeenCalled(); expect(mocked.email).not.toHaveBeenCalled();
  });
  it('does not expose an OAuth error description from the callback URL', () => {
    mount('/auth?error=access_denied&error_description=UNTRUSTED_SECRET_TEXT');
    expect(screen.getByText(/Google 연결이 취소됐어요/)).toBeTruthy();
    expect(screen.queryByText(/UNTRUSTED_SECRET_TEXT/)).toBeNull();
  });
  it('preserves the anonymous session after a linking failure and allows another attempt', async () => {
    mocked.session = { user: { id: 'existing-anonymous-user', is_anonymous: true } };
    mocked.link.mockRejectedValueOnce(new Error('연결을 마치지 못했어요.'));
    mount(); fireEvent.click(screen.getByRole('button', { name: 'Google로 계정 연결' }));
    await screen.findByText('연결을 마치지 못했어요.');
    expect(mocked.signIn).not.toHaveBeenCalled(); expect(mocked.signOut).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Google로 계정 연결' }) as HTMLButtonElement).disabled).toBe(false);
  });
  it('waits for auth restoration and does not offer login before that check finishes', () => {
    mocked.loading = true; mount();
    expect(screen.getByRole('status').textContent).toContain('로그인 상태를 확인');
    expect(screen.queryByRole('button', { name: /Google/ })).toBeNull();
  });
  it('shows completion after a linked session is restored', () => {
    mocked.session = { user: { id: 'existing-anonymous-user', is_anonymous: false, email: 'guest@example.com' } };
    mount(); expect(screen.getByText('계정 연결 완료')).toBeTruthy();
    expect(screen.getByRole('link', { name: /나의 기록 보기/ }).getAttribute('href')).toBe('/history');
    expect(screen.queryByRole('button', { name: /Google/ })).toBeNull();
  });
});
