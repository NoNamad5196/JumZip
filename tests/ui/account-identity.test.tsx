// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { HistoryPage, ProfilePage, SettingsPage } from '../../src/features/AccountPages';
import { MemoryLibrary } from '../../src/features/MemoryLibrary';
import { ConsultationHistory } from '../../src/features/ConsultationHistory';
import type { BirthInputValue } from '../../src/features/BirthInput';

const mocked = vi.hoisted(() => ({
  id: 'A' as string | null, anonymous: true,
  execute: vi.fn(), signOut: vi.fn(), updateProfile: vi.fn(),
  updateMemory: vi.fn(), deleteMemory: vi.fn(),
  updateReadingTitle: vi.fn(), deleteReading: vi.fn(),
  updateConversation: vi.fn(), deleteConversation: vi.fn(),
  saveBirthProfile: vi.fn(), saveRelatedPerson: vi.fn(),
}));
vi.mock('../../src/lib/service', () => ({ service: {
  configured: true, execute: mocked.execute, signOut: mocked.signOut, updateProfile: mocked.updateProfile,
  getSession: async () => mocked.id ? { user: { id: mocked.id } } : null,
  updateMemory: mocked.updateMemory, deleteMemory: mocked.deleteMemory,
  updateReadingTitle: mocked.updateReadingTitle, deleteReading: mocked.deleteReading,
  updateConversation: mocked.updateConversation, deleteConversation: mocked.deleteConversation,
  listMemories: async () => [{ id: `${mocked.id}-memory`, content: `${mocked.id}의 기억`, category: 'GOAL', scope: 'GLOBAL', subject: 'USER', created_at: '2026-09-20', disabled_at: null }],
  listReadingsPage: async () => ({ items: [{ id: `${mocked.id}-reading`, title: `${mocked.id}의 상담`, fortune_type: 'TAROT', conversation_id: `${mocked.id}-conversation`, character_id: 'BOMI', created_at: '2026-09-20' }], nextCursor: null }),
  listConversationsPage: async () => ({ items: [{ id: `${mocked.id}-conversation`, title: `${mocked.id}의 대화`, character_id: 'BOMI', created_at: '2026-09-20', last_message_at: null }], nextCursor: null }),
  getDeletionMemories: async () => [{ id: `${mocked.id}-memory`, content: `${mocked.id}의 관련 기억`, scope: 'GLOBAL' }],
  listBirthProfiles: async () => [], listRelatedPeople: async () => [],
  saveBirthProfile: mocked.saveBirthProfile, saveRelatedPerson: mocked.saveRelatedPerson,
} }));
vi.mock('../../src/features/session', () => ({
  useSession: () => ({ session: mocked.id ? { user: { id: mocked.id, is_anonymous: mocked.anonymous } } : null, loading: false }),
  useProfile: () => ({ data: { memory_enabled: true, display_name: `${mocked.id} 이름`, preferred_character: 'BOMI' } }),
  errorMessage: (error: unknown) => error instanceof Error ? error.message : '오류',
}));
vi.mock('../../src/lib/Captcha', () => ({ Captcha: () => null }));
// Isolate the profile callback boundary; BirthInput's validation/geocoding has separate tests.
vi.mock('../../src/features/BirthInput', () => ({ BirthInputForm: ({ onSubmit }: { onSubmit: (input: BirthInputValue) => void }) => <button onClick={() => onSubmit({ calendarType: 'SOLAR', leapMonth: false, birthDate: '2000-01-01', birthTime: null, birthTimeUnknown: true, gender: null, location: { name: 'Synthetic city', country: 'KR', latitude: 37, longitude: 127, timezone: 'Asia/Seoul' } })}>합성 출생 폼 제출</button> }));

