// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Reading from '../../src/features/Reading';
const mocked=vi.hoisted(()=>({reading:vi.fn(),messages:vi.fn()}));
vi.mock('../../src/lib/service',()=>({service:{configured:true,getReading:mocked.reading,listConsultationMessages:mocked.messages}}));
vi.mock('../../src/features/session',()=>({useSession:()=>({session:{user:{id:'user-1'}}}),useProfile:()=>({data:{}}),errorMessage:(error:unknown)=>error instanceof Error?error.message:'오류'}));
vi.mock('../../src/lib/Captcha',()=>({Captcha:()=>null}));
vi.mock('html-to-image',()=>({toPng:vi.fn()}));
const reading={id:'reading-1',conversation_id:'conversation-1',character_id:'BOMI',title:'함께 본 이야기',created_at:'2026-09-20',fortune_type:'TAROT',question:'',result_summary:null,saju_readings:[],saju_compatibility_readings:[],tarot_draw_groups:[{id:'draw-1',mode:'NORMAL',spread_type:'ONE_CARD',tarot_draws:[{card_id:0,position_index:0,position_name:'ADVICE',orientation:'UPRIGHT'}]}]};
function mount(){return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter initialEntries={['/reading/reading-1']}><Routes><Route path="/reading/:consultationId" element={<Reading/>}/></Routes></MemoryRouter></QueryClientProvider>);}
beforeEach(()=>{mocked.reading.mockReset().mockResolvedValue(reading);mocked.messages.mockReset().mockResolvedValue([]);});afterEach(cleanup);
describe('persisted reading detail',()=>{
 it('shows a partial draw without pretending that interpretation succeeded',async()=>{mount();await screen.findByAltText('The Fool, 정방향');expect(await screen.findByText('카드는 안전하게 저장됐어요. 해석을 다시 받아도 같은 카드를 사용해요.')).toBeTruthy();expect(screen.getByRole('link',{name:/보미와 더 이야기하기/}).getAttribute('href')).toContain('conversation=conversation-1&consultation=reading-1');});
 it('displays the latest saved interpretation and does not draw anything again',async()=>{mocked.messages.mockResolvedValue([{sender:'SYSTEM',metadata:{tarot:{drawGroupId:'draw-1',executionStatus:'PARTIAL'}}},{sender:'ASSISTANT',metadata:{tarot:{drawGroupId:'draw-1',executionStatus:'SUCCEEDED',interpretation:{messageId:'interpretation-1',content:'이미 저장된 해석입니다.'}}}}]);mount();await screen.findByText('이미 저장된 해석입니다.');expect(screen.queryByText('카드는 안전하게 저장됐어요. 해석을 다시 받아도 같은 카드를 사용해요.')).toBeNull();expect(screen.getAllByAltText('The Fool, 정방향')).toHaveLength(1);});
 it('requires an explicit toggle to include a saved birth date, time and city',async()=>{mocked.reading.mockResolvedValue({...reading,tarot_draw_groups:[],fortune_type:'SAJU',saju_readings:[{pillars:{},birth_profile_snapshot:{birthDate:'1991-01-02',birthTime:'08:35',calendarType:'SOLAR',location:{name:'Private Birth City',latitude:34.123456,longitude:128.654321,timezone:'Asia/Seoul'}}}]});mount();await screen.findByText('나를 이루는 네 기둥');expect(screen.queryByText('1991-01-02')).toBeNull();expect(screen.queryByText('Private Birth City')).toBeNull();fireEvent.click(screen.getByRole('switch',{name:/이미지에 상세 출생 정보 포함/}));expect(screen.getByText('1991-01-02')).toBeTruthy();expect(screen.getByText('08:35')).toBeTruthy();expect(screen.getByText('Private Birth City')).toBeTruthy();expect(screen.queryByText(/34.123456/)).toBeNull();});
});
