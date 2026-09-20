import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from '../lib/form-validation';
import { service, type ConversationCursor } from '../lib/service';
import { Captcha } from '../lib/Captcha';
import { characterFor, characterImage, characters } from '../components/characters';
import { Avatar, EmptyState, Eyebrow, Icon, Modal, Notice, PageTitle, Toggle } from '../components/ui';
import { errorMessage, useProfile, useSession } from './session';
import { BirthProfiles, type SavedBirthProfile } from './BirthProfiles';
import { clearDrafts } from './drafts';
import { MemoryLibrary } from './MemoryLibrary';
import { ConnectionNotice, SessionRequired } from './ConnectionState';
import { ConsultationHistory } from './ConsultationHistory';
import { uniqueRecords } from './pagination';
import { RecordDeletionDialog } from './RecordDeletionDialog';

const nicknameSchema = z.object({ nickname: z.string().trim().min(1, '어떻게 불러드리면 좋을까요?').max(20, '이름은 20자 이내로 적어주세요.') });
export function Onboarding() {
  const [params] = useSearchParams(); const character = characterFor(params.get('character')); const navigate = useNavigate(); const { session } = useSession(); const queryClient = useQueryClient();
  const [memory, setMemory] = useState(true); const [token, setToken] = useState(''); const [captchaKey, setCaptchaKey] = useState(0); const [error, setError] = useState<string | null>(null); const [pending, setPending] = useState(false);
  const { register, handleSubmit, formState: { errors } } = useForm({ resolver: zodResolver(nicknameSchema), defaultValues: { nickname: '' } });
  const active = useActiveAccountView();
  const start = handleSubmit(async ({ nickname }) => {
    setError(null); setPending(true);
    try {
      // The guest view remounts after signup, so completion follows the created UID.
      const owner = session ?? await service.signInAnonymously(token || undefined);
      if (!owner?.user.id) throw new Error('로그인 상태를 확인하지 못했어요. 다시 시작해 주세요.');
      const ownerId = owner.user.id;
      await service.updateProfile({ display_name: nickname, memory_enabled: memory, preferred_character: character.id }, ownerId);
      if ((await service.getSession())?.user.id !== ownerId) return;
      await queryClient.invalidateQueries({ queryKey: ['profile', ownerId] });
      if ((await service.getSession())?.user.id !== ownerId) return;
      navigate(`/chat/${character.slug}`);
    } catch (err) {
      if (active.current) { setError(errorMessage(err)); setToken(''); setCaptchaKey((n) => n + 1); }
    } finally { if (active.current) setPending(false); }
  });
  return <main className={`onboarding-layout theme-${character.slug}`}><div className="onboarding-art" aria-hidden="true"><span>{character.english}</span><img src={characterImage(character)} alt="" /></div><div className="onboarding-form"><div className="onboarding-step">01 · A LITTLE INTRODUCTION <span>우리, 처음 만나는 날</span></div><Eyebrow>LET’S GET TO KNOW YOU</Eyebrow><h1>뭐라고 불러주면<br />좋을까요?</h1><p>당신만의 이름으로 이야기를 시작해요.<br />생일이나 복잡한 회원가입은 필요 없어요.</p>{!service.configured && <ConnectionNotice />}<form onSubmit={start}><label className="field"><span>이름 또는 닉네임</span><input {...register('nickname')} placeholder="편하게 불리고 싶은 이름" autoComplete="nickname" maxLength={20} aria-invalid={!!errors.nickname} aria-describedby={errors.nickname ? 'nickname-error' : undefined} />{errors.nickname && <span id="nickname-error" className="field-error">{errors.nickname.message}</span>}</label><Toggle checked={memory} onChange={setMemory} label="우리의 이야기를 기억해 주세요" description="중요한 이야기와 선호를 기억해요. 설정에서 언제든 확인하거나 삭제할 수 있어요." />{!session && service.captchaConfigured && <div style={{ marginTop: 24 }}><Captcha key={captchaKey} onToken={setToken} onExpire={() => setToken('')} /></div>}{error && <Notice tone="error">{error}</Notice>}<button className="button primary wide" style={{ marginTop: 32 }} type="submit" disabled={!service.configured || pending || (!session && service.captchaConfigured && !token)}>{pending ? '우리의 자리를 준비하고 있어요…' : `${character.withName} 이야기 시작하기`}<Icon name="arrow" /></button></form><p className="onboarding-privacy">시작하면 이 브라우저에 익명 계정이 만들어져요. 계정을 연결하기 전에는 브라우저 데이터가 삭제되면 기록을 복구할 수 없어요. <Link to="/privacy">개인정보와 이용 안내</Link></p><Link className="button ghost" to="/auth">이미 계정을 연결했나요? 로그인</Link></div></main>;
}