type View = 'settings' | 'memory' | 'consultation' | 'conversation' | 'profile';
function RouteProbe() { return <output data-testid="route">{useLocation().pathname}</output>; }
function mount(view: View) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const tree = () => <QueryClientProvider client={client}><MemoryRouter initialEntries={['/settings?tab=conversations']}><RouteProbe />{view === 'settings' ? <SettingsPage /> : view === 'profile' ? <ProfilePage /> : view === 'memory' ? <MemoryLibrary /> : view === 'consultation' ? <ConsultationHistory /> : <HistoryPage />}</MemoryRouter></QueryClientProvider>;
  const rendered = render(tree());
  return { client, changeIdentity(id: string | null, anonymous = true) { mocked.id = id; mocked.anonymous = anonymous; rendered.rerender(tree()); } };
}
function deferred<T = unknown>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function settle(callback: () => void) { await act(async () => { callback(); await Promise.resolve(); }); }
function openAccountDelete() { fireEvent.click(screen.getByRole('button', { name: '계정과 모든 데이터 삭제' })); return screen.getByRole('textbox', { name: '계속하려면 DELETE를 입력해 주세요.' }) as HTMLInputElement; }
function submitAccountDelete() { fireEvent.change(openAccountDelete(), { target: { value: 'DELETE' } }); fireEvent.submit(screen.getByRole('dialog').querySelector('form')!); }
const editLabel = (view: View) => view === 'memory' ? '기억 수정' : '상담 제목 수정';
const deleteLabel = (view: View) => view === 'memory' ? '기억 삭제' : view === 'consultation' ? '이 상담 삭제' : '상담 기록 삭제';
async function openEdit(view: View) { fireEvent.click(await screen.findByRole('button', { name: editLabel(view) })); return within(screen.getByRole('dialog')).getByRole('textbox') as HTMLInputElement; }
async function openDelete(view: View) { fireEvent.click(await screen.findByRole('button', { name: deleteLabel(view) })); if (view !== 'memory') await screen.findByRole('checkbox'); }
beforeEach(() => {
  mocked.id = 'A'; mocked.anonymous = true;
  for (const value of Object.values(mocked)) if (typeof value === 'function') value.mockReset().mockResolvedValue(undefined);
  sessionStorage.clear();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(cleanup);

describe('account confirmation and late completion boundaries (mock services, no account deletion)', () => {
  it('preserves the same UID through linking/refresh, but drops confirmation across A → B → A and logout', () => {
    const view = mount('settings'); fireEvent.change(openAccountDelete(), { target: { value: 'DELETE' } });
    view.changeIdentity('A', false); expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('DELETE');
    view.changeIdentity('A', false); expect(screen.getByRole('dialog')).toBeTruthy();
    view.changeIdentity('B'); expect(screen.queryByRole('dialog')).toBeNull();
    expect(openAccountDelete().value).toBe('');
    view.changeIdentity('A'); expect(screen.queryByRole('dialog')).toBeNull();
    expect(openAccountDelete().value).toBe('');
    view.changeIdentity(null); expect(screen.queryByRole('dialog')).toBeNull();
    expect(mocked.execute).not.toHaveBeenCalled();
  });
  it('binds a confirmed deletion to its UID and delegates the only sign-out to the service', async () => {
    mocked.execute.mockResolvedValue({ ok: true, data: { deleted: true } });
    const { client } = mount('settings'); const clear = vi.spyOn(client, 'clear');
    submitAccountDelete();
    await waitFor(() => expect(mocked.execute).toHaveBeenCalledWith('account', { action: 'DELETE_ACCOUNT', confirmation: 'DELETE' }, { expectedUserId: 'A' }));
    await waitFor(() => expect(screen.getByTestId('route').textContent).toBe('/'));
    expect(clear).toHaveBeenCalledTimes(1); expect(mocked.signOut).not.toHaveBeenCalled();
  });
  it.each(['success', 'failure'] as const)('ignores an old A deletion %s after switching to B', async (outcome) => {
    const request = deferred(); mocked.execute.mockReturnValue(request.promise);
    const view = mount('settings'); const clear = vi.spyOn(view.client, 'clear'); submitAccountDelete();
    view.changeIdentity('B'); view.client.setQueryData(['private', 'B'], 'B cache'); sessionStorage.setItem('jumzip-draft:B:BOMI:conversation', 'B draft');
    fireEvent.change(openAccountDelete(), { target: { value: 'B confirmation in progress' } });
    await settle(() => outcome === 'success' ? request.resolve({ ok: true, data: { deleted: true } }) : request.reject(new Error('A-only error')));
    expect(screen.getByTestId('route').textContent).toBe('/settings'); expect(clear).not.toHaveBeenCalled(); expect(mocked.signOut).not.toHaveBeenCalled();
    expect(view.client.getQueryData(['private', 'B'])).toBe('B cache'); expect(sessionStorage.getItem('jumzip-draft:B:BOMI:conversation')).toBe('B draft');
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('B confirmation in progress'); expect(screen.queryByText('A-only error')).toBeNull();
  });
  it('does not reactivate an old A request when the user returns from B to A', async () => {
    const request = deferred(); mocked.execute.mockReturnValue(request.promise);
    const view = mount('settings'); const clear = vi.spyOn(view.client, 'clear'); submitAccountDelete(); view.changeIdentity('B'); view.changeIdentity('A');
    expect(openAccountDelete().value).toBe(''); await settle(() => request.resolve({ ok: true, data: { deleted: true } }));
    expect(screen.getByRole('dialog')).toBeTruthy(); expect(screen.getByTestId('route').textContent).toBe('/settings'); expect(clear).not.toHaveBeenCalled(); expect(mocked.signOut).not.toHaveBeenCalled();
  });
  it('checks the SDK identity when B is current before React commits the account remount', async () => {
    const request = deferred(); mocked.execute.mockReturnValue(request.promise);
    const view = mount('settings'); const clear = vi.spyOn(view.client, 'clear'); submitAccountDelete();
    mocked.id = 'B'; // The auth SDK has changed; deliberately do not rerender the context yet.
    view.client.setQueryData(['private', 'B'], 'B cache');
    await settle(() => request.resolve({ ok: true, data: { deleted: true } }));
    expect(clear).not.toHaveBeenCalled(); expect(screen.getByTestId('route').textContent).toBe('/settings'); expect(mocked.signOut).not.toHaveBeenCalled();
    expect(view.client.getQueryData(['private', 'B'])).toBe('B cache');
  });
});

describe.each(['memory', 'consultation', 'conversation'] as const)('%s private editing and selected deletion state', (kind) => {
  it('keeps drafts for a refreshed/linked same UID and resets them for A → B → A', async () => {
    const view = mount(kind); fireEvent.change(await openEdit(kind), { target: { value: 'A private unfinished edit' } });
    view.changeIdentity('A', false); expect((within(screen.getByRole('dialog')).getByRole('textbox') as HTMLInputElement).value).toBe('A private unfinished edit');
    view.changeIdentity('B'); expect(screen.queryByRole('dialog')).toBeNull();
    expect((await openEdit(kind)).value).not.toContain('A private');
    view.changeIdentity('A'); expect(screen.queryByRole('dialog')).toBeNull();
    expect((await openEdit(kind)).value).not.toContain('unfinished');
  });
  it('drops old selections and does not submit a former account record', async () => {
    const view = mount(kind); await openDelete(kind);
    if (kind !== 'memory') fireEvent.click(screen.getByRole('checkbox'));
    view.changeIdentity('A', false); expect(screen.getByRole('dialog')).toBeTruthy();
    if (kind !== 'memory') expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
    view.changeIdentity('B'); expect(screen.queryByRole('dialog')).toBeNull(); await openDelete(kind);
    expect(within(screen.getByRole('dialog')).queryByText(/A의/)).toBeNull();
    if (kind !== 'memory') expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
    view.changeIdentity('A'); expect(screen.queryByRole('dialog')).toBeNull(); await openDelete(kind);
    if (kind !== 'memory') expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
    expect(mocked.deleteMemory).not.toHaveBeenCalled(); expect(mocked.deleteReading).not.toHaveBeenCalled(); expect(mocked.deleteConversation).not.toHaveBeenCalled();
  });
  it.each([['save', 'success'], ['delete', 'success'], ['save', 'failure'], ['delete', 'failure']] as const)('ignores late %s %s before cache or dialog side effects', async (action, outcome) => {
    const request = deferred(); const operation = kind === 'memory' ? action === 'save' ? mocked.updateMemory : mocked.deleteMemory : kind === 'consultation' ? action === 'save' ? mocked.updateReadingTitle : mocked.deleteReading : action === 'save' ? mocked.updateConversation : mocked.deleteConversation;
    operation.mockReturnValue(request.promise);
    const view = mount(kind);
    if (action === 'save') { await openEdit(kind); fireEvent.submit(screen.getByRole('dialog').querySelector('form')!); }
    else { await openDelete(kind); fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: kind === 'memory' ? '1개 삭제' : '기록만 삭제' })); }
    await waitFor(() => expect(operation).toHaveBeenCalledTimes(1)); view.changeIdentity('B');
    fireEvent.change(await openEdit(kind), { target: { value: 'B current edit' } });
    const invalidation = vi.spyOn(view.client, 'invalidateQueries'); const removal = vi.spyOn(view.client, 'removeQueries');
    await settle(() => outcome === 'success' ? request.resolve(undefined) : request.reject(new Error('A-only error')));
    expect(invalidation).not.toHaveBeenCalled(); expect(removal).not.toHaveBeenCalled();
    expect((within(screen.getByRole('dialog')).getByRole('textbox') as HTMLInputElement).value).toBe('B current edit');
    expect(screen.queryByText(/개의 기억을 삭제했어요|기억을 수정했어요/)).toBeNull();
    expect(screen.queryByText('A-only error')).toBeNull();
  });
});

