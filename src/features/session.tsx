import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { service, type Session } from '../lib/service';
import { clearDrafts } from './drafts';

const SessionContext = createContext<{ session: Session | null; loading: boolean; error: string | null }>({ session: null, loading: true, error: null });
export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const currentSession = useRef<Session | null>(null);
  const queryClient = useQueryClient();
  useEffect(() => {
    let active = true;
    let authRevision = 0;
    const applySession = (value: Session | null) => { if (!active) return; if (currentSession.current?.user.id !== value?.user.id) { if (currentSession.current?.user.id) clearDrafts(currentSession.current.user.id); queryClient.clear(); } currentSession.current = value; setSession(value); };
    // A delayed initial read must not replace a newer login/logout event.
    const initialRevision = authRevision;
    service.getSession().then(value => { if (authRevision === initialRevision) applySession(value); }).catch(() => { if (active && authRevision === initialRevision) setError('로그인 상태를 확인하지 못했어요. 다시 연결해 주세요.'); }).finally(() => { if (active && authRevision === initialRevision) setLoading(false); });
    const stop = service.onAuthStateChange((value) => { if (active) { authRevision++; applySession(value); setLoading(false); setError(null); } });
    return () => { active = false; stop(); };
  }, [queryClient]);
  return <SessionContext.Provider value={{ session, loading, error }}>{children}</SessionContext.Provider>;
}
export const useSession = () => useContext(SessionContext);
export function useProfile() { const { session } = useSession(); return useQuery({ queryKey: ['profile', session?.user.id], queryFn: () => service.loadProfile(), enabled: !!session }); }
export function errorMessage(error: unknown) { return error instanceof Error ? error.message : '잠시 문제가 생겼어요. 다시 시도해 주세요.'; }
