# Deployment and recovery

This repository uses a static Vite frontend, hosted Supabase Auth/Postgres and five Edge Functions. Provisioning a resource does not establish release acceptance. The current evidence and outstanding gates are in [EXECUTION.md](EXECUTION.md) and [acceptance-matrix.md](acceptance-matrix.md).

## Configuration boundaries

- Browser build: `VITE_SUPABASE_URL`, publishable/anonymous `VITE_SUPABASE_ANON_KEY`, `VITE_TURNSTILE_SITE_KEY`, the public auth availability flags, and the three public LLM provider disclosure fields from `.env.example`. Enable `VITE_AUTH_GOOGLE_ENABLED` only after hosted Google OAuth is configured. Keep email disabled until public SMTP is actually available.
- Server: `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`, `LLM_STRUCTURED_FORMAT`, `ALLOWED_ORIGINS`. Supabase supplies its own reserved `SUPABASE_*` variables to Edge Functions. Never put a service-role key or model key in `VITE_*`.
- Local private integration tests: `.env.server.local`, ignored by Git. Tests use Node's `--env-file` option; do not print the file or pass secret values in command arguments.
- `TOOL_RECOMMENDATIONS_ENABLED=false`, `TITLE_GENERATION_ENABLED=false`, and `MEMORY_MAINTENANCE_ENABLED=false` independently disable optional server work. They do not disable user deletion or privacy controls.

The approved model trial is Cloudflare Workers AI `@cf/qwen/qwen3-30b-a3b-fp8`, through the account's `/ai/v1` OpenAI-compatible endpoint, with `json_object` output. Its free allowance and Korean output quality must be checked against actual usage and the benchmark. Do not enable paid usage as an implicit fallback. Provider selection is not a model-quality pass.

## Database changes

1. Run `pnpm lint`, `pnpm typecheck`, relevant tests, and `pnpm build`. PostgreSQL persistence tests are `pnpm test tests/db/persistence.test.ts`.
2. Read `supabase_migrations.schema_migrations` remotely and identify its last applied version.
3. For an existing database, run `node scripts/prepare-migrations.mjs --after <last-applied-12-digit-version>`. This writes a transaction to `supabase/.temp/pending-migrations.sql`. The SQL checks the expected remote history and acquires an advisory lock before applying changes.
4. Inspect the pending migration files and apply the generated transaction using `node node_modules/supabase/dist/supabase.js db query --linked --project-ref <project-ref> --file supabase/.temp/pending-migrations.sql`.
5. Read back the migration history and run the relevant remote smoke. Never edit an applied migration to represent a new deployment.

Migration 013 adds forward-only extraction/summary consent floors and the aggregated `blockedRelatedPeople` RPC field. Apply it before the updated Edge context reader, which fails closed when this privacy metadata is absent. Related-person deletion, or removal of an old blocked alias by rename/re-consent, retires only matching derived memory rows; raw messages are preserved. This follows the existing conservative forgetting policy: a scope/subject suppression can prevent future extraction for that subject, and any suppression prevents summary reconstruction. It is not a complete detector for unknown people or indirect references.

Without `--after`, the preparation script writes `initial-migrations.sql` for an empty JumZip project only; its guard rejects existing history or a `profiles` table. Do not use it for updates. A SQL transaction failure rolls back the batch. After commit, use a reviewed forward migration to correct a problem; do not reset the hosted database.

## Edge release

Migration 014 must precede the frontend record-deletion dialogs. `history_deletion_memories` returns owner-scoped candidates with their known conversation provenance, and `delete_history_with_memories` atomically validates/deletes only explicitly selected IDs and the record. An empty selection preserves independent memories; a stale/foreign selection rolls back. Neither RPC accepts a caller-supplied owner ID. Hosted regression evidence is `docs/evidence/backend-history-deletion-smoke.json`.

The v5/Intent-v2 source checkpoint is a benchmark candidate, not an instruction to switch production providers. Production remains Qwen/v4 until the candidate's semantic and actual integration checks are accepted. Preserve the failed v5 output/reviews and original full84 corpus.

Deploy with:

```powershell
node node_modules/supabase/dist/supabase.js functions deploy --project-ref <project-ref> --use-api --import-map supabase/functions/deno.json --jobs 3
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

## Retention and operational checks

`scripts/setup-housekeeping.sql` registers an hourly `jumzip-anonymous-90-day-cleanup` job at minute 13 UTC. It processes at most 100 inactive anonymous accounts per run and protects linked identities. Check `cron.job_run_details` for actual scheduled success; a registration response is insufficient. Function-level retention behavior also has PostgreSQL tests.

Keep the last verified frontend deployment available for rollback. Use new deployments for frontend changes and forward-compatible server migrations. During a provider outage, persisted fortune results remain available with an explicit partial status and interpretation retry. Do not regenerate cards or calculations as an outage workaround.

## Release evidence

Record the Git revision, migration head, Edge release timestamp, public URL, environment names (never values), local check counts, actual integration reports, benchmark assessment and any unresolved gates. A skipped live benchmark, fixture-only browser run, missing SMTP or unresolved Saju convention remains a documented gap.

Primary operational references: [Supabase email delivery](https://supabase.com/docs/guides/auth/auth-smtp), [anonymous sign-ins](https://supabase.com/docs/guides/auth/auth-anonymous), [Cron](https://supabase.com/docs/guides/cron), [Cloudflare Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/), [OpenAI compatibility](https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/).