it('stops a conversation deletion that becomes stale during an awaited cache refresh', async () => {
  const view = mount('conversation'); await openDelete('conversation');
  const refresh = deferred<void>(); const invalidation = vi.spyOn(view.client, 'invalidateQueries').mockReturnValue(refresh.promise); const removal = vi.spyOn(view.client, 'removeQueries');
  fireEvent.click(screen.getByRole('button', { name: '기록만 삭제' })); await waitFor(() => expect(invalidation).toHaveBeenCalled());
  expect(invalidation.mock.calls.every(([options]) => options?.queryKey?.[1] === 'A')).toBe(true);
  view.changeIdentity('B'); view.changeIdentity('A'); fireEvent.change(await openEdit('conversation'), { target: { value: '새 A 편집' } });
  await settle(() => refresh.resolve()); expect(removal).not.toHaveBeenCalled();
  expect((within(screen.getByRole('dialog')).getByRole('textbox') as HTMLInputElement).value).toBe('새 A 편집');
});

it.each([['settings', 'success'], ['settings', 'failure'], ['memory', 'success'], ['memory', 'failure']] as const)('ignores a former account %s toggle %s', async (kind, outcome) => {
  const request = deferred(); const operation = kind === 'settings' ? mocked.updateProfile : mocked.updateMemory; operation.mockReturnValue(request.promise);
  const view = mount(kind);
  if (kind === 'settings') fireEvent.click(screen.getByRole('switch'));
  else fireEvent.click(await screen.findByRole('button', { name: '이 기억 사용하지 않기' }));
  await waitFor(() => expect(operation).toHaveBeenCalledTimes(1)); view.changeIdentity('B');
  if (kind === 'settings') expect(operation).toHaveBeenCalledWith({ memory_enabled: false }, 'A');
  const invalidation = vi.spyOn(view.client, 'invalidateQueries');
  await settle(() => outcome === 'success' ? request.resolve(undefined) : request.reject(new Error('A-only error')));
  expect(invalidation).not.toHaveBeenCalled(); expect(screen.queryByText('A-only error')).toBeNull();
  expect(screen.queryByText('이 기억을 앞으로의 대화에서 사용하지 않아요.')).toBeNull();
  expect(kind === 'settings' ? (screen.getByRole('switch') as HTMLInputElement).disabled : (await screen.findByRole('button', { name: '이 기억 사용하지 않기' }) as HTMLButtonElement).disabled).toBe(false);
});

