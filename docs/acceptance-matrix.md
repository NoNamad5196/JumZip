# JumZip Core v1 acceptance matrix

Checkpoint: 2026-09-20 04:15 KST. **Core v1 and public-release acceptance remain incomplete.** Implementation, local doubles, privileged hosted smoke and actual public browser checks are tracked separately. The original [03:10 audit](audits/2026-09-20-0310.md) is historical and superseded by this document and newer batch evidence.

Source: [Engineering](https://app.notion.com/p/3df7cdef782d81d7b3a6d28b604f050f), [API](https://app.notion.com/p/3e07cdef782d8132bd82f38ad9a171c9), [Acceptance](https://app.notion.com/p/3e07cdef782d81da92ecf20053a3bff9). User-approved M7.5 and M9 conventions are recorded in their rule documents.

| Milestone | Implemented and verified evidence | Remaining acceptance |
| --- | --- | --- |
| M0 Bootstrap | React/Vite/TS, pnpm lock, lint, CI definition; last whole check 420 passed / 2 intentional live skips | Initial Git push and actual hosted CI; Docker local stack unavailable |
| M1 Frontend shell | Nine routes, 26 canonical assets matched by hashes, self-hosted fonts | Public route reload/CSP/visual check |
| M2 Auth/DB/RLS | Hosted migrations 001–012; 63 remote integration checks; anonymous/manual linking enabled; Turnstile enabled and survives reload | Actual CAPTCHA onboarding/rejection, Google linking/second session restore |
| M3 Chat | Actual Chat success and model provenance persisted; retry/idempotency/RLS tests | Full live conversation/reload sequence after model fixes |
| M4 Provider/validator/repair | Actual Cloudflare JSON responses; baseline one successful repair; bounded validation/timeouts tested | Correct Qwen truncation/example contamination and rerun; local llama.cpp compatibility unrun |
| M5 Persona | Three configurations and UX; 60 actual core outputs reviewed | Baseline quality FAILED, operational mean 7.03/10; need mean >=8 and Hard Fail 0 |
| M6 Tarot/Daily | CSPRNG and persisted draws, daily reuse/idempotency/retry verified remotely; real interpretation wired | Actual public interpretation/follow-up/Daily rollover and retry sequence |
| M7 Foundation | Twelve local fixture types, remote 15-case engine run; KASI 15 day-pillar/6-term evidence | Independent full expected charts for every required boundary class; evidence is not full calendar certification |
| M7.5 Rule freeze | A–G approved, product-policy distinction and independent frozen expectations documented | No unresolved A–G gate; new rule changes still need adoption |
| M8 Full engine | Strength/Balance/relations/patterns/shinsal, saved immutable result; real M9 flow includes Full Saju | Broader external astronomical golden coverage; public rendering/interpretation |
| M9 Luck/overlays | Civil-date convention approved; independent dates frozen; 35 actual remote checks passed, five model successes; retry preserves asOf and ruleVersion | Public known/unknown/compatibility date display acceptance |
| M10 Compatibility | Tarot and derived Saju implemented; remote consent/raw birth exclusion/immutable retry checked | Public A/B UI and semantic model fidelity after benchmark fixes |
| M11 Intent/recommendation | Matrix, inference orchestration and structured metadata local tests | Real explicit Tarot Chat failed validator in first conversation smoke; rerun required |
| M12 Memory/related person | Consent, tombstones, revision races, opt-out controls and lifecycle local tests | Actual extraction cursor did not commit; diagnose with safe telemetry, verify recall/withdrawal; summary compaction not yet exercised live |
| M13 History/title/export | Persisted reload and deletion remotely checked; three actual local PNG export types; title CAS/manual override tests | Real AI title, public export and resumed history; older-history pagination remains limited |
| M14 Persona UX | Loading/error/partial/retry, input preservation, keyboard focus, reduced-motion paths | Real public slow/network-loss and corrected model safety |
| M15 Benchmark | Actual 60+24 outputs, frozen source hashes, latency/usage and independent AI reviewer provenance preserved | FAILED baseline: person confusion, invented probabilities/tool facts, style leakage. Revised prompt/provider must be rerun and semantically reviewed |
| M16 Responsive | 20 populated fixture views; 39 UI tests plus 4 desktop/mobile intercepted Playwright tests; modal focus fixed | Public live-data desktop/mobile/reduced-motion/export checks |
| M17 Security/deploy | Auth/RLS/rate/leases/cascade tests; actual 63 remote passes, scheduled retention success, dependency prod audit 0 vulnerabilities, credential scans | Pages upload/deploy, actual CORS/CSP/anonymous/link/delete acceptance, latest telemetry/model deployment and regression |

## Evidence and limits

- `scripts/smoke-remote.mjs` and `test-results/remote-smoke.json`: 63 actual hosted checks after migration 011. A preceding cascade failure and its recovery are preserved. Disposable identity and child-data cleanup verified.
- `tests/backend/live-m9-smoke.mjs`, `test-results/remote-m9-smoke.json`: 35 actual hosted checks after migration 012, including known/unknown/missing gender/compatibility/retry. Admin-created sessions do not test guest signup.
- `tests/backend/live-conversation-smoke.mjs`, `test-results/remote-conversation-smoke.json`: FAILED; one successful Chat, no extraction cursor and following LLM_INVALID_RESPONSE. It is not counted as memory/title/intent acceptance.
- `tests/persona/benchmark-baseline-manifest.json`, `benchmark-results.json`, `saju-benchmark-results.json`, [independent core review](persona-core-independent-review.md), [benchmark review](persona-benchmark-review.md): 84 live entries, 89 HTTP attempts, 1,854.6405 accounted neurons. JSON validity and semantic quality are different gates. AI review is labeled honestly; no invented human-only requirement.
- `tests/domain/frozen-expectations.ts` and `luck-start-expectations.ts`: independent product-rule fixtures, not external astronomical goldens. See [calendar evidence](calendar-evidence.md).
- `tests/ui/fixture-visual-check.mjs` and `tests/e2e/navigation.spec.ts`: browser fixture tests intercept service requests. They never count as real Auth/LLM success.
- `test-results/` and `tests/ui/artifacts/` are ignored local execution artifacts. Safe result summaries needed for release must be copied into tracked evidence, with no session tokens, personal data or keys.

## Next integration gates

1. Finish and freeze safe telemetry, Google UI and model-fidelity fixes; lint, typecheck, related tests, production build and secret/asset checks.
2. Commit and push to the user-specified repository; inspect actual GitHub Actions results.
3. Deploy updated Edge code and rerun actual conversation/memory/title/intent cases. Use synthetic disposable identities, ledger every identity immediately, clean up in finally.
4. Rerun baseline after versioned model fixes within free usage. Keep all unsuccessful outputs and review all cases against the original five-axis rubric and hard-fail definitions.
5. Configure Google OAuth after owner-controlled MFA setup, then deploy Pages with confirmed public auth flags and test actual anonymous-to-linked UID continuity.
6. Public regression across Chat, Tarot, Daily, Saju, compatibility, History, memory, export, retries and deletion. Keep the verified release intact while continuing remaining Core v1 work.
