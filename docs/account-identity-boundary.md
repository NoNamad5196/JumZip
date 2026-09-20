# Account identity boundary

Reviewed and implemented by Codex AI, 2026-09-20. This checkpoint uses mocked service responses; it does not exercise external authentication or delete any account.

The confirmed defect was that a Settings deletion dialog and its `DELETE` input could survive an A → B identity change. A submission could consequently use B's current session, and a late A result could clear B's UI cache or navigate away. Memory and history edit/delete dialogs had the same local-state lifetime problem.

## UI changes

- Settings, Profile, MemoryLibrary, ConsultationHistory and the conversation HistoryPage have UID-keyed inner views. Different UIDs, including A → B → A, create fresh form/modal state. A token refresh or anonymous-to-linked transition with the same UID preserves state.
- Account confirmation stores its owner UID. Submission sends `expectedUserId` to the service. The UI no longer performs a second sign-out after successful deletion. An SDK identity read before cache clearing/navigation also covers an auth event that precedes React's remount commit.
- A layout-effect lifetime flag fences asynchronous UI effects on each private view. Late success, failure and completion cannot close a new account's dialog, show an old error/success, remove its query data or navigate it away. The flag belongs to an instance, so returning to A cannot revive the first A request.
- Memory/history cache invalidation is scoped to the initiating UID, with a second lifetime check after awaited refreshes. Profile saves and its birth/related-person callbacks use the same checks and scoped refreshes.
- Settings memory changes, explicit sign-out, profile changes and new birth/related-person saves pass the initiating UID to the service's ownership check. Existing record IDs remain protected by server ownership checks.

Main owns the complementary `App.tsx`, `session.tsx` and `service.ts` changes: route keys include UID, stale initial-session results cannot overwrite newer auth events, service mutations validate the expected UID, and account-deletion cleanup only signs out the matching current SDK identity. Their tests are separate from the UI checks below.

## Verification

`tests/ui/account-identity.test.tsx` contains 35 passing regressions. It covers same-UID preservation, A → B → A reset, empty selection for a new identity, owner-bound deletion/profile/create requests, old success/failure completion, a switch during an awaited cache refresh, and the SDK-before-React-commit window. The related-person modal is real UI; its birth-input callback test uses an explicit synthetic form to isolate identity handling from separately tested geocoding/validation.

The six scoped files passed 57 tests: account identity, existing record deletion, memory, history pagination, profile identity and auth entry. Whole TypeScript, scoped ESLint and production Vite build passed. The build was written only to ignored `test-results/account-identity-build`; public `dist` and environment files were not overwritten.

These are component and mocked-service regression results. They do not establish public signup, CAPTCHA, Google OAuth, server-side deletion or real-model acceptance. The separate local SDK/browser results below distinguish actual local Auth/REST checks from synthetic auth-event notifications.

## Local SDK/browser verification

The separate `tests/ui/local-account-boundary-check.mjs` has now run against the real local Supabase Auth/REST stack with two temporary synthetic identities. It used a fresh browser and separately built UI. A bridge tab wrote the SDK's localStorage key, producing a native storage event, and sent an explicitly synthetic Auth BroadcastChannel notification. No React state was injected. Anonymous/linked metadata and TOKEN_REFRESHED notifications were synthetic; they are not OAuth linking or token-refresh acceptance.

The complete result is `docs/evidence/frontend-local-account-boundary-retry3.json`: three actual data checks and five notification/UI checks passed, with 12 REST reads, two allowlisted read-only deletion-candidate RPCs and six allowlisted activity updates. There were no blocked/failed requests, browser errors, product mutations, account-deletion submissions or Edge/model calls. Fixture contents remained unchanged. Cleanup confirmed both temporary Auth identities absent and all 15 owned tables empty for each; pending cleanup is zero.

Four PNGs from `tests/ui/artifacts/local-account-boundary-2026-09-20T01-41-31-056Z` were directly inspected by Codex AI: `same-uid-confirmation.png`, `owner-B-empty-confirmation.png`, `owner-B-no-memory-draft.png`, and `owner-A-return-zero-selection.png`. They show the intended retained/empty confirmation, B's empty memory state and zero selected memories after returning to A. The inspected desktop dialogs have no clipped or overlapping text. This visual review does not extend to other viewports or public authentication.

Earlier immutable reports remain: the first run stopped before account creation because CLI telemetry could not write outside the sandbox; retry1 correctly blocked the extra candidate RPC and fully cleaned up; retry2 passed the narrower Settings/Memory scope. Retry3 restored the candidate test after approval of a fixture-bearer/kind/record-ID allowlist.

## Onboarding and link continuation

Onboarding now keeps the UID returned by anonymous signup (or the existing session), passes it to profile saving, and checks the current SDK UID before the owner-scoped cache refresh and again before navigation. Its original successful flow can finish through the intended guest-to-owner remount. Google and email linking also pass the initiating UID to their service guards.

Seven new onboarding regressions exercise the remount, a different current UID, existing linked identity, a switch during refresh, missing signup session and retry after signup failure. The auth test now also verifies owner-bound email linking. The final four-file check passed 51 tests, whole TypeScript and scoped ESLint passed, and the production build passed in separate ignored `test-results/onboarding-identity-build`. The earlier 57-test checkpoint and actual local browser report remain separately scoped; no public signup, CAPTCHA, OAuth or model claim is added.