it.each(['success', 'failure'] as const)('binds profile edits to A and ignores a late %s in B', async (outcome) => {
  const request = deferred(); mocked.updateProfile.mockReturnValue(request.promise);
  const view = mount('profile');
  fireEvent.change(screen.getByRole('textbox', { name: '이름 또는 닉네임' }), { target: { value: 'A private edit' } });
  fireEvent.click(screen.getByRole('button', { name: '변경 내용 저장' }));
  await waitFor(() => expect(mocked.updateProfile).toHaveBeenCalledWith({ display_name: 'A private edit', preferred_character: 'BOMI' }, 'A'));
  view.changeIdentity('B'); const invalidation = vi.spyOn(view.client, 'invalidateQueries');
  await settle(() => outcome === 'success' ? request.resolve(undefined) : request.reject(new Error('A-only error')));
  expect(invalidation).not.toHaveBeenCalled(); expect(screen.queryByText('A-only error')).toBeNull(); expect(screen.queryByText('변경한 내용을 저장했어요.')).toBeNull();
  expect((screen.getByRole('textbox', { name: '이름 또는 닉네임' }) as HTMLInputElement).value).toBe('B 이름');
  expect((screen.getByRole('button', { name: '변경 내용 저장' }) as HTMLButtonElement).disabled).toBe(false);
});