export function AuthPage() {
  const { session, loading, error: sessionError } = useSession();
  const [params] = useSearchParams();
  const linked = !!session && !session.user.is_anonymous;
  const linking = !!session?.user.is_anonymous;
  const navigate = useNavigate();
  const [email, setEmail] = useState(''); const [code, setCode] = useState(''); const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false); const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState(''); const [captchaKey, setCaptchaKey] = useState(0);
  const { google, email: emailEnabled } = service.authProviders;
  const hashParams = new URLSearchParams(window.location.hash.slice(1));
  const callbackError = params.get('error_code') || params.get('error') || hashParams.get('error_code') || hashParams.get('error');
  const callbackMessage = callbackError === 'access_denied'
    ? 'Google 연결이 취소됐어요. 준비되면 다시 연결할 수 있어요.'
    : callbackError === 'identity_already_exists' || callbackError === 'email_exists'
      ? '이미 다른 JumZip 계정에 연결된 Google 계정이에요. 지금 브라우저의 기록은 그대로 남아 있어요.'
      : callbackError ? '계정 연결을 마치지 못했어요. 잠시 후 다시 시도해 주세요.' : null;
  async function oauth() {
    setPending(true); setError(null);
    try { if (linking) await service.linkOAuth('google', session?.user.id); else await service.signInWithOAuth('google'); }
    catch (err) { setError(errorMessage(err)); }
    finally { setPending(false); }
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setPending(true); setError(null);
    try {
      if (sent && !linking) { await service.verifyOtp(email, code); navigate('/history'); }
      else { if (linking) await service.linkEmail(email, session?.user.id); else await service.signInWithOtp(email, token || undefined); setSent(true); setToken(''); }
    } catch (err) { setError(errorMessage(err)); if (!sent && !linking) { setToken(''); setCaptchaKey((value) => value + 1); } }
    finally { setPending(false); }
  }
  const unavailable = !google && !emailEnabled;
  return <main className="content-page narrow">
    <PageTitle eyebrow="KEEP OUR CONVERSATION" title={linked ? '이야기가 잘 연결되어 있어요' : linking ? '우리의 이야기를 계속 이어가요' : '다시 만나서 반가워요'} description={linking ? '지금까지 나눈 이야기는 그대로. 계정을 연결하면 다른 기기에서도 이어갈 수 있어요.' : linked ? '연결된 계정으로 지난 상담과 기억을 다시 만날 수 있어요.' : 'JumZip에 연결한 계정으로 지난 상담과 기억을 다시 만나요.'} />
    {!service.configured && <ConnectionNotice />}
    {loading ? <p className="muted" role="status">로그인 상태를 확인하고 있어요…</p> : linked ? <EmptyState icon="check" title="계정 연결 완료"><p>{session.user.email || '나의 JumZip 계정'}</p><Link to="/history" className="button primary">나의 기록 보기 <Icon name="arrow" /></Link></EmptyState> : <div className="auth-options">
      {(error || callbackMessage || sessionError) && <Notice tone="error">{error || callbackMessage || sessionError}</Notice>}
      {google && <div className="auth-provider"><button className="button primary wide" type="button" disabled={!service.configured || pending} onClick={oauth}>{pending ? '연결을 준비하고 있어요…' : linking ? 'Google로 계정 연결' : 'Google로 로그인'}<Icon name="arrow" /></button><p className="birth-form-note">Google 계정으로 JumZip에 로그인해요.{linking && ' 지금 브라우저에서 나눈 상담과 기억이 같은 계정에 이어져요.'}</p></div>}
      {unavailable && service.configured && <Notice>계정 연결을 준비하고 있어요. {linking ? '이 브라우저에서 지금까지의 이야기를 계속 이어갈 수 있어요.' : '가입 없이 먼저 캐릭터를 만나볼 수 있어요.'}</Notice>}
      {emailEnabled && <form onSubmit={submit}>
        {google && <div className="auth-divider"><span>또는 이메일로</span></div>}
        <label className="field"><span>이메일</span><input type="email" required value={email} onChange={(e) => { setEmail(e.target.value); setSent(false); }} placeholder="you@example.com" autoComplete="email" /></label>
        {sent && <Notice>{linking ? '이메일로 확인 링크를 보냈어요. 메일에서 연결을 완료한 뒤 돌아와 주세요.' : '이메일을 확인해 주세요. 받은 로그인 링크를 누르거나, 인증코드가 있다면 아래에 입력하세요.'}</Notice>}
        {sent && !linking && <label className="field"><span>이메일 인증코드</span><input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="인증코드" minLength={6} maxLength={10} required /></label>}
        {!sent && !linking && service.captchaConfigured && <div style={{ marginBottom: 24 }}><Captcha key={captchaKey} onToken={setToken} onExpire={() => setToken('')} /></div>}
        <button className="button secondary wide" disabled={!service.configured || pending || (!sent && !linking && service.captchaConfigured && !token)} type="submit">{pending ? '확인하고 있어요…' : sent && !linking ? '인증하고 이어가기' : sent ? '확인 이메일 다시 받기' : linking ? '이메일로 계정 연결' : '이메일로 로그인'}<Icon name="arrow" /></button>
        {sent && !linking && <button type="button" className="button ghost" disabled={pending} onClick={() => { setSent(false); setCode(''); setToken(''); setCaptchaKey((value) => value + 1); }}>인증 이메일 다시 받기</button>}
        <p className="birth-form-note">메일이 오지 않으면 스팸함을 확인해 주세요.</p>
      </form>}
      <Link to={linking ? '/history' : '/onboarding'} className="button ghost">{linking ? '지금은 계속 둘러볼게요' : '처음이라면, 가입 없이 시작하기'}<Icon name="arrow" size={16} /></Link>
      <p className="birth-form-note">어떤 정보를 보관하는지 <Link className="text-link" to="/privacy">개인정보 안내</Link>에서 확인하세요.</p>
    </div>}
  </main>;
}

