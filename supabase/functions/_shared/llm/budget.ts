import type { SupabaseClient } from '@supabase/supabase-js';
import type { FallbackReservationRequest, FallbackReservation } from './provider.ts';

/** All paid sends, including repairs, acquire an atomic persistent hold before the network call. */
export function createOpenAIBudget(client: SupabaseClient) {
  return async (request: FallbackReservationRequest): Promise<FallbackReservation> => {
    const denied = () => Object.assign(new Error('LLM_BUDGET_EXCEEDED'), { code: 'LLM_BUDGET_EXCEEDED' });
    let result;
    try {
      result = await client.rpc('reserve_openai_budget', { p_model: request.model, p_input_bytes: request.inputBytes,
        p_max_output_tokens: request.maxOutputTokens }).abortSignal(AbortSignal.timeout(2500));
    } catch { throw denied(); }
    if (result.error || !result.data || typeof result.data.reservationId !== 'string'
      || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(result.data.reservationId)
      || !Number.isSafeInteger(result.data.reservedMicros) || result.data.reservedMicros <= 0) throw denied();
    const reservationId = result.data.reservationId;
    return { async settle(usage) {
      // Failed settlement leaves a conservative hold; it cannot trigger another paid request.
      try {
        await client.rpc('settle_openai_budget', { p_reservation_id: reservationId,
          p_prompt_tokens: usage.promptTokens, p_completion_tokens: usage.completionTokens }).abortSignal(AbortSignal.timeout(1500));
      } catch { /* The reservation remains charged. */ }
    } };
  };
}
