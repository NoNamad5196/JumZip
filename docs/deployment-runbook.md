# Deployment and recovery

This repository uses a static Vite frontend, hosted Supabase Auth/Postgres and five Edge Functions. Provisioning a resource does not establish release acceptance. The current evidence and outstanding gates are in [EXECUTION.md](EXECUTION.md) and [acceptance-matrix.md](acceptance-matrix.md).

## Configuration boundaries

- Browser build: `VITE_SUPABASE_URL`, publishable/anonymous `VITE_SUPABASE_ANON_KEY`, `VITE_TURNSTILE_SITE_KEY`, the public auth availability flags, and the three public LLM provider disclosure fields from `.env.example`. Enable `VITE_AUTH_GOOGLE_ENABLED` only after hosted Google OAuth is configured. Keep email disabled until public SMTP is actually available.
- Server: `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`, `LLM_STRUCTURED_FORMAT`, `ALLOWED_ORIGINS`. Supabase supplies its own reserved `SUPABASE_*` variables to Edge Functions. Never put a service-role key or model key in `VITE_*`.
- Local private integration tests: `.env.server.local`, ignored by Git. Tests use Node's `--env-file` option; do not print the file or pass secret values in command arguments.
- `TOOL_RECOMMENDATIONS_ENABLED=false`, `TITLE_GENERATION_ENABLED=false`, and `MEMORY_MAINTENANCE_ENABLED=false` independently disable optional server work. They do not disable user deletion or privacy controls.

Cloudflare Workers AI `@cf/qwen/qwen3-30b-a3b-fp8` remains the primary, through the account's `/ai/v1` OpenAI-compatible endpoint with `json_object` output. The owner has explicitly approved replacing the Gemini secondary with paid OpenAI `gpt-5.6-luna`. The bounded direct model checks and five-function deployment have completed. Status is **`DEPLOYED_AND_ENABLED`**: after explicit approval for actual user-context transfer and activation, `LLM_FALLBACK_ENABLED=true` was enabled at 09:28 UTC (18:28 KST) on 2026-09-20. Seven remote primary/fallback setting comparisons matched; secrets remain server-only. This is not full model-quality acceptance. See [OpenAI fallback scope and budget](openai-fallback.md).

The v4.2 release permits Luna only for a **user-facing reply after primary HTTP429**. Intent classification, title generation and memory maintenance remain Cloudflare-only. There is no fallback for auth, timeout, network, malformed output or validator failure. Each transport keeps its original deadline, and a logical answer retains only one repair. Once switched within that provider instance, a later repair stays on Luna and acquires its own budget reservation.

Server configuration is `LLM_FALLBACK_ENABLED`, `LLM_FALLBACK_BASE_URL=https://api.openai.com/v1`, `LLM_FALLBACK_MODEL=gpt-5.6-luna`, and a separate server-only `LLM_FALLBACK_API_KEY`. The current release rejects Gemini configuration. Public `VITE_LLM_FALLBACK_PROVIDER_NAME/REGION/PRIVACY_URL` fields must describe OpenAI processing and never contain credentials. Set `LLM_FALLBACK_ENABLED=false` to stop paid fallback while leaving the CF model/key unchanged. Historical Gemini manifests and test evidence are retained; they are not the new release target.

## Database changes

1. Run `pnpm lint`, `pnpm typecheck`, relevant tests, and `pnpm build`. PostgreSQL persistence tests are `pnpm test tests/db/persistence.test.ts`.
2. Read `supabase_migrations.schema_migrations` remotely and identify its last applied version.
3. For an existing database, run `node scripts/prepare-migrations.mjs --after <last-applied-12-digit-version>`. This writes a transaction to `supabase/.temp/pending-migrations.sql`. The SQL checks the expected remote history and acquires an advisory lock before applying changes.
4. Inspect the pending migration files and apply the generated transaction using `node node_modules/supabase/dist/supabase.js db query --linked --project-ref <project-ref> --file supabase/.temp/pending-migrations.sql`.
5. Read back the migration history and run the relevant remote smoke. Never edit an applied migration to represent a new deployment.

