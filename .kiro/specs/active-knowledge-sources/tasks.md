# Active Knowledge Sources

## Agents

- codex-active-sources · role: owner · scope: implement, verify, and deploy governed active knowledge sources, including their employee knowledge-tree projection · paths: `.kiro/specs/active-knowledge-sources/**`, `ui/src/ui/views/knowledge-universe-cockpit-tree.ts`, `ui/src/ui/ports/employee/views/workbench-stage-module.knowledge.node.test.ts` · since: 2026-08-04

## Tasks

- [x] Rebase the deployment candidate on the latest remote deployment baseline. — codex-active-sources
- [x] Add governed API source registration, catalog discovery, invocation, and routing. — codex-active-sources
- [x] Add employee-side API source authentication and request configuration. — codex-active-sources
- [x] Bind and verify the configured FFD and Xueqiu sources for the personal profile space. — codex-active-sources
- [x] Run scoped tests, build the deployment candidate, and record verification results. — codex-active-sources

## Notes

- FFD history returned structured data once through the governed runtime; the final equivalent runtime and direct checks returned `401 API_KEY_DISABLED`, so a replacement vendor key is required. — codex-active-sources
- FFD capability discovery is not public on `/api/query`; the cached catalog is explicitly marked incomplete while documented public query functions remain independently consumable. — codex-active-sources
- Xueqiu returned `429` for both governed runtime and equivalent direct checks because the vendor key is rate/IP/quota restricted. — codex-active-sources
- Verification: 11 scoped Vitest tests passed, including strict SSRF enforcement; targeted formatting passed, and `pnpm build` completed successfully. — codex-active-sources
