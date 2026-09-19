/** Supabase Auth/PostgREST deadlines cover response bodies, not just response headers.
 * Buffering is bounded; RPC failures expose a sanitized code at the repository boundary. */
export function createBoundedFetch(options: { fetchImpl?: typeof fetch; timeoutMs?: number; maxBytes?: number } = {}): typeof fetch {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 8_000;
  const maxBytes = options.maxBytes ?? 4_194_304;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isInteger(maxBytes) || maxBytes < 1) throw new RangeError('NETWORK_LIMIT_INVALID');
  return async (input, init) => {
    const controller = new AbortController();
    const upstreamSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const abort = () => controller.abort();
    if (upstreamSignal?.aborted) controller.abort(); else upstreamSignal?.addEventListener('abort', abort, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const execute = async () => {
      const response = await fetchImpl(input, { ...init, signal: controller.signal });
      if (controller.signal.aborted || Number(response.headers.get('content-length') ?? 0) > maxBytes) {
        try { void response.body?.cancel().catch(() => undefined); } catch { /* Best effort cleanup. */ }
        throw new Error(controller.signal.aborted ? 'NETWORK_ABORTED' : 'NETWORK_RESPONSE_TOO_LARGE');
      }
      const bytes: Uint8Array[] = []; let total = 0;
      reader = response.body?.getReader();
      if (reader) while (true) {
        const next = await reader.read();
        if (controller.signal.aborted) throw new Error('NETWORK_ABORTED');
        if (next.done) break;
        total += next.value.byteLength;
        if (total > maxBytes) throw new Error('NETWORK_RESPONSE_TOO_LARGE');
        bytes.push(next.value);
      }
      const body = new Uint8Array(total); let offset = 0;
      for (const chunk of bytes) { body.set(chunk, offset); offset += chunk.byteLength; }
      const headers = new Headers(response.headers); headers.delete('content-encoding'); headers.delete('content-length');
      return new Response([204, 205, 304].includes(response.status) ? null : body, { status: response.status, statusText: response.statusText, headers });
    };
    try {
      return await Promise.race([execute(), new Promise<never>((_, reject) => { timer = setTimeout(() => { reject(new Error('NETWORK_TIMEOUT')); controller.abort(); }, timeoutMs); })]);
    } catch (error) {
      const code = error instanceof Error && ['NETWORK_TIMEOUT', 'NETWORK_ABORTED', 'NETWORK_RESPONSE_TOO_LARGE'].includes(error.message) ? error.message : 'NETWORK_UNAVAILABLE';
      // A caught transport error may contain headers/URLs in its stack or cause; never retain it.
      // eslint-disable-next-line preserve-caught-error -- Only the allowlisted code may reach SDK logging.
      throw new Error(code);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      controller.abort();
      upstreamSignal?.removeEventListener('abort', abort);
      // A custom upstream stream may never resolve cancellation; cleanup must not extend the deadline.
      if (reader) { void reader.cancel().catch(() => undefined); try { reader.releaseLock(); } catch { /* Already released. */ } }
    }
  };
}
