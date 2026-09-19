# JumZip Core v1 execution

Deadline: 2026-09-20 23:59 Asia/Seoul. User approved M0–M17 implementation. A working Tarot release is a checkpoint; independent Core v1 work continues until acceptance or a concrete external blocker.

## Source order

1. [Engineering](https://app.notion.com/p/3df7cdef782d81d7b3a6d28b604f050f)
2. [API](https://app.notion.com/p/3e07cdef782d8132bd82f38ad9a171c9)
3. [Saju](https://app.notion.com/p/3e07cdef782d818088cac2c9146b290f)
4. [Tarot](https://app.notion.com/p/3e07cdef782d812f9b8dec7646d863fe)
5. [Acceptance](https://app.notion.com/p/3e07cdef782d81da92ecf20053a3bff9)
6. [Product](https://app.notion.com/p/3df7cdef782d812d943bf132a3dc743b)
7. [Assets](https://app.notion.com/p/3e07cdef782d81ca9502c0f1ca17074e)

## Ownership and gates

Main owns contracts, migrations, package/lock/configuration, service client, integration, repository and deployment. Frontend owns App/components/features/styles/UI tests. Backend owns the five Edge handlers, HTTP/validation/persistence/orchestration and backend tests. Domain owns fortune/Persona/provider, domain tests and benchmark. No concurrent writers to the same file.

Each code batch must pass typecheck, relevant tests and production build; DB/Edge changes also require actual integration smoke. Failed or skipped checks are not passes. Preserve the latest verified release.

M7.5 A–G and the separate M9 civil-date convention were explicitly approved. Both have independent expected fixtures frozen before implementation. See [rule freeze](saju-rule-freeze.md) and [luck convention](luck-timing-convention.md). New result-changing rules must not be guessed.

## Current integration — 06:06 KST

Checkpoint `ea3d0a4797a2ec19acfb711d72147efb839e53eb` was pushed to `main` and [its CI passed](https://github.com/NoNamad5196/JumZip/actions/runs/35468084847). The next integrated source now passes **595 tests / three explicit live skips**, whole TypeScript and lint, production build, 26 asset checks, public/source credential scans, six existing browser tests and four additional deletion-dialog fixture views. No skipped test counts as passed.

Migration **202609190014** is applied and read back. It supplies an owner-scoped memory preview and atomic record-plus-selected-memory deletion. Default selection is empty. Consultation previews explicitly describe their actual conversation-level provenance; they do not invent consultation-level memory origins. Hosted RPC regression passed **28/28** with zero model/Edge calls, invalid/cross-owner selections rolled back, replays deleted no extra memory, and both disposable accounts plus fourteen owned tables were verified empty. The matching frontend build is being deployed separately.

Persona v5 and Intent-v2 are implemented locally with exact input availability separated from calculation uncertainty. A frozen Gemma comparison produced 24/24 responses, no repair and **693.897848 measured neurons**. The sixteen-reply primary/independent means are 8.5625 and 8.9375, but both find the same two hard failures: reversed-Hermit meaning and erasure of a known B hour pillar. **This is a failed diagnostic run, not full acceptance.** Eight intent tools/modes match; one auxiliary choices slot is wrong. Production stays Qwen/v4 pending further improvements and real integration validation. Full84 preflight made zero requests and is not a test pass.

Actual Supabase runtime logs now supply separate CPU evidence: fifty Saju Shutdown samples between 02:30–04:27 KST, mean123.86ms/p95 213ms/max250ms, all EarlyDrop. This is aggregate execution/isolate evidence from the hosted smoke window; it does not re-label earlier wall durations as CPU or certify every date/load. The original acceptance requires selected boundary fixtures and an Edge CPU smoke, not broad astronomical certification. Local Supabase/Edge/llama.cpp execution remains a real source requirement and is still unrun while Docker recovery is investigated.

## Previous integration — 05:36 KST

The latest source passes whole lint, TypeScript and **541 tests with three explicit live skips**. The production build, 26 canonical asset checks, source/public credential scans and six desktop/mobile Playwright tests pass. Nine PostgreSQL consent regressions cover forward-only OFF/ON boundaries, related-person creation/withdrawal/deletion/rename, stale work, alias retirement and account cascade. Registry dependency audits report zero advisories for both production and all build/test dependencies; this is a point-in-time advisory check, not proof of complete security.

Migration **202609190013** is applied and its remote history was read back. Matching Edge Functions, including the frozen v4 reply prompt and updated memory readers, were deployed; the maintenance budget fix followed at approximately 05:29 KST. Production remains Qwen. The initial six-candidate/500-token run was correctly rejected after truncation and its failure is preserved. The corrected three-candidate/900-token run used the identical 17-turn fixture and passed **23/23 actual checks**, six HTTP calls, 47.477346 measured neurons. It persisted real extraction and summary, preserved every USER row, verified private/OFF/withdrawn-alias zero-call paths and prevented deleted memory from reappearing. All disposable Auth/application data was verified absent. This invokes real maintenance code and hosted DB/provider; it does not substitute for a public browser or Edge background-hook check.

The new frontend is live at [jumzip.pages.dev](https://jumzip.pages.dev). Its eight JavaScript files matched the checked 05:19 local build by SHA-256. Twelve actual desktop/mobile guest views and reloads return 200, with zero CSP violations, overflow, page errors or broken images. History/message continuation, request recovery, complete-only export and account draft reset are deployed. Two minor word-wrap defects have since been fixed and visually checked at 360/390px, pending upload of that CSS revision. Turnstile challenge DNS fails in the isolated browser: token issuance and public Auth remain unverified.

Gemma 4 was tested as a separate free Cloudflare model comparison: all original 84 entries returned valid JSON, 85 HTTP attempts used 2,504.052313 neurons. Independent core review averages 9.25/10 but has one opposite-orientation card interpretation; supplemental review also identifies known birth-input erasure. **Quality acceptance still fails.** No paid upgrade or production model switch was made. Preserve all original Qwen and Gemma failures rather than replacing evidence with selected successful examples.

The latest deployed Chat→Tarot→Retry smoke passed **20/20** checks with exactly four user HTTP requests. Same-UUID Chat replay added no rows and returned the original assistant; Tarot retry kept the stored cards and produced a new interpretation. Real Qwen/v4 provenance and cross-owner RLS were checked. Both disposable accounts and their application rows were independently verified absent. The API exposes no neuron usage, so its 400-neuron budget reservation is an estimate, not measured consumption. This is a privileged synthetic session check; public onboarding remains a separate gate.

The mobile word-wrap build is publicly verified: both changed pages at 360/390px keep all names/buttons on one line, with no overflow or page errors. All eight public JavaScript files and the stylesheet match the latest local build. Remaining work: next commit/push/CI, generic model fact/uncertainty improvements and a complete passing benchmark, and authenticated public regression. Google OAuth still waits for owner-controlled two-step verification. The [acceptance matrix](acceptance-matrix.md) is authoritative for current per-milestone gaps.

## Historical checkpoint — 04:49 KST

- All nine frontend routes, canonical 26-image assets, persisted Tarot/Daily/History/retry, full Saju, both compatibility tools, account/memory/related-person controls, text/image export and Persona UX are implemented.
- Hosted Supabase in Seoul has migrations 001–012. All five Edge Functions received the v3 schema/prompt fix at 04:46 KST. The preceding v2 actual remote smoke passed 62 checks, including successful model interpretation, Auth/RLS, persistence, compatibility consent/retry and deletion; disposable cleanup was independently confirmed. Migration 011 fixed the account-cascade defect found in an earlier smoke.
- M9 remote smoke passed 35 checks with five actual model successes. Snapshot asOf/ruleVersion persist through reload/retry; unknown-hour candidates remain uncertain. These are admin-created synthetic sessions, not public anonymous browser acceptance.
- The initial pushed release passed lint, TypeScript, 445 tests / 2 intentional live skips, production build, 26 asset hashes, public/source credential scans and four intercepted Playwright tests. GitHub Actions repeated these checks successfully. The v3 provider/prompt and service batch then passed whole lint, TypeScript and 457 tests / 2 live skips; build passed. New independent foundation and pagination UI additions require the next full check.
- Local visual QA covered 20 populated fixture views at desktop/mobile sizes without overflow/page exceptions. Actual local PNG exports worked for Tarot, Full Saju and compatibility; default exports hide birth details. Fixture QA does not prove hosted Auth.
- Cloudflare email verification, Workers AI token verification and Supabase Secrets configuration succeeded. Qwen3 30B returned real Korean structured replies. The initial checked frontend is publicly deployed at [jumzip.pages.dev](https://jumzip.pages.dev). Actual root render and 12 desktop/mobile guest route/reload checks succeeded, without overflow or page exceptions. These are guest checks, not authenticated product acceptance.
- Turnstile widget exists; its secret is configured in hosted Auth. CAPTCHA enabled with Cloudflare provider survived a full reload. Anonymous sign-ins and manual linking are enabled. Site URL is `https://jumzip.pages.dev`, with exact production/local `/auth` callbacks.
- The hourly anonymous retention cron completed its first scheduled run successfully at 03:13 KST. Linked-user protection and the 90-day cutoff have PostgreSQL tests.
- User-requested [NoNamad5196/JumZip](https://github.com/NoNamad5196/JumZip) now contains initial commit `26c39e05491a5964cd677d635b1f0f15015e56ac` on `main`. The user explicitly approved the persistent GitHub CLI `workflow` scope; authentication refresh and push succeeded. [Actual CI run](https://github.com/NoNamad5196/JumZip/actions/runs/35464563030) passed. Later changes are pending their next checked commit/push.
- Actual public Auth rejected both missing and invalid CAPTCHA tokens with `captcha_failed`; no account was created. Guest onboarding renders Turnstile and keeps submit disabled without a token. Headless public QA encountered a challenge subdomain DNS failure; successful public signup remains unverified.
- Production service pagination passed an actual hosted test with 1,005 messages, seven conversations, eight readings, equal timestamps, null message dates and literal special-character search. Complete consultation detail/export retrieval passed; the disposable identity was deleted and verified absent. UI continuation is being connected.

## Historical remaining evidence — 04:49 KST

- Original actual model baseline (60 core + 24 supplement, 1,854.6405 neurons) failed semantic review. Preserved v2 rerun used 87 HTTP attempts / 1,276.82 neurons: 59/60 core and 22/24 supplement structurally valid, but both independent core reviews failed (7.58 and 7.05 operational averages, confirmed hard failures). v3 focused regression has 36/36 valid responses / 680.88 neurons, but still has confirmed element-distribution and relationship-certainty errors. None is a semantic quality pass. Reviews are attributed Codex AI assessments; the source imposes no human-only requirement.
- Actual v2 conversation smoke failed: one successful Chat, no memory cursor, then invalid explicit Tarot response. Safe telemetry showed memory validation failure, not a missing background task. A three-call synthetic probe proved the JSON-object provider omitted the required schema; injecting it produced the expected memory. The generic initial/repair fix is deployed in v3, and the actual conversation rerun is in progress.
- User chose Google login (superseding the earlier GitHub preference). Google Cloud is blocked until the account owner enables 2-step verification. No GitHub OAuth app was created. Public email OTP remains unavailable without SMTP and is gated out of the UI.
- Public anonymous onboarding, CAPTCHA rejection/success, Chat/Tarot/retry/reload/History/export, Google linking with the same UID, second-session restore and deletion remain to be tested on a real deployment.
- M7 now has an independent frozen fixture derived from KASI/IANA and adopted rules: 22 cases across 12 classes, 23 tests passed including the freeze hash. Seventeen cases have complete adopted fields, three intentionally omit unsupported month pillars and two reject DST gaps. Missing 2020/1988 Jie brackets and broad calendar coverage remain; this does not claim external certification of all charts.
- Docker engine still fails after the user's factory reset. Remote Management API deployment works without it; local Docker Auth/Edge tests remain unrun.
- Main bundle remains above Vite's advisory 500 kB threshold. The original public frontend retains the old history limits until the checked pagination UI is deployed. Public CSP blocks an eval probe without a page exception; the suspected Zod fallback must be confirmed before closing that observation.

Current detailed status: [acceptance matrix](acceptance-matrix.md). Provisioning, fixture QA and structured JSON validity alone do not satisfy full Core v1 acceptance.

## Combined batch — 05:04 KST

The next combined source batch passed whole lint, TypeScript, 494 tests with three explicit live skips, production build, 26 canonical asset hashes, both credential scans and six desktop/mobile Playwright tests. Its actual hosted pagination test passed separately. UI52 tests and strict-production-CSP checks also pass: previous-message scroll position is preserved, history search runs on the server, and Zod form validation uses its supported JIT-free path with zero CSP violations. These UI changes await the next Pages upload.

New [KASI2020/HKO1988 supplemental evidence](foundation-supplement-evidence.md) closes the three selected month-field omissions with four further passing tests. The original frozen fixture remains unchanged; full astronomical certification is not claimed.

The v4 focused model assessment still fails: 36 structurally valid entries, 777.334575 measured neurons, core subset8.11/10 with zero hard failures and supplemental subset7.61/10 with two confirmed hard failures. This is a diagnostic subset, not full-corpus acceptance. An analogous recall probe correctly remembered the synthetic preference but omitted the required `toolReferences` field in both initial/repair responses. The original v3 runtime failure is not retrospectively claimed to have this exact cause. Same-Cloudflare free model comparison is being prepared; no paid upgrade or production provider switch is authorized implicitly.
