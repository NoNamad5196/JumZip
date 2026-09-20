# Auth identity coordination

`src/lib/auth-identity.ts` exports `withAuthIdentityLock(projectUrl, operation)`.
It serializes identity-changing work by normalized project origin and base path.
The browser uses the public Web Locks API in exclusive mode, without `steal` or
`ifAvailable`. A 15-second deadline applies only while acquiring the lock. Once
acquired, its timer is cleared; a slow operation keeps its lock until completion
or rejection. Operation errors are preserved. Acquisition failures expose only
`AUTH_LOCK_UNAVAILABLE` or `AUTH_LOCK_TIMEOUT`, without underlying details.

Browsers without Web Locks fail closed before executing the operation. A
module-local FIFO fallback exists only when `window` is undefined and the Node
runtime is present, for Node fixtures. That fallback provides no cross-process
or cross-tab guarantee.

## Service integration requirements

- Keep SDK `auth.lock` unset. Its legacy lock does not cover all identity writes.
- Use `skipAutoInitialize: true`, then run one `auth.initialize()` inside this
  gate. Await that readiness **before** acquiring another identity gate.
- Wrap login/session confirmation (anonymous signup, OTP verification, OAuth
  initialization), account linking, and explicit logout in the same gate.
- After account deletion succeeds, acquire the gate, re-read the active UID,
  and clear the session only if it still matches the deleted account. Hold the
  gate through SDK logout completion. The account deletion HTTP call itself
  need not hold the gate.
- Do not nest the gate. Auth observers must return synchronously rather than
  await another gated Auth operation. UI status updates are safe.
- All cooperating tabs must use this coordination. It cannot serialize an old
  application version or code that writes Auth storage outside the gate.

Same-UID token refresh/linking is not an account switch. The guard compares user
identity, not bearer-token equality; SDK refresh coordination remains enabled.

## Evidence and limits

Installed `@supabase/auth-js` 2.116.0 has a default lockless path. Its custom-lock
branches cover `getSession`, `setSession`, and `signOut`, but `verifyOtp` and
`signInAnonymously` can save sessions without acquiring that lock. `signOut`
waits for a server response and then removes whichever local session is stored.
Thus merely enabling the SDK `processLock`/`navigatorLock` does not fix this race.
The exported SDK `navigatorLock` also includes timeout recovery with `steal`,
which this helper intentionally does not use.

`tests/service/auth-identity-sdk.test.ts` uses the installed SDK with a completely
synthetic fetch transport. It reproduces A logout deleting a newly stored B
session, both with the default SDK and with its optional process lock. Applying
the app gate delays B OTP verification until A cleanup finishes, preserving B;
if B arrives first, A cleanup is skipped. Same-UID token changes remain allowed.

`tests/service/auth-identity.test.ts` exercises browser LockManager behavior via
a shared test double: URL identity normalization, independent projects,
acquisition-only deadlines, no stealing, late callbacks, failure release, and
fail-closed behavior. It also checks Node queue ordering and expired waiters.
These tests make no real Auth, Edge, model, or external network request. They
are not a real multi-tab browser or public signup/OAuth acceptance test.

## Actual browser regression

On 2026-09-20 at 10:40 KST, run
`323d5886-ddff-4781-9d75-dd92939b33bb` passed **17/17 checks** in a fresh headless
Edge context. The [tracked report](evidence/frontend-local-auth-identity-race.json)
binds the exact production service/helper, installed dependency lockfile and
harness hashes with `sourceFrozen=true`. The production code was imported into
an isolated ignored Vite bundle; public build output and environment files were
unchanged.

This run used native `navigator.locks`, shared localStorage, separate browser
tabs, and the installed Supabase SDK. Auth and Edge HTTP responses were synthetic
route fulfillments. After a successful synthetic A account deletion, A's SDK
logout response was held. B's real `service.verifyOtp` call and a third tab's
service initialization appeared in the native pending-lock queue without
sending B's OTP request. Releasing A allowed both operations to finish, with B
remaining active in both original tabs and the cross-tab Auth observer ending
at B.

When B was already active, A's stale deletion confirmation returned
`SESSION_CHANGED` without another deletion or logout request. A separate fresh
context with Web Locks removed returned `AUTH_LOCK_UNAVAILABLE` before any Auth
or Edge request. The run fulfilled one synthetic user lookup, deletion, logout,
and OTP request each; unexpected and pending requests were both zero. The
browser contexts and owned local HTTP server were closed after verification.

This is actual browser coordination evidence, not hosted OAuth, public signup,
CAPTCHA, real account deletion, or Persona quality evidence. No real account,
DB, Auth, Edge, model, or external service was accessed. The prior unit-level
race reproductions remain intact rather than being replaced by this pass.

The separate [local memory regression](evidence/backend-local-memory-pagination-auth-gate.json)
passed **31/31** against actual local Auth/REST using the same frozen service/helper
source hashes. Its two disposable identities were independently verified absent
with 15 owned tables empty each and cleanup pending 0. That Node execution checks
pagination/service integration; native cross-tab exclusion is established by
the browser run above.
