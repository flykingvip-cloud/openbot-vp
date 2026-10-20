# External API Source Deployment

## Agents

- codex-api-source-deployer · role: owner · scope: verify, integrate, and deploy governed external API source onboarding from the production main baseline · paths: `.kiro/specs/external-api-source-deploy/**`, `skills/configure-external-api-source/**`, `src/agents/tool-catalog.ts`, `src/agents/tools/knowledge-source-tool.ts`, `src/agents/tools/knowledge-source-tool.test.ts`, `src/agents/openclaw-tools.ts`, `src/agents/builtin-steward/provision.ts`, `src/agents/builtin-steward/provision.test.ts`, `src/agents/builtin-steward/required-skills.ts`, `src/agents/builtin-steward/required-skills.test.ts`, `src/agents/builtin-steward/steward-skills-sync.test.ts`, `src/gateway/knowledge/sources/source-api-runtime.ts`, `src/gateway/knowledge/sources/source-api-runtime.test.ts`, `src/gateway/knowledge/resolve/resolve-engine.ts` · since: 2026-08-04

## Tasks

- [x] Review the previous implementation and integrate only external API source changes onto the production `main` baseline. — codex-api-source-deployer
- [x] Preserve production SSRF, upstream error, incomplete-catalog, and fixed-path behavior while adding SecretRef and enterprise read authorization. — codex-api-source-deployer
- [x] Verify the steward tool grant, skill bundle, catalog routing, persistence, and active consumption path. — codex-api-source-deployer
- [x] Pass scoped tests, formatting, lint, and a clean full production build. — codex-api-source-deployer
- [ ] Merge the verified branch and complete production cutover with rollback evidence. — codex-api-source-deployer

## Notes

- Vendor request failures are treated as a waived external dependency for this release because both sources were previously proven and are currently unrenewed. Internal persistence, authorization, routing, and build gates remain mandatory. — codex-api-source-deployer
- Verification before commit: 27 scoped Vitest tests, 2 HTTP probe tests, skill validation, scoped format/lint, and `pnpm build` passed. Full `pnpm check` remains blocked by 19 unrelated formatting issues already present on `main`. — codex-api-source-deployer