Migration 013 adds forward-only extraction/summary consent floors and the aggregated `blockedRelatedPeople` RPC field. Apply it before the updated Edge context reader, which fails closed when this privacy metadata is absent. Related-person deletion, or removal of an old blocked alias by rename/re-consent, retires only matching derived memory rows; raw messages are preserved. This follows the existing conservative forgetting policy: a scope/subject suppression can prevent future extraction for that subject, and any suppression prevents summary reconstruction. It is not a complete detector for unknown people or indirect references.

Migration **`202609200016_openai_budget.sql` is mandatory before enabling the paid fallback**. It creates service-role-only reservation/settlement RPCs and persistent shared limits: $0.10 per KST calendar day, $1 per KST calendar month, and $1 total for a policy expiring 30 days after migration insertion. Migration016 is now applied remotely and its real RPC rollback smoke passed. The current policy expires at `2026-10-20T09:12:35.300928Z` (18:12:35.300928 KST). A new day or month does not reset that total or extend the expiry. Missing policy/RPC, reservation failure, disabled policy, expiry or insufficient headroom blocks the paid request.

Before every actual Luna HTTP request, including repair, the complete UTF-8 JSON body must be at most 64,000 bytes and the output cap at most 900 tokens. Reserve `ceil((inputBytes + 1024) × 0.25 + maxOutputTokens × 1.2)` USD micro-units atomically. Valid bounded numeric response usage may settle at `ceil(promptTokens × 0.25 + completionTokens × 1.2)` and refund the difference once; missing/invalid usage, failed/uncertain transport or failed settlement keeps the full hold. The limits cover this app's guarded request path, not other applications using the same OpenAI account/key. See the dedicated document for pricing, units and examples. Do not reset reservations to force a test through.

Without `--after`, the preparation script writes `initial-migrations.sql` for an empty JumZip project only; its guard rejects existing history or a `profiles` table. Do not use it for updates. A SQL transaction failure rolls back the batch. After commit, use a reviewed forward migration to correct a problem; do not reset the hosted database.

## Edge release

Migration 014 must precede the frontend record-deletion dialogs. `history_deletion_memories` returns owner-scoped candidates with their known conversation provenance, and `delete_history_with_memories` atomically validates/deletes only explicitly selected IDs and the record. An empty selection preserves independent memories; a stale/foreign selection rolls back. Neither RPC accepts a caller-supplied owner ID. Hosted regression evidence is `docs/evidence/backend-history-deletion-smoke.json`.

Migration015 invalidates deleted-consultation execution caches and late callbacks, clears derived conversation context with a memory revision fence, and fixes the parent pointer of reused Daily Tarot executions. It is already applied locally and remotely; do not edit it. Both environments passed22 actual RPC checks. Unselected independent memories survive. Any further database correction requires a new forward migration.

The current Persona-v12 / Intent-v6 working source and earlier benchmark checkpoints are candidates, not an instruction to replace the deployed backend. The narrow Luna transition is Persona-v4.2 / Intent-v1; its five-function deployment and paid-fallback activation are complete following explicit approval. Preserve failed diagnostic output/reviews and the original full84 corpus. **Do not deploy the current working functions wholesale while this difference exists.**

The deletion hotfix release was reconstructed from commit `ea3d0a4797a2ec19acfb711d72147efb839e53eb` in an isolated ignored staging directory, with only `orchestration/execute.ts`, `saju.ts` and `compatibility.ts` overlaid. All 53 staged files were compared with the baseline and its TypeScript check passed. The [release manifest](evidence/edge-deletion-guard-release.json) records every file hash. Five functions were deployed and the [actual post-deploy flow](evidence/backend-edge-mini-smoke-deletion-guard.json) passed20/20. Reproduce an intended release from that manifest, or accept and verify a new candidate explicitly before replacing it.

The previous verified transport overlay is the historical [Gemini fallback manifest](evidence/edge-gemini-fallback-release.json). The new Luna stage is reconstructed from that exact deployed v4 base using:

```powershell
node scripts/prepare-openai-fallback-release.mjs --check
node scripts/prepare-openai-fallback-release.mjs
node --experimental-transform-types scripts/openai-fallback-release/check-stage.mjs <stage> --save-report
```

`--check` reconstructs and validates in memory without writing a stage. Preparation writes a new ignored `supabase/.temp/openai-fallback-v4-2-*` directory and `release-manifest.json`. The checker performs the staged TypeScript check and injected-transport checks with network access blocked; `offline-verification.json` is written once. These commands do not deploy or call a model.