it.each([['birth', 'success'], ['birth', 'failure'], ['person', 'success'], ['person', 'failure']] as const)('binds a new %s to A and ignores its late %s after switching to B', async (kind, outcome) => {
  const request = deferred(); const operation = kind === 'birth' ? mocked.saveBirthProfile : mocked.saveRelatedPerson; operation.mockReturnValue(request.promise);
  const view = mount('profile');
  if (kind === 'birth') {
    fireEvent.click(await screen.findByRole('button', { name: '출생 정보 저장하기' })); fireEvent.click(screen.getByRole('button', { name: '합성 출생 폼 제출' }));
    await waitFor(() => expect(operation).toHaveBeenCalledWith(expect.objectContaining({ birthDate: '2000-01-01' }), undefined, undefined, 'A'));
  } else {
    fireEvent.click(screen.getByRole('button', { name: '기억할 사람 추가' }));
    fireEvent.change(screen.getByRole('textbox', { name: '이름 또는 별칭' }), { target: { value: 'A private person' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /이 사람의 정보를 다음 대화에서도 기억하도록/ }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '저장' }));
    await waitFor(() => expect(operation).toHaveBeenCalledWith({ display_name: 'A private person', relation: '', memory_opt_in: true }, undefined, 'A'));
  }
  view.changeIdentity('B'); expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '기억할 사람 추가' })); fireEvent.change(screen.getByRole('textbox', { name: '이름 또는 별칭' }), { target: { value: 'B unfinished person' } });
  const invalidation = vi.spyOn(view.client, 'invalidateQueries');
  await settle(() => outcome === 'success' ? request.resolve(undefined) : request.reject(new Error('A-only error')));
  expect(invalidation).not.toHaveBeenCalled(); expect(screen.queryByText('A-only error')).toBeNull();
  expect((screen.getByRole('textbox', { name: '이름 또는 별칭' }) as HTMLInputElement).value).toBe('B unfinished person');
  expect(screen.queryByText(/출생 프로필을 저장했어요|기억할 사람을 저장했어요/)).toBeNull();
});
