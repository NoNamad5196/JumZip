import { useEffect, useState } from 'react';
import { PERSONA_UI_COPY } from '../../supabase/functions/_shared/persona/config';
import { characterFor, type CharacterId } from '../components/characters';
import { Avatar, Notice } from '../components/ui';
export const personaCopy=(characterId:CharacterId)=>PERSONA_UI_COPY[characterId];
export function PendingPersona({characterId}:{characterId:CharacterId}) {
  const [long,setLong]=useState(false);
  useEffect(()=>{const timer=setTimeout(()=>setLong(true),20000);return()=>clearTimeout(timer);},[]);
  const character=characterFor(characterId);
  return <article className="message message-assistant message-pending" role="status">
    <Avatar character={character} size="small"/>
    <div className="message-body"><div className="message-label">{character.name}</div>
      <div className="typing-bubble"><span className="loading-dots" aria-hidden="true"><i/><i/><i/></span><span className="sr-only">{personaCopy(characterId).thinking}</span></div>
      {long&&<p className="pending-long-wait">{personaCopy(characterId).longWait}</p>}
    </div>
  </article>;
}
export function ErrorPersona({characterId,message,code,details}:{characterId:CharacterId;message:string;code?:string;details?:Record<string,unknown>}) {
  const copy=personaCopy(characterId);
  const budgetExceeded=code==='LLM_BUDGET_EXCEEDED'||code==='LLM_UNAVAILABLE'&&details?.reason==='LLM_BUDGET_EXCEEDED';
  if(budgetExceeded)return <Notice tone="error">보조 AI의 이용 한도나 사용 기간을 확인해 주세요. 쓴 이야기는 남아 있어요.</Notice>;
  const rateLimited=code==='LLM_RATE_LIMITED'||code==='LLM_UNAVAILABLE'&&details?.reason==='LLM_RATE_LIMITED';
  if(rateLimited)return <Notice tone="error">AI 응답 요청이 제한되어 있어요. 제한이 해제된 뒤 다시 시도해 주세요.</Notice>;
  if(code&&['LLM_UNAVAILABLE','LLM_AUTH_FAILED','LLM_NOT_CONFIGURED'].includes(code))return <Notice tone="error">AI 응답 서비스를 이용할 수 없어 답변을 받지 못했어요.</Notice>;
  const intro=code?.includes('TIMEOUT')?copy.timeout:code==='NETWORK_ERROR'?copy.network:code==='TAROT_DRAW_FAILED'?copy.tarotError:code?.startsWith('SAFETY_')?copy.safety:null;
  const explanation=code==='LLM_INVALID_RESPONSE'?'답변을 완성하지 못했어요. 보낸 메시지에서 다시 시도해 주세요.':message;
  return <Notice tone="error">{intro&&<><strong>{intro}</strong><br/></>}{explanation}</Notice>;
}
