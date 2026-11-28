# W7B-3 Core V7 Gateway Bridge Report

- Document: `W7B3_CORE_V7_GATEWAY_BRIDGE_REPORT.md`
- Wave: Wave-V21-7 / W7B-3
- Date: 2026-11-28, timezone Asia/Shanghai (CST, UTC+8)
- Isolation branch: `codex/openbot/v21-wave7-space-gateway-wiring-and-interop-pack`
- Isolation baseline (frozen, not rewritten): `7486bc4688778e7d815d80e0248821789fb739fe` (single parent exact `4d4a7230bc1106547d0d2d43fca591b07e6b6b13`; ancestry also includes Wave-V21-4 `0f75009e42eaf6479e55396509dfe812a75e4c7a`)
- Official launch order: `WAVE_V21_6_JOINT_CLEAN_ACCEPT_AND_WAVE_V21_7_AUTH_V21_07_CORE_V7_LAUNCH_ORDER_2026-11-28.md` SHA-256 `96bc6586babc62eb650dbcbef8d9df3f81a185e6263f9c92c0241b751a0bf44f` (3740 bytes)
- **This report is not a send to Team A or a DBA. It has not been emailed or forwarded on any channel.**

## Status (binding)

- **WAVE_V21_6_JOINT_CLEAN_ACCEPT** and **TEAM_A_WAVE_V21_6_CLEAN_ACCEPT** are recorded here as *already issued official t64u / AUTH-V21-07-CORE-V7 rulings*, not as a new Team B self-declaration or a countersignature sent outbound.
  - Team A Wave-V21-6 isolation tip (as given): `feat/v21-wave6-schema-v7-sandbox-and-t01-t27@91b8b6f3`
  - Team B Wave-V21-6 clean-accept tip: `7486bc4688778e7d815d80e0248821789fb739fe` (208/208 green, 0 PR)
  - T-01–T-27 sandbox dual-stack joint verification is recorded as `SANDBOX_JOINT_VERIFIED`
  - `formal_t01_t27_accepted` remains **false**, pending Wave-V21-7 practical final acceptance. A green runner is not formal acceptance.
  - Official awards recorded as given: `TEAM_B_WAVE_V21_6_CLEAN_ACCEPT`, `TEAM_A_WAVE_V21_6_CLEAN_ACCEPT`, `WAVE_V21_6_JOINT_CLEAN_ACCEPT`
  - `wave_v21_7_unlocked = true` (this isolation-branch wave only; Team B read-only standby is lifted only for this wave)
- `schema_v7_prod_migration_authorized=false`. This wave does not run Schema v7 production migration, does not touch production databases, Qdrant, or live tenant data, and does not hang the new bridge on production default Gateway routes.
- Default feature flags stay false. Both `OPENBOT_KNOWLEDGE_SDK_V2_ENABLED` and `SPACE_FAVORITES_V7_ADAPTER_ENABLED` remain unset / not `"true"` in this wave's official test runs. Existing default-false behavior of production flags is unchanged.
- Zero production-database, Qdrant, or live-tenant-data contact. W7B-1 / W7B-2 use only `syn_` synthetic in-memory fixtures.

## 1. Acknowledgement of official AUTH-V21-07-CORE-V7 / t64u rulings (recorded as given)

The following are recorded as owner-issued rulings. They are not expanded by this report:

