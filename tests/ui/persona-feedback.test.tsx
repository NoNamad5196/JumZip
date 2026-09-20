// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { ErrorPersona, PendingPersona } from '../../src/features/PersonaFeedback';
afterEach(()=>{cleanup();vi.useRealTimers();});
describe('Persona system feedback',()=>{
 it('changes a pending thought to the same character long-wait copy',()=>{vi.useFakeTimers();render(<PendingPersona characterId="ARANG"/>);expect(screen.getByRole('status').textContent).toContain('이야기의 흐름을 살펴보고 있어요.');act(()=>vi.advanceTimersByTime(20000));expect(screen.getByRole('status').textContent).toContain('조금 늦어지고 있네요.');});
 it('uses a timeout line without describing the server error as lost user input',()=>{render(<ErrorPersona characterId="SANI" message="응답 생성 시간이 초과되었습니다." code="LLM_TIMEOUT"/>);expect(screen.getByRole('alert').textContent).toContain('답이 늦어져서 멈췄어. 다시 이어가면 돼.');});
 it('keeps validation errors factual rather than claiming a network failure',()=>{render(<ErrorPersona characterId="BOMI" message="출생 도시를 다시 선택해 주세요." code="SAJU_LOCATION_UNRESOLVED"/>);expect(screen.getByRole('alert').textContent).toBe('출생 도시를 다시 선택해 주세요.');});
 it.each(['LLM_BUDGET_EXCEEDED','LLM_UNAVAILABLE'])('handles budget denial %s without diagnosing exhausted funds, a reset time, or network failure',code=>{
  render(<ErrorPersona characterId="BOMI" code={code} details={code==='LLM_UNAVAILABLE'?{reason:'LLM_BUDGET_EXCEEDED',userMessageId:'persisted-user'}:undefined} message="보조 AI의 이용 한도 또는 사용 기간을 확인할 수 없어 답변 생성을 멈췄습니다."/>);
  const text=screen.getByRole('alert').textContent!;
  expect(text).toBe('보조 AI의 이용 한도나 사용 기간을 확인해 주세요. 쓴 이야기는 남아 있어요.');
  expect(text).not.toMatch(/소진|초과|연결|잠시|곧|내일|자정|초기화|멈췄습니다/);
 });
 it.each(['응답 서비스에 연결하지 못했습니다.','응답 서비스가 현재 요청을 제한하고 있습니다. 잠시 후 다시 시도해 주세요.'])('handles a production rate-limit reason without repeating the generic envelope or promising quick recovery: %s',message=>{
  render(<ErrorPersona characterId="BOMI" code="LLM_UNAVAILABLE" details={{reason:'LLM_RATE_LIMITED',userMessageId:'persisted-user'}} message={message}/>);
  const text=screen.getByRole('alert').textContent!;
  expect(text).toBe('AI 응답 요청이 제한되어 있어요. 제한이 해제된 뒤 다시 시도해 주세요.');
  expect(text).not.toMatch(/연결|잠시|곧|내일|자정|할당량|저장|남아/);expect(text).not.toContain(message);
 });
 it.each([undefined,'LLM_AUTH_FAILED','LLM_NOT_CONFIGURED','LLM_UNAVAILABLE','UNKNOWN_PROVIDER_REASON'])('does not diagnose service failure as a client network problem or claim saved input for reason %s',reason=>{
  render(<ErrorPersona characterId="ARANG" code="LLM_UNAVAILABLE" details={{reason}} message="응답 서비스에 연결하지 못했습니다."/>);
  const text=screen.getByRole('alert').textContent!;
  expect(text).toBe('AI 응답 서비스를 이용할 수 없어 답변을 받지 못했어요.');
  expect(text).not.toMatch(/연결|끊|놓쳤|잠시|제한|저장|남아/);
 });
 it('retains character network feedback only for an actual NETWORK_ERROR',()=>{
  render(<ErrorPersona characterId="SANI" code="NETWORK_ERROR" message="요청을 전달하지 못했어요."/>);
  expect(screen.getByRole('alert').textContent).toContain('연결이 끊겼네. 쓴 내용은 그대로 있어.');
 });
});
