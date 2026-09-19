// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { Captcha } from '../../src/lib/Captcha';

vi.mock('../../src/lib/service', () => ({ captchaSiteKey: 'synthetic-unit-sitekey' }));
afterEach(() => { cleanup(); delete window.turnstile; });

it('clears a previous error after SDK recovery and invalidates the token on failure and expiry', async () => {
  // SDK callbacks only: no Cloudflare request, real token, form submission or auth call.
  let callbacks: Record<string, unknown> = {};
  const renderWidget = vi.fn((_element: HTMLElement, options: Record<string, unknown>) => {
    callbacks = options;
    return 'synthetic-widget';
  });
  window.turnstile = { render: renderWidget, remove: vi.fn() };
  function Harness() {
    const [token, setToken] = useState('');
    return <><Captcha onToken={setToken} onExpire={() => setToken('')} /><button disabled={!token}>계속</button></>;
  }
  render(<Harness />);
  await waitFor(() => expect(renderWidget).toHaveBeenCalledTimes(1));
  const submit = screen.getByRole('button', { name: '계속' }) as HTMLButtonElement;
  const success = callbacks.callback as (token: string) => void;
  const error = callbacks['error-callback'] as () => void;
  const expire = callbacks['expired-callback'] as () => void;

  expect(submit.disabled).toBe(true);
  act(() => success('synthetic-first-unit-token'));
  expect(submit.disabled).toBe(false);

  act(error);
  expect(submit.disabled).toBe(true);
  expect(screen.getByRole('alert').textContent).toContain('보안 확인을 불러오지 못했어요');

  act(() => success('synthetic-recovered-unit-token'));
  expect(submit.disabled).toBe(false);
  expect(screen.queryByRole('alert')).toBeNull();

  act(expire);
  expect(submit.disabled).toBe(true);
  expect(screen.queryByRole('alert')).toBeNull();
});
