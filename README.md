# JumZip

Character-first Korean fortune conversations. React + Vite, Supabase Auth/PostgreSQL/Edge Functions, OpenAI-compatible model provider.

## Development

Use Node 24 and pnpm 11.19.0. Install with `pnpm install`, set the public frontend variables from `.env.example` in `.env.local`, and enable only the login providers actually configured in Supabase. Server credentials belong only in Supabase Secrets or `.env.server.local`, both excluded from the browser build. Local environment files are ignored by Git.

Run `pnpm dev`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`. On this Windows host, if `pnpm exec` cannot resolve a CLI, use its Node entry point (for example `node node_modules/vitest/vitest.mjs run`).

Local backend requires Docker Desktop: `node node_modules/supabase/dist/supabase.js start`. Apply the migrations, then serve Edge Functions with local server environment. Production must enable anonymous authentication and Turnstile, configure redirect allowlists, provision an actual model endpoint, and apply the public-release checklist before release.

## Current status

Implementation is in progress. See [execution status](docs/EXECUTION.md), [deployment runbook](docs/deployment-runbook.md), [asset provenance](docs/assets-audit.md), and [Saju rule gate](docs/saju-rule-freeze.md). Missing backend/model configuration produces an explicit unavailable state; it never simulates a successful fortune reading.

## Data integrity

Tarot draws use server-side cryptographic randomness and are committed before model interpretation. Retrying interpretation loads persisted cards. Request IDs and normalized payload hashes prevent duplicate user messages or redraws after network failures. RLS isolates users; authoritative data can only be authored through service-role RPCs after server authentication.
