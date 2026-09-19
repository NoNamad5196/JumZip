import { useEffect, useState } from 'react';
import { PERSONA_UI_COPY } from '../../supabase/functions/_shared/persona/config';
import type { CharacterId } from '../components/characters';
import { Notice } from '../components/ui';
export const personaCopy=(characterId:CharacterId)=>PERSONA_UI_COPY[characterId];
export function PendingPersona({characterId}:{characterId:CharacterId}) {const [long,setLong]=useState(false);useEffect(()=>{const timer=setTimeout(()=>setLong(true),20000);return()=>clearTimeout(timer);},[]);return <div className="loading-message" role="status"><span className="loading-dots" aria-hidden="true"><i/><i/><i/></span>{long?personaCopy(characterId).longWait:personaCopy(characterId).thinking}</div>;}
export function ErrorPersona({characterId,message,code}:{characterId:CharacterId;message:string;code?:string}) {const copy=personaCopy(characterId);const intro=code?.includes('TIMEOUT')?copy.timeout:code==='NETWORK_ERROR'||code==='LLM_UNAVAILABLE'?copy.network:code==='TAROT_DRAW_FAILED'?copy.tarotError:code?.startsWith('SAFETY_')?copy.safety:null;return <Notice tone="error">{intro&&<><strong>{intro}</strong><br/></>}{message}</Notice>;}
