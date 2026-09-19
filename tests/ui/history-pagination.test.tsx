// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ConsultationHistory } from '../../src/features/ConsultationHistory';
import { HistoryPage } from '../../src/features/AccountPages';
const mocked=vi.hoisted(()=>({readings:vi.fn(),conversations:vi.fn()}));
vi.mock('../../src/lib/service',()=>({service:{configured:true,listReadingsPage:mocked.readings,listConversationsPage:mocked.conversations}}));
vi.mock('../../src/features/session',()=>({useSession:()=>({session:{user:{id:'user-1'}}}),useProfile:()=>({data:{}}),errorMessage:(e:unknown)=>e instanceof Error?e.message:'오류'}));
vi.mock('../../src/lib/Captcha',()=>({Captcha:()=>null}));
const record=(id:string,title:string)=>({id,title,fortune_type:'TAROT',result_summary:null,created_at:'2026-09-20T00:00:00Z',conversation_id:'conversation-1',character_id:'ARANG'});
function mount(all=false){return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter initialEntries={['/history?tab=conversations']}>{all?<HistoryPage/>:<ConsultationHistory/>}</MemoryRouter></QueryClientProvider>);}
beforeEach(()=>{mocked.readings.mockReset();mocked.conversations.mockReset();});afterEach(cleanup);
describe('paginated saved history',()=>{
 it('loads older consultations and keeps only one record when cursor pages overlap',async()=>{
  const cursor={createdAt:'2026-09-20T00:00:00Z',id:'reading-1'};
  mocked.readings.mockResolvedValueOnce({items:[record('reading-1','새로운 상담')],nextCursor:cursor}).mockResolvedValueOnce({items:[record('reading-1','겹치는 낡은 제목'),record('reading-2','이전 상담')],nextCursor:null});
  mount();await screen.findByText('새로운 상담');fireEvent.click(screen.getByRole('button',{name:'상담 더 보기'}));await screen.findByText('이전 상담');
  expect(mocked.readings).toHaveBeenLastCalledWith({cursor,search:'',fortuneType:'ALL'});
  expect(screen.getAllByText('새로운 상담')).toHaveLength(1);expect(screen.queryByText('겹치는 낡은 제목')).toBeNull();expect(screen.queryByRole('button',{name:'상담 더 보기'})).toBeNull();
 });
 it('starts a fresh server search and type filter with no old cursor',async()=>{
  mocked.readings.mockImplementation(async({search,fortuneType})=>({items:[record(search?'match':'initial',search?`검색 결과 ${fortuneType}`:'기존 상담')],nextCursor:null}));
  mount();await screen.findByText('기존 상담');fireEvent.change(screen.getByRole('searchbox',{name:'상담 찾기'}),{target:{value:'오래된_% 이야기'}});
  await screen.findByText('검색 결과 ALL');expect(mocked.readings).toHaveBeenLastCalledWith({cursor:null,search:'오래된_% 이야기',fortuneType:'ALL'});
  fireEvent.change(screen.getByRole('combobox',{name:'상담의 종류'}),{target:{value:'SAJU'}});
  await screen.findByText('검색 결과 SAJU');expect(mocked.readings).toHaveBeenLastCalledWith({cursor:null,search:'오래된_% 이야기',fortuneType:'SAJU'});
  expect(screen.queryByText('기존 상담')).toBeNull();
 });
 it('continues conversation history through the nullable last-message cursor',async()=>{
  const cursor={lastMessageAt:null,id:'conversation-1'};
  const conversation=(id:string,title:string)=>({id,title,character_id:'ARANG',created_at:'2026-09-20',last_message_at:null,summary:null});
  mocked.conversations.mockResolvedValueOnce({items:[conversation('conversation-1','현재 대화')],nextCursor:cursor}).mockResolvedValueOnce({items:[conversation('conversation-2','오래된 대화')],nextCursor:null});
  mount(true);await screen.findByText('현재 대화');fireEvent.click(screen.getByRole('button',{name:'이전 대화 더 보기'}));await screen.findByText('오래된 대화');
  await waitFor(()=>expect(mocked.conversations).toHaveBeenLastCalledWith(cursor));expect(screen.getAllByText(/아랑과 나눈 이야기/)).toHaveLength(2);expect(mocked.readings).not.toHaveBeenCalled();
 });
});
