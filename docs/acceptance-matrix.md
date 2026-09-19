# JumZip Core v1 acceptance matrix

Checkpoint: 2026-09-20 05:36 KST. **Core v1 and authenticated public-release acceptance remain incomplete.** The corrected frontend is publicly verified; the initial repository CI passed and the next checked commit is pending. Implementation, local doubles, privileged hosted smoke and public browser checks are tracked separately. The original [03:10 audit](audits/2026-09-20-0310.md) is historical and superseded by this document and newer batch evidence.

Source: [Engineering](https://app.notion.com/p/3df7cdef782d81d7b3a6d28b604f050f), [API](https://app.notion.com/p/3e07cdef782d8132bd82f38ad9a171c9), [Acceptance](https://app.notion.com/p/3e07cdef782d81da92ecf20053a3bff9). User-approved M7.5 and M9 conventions are recorded in their rule documents.

| Milestone | Implemented and verified evidence | Remaining acceptance |
| --- | --- | --- |
| M0 Bootstrap | React/Vite/TS, pnpm lock, lint, CI; initial main commit and actual GitHub CI passed; latest whole 541 tests / 3 live skips, lint/TS/build and 6 browser tests pass | Next checked commit/CI; Docker local stack unavailable |
| M1 Frontend shell | Nine routes, 26 canonical assets, self-hosted fonts; deployed JIT-free form validation; actual public CSP violations zero and all 8 JS hashes match dist | Authenticated visual check |
| M2 Auth/DB/RLS | Hosted migrations 001–013; v2 62 remote checks; new maintenance23/23 and Edge20/20; anonymous/manual linking and Turnstile enabled; missing/invalid CAPTCHA rejected | Successful public CAPTCHA onboarding, Google linking/second session restore |
| M3 Chat | Actual latest Edge Chat/replay/Tarot/retry/provenance/RLS20/20; uncertain network retries preserve the original request across reload without mixing explicit consultations | Public browser sequence and fresh-conversation recall after model fixes |
| M4 Provider/validator/repair | JSON-object requests include schema in initial and repair; malformed gateway replies become recoverable service errors; Gemma comparison 84/84 valid | Qwen recall validation and semantic fidelity; production model remains Qwen; local llama.cpp compatibility unrun |
| M5 Persona | Three configurations and UX; full Qwen baseline/v2, focused v3/v4 and full Gemma outputs reviewed | Semantic release assessments still FAILED; need mean >=8 and Hard Fail 0 |
| M6 Tarot/Daily | CSPRNG and persisted draws, daily reuse/idempotency/retry verified remotely; real interpretation wired | Actual public interpretation/follow-up/Daily rollover and retry sequence |
| M7 Foundation | Remote 15-case engine run; independent frozen 22 cases across 12 classes, 23 tests pass; KASI2020/HKO1988 supplement closes three month omissions with 4 more tests | Broader independent calendar coverage; no claim of full astronomical certification |
| M7.5 Rule freeze | A–G approved, product-policy distinction and independent frozen expectations documented | No unresolved A–G gate; new rule changes still need adoption |
| M8 Full engine | Strength/Balance/relations/patterns/shinsal, saved immutable result; real M9 flow includes Full Saju | Broader external astronomical golden coverage; public rendering/interpretation |
| M9 Luck/overlays | Civil-date convention approved; independent dates frozen; 35 actual remote checks passed, five model successes; retry preserves asOf and ruleVersion | Public known/unknown/compatibility date display acceptance |
| M10 Compatibility | Tarot and derived Saju implemented; remote consent/raw birth exclusion/immutable retry checked | Public A/B UI and semantic model fidelity after benchmark fixes |
| M11 Intent/recommendation | Matrix and inference tests; v3 actual explicit Tarot Chat succeeds; smoke expects a valid Tarot recommendation rather than an unsupported text-to-spread rule | Pure recall was misclassified as natal personality; verify corrected full real matrix |
| M12 Memory/related person | Deployed consent floors, zero-row withdrawal, alias retirement/races/cascade; corrected identical17-turn real maintenance23/23, persisted extraction/summary, no resurrection and cleanup0 | Fresh-conversation recall and public lifecycle acceptance; old failed500-token report retained |
| M13 History/title/export | Actual AI titles/manual preservation; PNG export; hosted pagination retrieves all 1,005 messages; deployed paging/search, guarded complete-only export | Public authenticated export and restored history |
| M14 Persona UX | Loading/error/partial/retry, draft identity reset, uncertain request reuse, keyboard focus and reduced motion | Real public slow/network-loss and corrected model safety |
| M15 Benchmark | Qwen baseline84/v2 full84/v3 and v4 focused36; Gemma full84 valid, 85 HTTP attempts, 2,504.052313 neurons; independent core9.25 with one Hard Fail | Gemma core reverses a card meaning; supplement erases known input. Full acceptance FAILED despite higher scores |
| M16 Responsive | 20 populated fixture views; 6 intercepted Playwright cases; actual12 guest views without overflow/page/CSP errors; 360/390px wrap corrections publicly verified with9 asset hashes matching dist | Authenticated data/reduced-motion/export; challenge DNS limitation remains |
| M17 Security/deploy | Updated Pages and five Edge functions live; actual consent23/23 and deployed-flow20/20; RLS/cascade/retention/credential scans; registry audit zero advisories across349 dependencies | Actual public signup/link/delete, next CI and semantic quality |

## Evidence and limits

- `scripts/smoke-remote.mjs` and [tracked v2 evidence](evidence/backend-remote-smoke-v2.json): 62 actual hosted checks with successful model branches, plus independently confirmed cleanup. Earlier 63-check outputs were removed when Playwright reused its default output directory; their historical result is recorded, but the old raw artifacts are no longer claimed available. Playwright now uses `test-results/playwright`.
- `tests/backend/live-m9-smoke.mjs`, `test-results/remote-m9-smoke.json`: 35 actual hosted checks after migration 012, including known/unknown/missing gender/compatibility/retry. Admin-created sessions do not test guest signup.
- [v2 conversation](evidence/backend-conversation-v2.json) failed memory/explicit Tarot. [v3 conversation](evidence/backend-conversation-v3.json) now passes actual extraction, both AI titles, manual title protection and Tarot retry, but fails fresh-conversation recall. Preserve failures and distinguish individual passing checks from suite acceptance.
- `tests/persona/benchmark-baseline-manifest.json`, `benchmark-results.json`, `saju-benchmark-results.json`, [independent core review](persona-core-independent-review.md), [benchmark review](persona-benchmark-review.md): 84 live entries, 89 HTTP attempts, 1,854.6405 accounted neurons. JSON validity and semantic quality are different gates. AI review is labeled honestly; no invented human-only requirement.
- [v2 reviews](persona-benchmark-v2-review.md): primary core 7.58/10 and independent core 7.05/10, both FAILED; supplement 7.00/10 with confirmed hard failures. The 36-entry v3 focused run is diagnostic regression, not a replacement for the original complete corpus.
- `tests/domain/frozen-expectations.ts`, `luck-start-expectations.ts` and [new independent foundation evidence](foundation-independent-evidence.md): explicit product-rule derivations with frozen expected values. KASI/IANA supply the identified calendar/time facts; they do not certify astrology.
- [Hosted pagination evidence](evidence/service-pagination.json): production service methods, 1,005 messages across six pages, deterministic ties/nulls, literal search/type/cursor combination, no pending cleanup. The corrected frontend was uploaded as 174 files and Pages returned Success at approximately 05:19 KST; public verification of this revision is running separately.
- `tests/ui/fixture-visual-check.mjs` and `tests/e2e/navigation.spec.ts`: browser fixture tests intercept service requests. They never count as real Auth/LLM success.
- `test-results/` and `tests/ui/artifacts/` are ignored local execution artifacts. Safe result summaries needed for release must be copied into tracked evidence, with no session tokens, personal data or keys.

## Next integration gates

05:04 update: the combined pagination/CSP/provider/foundation batch passed whole lint, TypeScript, 494 tests / three explicit live skips, build, asset/credential scans and six Playwright tests. The three selected M7 month omissions are now filled by [new independently frozen evidence](foundation-supplement-evidence.md); broader calendar certification remains outside scope. Pagination UI and JIT-free CSP validation are implemented and checked, pending public upload. [v4 focused review](persona-benchmark-v4-focused-review.md) remains FAILED despite36 valid JSON responses: its supplemental subset has two hard failures. A separate controlled recall probe identifies omitted required JSON fields; it is not an exact replay of deleted test state.

1. Push the checked consent/pagination/provider/mobile batch and inspect its actual CI.
2. Correct reply/intent recall failures. Actual maintenance23/23 and deployed flow20/20 are preserved separately from public Auth acceptance.
3. Improve the remaining model fact/uncertainty errors, validate focused cases, then rerun the original complete corpus within the free allowance. Preserve failures and use the original five-axis rubric and hard-fail definitions.
4. Configure Google OAuth after owner-controlled MFA setup, then deploy confirmed public auth flags and test anonymous-to-linked UID continuity.
5. Public authenticated regression across Chat, Tarot, Daily, Saju, compatibility, History, memory, export, retry and deletion. Preserve the verified deployment while continuing Core v1 work.
