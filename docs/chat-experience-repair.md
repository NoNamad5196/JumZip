# Chat experience repair — 2026-09-20

Latest status, 17:18 KST: the frontend, including chat/mobile/Korean wrapping and the service-error follow-up, is publicly deployed. [Public HTML/JS/CSS comparison](evidence/frontend-service-errors-public.json) passed for all ten bundles. Production backend remains Qwen / Persona-v4 / Intent-v1. Neither current Persona-v12 nor the isolated v4.1 patch has been deployed. [The service-error follow-up](service-error-repair.md) records the confirmed provider allocation rejection and the remaining dashboard discrepancy. The historical upload-pending notes below describe the earlier checks, not the current publication status.

Follow-up: Korean prose now uses `word-break: keep-all` with `overflow-wrap: anywhere`. Chat, paragraphs, lists, definition text and notices preserve ordinary words while long unbroken tokens can still wrap. Headings, buttons, logos and fixed data layouts retain their own typography. The existing `pre-wrap` keeps explicit chat line breaks. [Local Edge rendering](evidence/frontend-korean-line-wrap.json) reproduced the original split and confirmed the fix at seven text widths, long-URL containment and no horizontal overflow on home/chat/privacy at 390/1024/1280/1440px. Related UI tests passed92; existing browser regression passed10 with two intentional skips; TypeScript, build and public credential scan passed. Firefox/WebKit were not verified. The rebuilt `dist` includes both this follow-up and the prior chat changes; public upload remains pending. Its latest index hash is in the linked evidence and supersedes the earlier build hash below.

## What changed

- Sending immediately inserts the user's bubble and clears the composer. The next draft remains editable while an avatar and typing bubble show the pending answer. A validated complete answer appears immediately, without the old artificial sentence delay or waiting for a history refetch.
- Persisted IDs and request IDs reconcile optimistic messages. Unknown transport outcomes reuse the original request; confirmed stored-message failures use response retry. Confirming a previously lost response releases its exact request UUID, allowing a later intentional identical message. UID, route and operation guards remain.
- In chat, mobile Tarot cards use a compact three-column row at 320/360/390px. Newly drawn cards scroll into view. Detail/export layouts retain their existing scale.
- Missing or partial AI interpretation shows explicitly labelled canonical card meanings with the selected orientation. It never calls those keywords an AI interpretation or turns a partial result into success.
- The format-error copy gives a usable retry action. Known provider-rate errors have distinct copy without claiming a quota cause.

## Response-format diagnosis and release boundary

Character prompts exist for BOMI, SANI and ARANG. Production v4 also demanded `toolReferences` for ordinary conversation. Two preserved synthetic recall outputs contained usable text but omitted that field. The error label can also represent parse, envelope, schema or semantic validation failure; these observations do not prove the cause of every user-visible failure.

The current v12 candidate explicitly selects `{text}` only for absent/null tool results. All tool-bearing requests retain their contracts and safety checks. Error diagnostics use fixed allowlists; raw model/error bodies, credentials and user text are excluded.

The independent production release stage is narrower: `supabase/.temp/chat-reliability-v4-1-Z8W00Y`. It reconstructs the exact 53 deployed files, changes eight and adds one. It preserves Qwen, Intent-v1 and v4 Tarot/Saju contracts, deletion guards and the Saju question focus. Its 54-file manifest SHA-256 is `9c37649998d8b5efe4411497c9a5c46d19d5a40cd48d50ffb2c19ff4aa1a5978`. Reproduce it with `scripts/prepare-chat-reliability-release.mjs`; do not deploy the current working functions wholesale. CI fetches full Git history to verify pinned release blobs.

## Verification and limits

- Whole TypeScript and ESLint passed. Vitest: 1,066 passed, three opt-in live tests skipped.
- Real local browser, synthetic network: ten Playwright cases passed, two intentional desktop duplicates skipped. This includes immediate own-message/typing feedback, delayed refetch, deduplication, all three mobile widths, fresh-card visibility and existing route/scroll/modal regression.
- Production build passed: 174 files; index SHA-256 `c3ba50e1e4dfc8dc5799f5c0d31789b028660a78dd2d1532b31263c06826b74f`. Public bundle credential scan and 26 canonical assets passed.
- v4.1 staged typecheck and 15 offline verification groups passed, including preserved v4 recall replays and unchanged initial tool prompts/requests. These are not fresh semantic-quality evidence.
- The bounded direct Qwen probe at 13:54 KST made one HTTP request and received 429, then stopped. Zero cases completed. No repair, model switch, paid upgrade, hosted account or user-data operation followed. The 75.559875-neuron reservation is conservative accounting, not observed usage. The response exposed no allowlisted quota/capacity code, so the reason for 429 remains unknown. Earlier isolated-shell transport failed with EACCES before an HTTP response; it is not another provider 429.
- [Public hash comparison](evidence/frontend-chat-experience-public-pending.json) confirms the site still serves the previous index `b2cdb160…`. Browser folder selection returned without an upload; the Cloudflare form remained empty with Save and deploy disabled. The owner was asked to select the prepared `dist` folder manually. No public deployment success is claimed.

The ignored detailed reports are `test-results/chat-experience-playwright.json` and `test-results/chat-reliability-live/v4-1-92744b65-7813-4503-aa5e-5ae1ff9ad331/result.json`. A safe durable summary is [chat-experience-validation.json](evidence/chat-experience-validation.json). After upload, verify public bytes with a new exclusive report path using `scripts/check-public-build.mjs`. Fresh successful provider and authenticated integration checks remain required before accepting v4.1 or claiming repaired AI quality.
