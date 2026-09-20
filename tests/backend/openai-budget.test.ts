import {describe,expect,it,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
import {createOpenAIBudget} from '../../supabase/functions/_shared/llm/budget.ts';
const request={model:'gpt-5.6-luna',maxOutputTokens:900,inputBytes:10000};
const id='00000000-0000-4000-8000-000000000001';
describe('server paid budget adapter',()=>{
  it.each([{error:{message:'private database error'}},{data:null},{data:{reservationId:'unsafe',reservedMicros:1}},{data:{reservationId:id,reservedMicros:0}}])('fails closed on unavailable or malformed reservation',async result=>{
    const abortSignal=vi.fn().mockResolvedValue(result);const rpc=vi.fn(()=>({abortSignal}));
    await expect(createOpenAIBudget({rpc} as unknown as SupabaseClient)(request)).rejects.toMatchObject({code:'LLM_BUDGET_EXCEEDED',message:'LLM_BUDGET_EXCEEDED'});
    expect(abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal));
  });
  it('settles only its server-issued reservation, without exposing a settlement failure',async()=>{
    const rpc=vi.fn().mockReturnValueOnce({abortSignal:vi.fn().mockResolvedValue({data:{reservationId:id,reservedMicros:3836}})})
      .mockReturnValueOnce({abortSignal:vi.fn().mockRejectedValue(Error('database offline'))});
    const hold=await createOpenAIBudget({rpc} as unknown as SupabaseClient)(request);
    await expect(hold.settle({promptTokens:3000,completionTokens:500})).resolves.toBeUndefined();
    expect(rpc).toHaveBeenLastCalledWith('settle_openai_budget',{p_reservation_id:id,p_prompt_tokens:3000,p_completion_tokens:500});
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});
