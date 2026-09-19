# Saju interpretation retry focus

2026-09-20. A failed Saju interpretation previously retried with a generic natal-chart request, losing the original GENERAL, CAREER, RELATIONSHIP, YEAR_FLOW or MONTH_FLOW choice. The deterministic result remained saved, but the model could answer a different question.

The server now restores the exact focus from the owned consultation before interpreting a saved reading. Supported calculation paths have stored this value in `consultations.question` since migration005. Each calculation creates a new consultation, so no migration or fallback to a guessed focus is needed. The lookup restricts owner, conversation, consultation and SAJU type. A missing parent returns404; an invalid stored focus returns a sanitized422 before generation. Same-request replay returns the cached response without the extra lookup.

The whole source passes744 tests with3 explicit live skips, TypeScript, lint and production build. Ten orchestration regressions cover the five choices, unchanged calculations/asOf, failed lookups and cached replay. Seventeen repository tests cover exact selection and malformed data. [Real local integration](evidence/backend-local-saju-focus.json) passes67 checks using actual Auth, Postgres RPCs, repository code and the pure engine. The timeout and success generator are explicitly synthetic; this is not model-quality or deployed-Edge evidence.

All five local cases saved PARTIAL, recovered the same reading, then replayed the retry UUID without application work. Stored result hashes and asOf stayed unchanged. Three clearly marked identities used4/4/2 units of existing quota and were removed afterwards; Auth returned404 and15 owned tables were empty for each. Model, hosted, Edge and external requests were0.

Production deployment is a separate gate. Preserve Qwen/Persona-v4/Intent-v1 when preparing this narrow fix; do not include the unaccepted Persona-v8/Intent-v3 candidate merely because it shares the working checkout.