- Wave-V21-6 joint clean accept is granted; T-01–T-27 sandbox joint verification is `SANDBOX_JOINT_VERIFIED`. Formal T-01–T-27 acceptance stays false.
- AUTH-V21-07-CORE-V7 unlocks Wave-V21-7 isolation-branch work only (`wave_v21_7_unlocked = true`).
- Isolation is created from exact `7486bc4688778e7d815d80e0248821789fb739fe`. **`f3558f2ccd24a1020dff8a378721786b3071f641` and `13763b2d85c6ca72d3bf5b10acb1825457776ff6` are not merged, rebased, or cherry-picked into this branch.**
- The AUTH-V21-5B upgraded main guard remains in force:
  - Latest official observed origin/main anchor: `13763b2d85c6ca72d3bf5b10acb1825457776ff6`.
  - Unrelated fast-forwards of origin/main that do not touch protected paths are not by themselves an abort reason.
  - At start and before delivery, Team B must prove (read-only fetch / ls-remote only): `8b83e4eba9b4eec5532046481ca98259c3bcf1d6`, `f3558f2ccd24a1020dff8a378721786b3071f641`, and `13763b2d85c6ca72d3bf5b10acb1825457776ff6` are all ancestors of current `origin/main`; Team B made zero pushes to origin/main; `gh pr list --head codex/openbot/v21-wave7-space-gateway-wiring-and-interop-pack --state all` is empty; and `13763b2d..<observed_origin_main>` log / name-only diff are recorded honestly.
  - Abort only if history was force-pushed or rewritten, or a newly merged change touches `src/knowledge/`, `contracts-pin/`, or Space ACL / PRE-02.
  - origin/main is never merged into the isolation branch.
- SPACE-C01–C10 remain effective (space-00F; SPACE-C03 phase one = 1 organization_team = 1 Team Space; department auto-mapping rejected).
- Existing Wave-V21-6 / Wave-V21-5 / Wave-V21-4 commits (`7486bc46` / `4d4a7230` / `0f75009e`), default dual switches, Space ACL / PRE-02 modules, contracts-pin, the golden fixture, historical freeze manifests, `TEAM_B_INDEPENDENT_REVIEW.md`, and `ARCHITECT_SIGNOFF.md` are not modified.

## 2. W7B-1 / W7B-2 isolation deliverables (this commit)

1. `src/knowledge/v21-wave0/space-favorites-v7-gateway-bridge.ts` and `.test.ts` — default-off pure/bridge module:
   - Requires **both** `OPENBOT_KNOWLEDGE_SDK_V2_ENABLED` and `SPACE_FAVORITES_V7_ADAPTER_ENABLED` to be the literal `"true"`. Either switch unset/false => immediate Fail-Closed and zero I/O (no adapter reads, no store access, no hydration).
   - `SPACE_FAVORITES_V7_ADAPTER_ENABLED` is introduced on the existing W6B-1 adapter as a default-off process-env reader only. Existing `options.enabled` test overrides and default-false production behavior are unchanged. The adapter is still not hooked to production routes.
   - Unifies eight Space/Favorites actions: `spaces.list` / `spaces.get` / `spaces.create` / `spaces.members.list` / `spaces.kbs.bind` / `favorites.add` / `favorites.remove` / `favorites.list`.
   - Bridges the W6B-1 adapter and the PRE-04 leaver guard (reuse, no forked semantics).
   - Force pass-through of the official 7-key `X-V21-*` tracing headers (`X-V21-Tenant-Id`, `X-V21-User-Id`, `X-V21-Agent-Id`, `X-V21-Trace-Id`, `X-V21-Run-Id`, `X-V21-Plan-Id`, `X-V21-Policy-Generation`) already named in the frozen tree (`X_V21_HEADER_NAMES` / `w2-interop-loopback.test.ts`). Header names are not invented here.
   - User ∩ Agent permission intersection; enterprise admin reading an employee personal space is Fail-Closed (anti side-channel, same denial shape as a missing space).
   - Zero-copy Favorites real-time auth hydration: store only `userId + assetId` pointers; never body / Chunk / Embedding / Evidence.
   - SPACE-C03 phase one: 1 organization_team = 1 Team Space; department auto-mapping rejected.
   - Not registered on production default Gateway routes.