The stage contains **54 files: six modified, one added and 47 byte-identical to the deployed base**. Modified files are `llm/provider.ts`, `llm/reply.ts`, `persona/config.ts`, `persona/prompt.ts`, `orchestration/execute.ts`, and `http/errors.ts`; `llm/budget.ts` is new. The separate DB migration is not part of that 54-file Edge inventory. Prompt version is `JumZipPersona-v4.2`, intent is `JumZipIntent-v1`; Tarot/Saju schemas and validators stay at v4. The prompt removes forced questions and a fixed empathy sequence and uses actual recent assistant turns to discourage repetition without flattening the three personas. Candidate v12/v4.1 contracts are not included.

The latest direct seven-case synthetic check returned seven HTTP 200 responses with no repair. All three follow-up turns avoided unwanted questions; the first probe's two unwanted-question failures remain preserved. Across both runs there were 14 actual Luna requests, no user-account or conversation writes, and 11,887 micro-USD ($0.011887) in the conservative persistent ledger. Both runs mocked the primary429 while using the real budget RPC and actual Luna transport; this is not an actual hosted CF429-to-Luna end-to-end test or full semantic benchmark. The local raw reports are `test-results/openai-fallback-live.json` and `test-results/openai-fallback-variety-recheck.json`.

The selected stage is `supabase/.temp/openai-fallback-v4-2-qjtA9h`, with manifest SHA-256 `535278a18113ef4b8832e142815e534643eda014c3f4cc0744a97112a338005c`. Its five-function deployment succeeded according to the CLI. Following approval, activation succeeded at 09:28 UTC with all 7 remote setting comparisons matching. All 5 functions returned OPTIONS 204 and unauthenticated POST 401; this verifies startup and the authentication boundary, not an authenticated end-to-end model conversation. See the [server release evidence](evidence/edge-openai-fallback-release.json). The [public frontend evidence](evidence/frontend-openai-fallback-public.json) already confirms all 10 HTML/JS/CSS files match at 18:22 KST. The frontend publication check and the separately confirmed backend activation are distinct evidence. Use the validated stage as deployment `--workdir` and its absolute import-map path; do not copy the full working backend into it.

`node scripts/prepare-verified-edge-release.mjs --check` verifies that manifest against committed Git objects without writing a stage. Omit `--check` to reconstruct all53 exact files in a new ignored `supabase/.temp/verified-edge-*` directory and read back their SHA-256 values. It checks the complete baseline file tree, allowed paths, unique entries, changed-file list and prompt versions; candidate working files are never copied. It does not deploy or contact any service. A shallow checkout lacking the recorded baseline/overlay objects must fetch the required history before this can work. Use the printed stage as `--workdir` and its absolute `supabase/functions/deno.json` as `--import-map` when intentionally redeploying that same accepted release.

After the intended release is accepted, deploy its verified stage with:

```powershell
node node_modules/supabase/dist/supabase.js functions deploy --workdir <absolute-verified-stage> --project-ref <project-ref> --use-api --import-map <absolute-verified-stage>/supabase/functions/deno.json --jobs 3
```

This path works without local Docker. Gateway `verify_jwt=false` is intentional: each handler validates the bearer token through Supabase `getUser` before any user operation. Service-role RPCs are unavailable to browser roles. Do not remove handler authentication.

Set server secrets using the Supabase Secrets UI or a private env file accepted by the CLI. Exclude reserved `SUPABASE_*` variables. Do not log or echo token values. Set exact production origins, not `*`, in `ALLOWED_ORIGINS`.

Remote integration smoke:

```powershell
node --env-file=.env.server.local scripts/smoke-remote.mjs
node --env-file=.env.server.local tests/domain/live-edge-saju-smoke.mjs
```

These scripts create disposable, clearly marked accounts and remove them after checking real Auth/RLS/Edge/storage. Their admin-created sessions do **not** verify public anonymous signup, CAPTCHA, email delivery, or browser Auth redirects. Missing-model `PARTIAL` checks verify persistence/retry behavior, not successful AI interpretation. Inspect the safe reports in `test-results/` and resolve any failed cleanup before repeating a run.

## Public frontend and Auth

