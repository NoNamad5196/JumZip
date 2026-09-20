# Isolated v4.1 chat reliability release

This is a narrow patch of the deployed 53-file Saju-focus release. It does not copy the current candidate runtime. `prepare-chat-reliability-release.mjs` verifies the pinned manifest file list, complete original Git tree, and all 53 staged Git blob hashes before applying these reviewed support files. `.ts.txt` files become TypeScript only inside a new ignored stage.

```powershell
node scripts/prepare-chat-reliability-release.mjs --check
node scripts/prepare-chat-reliability-release.mjs
node --experimental-transform-types scripts/chat-reliability-release/check-stage.mjs <returned-stage> --save-report
node node_modules/vitest/vitest.mjs run tests/persona/v4-1-release.test.ts
```

Preparation produces a new `supabase/.temp/chat-reliability-v4-1-*` directory, a `release-manifest.json` with all 54 deployment-file hashes, and, after verification, `offline-verification.json`. Both reports use exclusive creation. No command above accesses credentials, calls a service/model, changes current runtime, or deploys. The verifier installs a rejecting global fetch and supplies explicit transport doubles.

The release adds one file and changes eight existing files:

- `llm/chat-contract.ts`: only `DEFAULT` and `TEXT_ONLY_V1`. Only absent/null tool data selects text-only; every non-null value keeps DEFAULT.
- `llm/provider.ts`: declared text-only schema, bounded fixed diagnostic projection, original-final-user repair. Qwen model handling, token/body/time limits, and one repair remain. No Gemma handling, Tarot evidence contract, canonical repair table, or structured diagnostic mapper is imported.
- `llm/reply.ts`: selects the contract, records `JumZipPersona-v4.1`, and projects failed validation diagnostics.
- `llm/validator.ts`: text-only shape plus internal empty references, retaining v4 text safety checks. Existing DEFAULT Tarot reference and Saju numeric checks stay.
- `persona/prompt.ts`: changes only the output-format block for absent tools. The exported v4 global rules and tool-bearing initial system prompt remain unchanged.
- `http/errors.ts`: fixed diagnostic fields and safe provider-reason preservation, copied from the reviewed frozen helper (LF SHA-256 `b8308baf51333630d125d5c724c9e26a6553b5e9800963f5ecbfe0e4899d7c98`).
- Three orchestration files: import that helper and preserve its safe reason inside existing PARTIAL details. All deletion checks, Saju focus lookups, request/replay handling and public execution status remain from the deployed release.

The model remains `@cf/qwen/qwen3-30b-a3b-fp8`; Intent remains `JumZipIntent-v1`. Normal replies retain their existing public fields. Tool replies still require v4 `toolReferences`; they do not use the unaccepted v8–v12 Tarot evidence contract. If repair has no original final user message it fails before a repair HTTP request instead of inventing a request. Structured callers retain generic repair guidance.

`captured-v4-recall.json` contains two exact synthetic responses from the recorded Qwen v4 recall probe, with original-file and per-content hashes. Both omitted `toolReferences`. Offline verification demonstrates their old schema rejection and their new explicitly selected text-only validation, preserving their text. This is retrospective contract compatibility, not fresh model quality evidence.

The verifier also checks DEFAULT schema/global-rule equality to Git-backed v4, 54-file readback before and after, staged TypeScript, four reply transport cases, structured repair context, safety refusals, original user preservation, no raw-error promotion, rate-limit cause through PARTIAL, response-byte cap and hanging-body timeout. Semantic persona quality, fresh provider availability, hosted behavior, and release authorization remain separate; no offline result declares them passed.
