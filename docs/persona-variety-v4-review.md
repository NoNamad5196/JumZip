# Persona variety: isolated v4.2 release review

Status: deployed at 18:28 KST with the budgeted Luna fallback. Main's final seven-case synthetic run passed transport/contract checks without repair; the three followups omitted unwanted questions. See [both immutable runs and release evidence](evidence/edge-openai-fallback-release.json). Main's first candidate received seven successful transport/contract responses but two explicit interaction-preference failures. The original implementation review and implementation share an AI author; this is not full independent semantic acceptance.

The final replies still have limitations: Bomi's “쉬는 모드로 있자” and Sani's “느슨하게 있어도 되겠다” remain advice-like or permission-giving after the user preferred casual conversation. Several openings also paraphrase the same accomplishment. Removing mandatory questions improved this narrow check, but varied natural conversation and complete respect for all interaction preferences remain unproven. Do not promote the transport `passed` flag or absence of question marks to an overall quality pass.

A separate AI reviewer read all seven final outputs and confirmed those limitations. It additionally noted Arang's unsupported assumption that the user was discounting their achievement, a meta-conversational final acknowledgement, and generic advice/repeated keywords in the Tarot explanation. This supports only transport/schema success and the observed suppression of unwanted questions, not complete advice suppression, expression diversity or Persona quality acceptance. No additional inference was used for that review.

## First live result and bounded revision — 2026-09-20

The immutable `test-results/openai-fallback-live.json` binds the original stage manifest `9634145ff62dc4b3b38c78303fce18c64750f981c9f663c2f444810fcceec14d`. All seven synthetic responses passed transport/schema checks without repair; this report's `passed: true` is not semantic acceptance. Main's run used real Luna requests with primary HTTP 429 mocked, not an actual public conversation.

Two responses failed the explicit request to talk without advice or questions: BOMI-2 ended with “무슨 커피 마셨어?” and SANI-2 with “무슨 얘기 했어?”. BOMI-1 and SANI-1 also closely repeated the same celebration → permission to feel proud → unsolicited action sequence. The first stage and original result remain unchanged. These observations justify a prompt revision; they do not establish that all other responses satisfy every quality criterion.

The revision changes only Bomi/Sani rhythm and reaction within the existing config overlay, and appends general interaction guidance at the very end of the system message, after fictional examples and the caller task. Explicitly declining questions now calls for a response with no follow-up, confirmation question or request to elaborate. Declining advice also excludes softened action, rest or reward suggestions; omitting a question mark is insufficient. Necessary safety guidance is preserved, and requests that welcome questions still permit them. No fixture-specific dialogue, keyword branch, response bank or new validator is added.

Sani's delivery instructions now center on a brief, concrete observation without a default excited opening, quoted emotional paraphrase or invented internal state. Bomi's instructions emphasize response pace and attention to the present detail rather than forced praise or advice. Identity, humor, comfort and serious-response fields remain unchanged. The extra offline regression checks actual reply-to-provider message construction for all three characters with different interaction preferences, including a question-positive control: final guidance follows the caller task, while current user text and prior turns stay in their original roles. These checks establish prompt placement and preservation; broader live acceptance remains required beyond the final seven-case run.

## Evidence and scope

The source is the exact deployed v4 blobs pinned by `docs/evidence/edge-saju-focus-release.json`, also present in `supabase/.temp/gemini-fallback-v4-ywsYaa`. It is not reconstructed from the current candidate backend. Three full-file overlays live in `scripts/openai-fallback-release/`:

| Overlay | Deployment target | Change |
|---|---|---|
| `config.ts.txt` | `_shared/persona/config.ts` | Only rhythm, sentence length, reaction, questioning and memory-reference guidance for each character. |
| `prompt.ts.txt` | `_shared/persona/prompt.ts` | Conditional question use, response structure chosen for the current request, awareness of recent assistant repetition, examples treated as tone rather than wording templates. |
| `reply.ts.txt` | `_shared/llm/reply.ts` | Only the version marker: `JumZipPersona-v4.2`. |

The builder should place these overlays over the pinned v4 files and verify every other file separately. Provider/model/fallback changes belong to Main's separate release work.

## Why repetition is plausible

The old global prompt calls for two to four sentences and one core question; the default task and final instruction reinforce this pattern. Character profiles add ordered sequences such as reaction → emotion → question and literal opening or memory-reference examples. The same four style examples are sent repeatedly, mostly ending in a question or request to elaborate. These instructions plausibly favor repetitive structure despite the existing generic instruction against stock empathy. They do not prove that every repeated output has this cause.

The candidate removes fixed delivery sequences and phrase-like guidance from the relevant profile fields. It permits a short acknowledgement or direct answer to end without a question. Empathy and summarizing are conditional, not obligatory steps. It asks the model to compare recent actual assistant turns, avoid already-answered questions and choose what the present user needs instead of alternating a phrase bank or merely swapping synonyms. Existing fictional examples remain unchanged, with an explicit instruction not to copy their opening, ending, question count or sequence.

## Preserved boundaries and offline checks

Character identity, register and intimacy rules, safety boundaries, original example data, frontend UI copy, memory selection, untrusted context placement, tool projection and birth-data scrubbing remain intact. Every original global safety/grounding rule and the v4 `{text, toolReferences}` contract remain byte-identical. There is no TEXT_ONLY or Tarot evidence-contract import from v12. Reply processing still allows only one validation repair.

`tests/persona/openai-persona-variety.test.ts` loads pinned original modules and candidate overlays in memory. It compares all three identities and four relationship states, actual history/context channels, tool orientation and privacy scrubbing; validates synthetic question-free ordinary and Tarot responses; and verifies missing references and persona breaks still fail or require the same bounded repair. Network and model calls are unnecessary. Instruction assertions establish which instructions are sent, not that a model obeys them.

## Remaining acceptance

A bounded live comparison should inspect complete multi-turn sequences for repeated openings, redundant empathy/summary, repeated or unwanted final questions, relevant use of history and three-character identity. Short and question-free replies are allowed outcomes, not mandatory replacements for every response. Tool grounding and refusal behavior must still be reviewed. Do not claim repetition or overall AI quality is fixed solely from these offline checks.
