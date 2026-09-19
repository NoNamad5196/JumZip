// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConsultationHistory } from '../../src/features/ConsultationHistory';
import { HistoryPage } from '../../src/features/AccountPages';
const mocked=vi.hoisted(()=>({candidates:vi.fn(),deleteReading:vi.fn(),deleteConversation:vi.fn(),readings:vi.fn(),conversations:vi.fn()}));
vi.mock('../../src/lib/service',()=>({service:{configured:true,getDeletionMemories:mocked.candidates,deleteReading:mocked.deleteReading,deleteConversation:mocked.deleteConversation,listReadingsPage:mocked.readings,listConversationsPage:mocked.conversations}}));
vi.mock('../../src/features/session',()=>({useSession:()=>({session:{user:{id:'user-1'}}}),useProfile:()=>({data:{}}),errorMessage:(error:unknown)=>error instanceof Error?error.message:'오류'}));
vi.mock('../../src/lib/Captcha',()=>({Captcha:()=>null}));
const reading={id:'reading-1',title:'고른 상담',fortune_type:'TAROT',conversation_id:'conversation-1',character_id:'ARANG',created_at:'2026-09-20',result_summary:null};
const memories=[{id:'memory-1',content:'남겨둘 기억',scope:'GLOBAL',character_id:null,disabled_at:null},{id:'memory-2',content:'함께 지울 기억',scope:'CHARACTER',character_id:'ARANG',disabled_at:null}];
function mount(kind:'CONSULTATION'|'CONVERSATION') {const client=new QueryClient({defaultOptions:{queries:{retry:false}}});const view=render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/history?tab=conversations']}>{kind==='CONSULTATION'?<ConsultationHistory/>:<HistoryPage/>}</MemoryRouter></QueryClientProvider>);return{...view,client};}
async function open(kind:'CONSULTATION'|'CONVERSATION') {await screen.findByText(kind==='CONSULTATION'?'고른 상담':'고른 전체 대화');fireEvent.click(screen.getByRole('button',{name:kind==='CONSULTATION'?'이 상담 삭제':'상담 기록 삭제'}));}
beforeEach(()=>{mocked.candidates.mockReset().mockResolvedValue(memories);mocked.deleteReading.mockReset().mockResolvedValue(undefined);mocked.deleteConversation.mockReset().mockResolvedValue(undefined);mocked.readings.mockReset().mockResolvedValue({items:[reading],nextCursor:null});mocked.conversations.mockReset().mockResolvedValue({items:[{id:'conversation-1',title:'고른 전체 대화',character_id:'ARANG',created_at:'2026-09-20',last_message_at:null}],nextCursor:null});HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};});
afterEach(cleanup);
describe('explicit record and memory deletion',()=>{
 it.each(['CONSULTATION','CONVERSATION'] as const)('%s defaults to preserving every memory',async(kind)=>{
  mount(kind);await open(kind);const checkboxes=await screen.findAllByRole('checkbox');expect(checkboxes.every(box=>!(box as HTMLInputElement).checked)).toBe(true);
  expect(mocked.candidates).toHaveBeenCalledWith(kind,kind==='CONSULTATION'?'reading-1':'conversation-1');
  if(kind==='CONSULTATION')expect(screen.getByText('같은 대화에서 저장한 기억이에요. 다른 상담에서 나온 기억도 포함될 수 있으니 함께 지울 항목만 골라주세요.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'기록만 삭제'}));await waitFor(()=>expect(kind==='CONSULTATION'?mocked.deleteReading:mocked.deleteConversation).toHaveBeenCalledWith(kind==='CONSULTATION'?'reading-1':'conversation-1',{memoryIds:[]}));
 });
 it.each(['CONSULTATION','CONVERSATION'] as const)('%s submits only individually selected memory IDs in the same deletion call',async(kind)=>{
  const {client}=mount(kind);const invalidate=vi.spyOn(client,'invalidateQueries');await open(kind);fireEvent.click(await screen.findByRole('checkbox',{name:/함께 지울 기억/}));expect((screen.getByRole('checkbox',{name:/남겨둘 기억/}) as HTMLInputElement).checked).toBe(false);
  fireEvent.click(screen.getByRole('button',{name:'기록과 기억 1개 삭제'}));const remove=kind==='CONSULTATION'?mocked.deleteReading:mocked.deleteConversation;await waitFor(()=>expect(remove).toHaveBeenCalledWith(kind==='CONSULTATION'?'reading-1':'conversation-1',{memoryIds:['memory-2']}));await waitFor(()=>expect(invalidate).toHaveBeenCalledWith({queryKey:['memories','user-1']}));expect(remove).toHaveBeenCalledTimes(1);
 });
 it('offers a fresh candidate lookup after failure without selecting anything automatically',async()=>{
  mocked.candidates.mockRejectedValueOnce(new Error('lookup failed'));mount('CONSULTATION');await open('CONSULTATION');fireEvent.click(await screen.findByRole('button',{name:'기억 다시 불러오기'}));const boxes=await screen.findAllByRole('checkbox');expect(boxes.every(box=>!(box as HTMLInputElement).checked)).toBe(true);expect(mocked.candidates).toHaveBeenCalledTimes(2);expect(mocked.deleteReading).not.toHaveBeenCalled();
 });
 it('allows an explicit record-only deletion when memory lookup fails',async()=>{
  mocked.candidates.mockRejectedValue(new Error('lookup failed'));mount('CONVERSATION');await open('CONVERSATION');await screen.findByText(/기억 목록을 불러오지 못했어요/);expect(screen.queryByRole('checkbox')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'기록만 삭제'}));await waitFor(()=>expect(mocked.deleteConversation).toHaveBeenCalledWith('conversation-1',{memoryIds:[]}));
 });
 it('keeps selection and dialog on a failed atomic deletion instead of reporting a partial success',async()=>{
  mocked.deleteReading.mockRejectedValue(new Error('선택한 기억을 다시 확인해 주세요.'));mount('CONSULTATION');await open('CONSULTATION');fireEvent.click(await screen.findByRole('checkbox',{name:/함께 지울 기억/}));fireEvent.click(screen.getByRole('button',{name:'기록과 기억 1개 삭제'}));await screen.findAllByText('선택한 기억을 다시 확인해 주세요.');expect(screen.getByRole('dialog')).toBeTruthy();expect((screen.getByRole('checkbox',{name:/함께 지울 기억/}) as HTMLInputElement).checked).toBe(true);expect(mocked.deleteReading).toHaveBeenCalledTimes(1);
 });
});
