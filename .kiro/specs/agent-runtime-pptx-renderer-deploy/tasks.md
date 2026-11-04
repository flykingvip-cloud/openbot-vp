# Dedicated PPTX renderer image deployment

## Agents

- codex-runtime-manager · role: owner · scope: minimal renderer image publication and main-only deployment · paths: Dockerfile.pptx-renderer, src/gateway/office-pptx-render.ts, src/gateway/office-pptx-render.test.ts, scripts/pptx-renderer/worker.mts, .kiro/specs/agent-runtime-pptx-renderer-deploy/\*\* · since: 2026-11-04

## Scope

Extract only the standalone renderer image and its fixed worker from reviewed runtime convergence commit 559bbaa74. No Gateway or UI cutover. Production image build must use freshly fetched main after this PR is merged; no production side-branch build or install.

- [x] Fresh main worktree and signed registry session — codex-runtime-manager
- [x] Copy byte-identical standalone renderer/worker/Dockerfile and component tests — codex-runtime-manager
- [x] Scoped component verification (8 PASS, changed-file lint/format clean) and independent review — codex-runtime-manager
- [ ] Required landpr full gate and PR merge: blocked by 18 untouched-file lint diagnostics — codex-runtime-manager
- [ ] Build from fresh main, install image on local production daemon, run restricted 3-page fixture acceptance, record image identity — codex-runtime-manager

Existing local proof: three-slide layout/image/chart fixture and read-only eight-page Panda original rendered completely in no-network containers, original hashes unchanged. This is evidence of renderer operation, not deployment or the exact November 3 incident.

## Required gate evidence

`pnpm lint && pnpm build && pnpm test` stops at lint with 18 errors in unchanged bash-tools workspace tests, two UI capability-table files, and logging/node-require.test.mjs. This is not a successful full gate; build/test phases of that chained command were not reached. The original convergence tree separately passed its build and real isolated 3/8-page rendering, but that does not waive the landing gate here.

No production renderer build, import, tag change, container restart or Gateway/UI cutover performed. Source must land in freshly fetched main first. This PR is a concrete minimal candidate, not permission to bypass the gate. — codex-runtime-manager