export function ProfilePage() { const { session } = useSession(); return <ProfileForm key={session?.user.id || 'signed-out'}/>; }
function ProfileForm() {
  const { session, loading } = useSession(); const profile = useProfile(); const queryClient = useQueryClient(); const [name, setName] = useState<string | null>(null); const [selected, setSelected] = useState<string | null>(null); const [saving, setSaving] = useState(false); const [status, setStatus] = useState(''); const [error, setError] = useState<string | null>(null);
  const births = useQuery({ queryKey: ['birth-profiles', session?.user.id], queryFn: () => service.listBirthProfiles(), enabled: !!session }); const people = useQuery({ queryKey: ['related-people', session?.user.id], queryFn: () => service.listRelatedPeople(), enabled: !!session });
  const active = useActiveAccountView();
  const refreshBirths = async () => {
    if (!session || !active.current) return;
    await Promise.all(['birth-profiles', 'related-people'].map((key) => queryClient.invalidateQueries({ queryKey: [key, session.user.id] })));
  };
  if (loading) return <main className="content-page"><p className="muted">내 정보를 불러오고 있어요…</p></main>;
  const character = characterFor(selected || profile.data?.preferred_character);
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!session || !active.current) return;
    setSaving(true); setStatus(''); setError(null);
    try {
      await service.updateProfile({ display_name: (name ?? profile.data?.display_name ?? '').trim(), preferred_character: character.id }, session.user.id);
      if (!active.current) return;
      await queryClient.invalidateQueries({ queryKey: ['profile', session.user.id] });
      if (active.current) setStatus('변경한 내용을 저장했어요.');
    } catch (err) { if (active.current) setError(errorMessage(err)); }
    finally { if (active.current) setSaving(false); }
  }
  return <main className="content-page narrow"><PageTitle eyebrow="MY LITTLE WORLD" title="나의 공간" description="우리의 이야기가 조금 더 당신다워지도록." />{!service.configured && <ConnectionNotice />}{!session ? <SessionRequired /> : <><div className="profile-intro"><Avatar character={character} size="large" /><div><h2>{profile.data?.display_name || '이야기 손님'}</h2><small>{session.user.is_anonymous ? '이 브라우저에서 함께하는 익명 계정' : session.user.email}</small></div></div>{session.user.is_anonymous && <Notice>다른 기기에서도 기록을 이어가려면 <Link className="text-link" to="/auth">계정을 연결해 주세요.</Link></Notice>}{profile.error && <Notice tone="error">{errorMessage(profile.error)}</Notice>}<form className="form-section" onSubmit={save}><label className="field"><span>이름 또는 닉네임</span><input value={name ?? profile.data?.display_name ?? ''} onChange={(e) => setName(e.target.value)} maxLength={20} required autoComplete="nickname" /></label><div className="field"><span>가장 먼저 만나고 싶은 캐릭터</span><div className="radio-group">{characters.map((c) => <label className="radio-choice" key={c.id}><input type="radio" name="preferred-character" value={c.id} checked={c.id === character.id} onChange={() => setSelected(c.id)} />{c.name}</label>)}</div><small>이미 시작한 대화의 캐릭터는 바뀌지 않아요.</small></div>{error && <Notice tone="error">{error}</Notice>}{status && <Notice tone="success">{status}</Notice>}<button className="button primary" disabled={saving || !profile.data}>{saving ? '저장하고 있어요…' : '변경 내용 저장'}</button></form><BirthProfiles profiles={(births.data || []).map((p): SavedBirthProfile => ({ ...p, birth_time_unknown: p.unknown_birth_time, birth_city: p.city, birth_country: p.country, gender: p.gender === 'MALE' || p.gender === 'FEMALE' ? p.gender : null }))} people={people.data || []} loading={births.isLoading || people.isLoading} onSaveBirth={async (input, id, personId) => { if (!session || !active.current) return; await service.saveBirthProfile({ ...input, location: { ...input.location, country: input.location.country || '' } }, id, personId, session.user.id); if (active.current) await refreshBirths(); }} onDeleteBirth={async (id) => { if (!session || !active.current) return; await service.deleteBirthProfile(id); if (active.current) await refreshBirths(); }} onSavePerson={async (input, id) => { if (!session || !active.current) return; await service.saveRelatedPerson(input, id, session.user.id); if (active.current) await refreshBirths(); }} onDeletePerson={async (id) => { if (!session || !active.current) return; await service.deleteRelatedPerson(id); if (!active.current) return; await refreshBirths(); if (active.current) await queryClient.invalidateQueries({ queryKey: ['memories', session.user.id] }); }}/>{(births.error || people.error) && <Notice tone="error">{errorMessage(births.error || people.error)}</Notice>}<Link to="/settings" className="settings-link"><Icon name="settings" />기억과 계정 설정<Icon name="chevron" size={16} /></Link></>}</main>;
}

