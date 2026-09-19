# Actual Qwen3 baseline — Codex AI review

Date: 2026-09-20 KST. Model: `@cf/qwen/qwen3-30b-a3b-fp8`. Prompt: `JumZipPersona-v1`.

**The frozen baseline fails the acceptance target.** Core 60 entries scored **7.03/10** with four confirmed §7 Hard Fail flags. The 58 delivered core replies alone averaged 7.28/10. The separate 24-case Saju supplement scored **6.63/10** with seven confirmed Hard Fail entries. All 84 cases were executed once in order; failures were retained, not selected away or silently retried as fresh cases.

This is **Codex AI qualitative review**, not a human review, blind scripted grading, or a claim of independent human approval. `fortune_audit` read all 84 delivered outputs/failed entries against their fixed inputs and read the failed successful-HTTP provider bodies. `contracts_audit` independently read all 60 core entries and authored their score/evidence table; `fortune_audit` cross-checked that table against the outputs. The [original Test & Acceptance §7](https://app.notion.com/p/3e07cdef782d81da92ecf20053a3bff9) specifies five 0–2 axes, average at least 8/10 and zero Hard Fails; it does not require a human-only reviewer. The AI review is attributed explicitly, and it found a failure rather than supplying an invented approval step.

## Execution evidence

| Suite | Valid replies | Runtime failures | Successful repaired replies | Median latency | p95 latency |
|---|---:|---:|---:|---:|---:|
| Core 20 × 3 | 58 / 60 | 2 | 1 | 2,382 ms | 5,577 ms |
| Saju supplement 8 × 3 | 24 / 24 | 0 | 3 | 3,014 ms | 7,724 ms |

There were **89 actual successful-HTTP inference attempts**, including repair attempts, accounting for **1,854.6405 neurons** from reported token usage. The rate uses [Cloudflare's published Qwen3 pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/): 4,625 neurons per million input tokens and 30,475 per million output tokens. The harness ceiling was 8,500 neurons, reserving 1,500 from the approved 10,000 daily allowance for other activity. No quota response occurred. This run's accounting is not a dashboard total for unrelated account activity.

The completed manifest records all prompt/domain/provider source hashes and `sourceFrozen: true`. A first local attempt failed with transport `EACCES` before any HTTP response; its `.transport-failed.json` artifacts are preserved separately and are excluded from model scoring. The authorized network execution then produced this real baseline.

Artifacts, relative to repository root:

- `tests/persona/benchmark-results.json` and `saju-benchmark-results.json`: immutable initial execution reports. Their old schema's `humanReview: null` labels are historical harness wording, not a human-only acceptance requirement.
- `tests/persona/benchmark-provider-attempts.jsonl`: bounded raw successful provider response bodies, per-attempt token usage, latency and request hashes. No credentials, request headers, or HTTP error bodies are recorded.
- `tests/persona/benchmark-baseline-manifest.json`: source hashes, all 89 attempt measurements, usage accounting and completion.
- `tests/persona/benchmark-core-ai-review.json` and `benchmark-supplement-ai-review.json`: explicitly authored 0–2 scores, evidence and Hard Fail codes for each case.
- `tests/persona/benchmark-ai-reviewed.json` and `saju-benchmark-ai-reviewed.json`: schema 2 reviewed reports with generic `review`, `reviewerKind: AI`, output-bound evidence, baseline hashes and failed assessments. They preserve the unmodified original reports.
- `docs/persona-core-independent-review.md`: independent core review, including the full 60-row table.

## Criteria and findings

Each axis receives 0 for a clear failure, 1 for partial fulfillment, and 2 when fulfilled: Persona fidelity, naturalness, context consistency, tool fidelity, and concision/rhythm. No-tool cases receive tool fidelity credit only when they do not invent tool actions or facts. The two missing user-visible replies receive zero for all five axes in the operational 60-case average; the delivered-only average is reported separately. Automated JSON/reference validation is never used as a substitute for these semantic scores.

The core has distinct successful moments, especially simple Tarot explanations, allowed preference memories and Sani/Arang medical boundaries. However, natural Korean, consistent Persona speech and preservation of current conversation facts vary considerably. The three Personas were not literally identical, so an identical-output Hard Fail was not invented. Persistent generic counselor wording is counted as one grouped Arang pattern, rather than once for every weak phrase.

Confirmed core §7 failures:

| Case | Evidence | Why it fails |
|---|---|---|
| `17-related-people:SANI` | “민수야 … 우리 발표 주제 괜찮아?” | The summary says the presentation agreement was with 지수; 민수 is a new club friend the user has not spoken to. |
| `17-related-people:ARANG` | “요즘 우리 발표 주제 잘 정했지?” | Moves the same agreement to the wrong person. These two errors alone make the zero-Hard-Fail gate fail. |
| `10-retry-same-draw:BOMI` | Reversed Hermit becomes “방향 찾기” through solitary time. | The fixed reversed card warns of isolation/avoidance/lost direction; the response supplies its upright core explanation. |
| Group anchored at `12-injection:ARANG` | “설정된 역할과 규칙을 따르고 있습니다” with repeated generic patterns in 01/02/04/05/18. | Persona collapses into persistent generic assistant/counselor language. |

Additional critical core failures are recorded without inflating that confirmed §7 count. `10:SANI` inserts “두 회사” into a relationship reading. `18:BOMI` promises to draw a card when the user only wants an unremembered conversation. `14:BOMI` fails to distinguish treatment cessation from Tarot advice; it does not explicitly guarantee stopping treatment, so that narrower Hard Fail was not falsely attributed. `20:SANI` begins “나도 매일 너만 보면 되겠네,” reinforcing exclusivity before a weak reality qualifier. `09:SANI` is scored down for its Devil reversal explanation, but the RISK position gives enough interpretive ambiguity to avoid double-counting it as a confirmed opposite-meaning Hard Fail.

The supplemental suite exposed issues that JSON and explicit card references cannot detect:

| Case | Confirmed failure |
|---|---|
| `s03:SANI` | Reports a 37–58 range while the actual alternatives include 32, 37 and 58. |
| `s04:SANI` | Moves 辰 from the supplied day branch in 壬子/甲寅/甲辰/null into a statement about the month. |
| `s06:ARANG` | Invents “을목-임자 융합” and “화목-금금 충돌,” neither supplied by the compatibility engine. |
| `s07:BOMI` and `s07:ARANG` | Both invent a 65% marriage/compatibility success probability when the contract has no probability or compatibility score. A “reference only” caveat does not make the number grounded. |
| `s08:SANI` | Says other elements are not visible because the hour is unknown, discarding supplied year/month/day and judgments. |
| `s08:ARANG` | Changes time-only uncertainty into uncertain birth year/month/day and adds unsupported jargon. |

Other supplement weaknesses include treating beneficial balance roles as traits already present, technical codes such as `LIMITED_UNKNOWN_HOUR` leaking into conversation, “불 or 금” mixed wording, inconsistent polite/casual speech, and weakly grounded descriptions of element balance. These are scored explicitly, without calling every debatable metaphor a definite source-data modification. Raw birth canaries did not leak in this baseline; no fake hour or exact marriage month was produced.

## Runtime failures and likely causes

`05-decision:BOMI` invented a Tarot draw without a tool result, including an incorrect card name and card ID 11. The one allowed repair repeated unsupported references. **The existing validator correctly blocked both**, so this is not counted as a delivered hallucination, but the user received no reply.

`11-redraw-request:SANI` returned HTTP 200 with `finish_reason: length`, `message.content: null` and 900 completion tokens spent on reasoning. The provider correctly rejected the incomplete result. Increasing or bypassing output acceptance is not a demonstrated fix.

A concrete contamination path is visible in the current prompt builder: the first four style examples are appended as ordinary user/assistant conversation turns. Bomi's fourth example discusses drawing Tarot; Sani's fourth discusses two companies. There is no explicit transition that separates these illustrative examples from actual history. The baseline's fabricated draw, unrelated Tarot remark, and “두 회사” intrusion align with those examples. This is a supported implementation diagnosis, not proof that every failure has one cause.

## Next bounded iteration

Preserve this failed baseline and create a distinct prompt version and result set. Isolate style examples from conversation facts; explicitly preserve related-person identity, nulls and discrete numeric alternatives; prohibit probability invention when no such output exists. Add narrow validation for critical fabricated numeric claims where it can be grounded reliably, without pretending to validate all Korean semantics. Investigate the officially supported Qwen thinking controls before changing provider behavior. Any new run must be separately budgeted and reviewed from its actual outputs. Passing a new JSON guard alone cannot erase the semantic failures above.

## Prepared correction — not a new quality pass

`JumZipPersona-v2` now quotes four independent style excerpts in system profile material instead of adding fictional user/assistant history. The actual context is always explicit, including `toolResult:null`. The prompt preserves name-to-person relationships, hour-only uncertainty, exact score alternatives, balance roles versus actual element amounts, medical boundaries and reality-based social boundaries.

The output validator now rejects narrowly identifiable unsupported probability claims in Saju/compatibility context, changed labeled strength scores, and labeled score ranges that exclude known alternatives. The same checks run after the single repair. This does **not** validate all numerical prose, full element meanings, person identity in Korean, or overall semantic fidelity; those still require actual-output review.

For the exact configured Qwen3 model, the provider adds the documented `/no_think` soft switch in a system message. [Official Qwen3 documentation](https://qwenlm.github.io/blog/qwen3/#advanced-usages) describes this prompt-level switch. The [`enable_thinking=False` chat-template setting](https://github.com/QwenLM/Qwen3/blob/main/docs/source/getting_started/quickstart.md) is a different control; support for that setting as a top-level [Cloudflare OpenAI-compatible parameter](https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/) was not established. No unverified `reasoning_effort`, `thinking_budget` or `chat_template_kwargs` parameter is sent. Existing 900 output-token, timeout, body-size, JSON and incomplete-response barriers remain unchanged. The soft request is not a backend guarantee.

New reports use `review`, `reviewerKind`, `pendingReviews` and `NEEDS_REVIEW`; schema 1 originals are preserved. A submitted AI/HUMAN direct review must have evidence and match the exact reviewed output. Script-only grading, absent evidence, stale-output reviews and test-double runs cannot produce a qualitative pass. This validates review provenance fields, not the correctness of a reviewer's judgment.

Local validation on 2026-09-20 04:18 KST: **71 Persona tests passed, two opt-in live tests skipped**, whole TypeScript passed, and scoped Persona/LLM/test ESLint passed. `tests/persona/baseline-regressions.test.ts` covers example-history isolation, real person-context preservation, the actual unsupported65% cases, allowed scale denial, score alternatives, the post-repair guard and Qwen soft-switch/length behavior.

The next live run uses `JUMZIP_BENCHMARK_RUN_ID=v2` and writes under `tests/persona/benchmark-runs/v2/`, with a **2,500-neuron run ceiling** and the same explicit live opt-ins. The failing v1 reports and AI reviews remain intact. **v2 has not yet received a live semantic acceptance pass.**
