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

## Verified checkpoint — 04:15 KST

- All nine frontend routes, canonical 26-image assets, persisted Tarot/Daily/History/retry, full Saju, both compatibility tools, account/memory/related-person controls, text/image export and Persona UX are implemented.
- Hosted Supabase in Seoul has migrations 001–012 and all five M9 Edge endpoints deployed. Remote smoke passed 63 checks covering Auth/RLS, persistence, compatibility consent/retry and account deletion. An actual cascade defect found by this smoke was fixed in migration 011 and verified against both PostgreSQL and the hosted database.
- M9 remote smoke passed 35 checks with five actual model successes. Snapshot asOf/ruleVersion persist through reload/retry; unknown-hour candidates remain uncertain. These are admin-created synthetic sessions, not public anonymous browser acceptance.
- Latest completed whole code check: lint, TypeScript, 420 tests passed / 2 live suites intentionally skipped, build, 26 canonical asset hashes, and public credential scan. Frontend separately passed 39 UI tests and four intercepted Playwright tests. A following batch adds safe background telemetry, Google login UI and model corrections; it needs a new full check.
- Local visual QA covered 20 populated fixture views at desktop/mobile sizes without overflow/page exceptions. Actual local PNG exports worked for Tarot, Full Saju and compatibility; default exports hide birth details. Fixture QA does not prove hosted Auth.
- Cloudflare email verification, Workers AI token verification and Supabase Secrets configuration succeeded. Qwen3 30B returned real Korean structured replies. Pages project `jumzip` reserves `jumzip.pages.dev`; no uploaded public deployment has yet been verified.
- Turnstile widget exists; its secret is configured in hosted Auth. CAPTCHA enabled with Cloudflare provider survived a full reload. Anonymous sign-ins and manual linking are enabled. Site URL is `https://jumzip.pages.dev`, with exact production/local `/auth` callbacks.
- The hourly anonymous retention cron completed its first scheduled run successfully at 03:13 KST. Linked-user protection and the 90-day cutoff have PostgreSQL tests.
- GitHub repository [NoNamad5196/JumZip](https://github.com/NoNamad5196/JumZip) is empty/public and push-authorized. CLI authentication now works; initial checked commit/push and hosted CI are pending.

## Remaining release evidence

- Actual model baseline: 60 core + 24 supplemental responses, 89 HTTP attempts, 1,854.6405 provider-accounted neurons. Core 58/60 structurally valid, supplement 24/24 valid. Semantic review FAILED: invented probabilities, person confusion and example contamination. Core operational average 7.03/10. This is explicitly attributed Codex AI review; the source does not impose a human-only reviewer requirement. Baseline artifacts are preserved before fixes and rerun.
- Actual conversation smoke produced one successful persisted Chat, but background memory did not commit and the next explicit Tarot request failed response validation. Cleanup succeeded. Safe task/outcome/error-code telemetry is prepared; real memory/intent/title success is still required.
- User chose Google login (superseding the earlier GitHub preference). Google Cloud is blocked until the account owner enables 2-step verification. No GitHub OAuth app was created. Public email OTP remains unavailable without SMTP and is gated out of the UI.
- Public anonymous onboarding, CAPTCHA rejection/success, Chat/Tarot/retry/reload/History/export, Google linking with the same UID, second-session restore and deletion remain to be tested on a real deployment.
- M7 external calendar evidence is partial: documented KASI cases do not certify the full date range or all 12 foundation fixture types independently.
- Docker engine still fails after the user's factory reset. Remote Management API deployment works without it; local Docker Auth/Edge tests remain unrun.
- Main bundle remains above Vite's advisory 500 kB threshold. Pagination of older conversations/messages is limited and should not be described as unlimited history.

Current detailed status: [acceptance matrix](acceptance-matrix.md). Provisioning, fixture QA and structured JSON validity alone do not satisfy full Core v1 acceptance.
