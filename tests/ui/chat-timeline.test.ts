import { describe,expect,it } from 'vitest';
import { mergeChatTimeline,type ChatTurn } from '../../src/features/chat-timeline';
import type { Message } from '../../src/lib/service';
const turn=(patch:Partial<ChatTurn>={}):ChatTurn=>({localId:'local-1',content:'같은 이야기',createdAt:'2026-09-20T00:00:00Z',conversationId:'conversation-1',consultationId:null,requestId:'request-1',delivery:'unknown',...patch});
const message=(patch:Partial<Message>={}):Message=>({id:'server-1',conversation_id:'conversation-1',consultation_id:'reading-1',sender:'USER',type:'CHAT',content:'같은 이야기',request_id:'request-1',reply_to_message_id:null,metadata:{},created_at:'2026-09-20T00:00:01Z',...patch});
describe('chat timeline identity reconciliation',()=>{
  it('joins a transport-unknown optimistic row with its saved user by request ID and sender',()=>{
    const result=mergeChatTimeline([message()], [turn()]);
    expect(result).toHaveLength(1);expect(result[0]).toMatchObject({id:'server-1',turnId:'local-1',delivery:'unknown',consultation_id:'reading-1'});
  });
  it('does not merge identical text from another request or another sender',()=>{
    const result=mergeChatTimeline([message(),message({id:'assistant-1',sender:'ASSISTANT'})],[turn({localId:'local-2',requestId:'request-2'})]);
    expect(result).toHaveLength(3);expect(result.filter(row=>row.sender==='USER')).toHaveLength(2);
  });
  it('reconciles both validated response rows by server identity after a reply-only retry',()=>{
    const completed=turn({userMessageId:'server-1',delivery:'complete',assistant:{id:'assistant-2',content:'검증된 응답',createdAt:'2026-09-20T00:00:03Z',requestId:'retry-2'}});
    const result=mergeChatTimeline([message(),message({id:'assistant-2',sender:'ASSISTANT',request_id:'retry-2',content:'검증된 응답'})],[completed]);
    expect(result).toHaveLength(2);expect(result.map(row=>row.id)).toEqual(['server-1','assistant-2']);
  });
  it('places a locally received reply next to its canonical user before a later user row',()=>{
    const completed=turn({userMessageId:'server-1',delivery:'complete',assistant:{id:'assistant-1',content:'첫 답변',createdAt:'2026-09-20T00:00:02Z',requestId:'request-1'}});
    const result=mergeChatTimeline([message(),message({id:'later-user',request_id:'request-2'})],[completed,turn({localId:'local-2',requestId:'request-2',delivery:'sending'})]);
    expect(result.map(row=>row.id)).toEqual(['server-1','assistant-1','later-user']);
  });
});
