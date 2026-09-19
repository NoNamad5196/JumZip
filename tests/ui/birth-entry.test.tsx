// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SajuEntryForm, RelatedBirthEntry } from '../../src/features/BirthEntry';
const mocked=vi.hoisted(()=>({births:vi.fn(),people:vi.fn(),execute:vi.fn()}));
vi.mock('../../src/lib/service',()=>({service:{listBirthProfiles:mocked.births,listRelatedPeople:mocked.people,execute:mocked.execute}}));
vi.mock('../../src/features/session',()=>({useSession:()=>({session:{user:{id:'user-1'}}}),errorMessage:(error:unknown)=>error instanceof Error?error.message:'오류'}));
const profile={id:'birth-1',owner_type:'USER',related_person_id:null,birth_date:'1992-10-24',birth_time:'05:30',unknown_birth_time:false,calendar_type:'SOLAR',leap_month:false,city:'서울',location_provider_id:'1835848'};
function mount(children:React.ReactNode){return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>);}
beforeEach(()=>{mocked.births.mockReset().mockResolvedValue([profile]);mocked.people.mockReset().mockResolvedValue([]);mocked.execute.mockReset();});afterEach(cleanup);
describe('saved birth information selection',()=>{
 it('passes only the saved own profile identifier without geocoding or silently calculating',async()=>{const selected=vi.fn(),manual=vi.fn();mount(<SajuEntryForm pending={false} onStored={selected} onSubmit={manual}/>);fireEvent.click(await screen.findByRole('button',{name:/이 정보로 사주 보기/}));expect(selected).toHaveBeenCalledWith('birth-1');expect(manual).not.toHaveBeenCalled();expect(mocked.execute).not.toHaveBeenCalled();});
 it('offers only explicitly saved people with a matching related birth profile',async()=>{mocked.births.mockResolvedValue([{...profile,id:'other-birth',owner_type:'RELATED_PERSON',related_person_id:'person-with-birth'}]);mocked.people.mockResolvedValue([{id:'person-with-birth',display_name:'소중한 친구',relation:'친구'},{id:'person-without-birth',display_name:'다른 사람',relation:null}]);const selected=vi.fn();mount(<RelatedBirthEntry pending={false} onStored={selected} onSubmit={vi.fn()}/>);fireEvent.click(await screen.findByRole('button',{name:/소중한 친구/}));expect(selected).toHaveBeenCalledWith('person-with-birth');expect(screen.queryByRole('button',{name:/다른 사람.*궁합 보기/})).toBeNull();expect(mocked.execute).not.toHaveBeenCalled();});
});
