// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '../../src/lib/service';
import { SessionProvider, useSession } from '../../src/features/session';

const mocked = vi.hoisted(() => ({ getSession: vi.fn(), onAuthStateChange: vi.fn(), clearDrafts: vi.fn(), stop: vi.fn() }));
vi.mock('../../src/lib/service', () => ({ service: { getSession: mocked.getSession, onAuthStateChange: mocked.onAuthStateChange } }));
vi.mock('../../src/features/drafts', () => ({ clearDrafts: mocked.clearDrafts }));
const session = (id: string, anonymous = true) => ({ user: { id, is_anonymous: anonymous } } as Session);
function State() { const value = useSession(); return <output>{JSON.stringify({ id: value.session?.user.id ?? null, loading: value.loading, error: value.error })}</output>; }
let authEvent: (value: Session | null) => void;
beforeEach(() => { vi.clearAllMocks(); mocked.onAuthStateChange.mockImplementation(callback => { authEvent = callback; return mocked.stop; }); });
afterEach(cleanup);

describe('session event ordering', () => {
  it.each(['resolve', 'reject'] as const)('does not replace a new B auth event with a delayed initial A %s', async mode => {
    let resolve!: (value: Session) => void, reject!: (reason: Error) => void;
    mocked.getSession.mockReturnValue(new Promise((yes, no) => { resolve = yes; reject = no; }));
    const client = new QueryClient();
    render(<QueryClientProvider client={client}><SessionProvider><State /></SessionProvider></QueryClientProvider>);
    act(() => authEvent(session('B')));
    expect(screen.getByRole('status').textContent).toContain('"id":"B"');
    await act(async () => { if (mode === 'resolve') resolve(session('A')); else reject(new Error('old initial read')); });
    expect(JSON.parse(screen.getByRole('status').textContent!)).toEqual({ id: 'B', loading: false, error: null });
  });
  it('keeps same-UID linking state and only clears old account data across actual identity changes', async () => {
    mocked.getSession.mockResolvedValue(session('A'));
    const client = new QueryClient(), clear = vi.spyOn(client, 'clear');
    const view = render(<QueryClientProvider client={client}><SessionProvider><State /></SessionProvider></QueryClientProvider>);
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('"id":"A"'));
    clear.mockClear(); mocked.clearDrafts.mockClear();
    act(() => authEvent(session('A', false)));
    expect(clear).not.toHaveBeenCalled(); expect(mocked.clearDrafts).not.toHaveBeenCalled();
    act(() => authEvent(session('B')));
    expect(clear).toHaveBeenCalledTimes(1); expect(mocked.clearDrafts).toHaveBeenCalledExactlyOnceWith('A');
    act(() => authEvent(null));
    expect(clear).toHaveBeenCalledTimes(2); expect(mocked.clearDrafts).toHaveBeenLastCalledWith('B');
    view.unmount(); expect(mocked.stop).toHaveBeenCalledTimes(1);
  });
});