// Each UID gets a new instance; an old A request stays inactive after A → B → A.
function useActiveAccountView() {
  const active = useRef(false);
  useLayoutEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  return active;
}
export function SettingsPage() {
  const { session } = useSession();
  return <SettingsForm key={session?.user.id || 'signed-out'} ownerUserId={session?.user.id ?? null} />;
}
function SettingsForm({ ownerUserId }: { ownerUserId: string | null }) {
  const { session } = useSession(); const profile = useProfile(); const queryClient = useQueryClient(); const navigate = useNavigate(); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [deleting, setDeleting] = useState<string | null>(null); const [confirmation, setConfirmation] = useState(''); const [logout, setLogout] = useState(false);
  const active = useActiveAccountView();
  async function toggleMemory(value: boolean) {
    if (!ownerUserId || !active.current) return;
    setBusy(true); setError(null);
    try { await service.updateProfile({ memory_enabled: value }, ownerUserId); if (!active.current) return; await queryClient.invalidateQueries({ queryKey: ['profile', ownerUserId] }); }
    catch (err) { if (active.current) setError(errorMessage(err)); }
    finally { if (active.current) setBusy(false); }
  }
  async function signOut() {
    if (!ownerUserId || !active.current) return;
    setBusy(true); setError(null);
    try { await service.signOut(ownerUserId); if (!active.current) return; clearDrafts(ownerUserId); queryClient.clear(); navigate('/'); }
    catch (err) { if (active.current) setError(errorMessage(err)); }
    finally { if (active.current) setBusy(false); }
  }
  async function deleteAccount(e: React.FormEvent) {
    e.preventDefault();
    if (!ownerUserId || deleting !== ownerUserId || session?.user.id !== ownerUserId || confirmation !== 'DELETE' || !active.current) return;
    setBusy(true); setError(null);
    try {
      const result = await service.execute<{ deleted: boolean }>('account', { action: 'DELETE_ACCOUNT', confirmation }, { expectedUserId: ownerUserId });
      if (!active.current) return;
      if (result.ok && result.data.deleted) {
        // Auth can change before React has committed the UID-keyed remount.
        const current = await service.getSession();
        if (!active.current || (current && current.user.id !== ownerUserId)) return;
        clearDrafts(ownerUserId); queryClient.clear(); navigate('/');
      }
    } catch (err) { if (active.current) setError(errorMessage(err)); }
    finally { if (active.current) setBusy(false); }
  }
  return <main className="content-page narrow"><PageTitle eyebrow="MAKE YOURSELF COMFORTABLE" title="설정" description="무엇을 기억하고, 무엇을 남길지 당신이 정해요." />{!service.configured && <ConnectionNotice />}{!session ? <SessionRequired /> : <><div className="form-section"><h2 className="section-heading">기억과 대화 <small>MEMORY</small></h2><Toggle checked={profile.data?.memory_enabled ?? false} onChange={toggleMemory} disabled={busy || !profile.data} label="대화에서 중요한 이야기 기억하기" description="이름, 관계, 선호처럼 다음 대화에 도움이 되는 맥락을 기억해요. 끄면 기억의 저장과 사용을 중단해요." /><Link to="/history?tab=memory" className="settings-link"><Icon name="history" />저장된 기억 확인·수정·삭제<Icon name="chevron" size={16} /></Link></div><div className="form-section"><h2 className="section-heading">계정 <small>ACCOUNT</small></h2>{session.user.is_anonymous && <Link to="/auth" className="settings-link"><Icon name="user" />계정 연결하기<Icon name="chevron" size={16} /></Link>}<button className="settings-link" style={{ width: '100%', textAlign: 'left' }} onClick={() => setLogout(true)}><Icon name="back" />로그아웃<Icon name="chevron" size={16} /></button></div><div className="form-section"><h2 className="section-heading">내 데이터 관리 <small>YOUR CHOICE</small></h2><p>상담 기록과 기억은 각각 삭제할 수 있어요. 계정을 삭제하면 모든 관련 데이터가 함께 삭제돼요.</p><button className="button danger" onClick={() => { setConfirmation(''); setDeleting(ownerUserId); }}>계정과 모든 데이터 삭제</button></div>{error && <Notice tone="error">{error}</Notice>}</>}<div className="form-section"><Link to="/privacy" className="settings-link"><Icon name="lock" />개인정보와 이용 안내<Icon name="chevron" size={16} /></Link><div className="settings-link"><Icon name="moon" /><span>동작 줄이기<small style={{ display: 'block', color: 'var(--muted)', marginTop: 8 }}>기기의 접근성 설정을 자동으로 따릅니다.</small></span></div></div>{logout && <Modal title="잠시 쉬어갈까요?" onClose={() => setLogout(false)}><p>{session?.user.is_anonymous ? '계정을 연결하지 않은 상태에서 로그아웃하면 이 기록으로 돌아오지 못할 수 있어요. 먼저 계정을 연결하는 것을 권해요.' : '기록은 계정에 남아 있어요. 다시 로그인하면 이어갈 수 있어요.'}</p><div className="form-actions"><button className="button secondary" onClick={() => setLogout(false)}>취소</button>{session?.user.is_anonymous && <Link className="button primary" to="/auth">계정 연결</Link>}<button className="button ghost" disabled={busy} onClick={signOut}>로그아웃</button></div></Modal>}{deleting && <Modal title="모든 이야기를 지울까요?" onClose={() => setDeleting(null)}><p>계정, 대화, 점술 결과, 기억, 출생 정보가 영구 삭제돼요. 삭제한 데이터는 되돌릴 수 없어요.</p><form onSubmit={deleteAccount}><label className="field" style={{ marginTop: 24 }}><span>계속하려면 DELETE를 입력해 주세요.</span><input value={confirmation} onChange={(e) => setConfirmation(e.target.value)} placeholder="DELETE" autoComplete="off" /></label>{error && <Notice tone="error">{error}</Notice>}<div className="form-actions"><button type="button" className="button secondary" onClick={() => setDeleting(null)}>남겨둘게요</button><button className="button danger" disabled={confirmation !== 'DELETE' || busy}>{busy ? '삭제하고 있어요…' : '모두 삭제'}</button></div></form></Modal>}</main>;
}

