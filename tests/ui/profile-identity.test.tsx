// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ProfilePage } from '../../src/features/AccountPages';
const mocked=vi.hoisted(()=>({id:'account-a',anonymous:true,save:vi.fn()}));
vi.mock('../../src/lib/service',()=>({service:{configured:true,listBirthProfiles:async()=>[],listRelatedPeople:async()=>[],updateProfile:mocked.save}}));
vi.mock('../../src/features/session',()=>({useSession:()=>({session:{user:{id:mocked.id,is_anonymous:mocked.anonymous}},loading:false}),useProfile:()=>({data:{display_name:mocked.id==='account-a'?'첫 계정':'다음 계정',preferred_character:'BOMI'}}),errorMessage:()=>''}));
vi.mock('../../src/lib/Captcha',()=>({Captcha:()=>null}));
afterEach(cleanup);
describe('profile form identity',()=>{
 it('drops the former identity draft but preserves it when the same anonymous identity is linked',async()=>{
  mocked.id='account-a';mocked.anonymous=true;mocked.save.mockReset().mockResolvedValue(undefined);
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});const tree=()=> <QueryClientProvider client={client}><MemoryRouter><ProfilePage/></MemoryRouter></QueryClientProvider>;
  const view=render(tree());const nickname=()=>screen.getByRole('textbox',{name:'이름 또는 닉네임'}) as HTMLInputElement;
  fireEvent.change(nickname(),{target:{value:'이전 계정의 미완성 이름'}});fireEvent.click(screen.getByRole('radio',{name:'아랑'}));
  mocked.anonymous=false;view.rerender(tree());expect(nickname().value).toBe('이전 계정의 미완성 이름');
  mocked.id='account-b';view.rerender(tree());expect(nickname().value).toBe('다음 계정');expect((screen.getByRole('radio',{name:'보미'}) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole('button',{name:'변경 내용 저장'}));await waitFor(()=>expect(mocked.save).toHaveBeenCalledWith({display_name:'다음 계정',preferred_character:'BOMI'}));
 });
});
