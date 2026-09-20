# Provider repair context: independent regression review

Reviewer: **Codex / contracts_audit (AI)**. Verified 2026-09-20 09:49 KST.

The new repair ordering preserves the original task as the final user payload across Intent, Memory extraction, conversation summaries, title generation, and ordinary Chat. Nine independent offline tests pass against the implemented provider. These are transport and validator regressions with explicitly supplied **TEST_DOUBLE** outputs; they do not demonstrate improved live model accuracy or full Persona acceptance.

## Observed defect and corrected boundary

In the frozen Intent v4 run, the repaired outputs for `v4-assistant-only-alias-unresolved` and `v4-recent-user-choice-pair` used `응답 검증에 실패했습니다.` as `intentEvidenceQuote` and classified the repair instruction as GENERAL_CHAT / small_talk. The original validator rejected both because that quote did not occur in the actual current input. No valid recommendation was produced from those repair outputs.

The reviewed [provider implementation](../supabase/functions/_shared/llm/provider.ts#L164) clones the original messages, places server-controlled repair instructions in the leading system context, preserves the original context, and appends the failed assistant output followed by an exact replay of the original final user message. It neither wraps nor rewrites that final payload. It does not depend on a system message after the conversation. The original final user must exist; the implementation fails closed when the final role is different.

The provider now allowlists issue codes before promoting diagnostics into system context. Invalid response text stays in an assistant message, and user/context data stays at its original authority. Tarot's bounded path/reason guidance remains specific to that response contract. The original validators remain responsible for acceptance.

## Independent tests and results

New file: [structured-repair-context.test.ts](../tests/persona/structured-repair-context.test.ts).

| Checks | Result |
| --- | --- |
| Existing leading system and absent leading system, with frozen original messages | 2 passing cases. No input mutation; all original nonsystem messages remain in order; original final user bytes, including JSON whitespace, are replayed exactly. |
| Actual two v4 initial/repair output pairs | 2 passing cases. The observed repair-meta quotes still fail the real Intent validator. Replacing only the supplied repair output with valid original-input evidence succeeds through the existing router and missing-slot rules. Failed null and validated NONE are not conflated. |
| Memory extraction | 2 passing cases. An unauthorized related-person subject triggers repair; a grounded consenting candidate is accepted while sensitive output is omitted. Repair-instruction text does not become memory evidence, even after a second attempt. |
| Conversation summary | 1 passing case. A sensitive initial output triggers repair; the safe summary succeeds against the original minimized input. Blocked-person history, its assistant echo, and the blocked previous summary remain absent. |
| Title generation | 1 passing case through the actual title validator. A sensitive title is rejected, then a safe title is accepted using the same original JSON payload. No database method is invoked. |
| Ordinary Chat | 1 passing case through `generatePersonaReply`. Context/current-user/rejected-output canaries never enter system messages, the exact current user remains last, and the repaired public response keeps its existing shape. |

Across these cases, the injected JSON schema remains unchanged. Intent/structured requests retain 350 output tokens and temperature 0.1; the tested Chat request retains 900 tokens and temperatures 0.65/0.15. Every repair case makes exactly two injected transport calls. The global network function is guarded and verified unused in every test.

Commands executed successfully:

```text
node node_modules/vitest/vitest.mjs run tests/persona/structured-repair-context.test.ts
  1 file, 9 tests passed
node node_modules/typescript/bin/tsc -b --pretty false
  exit 0
node node_modules/eslint/bin/eslint.js tests/persona/structured-repair-context.test.ts
  exit 0
```

## Limits and ownership

- Only the new test file and this document were written by this reviewer. Provider implementation, existing tests, prompt/version changes, package files, and production artifacts are owned by Main/Domain and were not edited here.
- Historical raw outputs are read as immutable regression fixtures; neither the failed historical cases nor their source expectations were rewritten.
- The tests verify data boundaries and existing validators, not that a model will choose the correct target or obey semantic instructions. No live inference, credential access, account mutation, or external request occurred.
- The original payload is intentionally present twice in the **repair transport**. Input tokens and cost can rise even though output/time/attempt limits do not change. Fresh request-size preflight remains necessary before any separately authorized live run.
- This independent batch did not rerun timeout timers, all Tarot combinations, or the full application build. Domain/Main own those integration checks. The tests make no deployment, full-84, or human-review claim.

No actionable defect was found in the implemented repair ordering within this scope.

Reviewed UTF-8/LF SHA-256 bindings: provider `ff694aaf8c69c2cde1c9d25c76ba64c22c0f4dd0bf28c5bb2a963ec9e58b9eb9`; new test `793c011869ef7aa4503549de088b92c225d1b4beb2d1ded6651e65dbdc56a35b`; historical raw fixture `a65cb456ddf77a3e15b31f69e83a9ac5ea6d2b7c930cb4c11e6784f0327158bf`.
