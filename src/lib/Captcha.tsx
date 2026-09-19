import { useEffect, useRef, useState } from 'react';
import { captchaSiteKey } from './service';
declare global { interface Window { turnstile?: { render: (element: HTMLElement, options: Record<string, unknown>) => string; remove: (id: string) => void } } }
let scriptPromise: Promise<void> | undefined;
function loadScript() { return scriptPromise ||= new Promise<void>((resolve, reject) => { if (window.turnstile) return resolve(); const script = document.createElement('script'); script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; script.async = true; script.onload = () => resolve(); script.onerror = () => { scriptPromise = undefined; reject(new Error('Captcha unavailable')); }; document.head.appendChild(script); }); }
export function Captcha({ onToken, onExpire }: { onToken: (token: string) => void; onExpire?: () => void }) {
  const element = useRef<HTMLDivElement>(null); const callbacks = useRef({ onToken, onExpire }); callbacks.current = { onToken, onExpire }; const [error, setError] = useState(false);
  useEffect(() => { if (!captchaSiteKey) return; let active = true; let widget: string | undefined; loadScript().then(() => { if (active && element.current && window.turnstile) widget = window.turnstile.render(element.current, { sitekey: captchaSiteKey, theme: 'dark', callback: (token: string) => { setError(false); callbacks.current.onToken(token); }, 'expired-callback': () => callbacks.current.onExpire?.(), 'error-callback': () => { setError(true); callbacks.current.onExpire?.(); } }); }).catch(() => { if (active) setError(true); }); return () => { active = false; if (widget) window.turnstile?.remove(widget); }; }, []);
  return <div><div ref={element} />{error && <p role="alert">보안 확인을 불러오지 못했어요. 페이지를 새로고침해 주세요.</p>}</div>;
}
export default Captcha;
