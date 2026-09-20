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
  const rateLimited=code==='LLM_UNAVAILABLE'&&details?.reason==='LLM_RATE_LIMITED';
  const intro=code?.includes('TIMEOUT')?copy.timeout:rateLimited?'AI 응답 요청이 현재 제한되어 있어요.':code==='NETWORK_ERROR'||code==='LLM_UNAVAILABLE'?copy.network:code==='TAROT_DRAW_FAILED'?copy.tarotError:code?.startsWith('SAFETY_')?copy.safety:null;
  const explanation=code==='LLM_INVALID_RESPONSE'?'답변을 완성하지 못했어요. 보낸 메시지에서 다시 시도해 주세요.':rateLimited?'잠시 후 다시 시도해 주세요.':message;
  return <Notice tone="error">{intro&&<><strong>{intro}</strong><br/></>}{explanation}</Notice>;
}