export function HistoryPage() {
  const { session } = useSession();
  return <HistoryContent key={session?.user.id || 'signed-out'} />;
}
function HistoryContent() {
  const [params,setParams]=useSearchParams();const tab=params.get('tab')==='memory'?'memory':params.get('tab')==='conversations'?'conversations':'history';const {session}=useSession();const queryClient=useQueryClient();
  const recordPages=useInfiniteQuery({queryKey:['conversations',session?.user.id,'pages'],initialPageParam:null as ConversationCursor|null,queryFn:({pageParam})=>service.listConversationsPage(pageParam),getNextPageParam:(last)=>last.nextCursor,enabled:!!session&&tab==='conversations'});
  const recordData=useMemo(()=>uniqueRecords(recordPages.data?.pages.flatMap((page)=>page.items)||[]),[recordPages.data]);
  const records={...recordPages,data:recordData};
  const [deleteId,setDeleteId]=useState<string|null>(null);const [editing,setEditing]=useState<{id:string;content:string}|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState<string|null>(null);
  const active = useActiveAccountView();
  async function remove(memoryIds: string[]) {
    if (!deleteId || !session || !active.current) return;
    setBusy(true); setError(null);
    try {
      await service.deleteConversation(deleteId, { memoryIds });
      if (!active.current) return;
      await Promise.all(['memories', 'readings', 'conversations', 'reading'].map((key) => queryClient.invalidateQueries({ queryKey: [key, session.user.id] })));
      if (!active.current) return;
      queryClient.removeQueries({ queryKey: ['deletion-memories', session.user.id] });
      queryClient.removeQueries({ queryKey: ['consultation-messages', session.user.id] });
      queryClient.removeQueries({ queryKey: ['messages', session.user.id, deleteId] });
      queryClient.removeQueries({ queryKey: ['conversation', session.user.id, deleteId] });
      setDeleteId(null);
    } catch (err) { if (active.current) setError(errorMessage(err)); }
    finally { if (active.current) setBusy(false); }
  }
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!editing || !session || !active.current) return;
    setBusy(true); setError(null);
    try { await service.updateConversation(editing.id, { title: editing.content.trim() }); if (!active.current) return; await queryClient.invalidateQueries({ queryKey: ['conversations', session.user.id] }); if (active.current) setEditing(null); }
    catch (err) { if (active.current) setError(errorMessage(err)); }
    finally { if (active.current) setBusy(false); }
  }
  return <main className="content-page"><PageTitle eyebrow="THE STORIES WE KEEP" title="나의 이야기 보관함" description="함께 나눈 이야기와, 잊지 않고 싶은 마음들."><Link to="/" className="button secondary compact history-new-story"><Icon name="plus" size={16}/>새 이야기</Link></PageTitle><div className="tab-bar"><button className={tab==='history'?'active':''} onClick={()=>setParams({})}>상담별 기록</button><button className={tab==='conversations'?'active':''} onClick={()=>setParams({tab:'conversations'})}>전체 대화</button><button className={tab==='memory'?'active':''} onClick={()=>setParams({tab:'memory'})}>기억하고 있는 이야기</button></div>{!service.configured&&<ConnectionNotice/>}{!session?<SessionRequired/>:tab==='memory'?<MemoryLibrary/>:tab==='history'?<ConsultationHistory/>:<>{error&&<Notice tone="error">{error}</Notice>}{records.isLoading&&<p className="muted">이야기를 꺼내고 있어요…</p>}{records.error&&<Notice tone="error">{errorMessage(records.error)}</Notice>}{records.data?.length?records.data.map((record)=>{const c=characterFor(record.character_id);return <article className="record-row" key={record.id}><Avatar character={c}/><Link className="record-row-content" to={`/chat/${c.slug}?conversation=${record.id}`}><small>{c.withName} 나눈 이야기 · {new Date(record.last_message_at||record.created_at).toLocaleDateString('ko-KR')}</small><h3>{record.title||`${c.withName}의 첫 이야기`}</h3><p>{record.summary?record.summary.slice(0,80):'마지막 이야기부터 이어가 볼까요?'}</p></Link><div className="record-actions"><button className="icon-button" aria-label="상담 제목 수정" onClick={()=>{setEditing({id:record.id,content:record.title||''});setError(null);}}><Icon name="settings" size={16}/></button><button className="icon-button" aria-label="상담 기록 삭제" onClick={()=>{setDeleteId(record.id);setError(null);}}><Icon name="trash" size={16}/></button></div></article>;}):!records.isLoading&&<EmptyState icon="history" title="아직, 쓰이지 않은 이야기">첫 대화를 나누면 이곳에 기록이 남아요.<br/>어떤 마음부터 꺼내볼까요?<div><Link className="button primary" to="/">이야기하러 가기 <Icon name="arrow"/></Link></div></EmptyState>}{recordPages.hasNextPage&&<div className="history-more"><button className="button secondary" disabled={recordPages.isFetching} onClick={()=>recordPages.fetchNextPage()}>{recordPages.isFetchingNextPage?'대화를 더 불러오고 있어요…':'이전 대화 더 보기'}</button></div>}</>}{deleteId&&<RecordDeletionDialog key={deleteId} kind="CONVERSATION" recordId={deleteId} recordTitle={records.data?.find((record)=>record.id===deleteId)?.title||'선택한 전체 대화'} busy={busy} error={error} onClose={()=>setDeleteId(null)} onConfirm={remove}/>}{editing&&<Modal title="이야기에 이름 붙이기" onClose={()=>setEditing(null)}><form onSubmit={save}><label className="field"><span>상담 제목</span><textarea value={editing.content} onChange={(e)=>setEditing({...editing,content:e.target.value})} maxLength={100} rows={2} required/></label>{error&&<Notice tone="error">{error}</Notice>}<div className="form-actions"><button type="button" className="button secondary" onClick={()=>setEditing(null)}>취소</button><button className="button primary" disabled={busy||!editing.content.trim()}>{busy?'저장 중…':'저장'}</button></div></form></Modal>}</main>;
}
export function PrivacyPage() { const providerName=import.meta.env.VITE_LLM_PROVIDER_NAME; const providerRegion=import.meta.env.VITE_LLM_PROVIDER_REGION; const providerPolicy=import.meta.env.VITE_LLM_PRIVACY_URL; const fallbackName=import.meta.env.VITE_LLM_FALLBACK_PROVIDER_NAME?.trim(); const fallbackRegion=import.meta.env.VITE_LLM_FALLBACK_PROVIDER_REGION?.trim(); const fallbackPolicy=import.meta.env.VITE_LLM_FALLBACK_PRIVACY_URL?.trim(); const isOpenAIFallback=/\bopenai\b/i.test(fallbackName||''); return <main className="content-page narrow"><PageTitle eyebrow="YOUR STORY, YOUR CHOICE" title="당신의 이야기를 소중하게" description="어떤 정보를 보관하고, 어떻게 사용하는지 알려드려요." /><div className="privacy-copy"><h2>01 · JumZip은 어떤 서비스인가요?</h2><p>JumZip은 AI 캐릭터와 대화하며 타로와 사주를 통해 마음을 돌아보는 서비스예요. 점술은 오락과 자기성찰을 위한 참고이며, 미래나 타인의 마음을 실제 사실로 확정하지 않아요. 의료·법률·재정·신변안전 판단을 대신하지 않아요.</p><h2>02 · 어떤 이야기가 저장되나요?</h2><p>이름, 대화와 상담 기록, 타로 카드 및 사주 계산 결과, 선택한 기억 설정이 저장돼요. 출생 프로필은 저장을 선택한 경우 보관해요. 상대방의 정확한 생년월일·출생시간·도시·좌표는 별도 저장 선택 없이 장기 보관하지 않으며, 궁합 결과에는 계산된 원국과 관계 정보가 남을 수 있어요.</p><h2>03 · AI와 외부 서비스는 무엇을 받나요?</h2><p>AI 캐릭터의 답변을 만들기 위해 대화 내용, 선택된 관련 맥락, 점술 결과가 외부 AI 서비스로 전송·처리될 수 있어요. 출생 입력 폼의 원본 정보 대신 계산 결과를 우선 전달해요. 다만 대화에 직접 적은 개인정보는 메시지의 일부로 처리될 수 있어요.</p>{providerName?<Notice><strong>AI 답변 처리 서비스: {providerName}</strong><p>처리 지역: {providerRegion||'서비스 제공자의 정책에 따름'}</p>{providerPolicy&&<a className="text-link" href={providerPolicy} target="_blank" rel="noreferrer">AI 서비스의 데이터 처리 안내 <Icon name="arrow" size={13}/></a>}</Notice>:<Notice>현재 AI 대화 서비스를 준비하고 있어요. 연결되면 사용하는 AI 서비스와 처리 위치를 이 안내에서 확인할 수 있어요. 아직 연결되지 않은 화면에서는 AI 답변을 만들지 않아요.</Notice>}{fallbackName&&<Notice><strong>보조 AI 답변 처리 서비스: {fallbackName}</strong><p>기본 AI 서비스의 요청이 제한되면 보조 AI 서비스를 사용해요. 이때 기본 서비스에 보내는 것과 같은 대화 내용, 선택된 관련 맥락, 점술 결과가 보조 제공자로 전송·처리돼요.</p>{isOpenAIFallback&&<p>OpenAI API로 보낸 내용과 생성된 답변은 기본적으로 모델 학습에 사용되지 않아요. 학습용 데이터 공유를 별도로 선택한 경우는 예외예요. 악용 방지와 서비스 제공을 위해 제공자 정책에 따라 데이터가 보관될 수 있어요.</p>}<p>처리 지역: {fallbackRegion||'서비스 제공자의 정책에 따름'}</p>{fallbackPolicy&&<a className="text-link" href={fallbackPolicy} target="_blank" rel="noreferrer">보조 AI 서비스의 데이터 처리 안내 <Icon name="arrow" size={13}/></a>}</Notice>}<p>출생도시 검색에는 Open-Meteo Geocoding을 사용해요. 검색한 도시의 이름, 좌표, 시간대를 계산에 활용하며 선택해 저장한 위치는 반복 계산 때 다시 검색하지 않아요. 인증과 데이터 보관에는 Supabase, 보안 확인에는 Cloudflare Turnstile을 사용해요.</p><h2>04 · 기억은 내가 선택할 수 있어요</h2><p>기억 기능은 설정에서 끌 수 있고, 보관함에서 기억을 조회·수정·삭제할 수 있어요. “기억하지 마”라고 말한 발언은 새 기억과 요약에 추가하지 않아요. 이미 저장된 기억을 지우려면 보관함에서 삭제해 주세요. 자동으로 추출하는 기억에서는 정확한 출생 정보나 인증코드·비밀번호 같은 민감 정보를 제외해요. 직접 수정한 기억의 내용은 저장되고 이후 대화에 사용될 수 있어요.</p><h2>05 · 익명으로 시작한 기록</h2><p>같은 브라우저의 익명 세션에서는 이야기를 이어갈 수 있어요. 로그아웃하거나 브라우저 데이터를 지우면 미연결 계정은 복구가 보장되지 않아요. 계정을 연결하면 다른 기기에서도 이어갈 수 있어요. 90일 이상 활동하지 않은 미연결 익명 계정은 정리 대상이며, 연결된 계정은 이 정책으로 자동 삭제하지 않아요.</p><h2>06 · 지우고 싶을 때</h2><p>보관함에서 상담을 삭제하면 해당 대화와 점술 기록을 지워요. 독립적으로 저장된 기억은 별도로 삭제할 수 있어요. 출생 정보와 관련 인물 정보 역시 삭제할 수 있으며, 설정에서 계정을 삭제하면 사용자 소유 데이터를 함께 삭제해요. 계정 삭제는 되돌릴 수 없어요.</p><h2>07 · 결과를 저장하고 공유할 때</h2><p>결과 이미지와 복사한 텍스트에는 출생 입력 폼에 따로 입력한 정확한 생년월일·출생시간·출생도시를 기본으로 숨겨요. 상세 정보 포함을 직접 선택하면 함께 담아요. 다만 제목·질문·해석에 포함된 개인정보는 그대로 담길 수 있으니 공유 전에 확인해 주세요. 이미지 저장과 텍스트 복사는 당신의 기기에서 실행돼요.</p><h2>08 · 데이터와 라이선스</h2><ul><li>도시 검색: <a className="text-link" href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a> · <a className="text-link" href="https://www.geonames.org/" target="_blank" rel="noreferrer">GeoNames</a></li><li>사주 기반 계산: manseryeok 2.0.0 · MIT License</li><li>서체: Pretendard, Noto Serif KR, Playfair Display · SIL Open Font License</li></ul><div className="form-actions"><Link className="button secondary" to="/settings">내 설정 관리하기 <Icon name="arrow" size={16} /></Link><Link className="button ghost" to="/">캐릭터 만나러 가기</Link></div></div></main>; }
