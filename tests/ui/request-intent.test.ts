// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearRequestIntents, executeIntent } from '../../src/features/request-intent';
import { clearDrafts } from '../../src/features/drafts';
const lost=()=>Object.assign(new Error('response lost'),{code:'NETWORK_ERROR'});
beforeEach(()=>{vi.stubGlobal('crypto',webcrypto);clearRequestIntents();sessionStorage.clear();});
afterEach(()=>vi.unstubAllGlobals());
describe('uncertain request transport continuity',()=>{
 it('cancels preparation after the account scope is cleared and does not recreate private pending state',async()=>{
  let complete!:(value:ArrayBuffer)=>void;const digest=vi.fn(()=>new Promise<ArrayBuffer>(resolve=>{complete=resolve;}));
  vi.stubGlobal('crypto',{randomUUID:webcrypto.randomUUID.bind(webcrypto),subtle:{digest}});
  const send=vi.fn().mockResolvedValue({});const request=executeIntent('user-1','chat',{action:'SEND',message:'old account draft'},send);
  clearRequestIntents('user-1');complete(new ArrayBuffer(32));
  await expect(request).rejects.toMatchObject({code:'REQUEST_CANCELLED'});expect(send).not.toHaveBeenCalled();expect(Object.keys(sessionStorage)).toEqual([]);
 });
 it('does not let an old account request erase the newer retry intent after signing back in',async()=>{
  let complete!:(value:unknown)=>void;const body={action:'SEND',message:'same draft'};
  const oldSend=vi.fn(()=>new Promise(resolve=>{complete=resolve;}));const oldRequest=executeIntent('user-1','chat',body,oldSend);
  await vi.waitFor(()=>expect(oldSend).toHaveBeenCalledTimes(1));clearRequestIntents('user-1');
  const currentSend=vi.fn().mockRejectedValueOnce(lost()).mockResolvedValueOnce({});
  await expect(executeIntent('user-1','chat',body,currentSend)).rejects.toThrow();complete({});await oldRequest;
  await executeIntent('user-1','chat',body,currentSend);
  expect(currentSend.mock.calls[1][0].requestId).toBe(currentSend.mock.calls[0][0].requestId);
 });
 it('releases a replay request after terminal NOT_FOUND instead of retaining a retryable transport intent',async()=>{
  const body={action:'SEND',conversationId:'conversation-1',consultationId:'deleted-reading',message:'retained draft'};
  const send=vi.fn().mockRejectedValueOnce(lost()).mockRejectedValueOnce(Object.assign(new Error('deleted'),{code:'NOT_FOUND',retryable:false})).mockResolvedValueOnce({});
  await expect(executeIntent('user-1','chat',body,send)).rejects.toThrow();await expect(executeIntent('user-1','chat',body,send)).rejects.toMatchObject({code:'NOT_FOUND'});
  expect(Object.keys(sessionStorage)).toEqual([]);await executeIntent('user-1','chat',body,send);
  expect(send.mock.calls[1][0].requestId).toBe(send.mock.calls[0][0].requestId);expect(send.mock.calls[2][0].requestId).not.toBe(send.mock.calls[1][0].requestId);
 });

 it.each([['tarot','DRAW'],['saju','CALCULATE'],['compatibility','DRAW_TAROT']])('replays %s after lost responses without creating a second resource, then allows a new explicit request',async(endpoint,action)=>{
  const resources=new Map<string,string>();const transportIds:string[]=[];let lose=true;
  const transport=async(payload:Record<string,unknown>)=>{const id=String(payload.requestId);transportIds.push(id);if(!resources.has(id))resources.set(id,`saved-${resources.size+1}`);if(lose)throw lost();return resources.get(id);};
  const send=async(payload:Record<string,unknown>)=>{try{return await transport(payload);}catch{return transport(payload);}};
  const body={action,conversationId:'conversation-1',consultationId:null,question:'Private original question',subject:{birthDate:'1990-01-02'}};
  await expect(executeIntent('user-1',endpoint,body,send,null)).rejects.toMatchObject({code:'NETWORK_ERROR'});
  expect(transportIds).toHaveLength(2);expect(new Set(transportIds).size).toBe(1);expect(resources.size).toBe(1);
  const persisted=Object.values(sessionStorage).join('');expect(persisted).not.toContain('Private original question');expect(persisted).not.toContain('1990-01-02');
  lose=false;expect(await executeIntent('user-1',endpoint,{...body,consultationId:'restored-reading'},send,null)).toBe('saved-1');expect(resources.size).toBe(1);
  await executeIntent('user-1',endpoint,body,send,null);expect(resources.size).toBe(2);
 });
 it('restores the request ID and original null consultation after a module reload',async()=>{
  const body={action:'SEND',conversationId:'conversation-1',consultationId:null,message:'unchanged draft'};const first=vi.fn().mockRejectedValue(lost());
  await expect(executeIntent('user-1','chat',body,first,null)).rejects.toThrow();vi.resetModules();const restored=await import('../../src/features/request-intent');const second=vi.fn().mockResolvedValue({});
  await restored.executeIntent('user-1','chat',{...body,consultationId:'newly-restored-reading'},second,null);
  expect(second.mock.calls[0][0]).toEqual(first.mock.calls[0][0]);
 });
 it.each([true,false])('separates an unresolved A request from explicitly selected B with identical text (context supplied: %s)',async(explicit)=>{
  const body={action:'SEND',conversationId:'conversation-1',consultationId:'reading-a',message:'same words'};const first=vi.fn().mockRejectedValue(lost());const second=vi.fn().mockResolvedValue({});
  await expect(executeIntent('user-1','chat',body,first,explicit?'reading-a':undefined)).rejects.toThrow();
  await executeIntent('user-1','chat',{...body,consultationId:'reading-b'},second,explicit?'reading-b':undefined);
  expect(second.mock.calls[0][0].requestId).not.toBe(first.mock.calls[0][0].requestId);expect(second.mock.calls[0][0].consultationId).toBe('reading-b');
 });
 it('does not reuse another identity, a changed question, or the explicit REDRAW action',async()=>{
  const first=vi.fn().mockRejectedValue(lost());const body={action:'DRAW',conversationId:'conversation-1',question:'first question'};await expect(executeIntent('user-1','tarot',body,first)).rejects.toThrow();
  const later=vi.fn().mockResolvedValue({});await executeIntent('user-2','tarot',body,later);await executeIntent('user-1','tarot',{...body,question:'another question'},later);await executeIntent('user-1','tarot',{action:'REDRAW',conversationId:'conversation-1',sourceDrawGroupId:'draw-1'},later);
  expect(new Set([first.mock.calls[0][0].requestId,...later.mock.calls.map(([p])=>p.requestId)]).size).toBe(4);
 });
 it('retains an in-progress request but clears it with the account drafts on logout',async()=>{
  const body={action:'SEND',conversationId:'conversation-1',message:'draft'};const fail=vi.fn().mockRejectedValue(Object.assign(new Error('pending'),{code:'REQUEST_IN_PROGRESS'}));
  await expect(executeIntent('user-1','chat',body,fail)).rejects.toThrow();clearDrafts('user-1');const next=vi.fn().mockResolvedValue({});await executeIntent('user-1','chat',body,next);expect(next.mock.calls[0][0].requestId).not.toBe(fail.mock.calls[0][0].requestId);
 });
});
