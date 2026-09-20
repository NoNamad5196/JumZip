// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PrivacyPage } from '../../src/features/AccountPages';

vi.mock('../../src/lib/service',()=>({service:{configured:false}}));
const primaryPolicy='https://developers.cloudflare.com/workers-ai/platform/data-usage/';
const fallbackPolicy='https://ai.google.dev/gemini-api/terms';
const show=()=>render(<MemoryRouter><PrivacyPage/></MemoryRouter>);
beforeEach(()=>{
  vi.stubEnv('VITE_LLM_PROVIDER_NAME','Cloudflare Workers AI');
  vi.stubEnv('VITE_LLM_PROVIDER_REGION','처리 지역 고정 없음');
  vi.stubEnv('VITE_LLM_PRIVACY_URL',primaryPolicy);
  vi.stubEnv('VITE_LLM_FALLBACK_PROVIDER_NAME','');
  vi.stubEnv('VITE_LLM_FALLBACK_PROVIDER_REGION','');
  vi.stubEnv('VITE_LLM_FALLBACK_PRIVACY_URL','');
});
afterEach(()=>{cleanup();vi.unstubAllEnvs();});

describe('configured AI provider disclosure',()=>{
  it('keeps the primary provider and policy without advertising an unconfigured fallback',()=>{
    vi.stubEnv('VITE_LLM_FALLBACK_PROVIDER_REGION','unused region');
    vi.stubEnv('VITE_LLM_FALLBACK_PRIVACY_URL',fallbackPolicy);
    show();
    expect(screen.getByText('AI 답변 처리 서비스: Cloudflare Workers AI')).toBeTruthy();
    expect(screen.getByText('처리 지역: 처리 지역 고정 없음')).toBeTruthy();
    expect(screen.getByRole('link',{name:'AI 서비스의 데이터 처리 안내'}).getAttribute('href')).toBe(primaryPolicy);
    expect(screen.queryByText(/보조 AI 답변 처리 서비스/)).toBeNull();
    expect(screen.queryByText(/Google 제품 개선/)).toBeNull();
    expect(screen.queryByRole('link',{name:'보조 AI 서비스의 데이터 처리 안내'})).toBeNull();
  });
  it('discloses both providers, the rate-limit trigger, Google transfer and free API use without replacing primary metadata',()=>{
    vi.stubEnv('VITE_LLM_FALLBACK_PROVIDER_NAME','Google Gemini 3.5 Flash');
    vi.stubEnv('VITE_LLM_FALLBACK_PROVIDER_REGION','Google 정책에 따른 처리 지역');
    vi.stubEnv('VITE_LLM_FALLBACK_PRIVACY_URL',fallbackPolicy);
    show();
    expect(screen.getByText('AI 답변 처리 서비스: Cloudflare Workers AI')).toBeTruthy();
    expect(screen.getByText('보조 AI 답변 처리 서비스: Google Gemini 3.5 Flash')).toBeTruthy();
    expect(screen.getByText(/기본 AI 서비스의 요청이 제한되면/).textContent).toContain('같은 대화 내용, 선택된 관련 맥락, 점술 결과가 Google로 전송·처리돼요.');
    expect(screen.getByText(/Google의 무료 Gemini API에 전송한 내용과 생성된 답변/).textContent).toContain('Google 제품 개선에 사용될 수 있어요.');
    expect(screen.getByText('처리 지역: Google 정책에 따른 처리 지역')).toBeTruthy();
    expect(screen.getByRole('link',{name:'AI 서비스의 데이터 처리 안내'}).getAttribute('href')).toBe(primaryPolicy);
    const link=screen.getByRole('link',{name:'보조 AI 서비스의 데이터 처리 안내'});
    expect(link.getAttribute('href')).toBe(fallbackPolicy);expect(link.getAttribute('rel')).toBe('noreferrer');
  });
  it('allows an unspecified secondary region and policy without inventing a location or an empty link',()=>{
    vi.stubEnv('VITE_LLM_FALLBACK_PROVIDER_NAME','Google Gemini 3.5 Flash');
    vi.stubEnv('VITE_LLM_FALLBACK_PROVIDER_REGION','   ');
    show();
    expect(screen.getByText('처리 지역: 서비스 제공자의 정책에 따름')).toBeTruthy();
    expect(screen.queryByRole('link',{name:'보조 AI 서비스의 데이터 처리 안내'})).toBeNull();
    expect(screen.queryByText(/미국|한국 내|고정 지역/)).toBeNull();
  });
  it('does not treat a whitespace-only fallback name as a configured secondary provider',()=>{
    vi.stubEnv('VITE_LLM_FALLBACK_PROVIDER_NAME','   ');show();
    expect(screen.queryByText(/보조 AI 답변 처리 서비스/)).toBeNull();
    expect(screen.queryByText(/Google 제품 개선/)).toBeNull();
  });
});
