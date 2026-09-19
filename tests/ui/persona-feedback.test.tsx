// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { ErrorPersona, PendingPersona } from '../../src/features/PersonaFeedback';
afterEach(()=>{cleanup();vi.useRealTimers();});
describe('Persona system feedback',()=>{
 it('changes a pending thought to the same character long-wait copy',()=>{vi.useFakeTimers();render(<PendingPersona characterId="ARANG"/>);expect(screen.getByRole('status').textContent).toContain('이야기의 흐름을 살펴보고 있어요.');act(()=>vi.advanceTimersByTime(20000));expect(screen.getByRole('status').textContent).toContain('조금 늦어지고 있네요.');});
 it('uses a timeout line without describing the server error as lost user input',()=>{render(<ErrorPersona characterId="SANI" message="응답 생성 시간이 초과되었습니다." code="LLM_TIMEOUT"/>);expect(screen.getByRole('alert').textContent).toContain('답이 늦어져서 멈췄어. 다시 이어가면 돼.');});
 it('keeps validation errors factual rather than claiming a network failure',()=>{render(<ErrorPersona characterId="BOMI" message="출생 도시를 다시 선택해 주세요." code="SAJU_LOCATION_UNRESOLVED"/>);expect(screen.getByRole('alert').textContent).toBe('출생 도시를 다시 선택해 주세요.');});
});
