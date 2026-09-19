// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { BirthInputForm, type BirthInputValue } from '../../src/features/BirthInput';
import { birthInputFromProfile } from '../../src/features/BirthProfiles';

const mocked=vi.hoisted(()=>({execute:vi.fn()}));
vi.mock('../../src/lib/service',()=>({service:{execute:mocked.execute}}));
vi.mock('../../src/features/session',()=>({errorMessage:(error:unknown)=>error instanceof Error?error.message:'오류'}));
const input:BirthInputValue={birthDate:'2000-02-29',birthTime:'08:30',birthTimeUnknown:false,calendarType:'SOLAR',leapMonth:false,gender:'FEMALE',location:{providerId:'1835848',name:'Seoul',country:'South Korea',latitude:37.5665,longitude:126.978,timezone:'Asia/Seoul'}};
beforeEach(()=>mocked.execute.mockReset());afterEach(cleanup);
describe('birth information consent and uncertainty',()=>{
  it('uses a selected saved location without another geocoding request and defaults to no profile save',async()=>{const submit=vi.fn();render(<MemoryRouter><BirthInputForm pending={false} initial={input} onSubmit={submit}/></MemoryRouter>);fireEvent.click(screen.getByRole('button',{name:'나의 사주 이야기'}));await waitFor(()=>expect(submit).toHaveBeenCalledWith(input,false));expect(mocked.execute).not.toHaveBeenCalled();});
  it('submits unknown time as null rather than keeping a previous known time',async()=>{const submit=vi.fn();render(<MemoryRouter><BirthInputForm pending={false} initial={input} onSubmit={submit}/></MemoryRouter>);fireEvent.click(screen.getByRole('switch',{name:/출생시간을 몰라요/}));fireEvent.click(screen.getByRole('button',{name:'나의 사주 이야기'}));await waitFor(()=>expect(submit).toHaveBeenCalledWith({...input,birthTime:null,birthTimeUnknown:true},false));});
  it('allows lunar day 30 independently of Gregorian browser date validity',async()=>{const submit=vi.fn();render(<MemoryRouter><BirthInputForm pending={false} initial={{...input,calendarType:'LUNAR',birthDate:'2000-02-30'}} onSubmit={submit}/></MemoryRouter>);const date=screen.getByPlaceholderText('YYYY-MM-DD') as HTMLInputElement;expect(date.type).toBe('text');expect(date.value).toBe('2000-02-30');fireEvent.click(screen.getByRole('button',{name:'나의 사주 이야기'}));await waitFor(()=>expect(submit).toHaveBeenCalledWith(expect.objectContaining({birthDate:'2000-02-30',calendarType:'LUNAR'}),false));});
  it('preserves saved timezone and coordinates when preparing an editable profile',()=>{expect(birthInputFromProfile({id:'profile-1',owner_type:'USER',related_person_id:null,calendar_type:'SOLAR',leap_month:false,birth_date:'2000-02-29',birth_time:'08:30:00',birth_time_unknown:false,birth_city:'Seoul',birth_country:'South Korea',location_provider_id:'1835848',latitude:37.5665,longitude:126.978,timezone:'Asia/Seoul',gender:'FEMALE'})).toEqual(input);});
});