1. Build `dist/` only after public environment fields are configured. Keep `public/_headers` and `_redirects` in the output so Cloudflare Pages applies security headers and SPA routing.
2. Deploy to a confirmed Pages hostname. Add that exact hostname to Turnstile; use its public site key in the build and its private secret only in Supabase Auth CAPTCHA configuration.
3. Enable anonymous sign-ins and manual identity linking in hosted Auth. Set `site_url` to the production origin and allow only the required `/auth` callback URLs. Keep email confirmation enabled.
4. Configure real public email delivery or an approved OAuth provider. Supabase's default mailer is restricted to project-team addresses and is not a public SMTP solution. Do not present an untested account-linking flow as passed.
5. Run a real browser sequence: anonymous onboarding → conversation → model reply → persisted Tarot → reload → interpretation retry → Daily reuse → History/detail/export → account linking and restored records on a second session → deletion. Confirm a deleted token fails and all owned records are removed.
6. Check mobile/desktop, keyboard navigation, reduced motion, actual CSP, cache headers, missing-route reload, CAPTCHA failure and network loss on the public URL. Fixture screenshots supplement, but never replace, this sequence.

Cloudflare email verification is complete. [jumzip.pages.dev](https://jumzip.pages.dev) is publicly deployed from the initial checked build; root render and desktop/mobile guest route reloads were actually inspected. This is not yet authenticated release acceptance. For direct upload, select the entire `dist` folder so its hierarchy is preserved. A ZIP uploaded as a single asset exceeds the 25 MB file limit for this build; folder upload succeeded with 174 files. Retain the previous deployment when publishing another revision.

Turnstile and hosted anonymous/manual linking are enabled. Missing/invalid CAPTCHA requests actually fail; public success is still unverified. The user chose Google login; Google Cloud currently requires the owner to enable two-step verification before OAuth provisioning can continue. The frontend exposes a provider only after its public availability flag is enabled; no GitHub OAuth app was created.

At06:32KST, the mismatched hosted CAPTCHA secret was repaired using the existing widget's secret. A fresh read confirmed equality and enabled protection. A deliberately invalid token was rejected400 with `invalid-input-response`; the earlier `invalid-input-secret` is preserved in the logs. This verifies secret configuration and continued rejection only, not successful public signup. Never disable CAPTCHA to make a smoke pass.

## Local runtime verification

Docker recovery and retained socket backups are recorded in `local-runtime-status.md`. Native provider evidence is `evidence/local-provider-smoke.json`. Keep local inference bound to loopback, require its separate random API key, and never reuse production provider credentials. Binary/model hashes are pinned in that report. Ignored `test-results/local-edge.env.local` supplies the local Supabase Edge serve process; it must not read `.env.server.local` or target the hosted URL.

`tests/backend/live-local-supabase-smoke.mjs` is opt-in and enforces a loopback Supabase URL. Its actual first run verified Chat, persistence/retry and account boundaries, but the0.8B model failed both Tarot interpretations. Preserve `backend-local-supabase-smoke.json` and the separate no-model `backend-local-supabase-verification.json`; do not relabel the entire suite as passed. Owned test identities and15 application tables were independently confirmed absent. Local Vector analytics has no Docker TCP listener; do not expose an unauthenticated Docker daemon to satisfy logging.

## Retention and operational checks

`scripts/setup-housekeeping.sql` registers an hourly `jumzip-anonymous-90-day-cleanup` job at minute 13 UTC. It processes at most 100 inactive anonymous accounts per run and protects linked identities. Check `cron.job_run_details` for actual scheduled success; a registration response is insufficient. Function-level retention behavior also has PostgreSQL tests.

Keep the last verified frontend deployment available for rollback. Use new deployments for frontend changes and forward-compatible server migrations. During a provider outage, persisted fortune results remain available with an explicit partial status and interpretation retry. Do not regenerate cards or calculations as an outage workaround.

## Release evidence

Record the Git revision, migration head, Edge release timestamp, public URL, environment names (never values), local check counts, actual integration reports, benchmark assessment and any unresolved gates. A skipped live benchmark, fixture-only browser run, missing SMTP or unresolved Saju convention remains a documented gap.

Primary operational references: [Supabase email delivery](https://supabase.com/docs/guides/auth/auth-smtp), [anonymous sign-ins](https://supabase.com/docs/guides/auth/auth-anonymous), [Cron](https://supabase.com/docs/guides/cron), [Cloudflare Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/), [OpenAI compatibility](https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/).
