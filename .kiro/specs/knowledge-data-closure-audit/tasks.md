# Knowledge and Data Capability Closure Audit

## Agents

- codex-knowledge-audit · role: owner · scope: end-to-end audit of knowledge-base and data-capability creation, retrieval, consumption, and feedback closure · paths: `.kiro/specs/knowledge-data-closure-audit/**`, `docs/design/knowledge-data-closure-audit-2026-07-19.md` · since: 2026-07-19
- grok · role: remediator · scope: close P0–P2 findings, golden path, scheduled backoff, governance registration · paths: `src/gateway/knowledge/**`, `src/gateway/enterprise-data/**`, `src/agents/tools/data-capability-tool*`, `docs/design/knowledge-data-closure-audit-2026-07-19.md` · since: 2026-07-19

## Audit tasks

- [x] Inventory creation, ingestion, persistence, indexing, retrieval, authorization, and consumption entry points. — codex-knowledge-audit
- [x] Trace representative knowledge and enterprise-data flows end to end with code-level evidence. — codex-knowledge-audit
- [x] Run focused tests and executable integration checks for the critical paths. — codex-knowledge-audit
- [x] Classify closure gaps by severity, ownership boundary, and remediation priority. — codex-knowledge-audit
- [x] Publish the evidence-backed audit report and verification matrix. — codex-knowledge-audit

## Remediation tasks

- [x] P0 personal object RPC authorization + ownerUserId stamp. — grok
- [x] P1 durable enterprise knowledge access via governance approval store. — grok
- [x] P1 scheduled materialization + maintenance tick wiring. — grok
- [x] P1 reply integration suite import gate. — grok
- [x] P2 degradation observability on knowledge universe context. — grok
- [x] P2 data_capability tool contract tests. — grok
- [x] Approve → visibility grant effect. — grok
- [x] Golden-path E2E: create → materialize → retrieve/feed → capability → access approve/reject → prompt → restart. — grok
- [x] Scheduled: failure backoff state, multi-tenant tick, overlap reentry, cursor restart recovery tests. — grok
- [x] Remove dead in-memory `access-request.ts` Map implementation. — grok
- [x] Register loom task + track kiro/docs for attribution. — grok
- [x] Residual B: personal KB ingest → retrieve → generation lineage in golden-path suite. — grok
- [x] Residual A L2: multi-tenant scheduled soak simulate harness + smoke checklist + inspect procedure. — grok
- [x] Residual A inspect-selftest + package gate (`OPENBOT_SOAK_MODE=all`, `pnpm check:knowledge-data-closure`). — grok
- [ ] Residual A live inspect: run soak inspect mode on staging MT window at next cutover. — ops