2. `src/knowledge/v21-wave0/space-v7-dual-stack-coverage.test.ts` — dual-switch coverage and T-01–T-27 cross-stack ledger:
   - Dual switches unset => zero activation of all eight actions.
   - Explicit test-enable of both switches exercises the eight-action full paths, including SPACE-C03 phase-one 1:1 team space, PRE-03 12-rule zero-PII, and PRE-04 5-rule leaver freeze.
   - Complete T-01–T-27 cross-stack responsibility ledger:
     - OpenBot-side actually tested: T-01–T-10 and T-18–T-27 (official titles taken from the frozen W6B-2 matrix; not rewritten).
     - T-11–T-17 are explicitly registered as `DELEGATED_TO_TEAM_A_CORE_V7`. Official definition text is not in the frozen pack (F-02 / TEAM_B_HANDOFF_BRIEF §7) and is **not invented** here.
   - Annotated `formal_t01_t27_accepted: false` pending final acceptance.
3. This report records the Wave-V21-6 joint closeout and AUTH-V21-07-CORE-V7 boundary. It is not a send to Team A or a DBA.

## 3. What this report does not do

- It does not authorize Schema v7/v8/v9 production migration or DDL.
- It does not declare formal T-01–T-27 accepted. `SANDBOX_JOINT_VERIFIED` is not formal acceptance.
- It does not change default feature flags, Space ACL / PRE-02 modules, contracts-pin bytes, or the OBS-W2-01 golden fixture.
- It does not open a PR or merge to main.
- It does not send, email, or auto-forward anything to Team A, a DBA, or Daniel.
- It does not invent unofficial T-11–T-17 definition text.

## 4. Official unset-flag verification (pre-commit, both flags unset)

Official commands were run with both `OPENBOT_KNOWLEDGE_SDK_V2_ENABLED` and `SPACE_FAVORITES_V7_ADAPTER_ENABLED` unset (CST, Asia/Shanghai):

| Suite | Official command | Result |
| --- | --- | --- |
| v21-wave0 | `pnpm exec vitest run --config vitest.unit.config.ts src/knowledge/v21-wave0 --reporter=verbose` | 15 files / 116 tests, exit 0 (prior 13/102 at `7486bc46` plus W7B-1 10 tests and W7B-2 4 tests) |
| acl-pre02 | `pnpm exec vitest run --reporter=verbose src/gateway/server-methods/policy-pre02-read-gate.test.ts src/gateway/server-methods/space-acl-13-gaps.test.ts src/gateway/knowledge/lineage/lineage-explain-acl.test.ts` | 3 files / 12 tests, exit 0 |
| b3 | `pnpm exec vitest run --reporter=verbose src/gateway/knowledge/knowledge-base-permissions.test.ts src/gateway/knowledge/knowledge-base-members.test.ts src/retrieval/sources/knowledge-source.test.ts` | 3 files / 22 tests, exit 0 |
| vault-sync-handlers | `pnpm exec vitest run --reporter=verbose src/gateway/server-methods/vault-sync.test.ts` | 1 file / 12 tests, exit 0 |
| vault-sync | `pnpm exec vitest run --reporter=verbose src/vault-sync` | 18 files / 60 tests, exit 0 |

- Four core Space/Vault-Sync total: 25 files / 106 tests, all exit 0.
- Combined official unset total: 40 files / 222 tests, all exit 0.
- contracts-pin: 20/20 worktree == git_blob, mismatches=0, manifest SHA-256 exactly `212537fd41bd4cc4d9d7343cacafaea225ee98b6586df716bf036a397cb2a382`.
- Golden fixture `src/knowledge/v21-wave0/interop-fixtures/w2_interop_golden.json`: SHA-256 exactly `f8033a902af06b005fa591ab872a74f9569a3783fd3e7cef90c6dc94cf9d0fef` (33863 bytes, git blob `5afaff1616ddd77dca604dc498fc691ae4a4f37b`). Bytes were not mutated.

Verbose logs, pin proof, and fixture proof are filed in the independent Wave-V21-7 Team B handoff pack. This report still does not declare formal T-01–T-27 acceptance.
