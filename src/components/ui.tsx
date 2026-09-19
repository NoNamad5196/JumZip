import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { characterImage, type Character } from './characters';

export function Icon({ name, size = 20, ...props }: { name: string; size?: number; className?: string }) {
  const paths: Record<string, ReactNode> = {
    arrow: <><path d="M4 12h15M13 5l7 7-7 7" /></>,
    back: <><path d="M20 12H5m6-7-7 7 7 7" /></>,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    plus: <path d="M12 5v14M5 12h14" />,
    send: <><path d="m12 4 8 16-8-4-8 4 8-16Z" /><path d="M12 4v12" /></>,
    star: <path d="m12 2 2.6 7.4L22 12l-7.4 2.6L12 22l-2.6-7.4L2 12l7.4-2.6L12 2Z" />,
    history: <><path d="M3 11a9 9 0 1 1 2.6 7M3 5v6h6" /><path d="M12 7v5l3 2" /></>,
    settings: <><path d="m10 3-1 3-3 1-3 3 2 3-1 3 3 3 3-1 3 2 3-2 3-1 1-4-2-2 1-4-3-2-3 1-2-3Z" /><circle cx="12" cy="12" r="3" /></>,
    user: <><circle cx="12" cy="8" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></>,
    cards: <><rect x="7" y="3" width="12" height="18" rx="2" /><path d="m5 5-3 1 3 15" /><path d="m13 8 1.2 2.8L17 12l-2.8 1.2L13 16l-1.2-2.8L9 12l2.8-1.2Z" /></>,
    moon: <path d="M20.8 14A9 9 0 0 1 10 3.2 9 9 0 1 0 20.8 14Z" />,
    chevron: <path d="m9 5 7 7-7 7" />,
    copy: <><rect x="8" y="8" width="12" height="13" rx="2" /><path d="M16 8V3H3v13h5" /></>,
    download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" /></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></>,
    check: <path d="m4 12 5 5L20 6" />,
    trash: <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" /></>,
    menu: <path d="M4 6h16M4 12h16M4 18h16" />,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7v1" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name] ?? paths.star}</svg>;
}
export function Wordmark({ small = false }: { small?: boolean }) { return <Link to="/" className={`wordmark ${small ? 'small' : ''}`} aria-label="JumZip 홈">Jum<span>Zi</span>p<span className="wordmark-dot">.</span></Link>; }
export function Header() { return <header className="site-header"><Wordmark /><nav aria-label="주 메뉴"><NavLink to="/" end>캐릭터 만나기</NavLink><NavLink to="/history">나의 기록</NavLink></nav><Link className="header-account" to="/profile"><Icon name="user" /><span>마이페이지</span></Link></header>; }
export function Footer() { return <footer className="site-footer"><span>© {new Date().getFullYear()} JumZip</span><span className="footer-thought">A little conversation. A new perspective.</span><div className="footer-links"><a href="/third-party-notices.txt" target="_blank" rel="noreferrer">오픈소스 고지</a><Link to="/privacy">개인정보와 이용 안내 <Icon name="arrow" size={14} /></Link></div></footer>; }
export function Avatar({ character, size = 'normal' }: { character: Character; size?: 'small' | 'normal' | 'large' }) { return <span className={`avatar avatar-${size} avatar-${character.slug}`}><img src={characterImage(character)} alt={character.name} /></span>; }
export function Eyebrow({ children, number }: { children: ReactNode; number?: string }) { return <div className="eyebrow">{number && <span>{number}</span>}{children}</div>; }
export function PageTitle({ eyebrow, title, description, children }: { eyebrow: string; title: string; description?: string; children?: ReactNode }) { return <div className="page-title"><Eyebrow>{eyebrow}</Eyebrow><div className="page-title-row"><h1>{title}</h1>{children}</div>{description && <p>{description}</p>}</div>; }
export function EmptyState({ icon = 'star', title, children, action }: { icon?: string; title: string; children?: ReactNode; action?: ReactNode }) { return <div className="empty-state"><span className="empty-emblem"><Icon name={icon} size={30} /></span><h2>{title}</h2><div className="muted">{children}</div>{action}</div>; }
export function Notice({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'error' | 'success' }) { return <div className={`notice notice-${tone}`} role={tone === 'error' ? 'alert' : 'status'}><Icon name={tone === 'success' ? 'check' : 'info'} size={18} /><div>{children}</div></div>; }
export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingId=useId();
  useEffect(() => { const dialog = ref.current; const previous=document.activeElement; dialog?.showModal(); return () => { dialog?.close(); if(previous instanceof HTMLElement&&previous.isConnected)previous.focus(); }; }, []);
  return <dialog ref={ref} className="modal" aria-labelledby={headingId} onKeyDown={(event)=>{if(event.key!=='Tab')return;const dialog=ref.current;if(!dialog)return;const controls=Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')).filter((element)=>element.getClientRects().length>0);const first=controls[0],last=controls.at(-1);if(!first){event.preventDefault();dialog.focus();return;}if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}} onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={(e) => { if (e.target === ref.current) onClose(); }}><div className="modal-inner"><div className="modal-heading"><h2 id={headingId}>{title}</h2><button type="button" className="icon-button" aria-label="닫기" onClick={onClose}><Icon name="close" /></button></div>{children}</div></dialog>;
}
export function Toggle({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (value: boolean) => void; label: string; description?: string; disabled?: boolean }) { return <label className="toggle-row"><span><strong>{label}</strong>{description && <small>{description}</small>}</span><input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} /><span className="toggle-track" aria-hidden="true" /></label>; }
