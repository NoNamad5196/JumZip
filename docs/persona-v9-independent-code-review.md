# Persona v9 / Intent v4 independent code review

Reviewer: **Codex / contracts_audit (AI)**. Date: 2026-09-20 KST.

Read-only review of the implementation diff, complete relevant provider/reply/schema/validator/router code, the new v9 repair tests, and all eight new Intent v4 contrasts. No model calls, test execution, production changes, or source edits were made by this reviewer. This document is a code review, not a live semantic acceptance result. Main owns integration checks; the runtime and fixture owners own corrections.

## Result

No blocking runtime defect found in the reviewed Persona v9 change. One small Intent fixture inconsistency was reported to its owner: the conversation-only concern example supplied `recentSituationPresent: true` despite the new prompt requiring a concrete event, action, or relationship state. Its expected slots also omitted that assertion. The owner accepted changing both mock and expectation to `false`; the NONE recommendation itself is unaffected. The final verification of that correction is recorded below.

## Persona v9 boundaries

- [provider.ts:36](../supabase/functions/_shared/llm/provider.ts#L36): the new helper produces advisory paths and fixed reason codes. It inspects at most 12 evidence rows and emits at most 16 distinct diagnostics. It does not echo field values into the extra feedback, invent a replacement quote, modify the previous output, or decide validity. The existing repair conversation still contains the invalid assistant output, as it did before v9.
- [provider.ts:176](../supabase/functions/_shared/llm/provider.ts#L176): the extra guidance is appended only for the server-selected `TAROT_EVIDENCE_V1` contract. DEFAULT chat/Saju repair and structured Intent/Memory repair keep the existing generic repair text. The server schema continues to be supplied in both initial and repair requests.
- [prompt.ts:28](../supabase/functions/_shared/persona/prompt.ts#L28): the added instruction explains the existing contiguous-span rule. It requests an exact span from the generated final text, including particles, spacing, and punctuation, rather than a new comma-joined phrase. It contains no fixture identifiers, card-specific expected answer, provider output, or fabricated quotation.
- [chat-contract.ts:3](../supabase/functions/_shared/llm/chat-contract.ts#L3): the authoritative evidence limit remains **200 characters**, with at most three rows and one to five keyword indices per row. The schema, `validator.ts`, and deterministic router have no diff in this batch. Advisory diagnostics do not relax validation or bypass the final validator.
- [reply.ts:18](../supabase/functions/_shared/llm/reply.ts#L18): initial output and the single permitted repair are still validated through the same function. A second invalid result throws `LLM_INVALID_RESPONSE`. Public content/segments/repaired/metadata fields are unchanged; evidence and diagnostics are not added to the public response. The reply-file diff only changes the prompt version to v9.
- [provider.ts:94](../supabase/functions/_shared/llm/provider.ts#L94): configured timeout handling, 60-second initial/30-second repair maximums, default 900 output tokens, nonstreaming requests, temperatures, 128,000-byte response ceiling, and rejection of `finish_reason: length` are unchanged. Structured requests still permit one repair with their own schema. This review does not claim that extra repair instructions consume no additional input tokens.

The [v9 repair tests](../tests/persona/v9-repair.test.ts) meaningfully cover valid repair versus repeated-invalid failure, unchanged DEFAULT/structured feedback, bounded malformed-output diagnostics without data echo, and unchanged public output. They explicitly retain a structurally valid but semantically wrong reversed-card example; this correctly shows that exact lexical evidence does **not** establish direction, cause, or interpretation quality. These tests use test doubles and were read, not executed, during this review.

## Intent v4 consistency

[intent.ts:155](../supabase/functions/_shared/llm/intent.ts#L155) clarifies topic before period and separates a vague concern from ordinary small talk. [Line 159](../supabase/functions/_shared/llm/intent.ts#L159) clarifies concrete recent situation. Enum/schema/validator, data minimization, explicit-tool handling, high-stakes suppression, and the deterministic recommendation matrix are unchanged. There is no fixture-specific keyword branch or automatic tool execution.

The eight [new contrasts](../tests/persona/intent-v4-corpus.ts) align with the existing router:

| Contrast | Expected existing behavior |
| --- | --- |
| Filtered recent user alias | User alias uses the minimized array's index; relationship Tarot has its target and period. |
| Assistant-only alias | Alias remains unresolved; relationship Tarot requests `targetPerson`. |
| Two prior career alternatives | The two real, relevant prior choices satisfy `choices`; current contract renewal supplies recent situation. |
| Irrelevant prior quotes | Park/lunch text does not become career alternatives; `choices` stays missing. |
| Overall monthly flow | With own birth information available, SAJU / MONTHLY. |
| Monthly relationship flow | Specific relationship topic remains TAROT / RELATIONSHIP_3. |
| Semantic medical high stakes | A validated `highStakes: true` suppresses an explicit Tarot request; validated NONE is distinguished from failed classification. |
| Conversation-only vague concern | GENERAL_CHAT / general_concern produces NONE. The recent-situation fixture correction is noted above. |

The original 18 inputs and expectations are imported unchanged. The new tests explicitly demonstrate that source-valid wrong topic classifications and irrelevant quote pairs remain observable semantic errors: the code does not silently repair those meanings. The runner excludes `mockClassification` from the selection artifact and sends only `item.input` through the real extraction API. Its automatic checks leave `semanticReview: UNREVIEWED` and distinguish VALID_NONE from FAILED_NULL. Actual accuracy still requires direct review of any future real outputs; this review grants no full-84 acceptance.

## Correction verification

**Resolved before freeze.** The owner removed the mock override, so it uses the existing `false` default, and fixed `expectedSlots.recentSituationPresent` to `false` at [intent-v4-corpus.ts:78–80](../tests/persona/intent-v4-corpus.ts#L78). I re-read these final lines and independently calculated the LF-normalized corpus SHA-256: `e22a9a9b332aaa8a3ee664b01bfcaa29ec740e72b31b4b567fe58e3af35c1d9f`. The correction changes neither the original 18 cases nor production runtime. The owner reports 14 related tests and scoped lint passing; this reviewer did not rerun those checks. No open actionable finding remains within the reviewed scope.

## Reviewed source binding

SHA-256 of UTF-8 source normalized to LF, captured during review:

| File | SHA-256 |
| --- | --- |
| `llm/provider.ts` | `b1b1edc89be8e8705823446214dfd044119ecad63e71e88fc343b322fb181cf9` |
| `persona/prompt.ts` | `f8e1893e66f02129665ebcf16fc08b14d4c5581a3d7a2f063f5fbc52b4bd2d16` |
| `llm/reply.ts` | `8e8b2d6a0f28f74681daaa7f08e34dbede0524b2f13e935bb2f5af2290b0d1b7` |
| `llm/validator.ts` | `53f193878948847e7f4e7c5f4d1ecd3de56fb153f71f56cc91162e06ea203555` |
| `llm/chat-contract.ts` | `0e549094905b38060a14092b600cd1fbb46c0a41eb66d73bb43d6575a10bde78` |
| `llm/intent.ts` | `a5a35e1144571472a163247087be5dc9e134ed7f1c4a47c51c1015af533d9983` |
| `domain/router.ts` | `744e1b07a32183d9839f203ece853b4a19b3a847e956032d5f5b38ccf0a2f845` |
| `tests/persona/v9-repair.test.ts` | `4a601441ec469ad16f740b341a92ee6923b5610a41adf35ac8ef2e70dde24858` |
| `tests/persona/intent-v4.test.ts` | `6314f5dfcacfd9e7d19dbd8dac9906f272b60220253963fbe422eac8c835511d` |

The first seven paths are relative to `supabase/functions/_shared/`. The fixture's pre-correction hash was `bd71ca210aab23c63dc10bc2b11a051f26fdd26bae48be7403cac30779eeaff6`; its final binding is recorded with the correction verification above. No primary semantic review was used to derive these findings.
