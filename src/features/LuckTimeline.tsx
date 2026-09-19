import type { FullSajuResult } from '../../supabase/functions/_shared/domain/full-saju';
import type { LuckPeriodSummary } from '../../supabase/functions/_shared/domain/fortune-timing';
import { Notice } from '../components/ui';
type Timing=FullSajuResult['timing'];
const civil=(value:string)=>value.replaceAll('-','.');
export function CurrentLuck({timing,compact=false}:{timing:Timing;compact?:boolean}){
 const luck=timing?.luck;
 if(!luck)return null;
 const period=luck.currentPeriod;
 const pillar=luck.currentPillar;
 const message=timing?.activeDaewoonStatus==='NO_ACTIVE_PERIOD'?'아직 첫 대운이 시작되기 전이에요.':timing?.activeDaewoonStatus==='OUTSIDE_COMPUTED_RANGE'?'현재 날짜가 저장된 대운의 계산 범위를 벗어나요.':timing?.activeDaewoonStatus==='UNRESOLVED'?'현재 대운을 확정할 정보가 부족해요.':!period?'출생 정보에 따라 대운의 날짜 경계에 여러 가능성이 있어요.':null;
 return <div className={`current-luck ${compact?'compact':''}`} aria-label="현재 대운"><small>현재 대운 · {civil(luck.asOfLocalDate)} 기준</small>{pillar&&<strong>{pillar.heavenlyStem}{pillar.earthlyBranch}</strong>}{period?<p>{civil(period.startDate)} 시작<br/>다음 대운 {civil(period.endDate)}</p>:message&&<p>{message}</p>}{pillar&&!period&&<p>현재의 기운은 같아도 시작·전환 날짜는 달라질 수 있어요.</p>}<span>출생도시의 현지 날짜 기준</span></div>;
}
function Boundary({label,date,range}:{label:string;date:string|null;range:LuckPeriodSummary['startDateRange']}){return <div className="luck-boundary"><small>{label}</small>{date?<span>{civil(date)}</span>:<span>{civil(range.earliest)}<br/><i>~ {civil(range.latest)}</i></span>}</div>;}
export function LuckTimeline({timing}:{timing:Timing}){
 const luck=timing?.luck;if(!luck)return null;
 const ranged=luck.periods.some(period=>period.startDate===null||period.endDate===null);
 return <>{ranged&&<Notice>날짜 범위는 가능한 경계 중 가장 이른 날과 늦은 날이에요. 그 사이의 모든 날짜를 뜻하지는 않아요.</Notice>}<div className="luck-date-timeline" aria-label="저장된 대운 날짜">{luck.periods.map(period=><article key={period.index} className={luck.currentPeriod?.index===period.index?'current':''} aria-label={`${period.index+1}번째 대운${luck.currentPeriod?.index===period.index?' · 현재':''}`}><small>{luck.currentPeriod?.index===period.index?'현재':`${period.index+1}번째 흐름`}</small><strong>{period.pillar?`${period.pillar.heavenlyStem}${period.pillar.earthlyBranch}`:'미확정'}</strong><Boundary label="시작" date={period.startDate} range={period.startDateRange}/><Boundary label="다음 대운" date={period.endDate} range={period.endDateRange}/></article>)}</div><p className="section-note">전환일은 날짜 단위로 살펴봐요. 특정 시각을 확정한 결과는 아니에요.</p></>;
}
