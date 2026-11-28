# W6B-3 Gate 6 Frozen and Wave-V21-6 Adapter Report

- Document: `W6B3_GATE6_FROZEN_AND_WAVE6_ADAPTER_REPORT.md`
- Wave: Wave-V21-6 / W6B-3
- Date: 2026-11-28, timezone Asia/Shanghai (CST, UTC+8)
- Isolation branch: `codex/openbot/v21-wave6-space-favorites-adapter-and-t01-t27`
- Isolation baseline (frozen, not rewritten): `4d4a7230bc1106547d0d2d43fca591b07e6b6b13` (single parent exact `0f75009e42eaf6479e55396509dfe812a75e4c7a`)
- Official launch order: `WAVE_V21_6_JOINT_CLEAN_ACCEPT_GATE6_MET_AND_AUTH_V21_06_SANDBOX_LAUNCH_ORDER_2026-11-28.md` SHA-256 `23fdc54e0c7a1663bc12bad7a39e8e5ba5e11281aa868df49bac0dfe1c957207` (3827 bytes)
- **This report is not a send to Team A or a DBA. It has not been emailed to Daniel or forwarded on any channel.**

## Status (binding)

- **Space Gate 6 = MET** is recorded here as an *already issued official t62u / AUTH-V21-06-SANDBOX ruling*, not as a new Team B self-declaration or a countersignature sent outbound.
  - `final_alignment_frozen = true`
  - Team A alignment anchor (as given in the official order): `46de73e8...`
  - Team B Wave-V21-5 countersign memo SHA-256: `b803b9c34efd70e5666a3f3a0b5ea23dd8ae2ee3ce54ae1ca66a787c22d8bbf0`
  - Official awards recorded as given: `TEAM_B_WAVE_V21_5_CLEAN_ACCEPT`, `TEAM_A_WAVE_V21_5_CLEAN_ACCEPT`, `WAVE_V21_5_JOINT_CLEAN_ACCEPT`
  - `wave_v21_6_unlocked = true` (isolation-branch sandbox only)
- `schema_v7_prod_migration_authorized=false`. This wave does not run Schema v7 production migration, does not touch production databases, Qdrant, or live tenant data, and does not hook the new adapter to production routes.
- `formal_t01_t27_accepted: false`. OpenBot-side in-memory mapping and assertions in W6B-2 are sandbox coverage only. This report does not claim formal T-01–T-27 acceptance (not SQLite / PostgreSQL FORCE RLS / HTTP `/v2` / MCP).
- Default feature flags stay false. `OPENBOT_KNOWLEDGE_SDK_V2_ENABLED` and `EXPERIMENTAL_V3_ENABLED` remain unset in this wave's test runs.
- Zero production-database, Qdrant, or live-tenant-data contact. W6B-1 / W6B-2 use only `syn_` synthetic in-memory fixtures.

## 1. Acknowledgement of official AUTH-V21-06-SANDBOX / t62u rulings (recorded as given)

The following are recorded as owner-issued rulings. They are not expanded by this report:

- Wave-V21-5 joint clean accept is granted; Space Gate 6 is signed MET with `final_alignment_frozen = true`.
- AUTH-V21-06-SANDBOX unlocks Wave-V21-6 isolation-branch sandbox work only.
- Isolation is created from exact `4d4a7230bc1106547d0d2d43fca591b07e6b6b13`. **`f3558f2ccd24a1020dff8a378721786b3071f641` is not merged, rebased, or cherry-picked into this branch.**
- The AUTH-V21-5B upgraded main guard remains in force:
  - Observed main anchor: `f3558f2ccd24a1020dff8a378721786b3071f641`.
  - Unrelated fast-forwards of origin/main are not by themselves an abort reason.
  - At start and before delivery, Team B must prove (read-only fetch / ls-remote only): `8b83e4eba9b4eec5532046481ca98259c3bcf1d6` and `f3558f2ccd24a1020dff8a378721786b3071f641` are both ancestors of current `origin/main`; Team B made zero pushes to origin/main; `gh pr list --head codex/openbot/v21-wave6-space-favorites-adapter-and-t01-t27 --state all` is empty; and `f3558f2cc..<observed_origin_main>` log / name-only diff are recorded honestly.
  - Abort only if history was force-pushed or rewritten, or a newly merged change touches `src/knowledge/`, `contracts-pin/`, or Space ACL / PRE-02.
- SPACE-C01–C10 remain effective (space-00F; SPACE-C03 phase one = 1 organization_team = 1 Team Space).
- Existing Wave-V21-5 / Wave-V21-4 commits, default dual switches, Space ACL / PRE-02 modules, contracts-pin, and the golden fixture are not modified.

## 2. W6B-1 / W6B-2 sandbox deliverables (this commit)

1. `src/knowledge/v21-wave0/space-favorites-v7-adapter.ts` and `.test.ts` — default-off pure in-memory adapter:
   - Tenant → Space → KB, 1 Space : N KB, `Space.org_id == KB.org_id`
   - SPACE-C03 phase one 1 organization_team = 1 Team Space; department auto-mapping rejected; phase-one `parent_space_id` rejected
   - Zero-copy Favorites pointers store only `userId + assetId`; body / Chunk / Embedding / Evidence are forbidden
   - `resolveAuthorizedFavorites` batch real-time authorization hydration; revoke, delete, cross-tenant, and enterprise-admin reading an employee personal space are Fail-Closed (anti side-channel)
   - Not hooked into production routes or default Gateway paths
2. `src/knowledge/v21-wave0/space-t01-t27-matrix.test.ts` — OpenBot-side T-01–T-27 mapping and in-memory assertions:
   - T-01–T-10 follow `SDK_SPACE_ISOLATION_TEST_PLAN.md` (space isolation, favorites, User ∩ Agent, team-leave revocation, identity stability)
   - T-18–T-27 follow `TEAM_A_SPACE_FEASIBILITY_COUNTERSIGN_AND_GAP_MATRIX.md` §5
   - T-11–T-17 official definition text is **not present** in the frozen isolation tree or the Team B space-and-favorites pack (handoff brief §7 / F-02). This wave does **not** invent unofficial T-11–T-17 rule wording.
   - PRE-03 12-rule and PRE-04 5-rule boundaries are re-asserted as named W6B-2 theme coverage, still `formal_t01_t27_accepted: false`
3. This report records the AUTH-V21-06-SANDBOX / Gate 6 MET boundary. It is not a send to Team A or a DBA.

## 3. What this report does not do

- It does not authorize Schema v7/v8/v9 production migration or DDL.
- It does not declare formal T-01–T-27 accepted.
- It does not change default feature flags, Space ACL / PRE-02 modules, contracts-pin bytes, or the OBS-W2-01 golden fixture.
- It does not open a PR or merge to main.
- It does not send, email, or auto-forward anything to Team A, a DBA, or Daniel.
