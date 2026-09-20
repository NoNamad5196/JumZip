// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Chat from '../../src/features/Chat';
import { ServiceError } from '../../src/lib/service';
import { webcrypto } from 'node:crypto';
import { clearRequestIntents } from '../../src/features/request-intent';

const mocked = vi.hoisted(() => ({ execute: vi.fn(), messages: vi.fn(), pages: vi.fn(), providers: {google:false,email:false}, create: vi.fn(), conversation: vi.fn(), session: { user: { id: 'user-1' } } as object | null }));
vi.mock('../../src/lib/service', () => ({ service: { configured: true, authProviders: mocked.providers, listMessagesPage: async(id:string,cursor:unknown)=>await mocked.pages(id,cursor)??{items:await mocked.messages(id),nextCursor:null}, getConversation: mocked.conversation, createConversation: mocked.create, execute: mocked.execute }, capabilities: { sajuFull: false }, ServiceError: class extends Error { code = ''; details?: Record<string,unknown>; } }));
vi.mock('../../src/features/session', () => ({ useSession: () => ({ session: mocked.session, loading: false }), useProfile: () => ({ data: { display_name: '하루' } }), errorMessage: (error: unknown) => error instanceof Error ? error.message : '오류' }));
vi.mock('../../src/lib/Captcha', () => ({ Captcha: () => null }));
const group={executionStatus:'PARTIAL',consultationId:'reading-1',drawGroupId:'draw-1',spreadType:'ONE_CARD',mode:'NORMAL',cards:[{cardId:0,orientation:'UPRIGHT',positionIndex:0,positionKey:'ADVICE'}],interpretation:null};
const message=(patch:object)=>({id:'message-1',conversation_id:'conversation-1',consultation_id:'reading-1',sender:'SYSTEM',content:'',type:'TAROT_DRAW',metadata:{},created_at:'2026-09-20T00:00:00Z',...patch});
function mount(path='/chat/bomi?conversation=conversation-1',extra?:React.ReactNode){const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}>{extra}<Routes><Route path="/chat/:characterId" element={<Chat/>}/><Route path="/history" element={<h1>기록 화면</h1>}/></Routes></MemoryRouter></QueryClientProvider>);}
beforeEach(()=>{vi.stubGlobal('crypto',webcrypto);clearRequestIntents();mocked.session={user:{id:'user-1'}};mocked.execute.mockReset();mocked.messages.mockReset();mocked.pages.mockReset();mocked.providers.google=false;mocked.providers.email=false;mocked.create.mockReset();mocked.conversation.mockReset();mocked.conversation.mockResolvedValue({id:'conversation-1',character_id:'BOMI'});mocked.messages.mockResolvedValue([]);sessionStorage.clear();Element.prototype.scrollTo=vi.fn();HTMLDialogElement.prototype.showModal=vi.fn();HTMLDialogElement.prototype.close=vi.fn();window.matchMedia=vi.fn().mockImplementation(()=>({matches:true,addListener:vi.fn(),removeListener:vi.fn(),addEventListener:vi.fn(),removeEventListener:vi.fn()}));});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
describe('real chat interaction contract',()=>{
  it('shows the user and character typing bubble before conversation creation, then shows the complete answer without waiting for history',async()=>{
    let created!:(value:unknown)=>void,answered!:(value:unknown)=>void;
    mocked.create.mockReturnValue(new Promise(resolve=>{created=resolve;}));
    mocked.execute.mockReturnValue(new Promise(resolve=>{answered=resolve;}));
    mocked.pages.mockImplementation(()=>new Promise(()=>{}));
    window.matchMedia=vi.fn().mockImplementation(()=>({matches:false,addListener:vi.fn(),removeListener:vi.fn(),addEventListener:vi.fn(),removeEventListener:vi.fn()}));
    const {container}=mount('/chat/bomi');
    const input=screen.getByRole('textbox',{name:'보미에게 보낼 이야기'}) as HTMLTextAreaElement;
    fireEvent.change(input,{target:{value:'첫 말은 바로 보여야 해'}});fireEvent.click(screen.getByRole('button',{name:'이야기 보내기'}));
    expect(screen.getByText('첫 말은 바로 보여야 해',{selector:'.message-user .sr-only'})).toBeTruthy();expect(input.value).toBe('');
    expect(screen.getByRole('status').querySelector('img')?.alt).toBe('보미');expect(container.querySelector('.typing-bubble')).toBeTruthy();
    expect(mocked.execute).not.toHaveBeenCalled();
    fireEvent.change(input,{target:{value:'답을 기다리며 새로 적는 말'}});fireEvent.keyDown(input,{key:'Enter'});expect(mocked.create).toHaveBeenCalledTimes(1);
    await act(async()=>created({id:'created-conversation',character_id:'BOMI'}));await waitFor(()=>expect(mocked.execute).toHaveBeenCalledTimes(1));
    expect(screen.getAllByText('첫 말은 바로 보여야 해',{selector:'.message-user .sr-only'})).toHaveLength(1);expect(screen.getByRole('status')).toBeTruthy();
    await act(async()=>answered({ok:true,meta:{createdAt:'2026-09-20T00:01:00Z'},data:{conversationId:'created-conversation',consultationId:'reading-new',userMessage:{id:'user-new'},assistantMessage:{id:'answer-new',content:'첫 문장. 둘째 문장. 마지막 문장까지 즉시.'}}}));
    expect(screen.getByText('첫 문장. 둘째 문장. 마지막 문장까지 즉시.',{selector:'.message-assistant .message-text > [aria-hidden]'})).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();expect(input.value).toBe('답을 기다리며 새로 적는 말');expect(container.querySelector('.sentence-reveal')).toBeNull();
    expect(mocked.execute.mock.calls[0][1].message).toBe('첫 말은 바로 보여야 해');
  });
  it('keeps a successful response visible and stops typing when the history refresh fails',async()=>{
    mocked.messages.mockResolvedValueOnce([]).mockRejectedValue(new Error('기록 재조회 실패'));
    mocked.execute.mockResolvedValue({ok:true,data:{conversationId:'conversation-1',consultationId:'reading-1',userMessage:{id:'saved-question'},assistantMessage:{id:'valid-answer',content:'이미 받은 검증된 답변'}}});
    mount();await waitFor(()=>expect(mocked.messages).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByRole('textbox'),{target:{value:'다시 읽기 실패와 구분'}});fireEvent.click(screen.getByRole('button',{name:'이야기 보내기'}));
    await screen.findByText('이미 받은 검증된 답변',{selector:'.sr-only'});await screen.findByText(/방금 받은 답변은 그대로 남아 있어요/);
    expect(screen.queryByRole('status')).toBeNull();expect(screen.queryByRole('button',{name:'이 이야기 다시 보내기'})).toBeNull();expect(mocked.execute).toHaveBeenCalledTimes(1);
  });
  it('retries a confirmed stored user message as RETRY_RESPONSE while preserving the next draft',async()=>{
    let reject!:(reason:unknown)=>void;
    mocked.execute.mockReturnValueOnce(new Promise((_resolve,no)=>{reject=no;})).mockResolvedValueOnce({ok:true,data:{conversationId:'conversation-1',consultationId:'reading-1',userMessage:{id:'stored-user'},assistantMessage:{id:'recovered-answer',content:'다시 받은 답변'}}});
    mount();const input=screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(input,{target:{value:'저장된 원래 질문'}});fireEvent.click(screen.getByRole('button',{name:'이야기 보내기'}));await waitFor(()=>expect(mocked.execute).toHaveBeenCalledTimes(1));
    fireEvent.change(input,{target:{value:'보존할 다음 초안'}});
    await act(async()=>reject(Object.assign(new ServiceError('LLM_INVALID_RESPONSE','legacy internal JSON message'),{code:'LLM_INVALID_RESPONSE',details:{userMessageId:'stored-user',conversationId:'conversation-1',consultationId:'reading-1'}})));
    expect(screen.getByRole('alert').textContent).toContain('답변을 완성하지 못했어요.');expect(screen.getByRole('alert').textContent).not.toContain('JSON');
    fireEvent.click(screen.getByRole('button',{name:'이어서 듣기'}));await screen.findByText('다시 받은 답변',{selector:'.sr-only'});
    expect(mocked.execute.mock.calls[1][1]).toMatchObject({action:'RETRY_RESPONSE',userMessageId:'stored-user'});expect(mocked.execute.mock.calls[1][1]).not.toHaveProperty('message');
    expect(mocked.execute.mock.calls[1][1].requestId).not.toBe(mocked.execute.mock.calls[0][1].requestId);
    expect(screen.getAllByText('저장된 원래 질문',{selector:'.message-user .sr-only'})).toHaveLength(1);expect(input.value).toBe('보존할 다음 초안');
  });
  it('manually replays an uncertain SEND with its original text and UUID without erasing newer input',async()=>{
    let reject!:(reason:unknown)=>void;
    mocked.execute.mockReturnValueOnce(new Promise((_resolve,no)=>{reject=no;})).mockRejectedValueOnce(Object.assign(new Error('두 번째 연결 실패'),{code:'NETWORK_ERROR'})).mockResolvedValueOnce({ok:true,data:{conversationId:'conversation-1',consultationId:'reading-1',userMessage:{id:'same-user'},assistantMessage:{id:'same-answer',content:'확인된 답변'}}});
    mount();const input=screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(input,{target:{value:'원래 전송 의도'}});fireEvent.click(screen.getByRole('button',{name:'이야기 보내기'}));await waitFor(()=>expect(mocked.execute).toHaveBeenCalledTimes(1));
    fireEvent.change(input,{target:{value:'대기 중 새로 적은 초안'}});await act(async()=>reject(Object.assign(new Error('첫 연결 실패'),{code:'NETWORK_ERROR'})));
    fireEvent.click(screen.getByRole('button',{name:'이 이야기 다시 보내기'}));await screen.findByText('두 번째 연결 실패');
    fireEvent.click(screen.getByRole('button',{name:'이 이야기 다시 보내기'}));await screen.findByText('확인된 답변',{selector:'.sr-only'});
    expect(new Set(mocked.execute.mock.calls.map(([,payload])=>payload.requestId)).size).toBe(1);
    expect(mocked.execute.mock.calls.every(([,payload])=>payload.action==='SEND'&&payload.message==='원래 전송 의도')).toBe(true);
    expect(input.value).toBe('대기 중 새로 적은 초안');expect(screen.getAllByText('원래 전송 의도',{selector:'.message-user .sr-only'})).toHaveLength(1);
  });
  it('preserves two intentional identical sends with different request identities',async()=>{
    let index=0;
    mocked.execute.mockImplementation(async(_endpoint,payload)=>{index++;return {ok:true,data:{conversationId:'conversation-1',consultationId:'reading-1',userMessage:{id:`same-text-user-${index}`},assistantMessage:{id:`same-text-answer-${index}`,content:`답변 ${index}`}},meta:{requestId:payload.requestId}};});
    mount();const input=screen.getByRole('textbox');
    for(let i=1;i<=2;i++){fireEvent.change(input,{target:{value:'같은 말'}});fireEvent.click(screen.getByRole('button',{name:'이야기 보내기'}));await screen.findByText(`답변 ${i}`,{selector:'.sr-only'});}
    expect(screen.getAllByText('같은 말',{selector:'.message-user .sr-only'})).toHaveLength(2);expect(mocked.execute.mock.calls[0][1].requestId).not.toBe(mocked.execute.mock.calls[1][1].requestId);
  });
  it.each([false,true])('accepts a saved user and answer after a lost response without another model request (new draft: %s)',async(newDraft)=>{
    let fail!:(reason:unknown)=>void;
    mocked.execute.mockImplementationOnce((_endpoint,payload)=>{
      mocked.messages.mockResolvedValue([
        message({id:'stored-after-loss',sender:'USER',content:'응답은 저장된 원문',request_id:payload.requestId}),
        message({id:'answer-after-loss',sender:'ASSISTANT',content:'재조회로 확인한 실제 저장 답변',request_id:payload.requestId,reply_to_message_id:'stored-after-loss'}),
      ]);
      return new Promise((_resolve,reject)=>{fail=reject;});
    });
    mount();const input=screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(input,{target:{value:'응답은 저장된 원문'}});fireEvent.click(screen.getByRole('button',{name:'이야기 보내기'}));await waitFor(()=>expect(mocked.execute).toHaveBeenCalledTimes(1));
    if(newDraft)fireEvent.change(input,{target:{value:'다음에 이어갈 내용'}});
    await act(async()=>fail(Object.assign(new Error('HTTP 응답 유실'),{code:'NETWORK_ERROR'})));
    await screen.findByText('재조회로 확인한 실제 저장 답변',{selector:'.sr-only'});
    await waitFor(()=>expect(screen.queryByRole('button',{name:'이 이야기 다시 보내기'})).toBeNull());
    expect(screen.queryByRole('alert')).toBeNull();expect(screen.queryByRole('status')).toBeNull();expect(mocked.execute).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText('응답은 저장된 원문',{selector:'.message-user .sr-only'})).toHaveLength(1);
    expect(input.value).toBe(newDraft?'다음에 이어갈 내용':'');
    mocked.execute.mockResolvedValueOnce({ok:true,data:{conversationId:'conversation-1',consultationId:'reading-1',userMessage:{id:'intentional-second-user'},assistantMessage:{id:'intentional-second-answer',content:'같은 문장을 새로 보낸 답변'}}});
    fireEvent.change(input,{target:{value:'응답은 저장된 원문'}});fireEvent.click(screen.getByRole('button',{name:'이야기 보내기'}));await screen.findByText('같은 문장을 새로 보낸 답변',{selector:'.sr-only'});
    expect(mocked.execute.mock.calls[1][1].requestId).not.toBe(mocked.execute.mock.calls[0][1].requestId);
    expect(screen.getAllByText('응답은 저장된 원문',{selector:'.message-user .sr-only'})).toHaveLength(2);
  });
  it('drops a pending turn on explicit consultation navigation and ignores its late response',async()=>{
    let answer!:(value:unknown)=>void;mocked.execute.mockReturnValue(new Promise(resolve=>{answer=resolve;}));
    mount('/chat/bomi?conversation=conversation-1&consultation=reading-a',<Link to="/chat/bomi?conversation=conversation-1&consultation=reading-b">다른 상담으로</Link>);
    fireEvent.change(screen.getByRole('textbox'),{target:{value:'A에게만 속하는 질문'}});fireEvent.click(screen.getByRole('button',{name:'이야기 보내기'}));await waitFor(()=>expect(mocked.execute).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('link',{name:'다른 상담으로'}));expect(screen.queryByRole('status')).toBeNull();expect(screen.queryByText('A에게만 속하는 질문',{selector:'.sr-only'})).toBeNull();
    await act(async()=>answer({ok:true,data:{conversationId:'conversation-1',consultationId:'reading-a',assistantMessage:{id:'late-a',content:'A의 늦은 응답'}}}));
    expect(screen.queryByText('A의 늦은 응답')).toBeNull();expect(screen.queryByRole('status')).toBeNull();
  });
  it('follows a new send but does not pull a reader down when the answer arrives after scrolling up',async()=>{
    let answer!:(value:unknown)=>void;mocked.execute.mockReturnValue(new Promise(resolve=>{answer=resolve;}));const {container}=mount();
    const scroller=container.querySelector('.chat-messages') as HTMLDivElement;
    Object.defineProperty(scroller,'scrollHeight',{configurable:true,value:2000});Object.defineProperty(scroller,'clientHeight',{configurable:true,value:400});
    scroller.scrollTop=0;fireEvent.scroll(scroller);vi.mocked(Element.prototype.scrollTo).mockClear();
    fireEvent.change(screen.getByRole('textbox'),{target:{value:'아래로 보낼 새 이야기'}});fireEvent.click(screen.getByRole('button',{name:'이야기 보내기'}));
    expect(scroller.scrollTo).toHaveBeenCalledWith(expect.objectContaining({top:2000}));await waitFor(()=>expect(mocked.execute).toHaveBeenCalledTimes(1));
    scroller.scrollTop=100;fireEvent.scroll(scroller);vi.mocked(Element.prototype.scrollTo).mockClear();
    await act(async()=>answer({ok:true,data:{conversationId:'conversation-1',consultationId:'reading-1',assistantMessage:{id:'no-scroll-answer',content:'읽던 위치를 지킬 답변'}}}));
    expect(screen.getByText('읽던 위치를 지킬 답변',{selector:'.sr-only'})).toBeTruthy();expect(scroller.scrollTo).not.toHaveBeenCalled();
  });
  it('ignores a late daily result after leaving chat for the history/delete flow',async()=>{
    let complete!:(value:unknown)=>void;mocked.execute.mockReturnValue(new Promise(resolve=>{complete=resolve;}));
    mocked.conversation.mockImplementation(async(id:string)=>({id,character_id:'BOMI'}));
    mount();fireEvent.click(screen.getByRole('button',{name:'오늘의 한 장'}));fireEvent.click(screen.getByText('오늘의 카드 만나기'));
    await waitFor(()=>expect(mocked.execute).toHaveBeenCalledTimes(1));fireEvent.click(screen.getByRole('link',{name:'나의 기록'}));
    await screen.findByRole('heading',{name:'기록 화면'});
    await act(async()=>{complete({ok:true,data:{...group,conversationId:'original-conversation',mode:'DAILY'}});});
    expect(screen.getByRole('heading',{name:'기록 화면'})).toBeTruthy();expect(mocked.conversation).not.toHaveBeenCalledWith('original-conversation');
  });
  it('preserves a NOT_FOUND draft but stops retrying a deleted consultation until a new story is explicitly chosen',async()=>{
    mocked.execute.mockRejectedValueOnce(Object.assign(new ServiceError('NOT_FOUND','삭제된 상담이에요.',false),{code:'NOT_FOUND'})).mockResolvedValueOnce({ok:true,data:{conversationId:'fresh-conversation',consultationId:'fresh-reading',assistantMessage:{id:'fresh-answer',content:'fixture only'}}});
    mocked.create.mockResolvedValue({id:'fresh-conversation',character_id:'BOMI'});
    mount('/chat/bomi?conversation=conversation-1&consultation=deleted-reading');
    const input=screen.getByRole('textbox',{name:'보미에게 보낼 이야기'}) as HTMLTextAreaElement;
    fireEvent.change(input,{target:{value:'사라지면 안 되는 초안'}});fireEvent.click(screen.getByRole('button',{name:'이야기 보내기'}));
    await waitFor(()=>expect(mocked.execute).toHaveBeenCalledTimes(1));await waitFor(()=>expect(screen.queryByRole('status')).toBeNull());
    expect(input.value).toBe('사라지면 안 되는 초안');expect((screen.getByRole('button',{name:'이야기 보내기'}) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(input,{key:'Enter'});expect(mocked.execute).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button',{name:'새 이야기로 이어가기'}));
    await waitFor(()=>expect((screen.getByRole('button',{name:'이야기 보내기'}) as HTMLButtonElement).disabled).toBe(false));expect(input.value).toBe('사라지면 안 되는 초안');
    fireEvent.click(screen.getByRole('button',{name:'이야기 보내기'}));await waitFor(()=>expect(mocked.execute).toHaveBeenCalledTimes(2));
    expect(mocked.execute.mock.calls[1][1]).toMatchObject({conversationId:'fresh-conversation',consultationId:null,message:'사라지면 안 되는 초안'});expect(mocked.execute.mock.calls[1][1].requestId).not.toBe(mocked.execute.mock.calls[0][1].requestId);
  });

  it('switches explicit reading context without replaying an unresolved request into the former consultation',async()=>{
    mocked.execute.mockRejectedValueOnce(Object.assign(new Error('A 응답 유실'),{code:'NETWORK_ERROR'})).mockResolvedValueOnce({ok:true,data:{consultationId:'reading-b',assistantMessage:{id:'reply-b',content:'fixture response'}}});
    mount('/chat/bomi?conversation=conversation-1&consultation=reading-a',<Link to="/chat/bomi?conversation=conversation-1&consultation=reading-b">상담 B 선택</Link>);
    const input=screen.getByRole('textbox',{name:'보미에게 보낼 이야기'}) as HTMLTextAreaElement;fireEvent.change(input,{target:{value:'두 상담에 같은 질문'}});fireEvent.click(screen.getByRole('button',{name:'이야기 보내기'}));await screen.findByText(/A 응답 유실/);
    fireEvent.click(screen.getByRole('link',{name:'상담 B 선택'}));await waitFor(()=>expect(screen.queryByText(/A 응답 유실/)).toBeNull());fireEvent.click(screen.getByRole('button',{name:'이야기 보내기'}));
    await waitFor(()=>expect(mocked.execute).toHaveBeenCalledTimes(2));const [first,second]=mocked.execute.mock.calls.map(([,body])=>body);expect(first.consultationId).toBe('reading-a');expect(second.consultationId).toBe('reading-b');expect(second.requestId).not.toBe(first.requestId);
  });
  it('reuses the original SEND after two lost responses and a restored consultation without duplicating the message',async()=>{
    const saved=new Map<string,object>();const transportIds:string[]=[];let lose=true;
    mocked.execute.mockImplementation(async(_endpoint:string,payload:Record<string,unknown>)=>{
      const transport=async()=>{const requestId=String(payload.requestId);transportIds.push(requestId);if(!saved.has(requestId)){saved.set(requestId,message({id:`saved-user-${saved.size+1}`,sender:'USER',content:payload.message,request_id:requestId,metadata:{}}));mocked.messages.mockResolvedValue([...saved.values()]);}if(lose)throw Object.assign(new Error('응답을 확인하지 못했어요'),{code:'NETWORK_ERROR'});return {ok:true,data:{consultationId:'reading-1',assistantMessage:{id:'reply-1',content:'fixture response'}}};};
      try{return await transport();}catch{return transport();}
    });
    mount();const input=screen.getByRole('textbox',{name:'보미에게 보낼 이야기'}) as HTMLTextAreaElement;fireEvent.change(input,{target:{value:'같은 질문을 이어서 보내기'}});fireEvent.click(screen.getByRole('button',{name:'이야기 보내기'}));
    await screen.findAllByText(/응답을 확인하지 못했어요/);await screen.findByText('같은 질문을 이어서 보내기',{selector:'.sr-only'});await waitFor(()=>expect((screen.getByRole('button',{name:'이야기 보내기'}) as HTMLButtonElement).disabled).toBe(false));
    expect(input.value).toBe('같은 질문을 이어서 보내기');expect(transportIds).toHaveLength(2);lose=false;fireEvent.click(screen.getByRole('button',{name:'이야기 보내기'}));
    await waitFor(()=>expect(input.value).toBe(''));expect(saved.size).toBe(1);expect(new Set(transportIds).size).toBe(1);expect(mocked.execute.mock.calls[1][1].consultationId).toBeNull();
  });
  it('coalesces persisted draw and interpretation messages into one immutable card group',async()=>{mocked.messages.mockResolvedValue([message({metadata:{tarot:group}}),message({id:'assistant-1',sender:'ASSISTANT',content:'저장된 카드의 해석이에요.',metadata:{tarot:{...group,executionStatus:'SUCCEEDED',interpretation:{messageId:'assistant-1',content:'저장된 카드의 해석이에요.'}}}})]);mount();await screen.findAllByText('저장된 카드의 해석이에요.');expect(screen.getAllByAltText('The Fool, 정방향')).toHaveLength(1);expect(screen.queryByText('카드는 안전하게 저장됐어요. 해석을 다시 받아도 같은 카드를 사용해요.')).toBeNull();expect(mocked.execute).not.toHaveBeenCalled();});
  it('retries interpretation with only the existing resource identifier',async()=>{mocked.messages.mockResolvedValue([message({metadata:{tarot:group}})]);mocked.execute.mockResolvedValue({ok:true,data:group});mount();const retry=await screen.findByRole('button',{name:'해석 다시 받기'});fireEvent.click(retry);await waitFor(()=>expect(mocked.execute).toHaveBeenCalledWith('tarot',expect.objectContaining({action:'RETRY_INTERPRETATION',conversationId:'conversation-1',drawGroupId:'draw-1'}),{expectedUserId:'user-1'}));expect(mocked.execute.mock.calls[0]?.[1]).not.toHaveProperty('cards');});
  it('retains a chat draft when the request has no confirmed saved message',async()=>{mocked.execute.mockRejectedValue(new Error('연결 실패'));mount();const input=screen.getByRole('textbox',{name:'보미에게 보낼 이야기'}) as HTMLTextAreaElement;fireEvent.change(input,{target:{value:'네트워크가 끊겨도 남길 이야기'}});fireEvent.click(screen.getByRole('button',{name:'이야기 보내기'}));await screen.findByText('연결 실패',{exact:false});expect(input.value).toBe('네트워크가 끊겨도 남길 이야기');expect(mocked.execute).toHaveBeenCalledWith('chat',expect.objectContaining({action:'SEND',message:'네트워크가 끊겨도 남길 이야기'}),{expectedUserId:'user-1'});});
  it('requires an authenticated anonymous session before sending',()=>{mocked.session=null;mount();expect((screen.getByRole('button',{name:'이야기 보내기'}) as HTMLButtonElement).disabled).toBe(true);expect(screen.getByRole('link',{name:/보미와 처음 이야기하기/})).toBeTruthy();expect(mocked.execute).not.toHaveBeenCalled();});
  it('does not collect birth details while full Saju is unavailable',async()=>{mount();fireEvent.click(screen.getByRole('button',{name:'사주'}));expect(await screen.findByText(/사주 상담을 준비하고 있어요/)).toBeTruthy();expect(screen.queryByLabelText('생년월일')).toBeNull();expect(mocked.execute).not.toHaveBeenCalled();});
  it('submits relationship Tarot to its own compatibility action with an alias',async()=>{mocked.execute.mockResolvedValue({ok:true,data:group});mount();fireEvent.click(screen.getByRole('button',{name:'궁합'}));fireEvent.change(screen.getByPlaceholderText('이름 대신 별칭도 좋아요'),{target:{value:'소중한 친구'}});fireEvent.click(screen.getByText('관계 타로 세 장 펼치기'));await waitFor(()=>expect(mocked.execute).toHaveBeenCalledWith('compatibility',expect.objectContaining({action:'DRAW_TAROT',targetPersonAlias:'소중한 친구',conversationId:'conversation-1'}),{expectedUserId:'user-1'}));});
  it('moves a daily result back to its original owned conversation before any follow-up',async()=>{mocked.execute.mockResolvedValue({ok:true,data:{...group,conversationId:'original-conversation',mode:'DAILY'}});mocked.conversation.mockImplementation(async(id:string)=>({id,character_id:id==='original-conversation'?'SANI':'BOMI'}));mount();fireEvent.click(screen.getByRole('button',{name:'오늘의 한 장'}));fireEvent.click(screen.getByText('오늘의 카드 만나기'));await screen.findByRole('textbox',{name:'산이에게 보낼 이야기'});expect(mocked.conversation).toHaveBeenCalledWith('original-conversation');await waitFor(()=>expect(mocked.messages).toHaveBeenCalledWith('original-conversation'));});
  it('restores an unsent draft after remount and never shares it across users',async()=>{let view=mount();const input=screen.getByRole('textbox',{name:'보미에게 보낼 이야기'});fireEvent.change(input,{target:{value:'아직 보내지 않은 마음'}});view.unmount();view=mount();expect((screen.getByRole('textbox',{name:'보미에게 보낼 이야기'}) as HTMLTextAreaElement).value).toBe('아직 보내지 않은 마음');view.unmount();mocked.session={user:{id:'another-user'}};mount();expect((screen.getByRole('textbox',{name:'보미에게 보낼 이야기'}) as HTMLTextAreaElement).value).toBe('');});
  it('does not erase new text typed while a previous message is being answered',async()=>{let complete!:(value:unknown)=>void;mocked.execute.mockReturnValue(new Promise((resolve)=>{complete=resolve;}));mount();const input=screen.getByRole('textbox',{name:'보미에게 보낼 이야기'}) as HTMLTextAreaElement;fireEvent.change(input,{target:{value:'먼저 보낼 이야기'}});fireEvent.click(screen.getByRole('button',{name:'이야기 보내기'}));await waitFor(()=>expect(mocked.execute).toHaveBeenCalled());fireEvent.change(input,{target:{value:'다음에 보낼 다른 이야기'}});complete({ok:true,data:{conversationId:'conversation-1',consultationId:'reading-1',assistantMessage:{id:'answer-1',content:'잘 들었어.'}}});await waitFor(()=>expect((screen.getByRole('button',{name:'이야기 보내기'}) as HTMLButtonElement).disabled).toBe(false));expect(input.value).toBe('다음에 보낼 다른 이야기');});
  it('restores a partial Saju snapshot and retries its interpretation without birth inputs',async()=>{const saju={executionStatus:'PARTIAL',conversationId:'conversation-1',consultationId:'reading-1',readingId:'saju-1',interpretation:null};mocked.messages.mockResolvedValue([message({type:'SAJU_SNAPSHOT',metadata:{saju}})]);mocked.execute.mockResolvedValue({ok:true,data:saju});mount();await screen.findByText('원국과 계산 결과는 저장되었어요. 해석을 다시 받아도 저장된 결과를 그대로 사용해요.');fireEvent.click(screen.getByRole('button',{name:'사주 해석 다시 받기'}));await waitFor(()=>expect(mocked.execute).toHaveBeenCalledWith('saju',expect.objectContaining({action:'RETRY_INTERPRETATION',conversationId:'conversation-1',readingId:'saju-1'}),{expectedUserId:'user-1'}));expect(mocked.execute.mock.calls[0][1]).not.toHaveProperty('subject');});
  it('coalesces a saved Saju calculation and successful interpretation into one inline result',async()=>{const saju={executionStatus:'PARTIAL',consultationId:'reading-1',readingId:'saju-1'};mocked.messages.mockResolvedValue([message({type:'SAJU_SNAPSHOT',metadata:{saju}}),message({id:'saju-interpretation',sender:'ASSISTANT',content:'저장한 원국의 해석',metadata:{saju:{...saju,executionStatus:'SUCCEEDED',interpretation:{messageId:'saju-interpretation',content:'저장한 원국의 해석'}}}})]);mount();await screen.findAllByText('저장한 원국의 해석');expect(screen.getAllByLabelText('저장된 사주 결과')).toHaveLength(1);expect(screen.queryByText('원국과 계산 결과는 저장되었어요. 해석을 다시 받아도 저장된 결과를 그대로 사용해요.')).toBeNull();});
  it('opens a recommended spread with its original question without silently drawing cards',async()=>{mocked.execute.mockResolvedValue({ok:true,data:{conversationId:'conversation-1',consultationId:'reading-1',assistantMessage:{id:'answer-1',content:'선택을 함께 살펴보자.'},recommendation:{recommendedTools:[{tool:'TAROT',mode:'DECISION_3',reason:'지금 선택의 추진력과 위험을 살펴볼 수 있어요.',missingSlots:[]}]}}});mount();fireEvent.change(screen.getByRole('textbox',{name:'보미에게 보낼 이야기'}),{target:{value:'이번 프로젝트를 맡을지 고민이야'}});fireEvent.click(screen.getByRole('button',{name:'이야기 보내기'}));fireEvent.click(await screen.findByRole('button',{name:'선택의 타로 살펴보기'}));expect(screen.getByRole('button',{name:/선택의 세 장/,hidden:true}).getAttribute('aria-pressed')).toBe('true');expect((screen.getByPlaceholderText('요즘 마음에 걸리는 이야기를 적어주세요.') as HTMLTextAreaElement).value).toBe('이번 프로젝트를 맡을지 고민이야');expect(mocked.execute).toHaveBeenCalledTimes(1);expect(screen.getByRole('button',{name:'타로'})).toBeTruthy();});
  it('restores a saved recommendation and its original user question',async()=>{mocked.messages.mockResolvedValue([message({id:'question-1',sender:'USER',content:'저장된 선택 질문',metadata:{}}),message({id:'answer-1',sender:'ASSISTANT',reply_to_message_id:'question-1',content:'저장된 답변',metadata:{recommendation:{recommendedTools:[{tool:'TAROT',mode:'DECISION_3',reason:'저장된 추천 이유',missingSlots:[]}]}}})]);mount();fireEvent.click(await screen.findByRole('button',{name:'선택의 타로 살펴보기'}));expect((screen.getByPlaceholderText('요즘 마음에 걸리는 이야기를 적어주세요.') as HTMLTextAreaElement).value).toBe('저장된 선택 질문');expect(mocked.execute).not.toHaveBeenCalled();});
  it('keeps the consultation selected from a reading instead of adopting another latest conversation message',async()=>{mocked.messages.mockResolvedValue([message({id:'old-answer',sender:'ASSISTANT',consultation_id:'older-reading',content:'이전 상담의 답변',metadata:{recommendation:{recommendedTools:[{tool:'TAROT',mode:'DECISION_3',reason:'이전 상담 추천',missingSlots:[]}]}}}),message({id:'last-answer',sender:'ASSISTANT',consultation_id:'new-reading',content:'다른 상담의 최근 답변',metadata:{}})]);mocked.execute.mockResolvedValue({ok:true,data:{conversationId:'conversation-1',consultationId:'older-reading',assistantMessage:{id:'new-answer',content:'계속 이야기해보자.'},recommendation:null}});mount('/chat/bomi?conversation=conversation-1&consultation=older-reading');await screen.findByRole('button',{name:'선택의 타로 살펴보기'});fireEvent.change(screen.getByRole('textbox',{name:'보미에게 보낼 이야기'}),{target:{value:'이 상담을 이어서 이야기할게'}});fireEvent.click(screen.getByRole('button',{name:'이야기 보내기'}));await waitFor(()=>expect(mocked.execute).toHaveBeenCalledWith('chat',expect.objectContaining({consultationId:'older-reading'}),{expectedUserId:'user-1'}));});
  it('retries persisted compatibility interpretation using only its target identifier',async()=>{const compatibility={executionStatus:'PARTIAL',conversationId:'conversation-1',consultationId:'reading-1',compatibilityReadingId:'compatibility-1',summary:{dayMasterRelation:null},uncertaintyFlags:[],interpretation:null};mocked.messages.mockResolvedValue([message({type:'COMPATIBILITY_SNAPSHOT',metadata:{compatibility}})]);mocked.execute.mockResolvedValue({ok:true,data:compatibility});mount();fireEvent.click(await screen.findByRole('button',{name:'궁합 해석 다시 받기'}));await waitFor(()=>expect(mocked.execute).toHaveBeenCalledWith('compatibility',expect.objectContaining({action:'RETRY_INTERPRETATION',conversationId:'conversation-1',targetType:'SAJU',targetId:'compatibility-1'}),{expectedUserId:'user-1'}));expect(mocked.execute.mock.calls[0][1]).not.toHaveProperty('personB');});
  it('prepends older messages, deduplicates an overlapping cursor page and preserves scroll position',async()=>{
    const cursor={createdAt:'2026-09-20T00:00:00Z',id:'recent-message'};
    const recent=message({id:'recent-message',sender:'USER',content:'최근에 나눈 이야기',metadata:{}});
    mocked.pages.mockResolvedValueOnce({items:[recent],nextCursor:cursor}).mockResolvedValueOnce({items:[message({id:'older-message',sender:'USER',content:'아주 이전의 이야기',created_at:'2026-09-19T00:00:00Z',metadata:{}}),{...recent,content:'겹친 페이지의 낡은 내용'}],nextCursor:null});
    const {container}=mount();await screen.findByText('최근에 나눈 이야기',{selector:'.sr-only'});
    const scroller=container.querySelector('.chat-messages') as HTMLDivElement;
    Object.defineProperty(scroller,'scrollHeight',{configurable:true,get:()=>screen.queryAllByText('아주 이전의 이야기').length?1400:700});
    scroller.scrollTop=120;fireEvent.scroll(scroller);
    fireEvent.click(screen.getByRole('button',{name:'이전 메시지 더 보기'}));
    await screen.findByText('아주 이전의 이야기',{selector:'.sr-only'});
    expect(mocked.pages).toHaveBeenLastCalledWith('conversation-1',cursor);
    expect(screen.getAllByText('최근에 나눈 이야기',{selector:'.sr-only'})).toHaveLength(1);
    expect(screen.queryByText('겹친 페이지의 낡은 내용')).toBeNull();
    expect(scroller.scrollTop).toBe(820);
    expect(screen.queryByRole('button',{name:'이전 메시지 더 보기'})).toBeNull();
  });
  it.each([true,false])('shows the anonymous account reminder only for a configured Google provider: %s',async(enabled)=>{
    mocked.session={user:{id:'user-1',is_anonymous:true}};mocked.providers.google=enabled;
    mocked.messages.mockResolvedValue([message({id:'answer-1',sender:'ASSISTANT',content:'저장된 대화 응답',metadata:{}})]);
    mount();await screen.findAllByText('저장된 대화 응답');
    expect(!!screen.queryByRole('link',{name:/Google로 계정 연결/})).toBe(enabled);
    expect(screen.queryByRole('link',{name:/이메일로 계정 연결/})).toBeNull();
  });

});
