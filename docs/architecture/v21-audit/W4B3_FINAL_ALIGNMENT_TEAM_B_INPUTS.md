# W4B-3 Final Alignment — Team B Inputs (read-only, for later joint editing)

- Document: `W4B3_FINAL_ALIGNMENT_TEAM_B_INPUTS.md`
- Wave: Wave-V21-4 / W4B-3
- Date: 2026-11-28, timezone Asia/Shanghai (CST, UTC+8)
- Audience: later joint editing with Team A. **This document has not been sent to Team A.**

## Status (binding)

- Space Gate 3 = MET at official accepted main `8b83e4eba9b4eec5532046481ca98259c3bcf1d6` (owner ruling t57u).
- `W3B_1_CLEAN_ACCEPT_MERGED_TO_MAIN` and `WAVE_V21_3_JOINT_CLEAN_ACCEPT` are recorded as owner-issued.
- `wave_v21_4_unlocked=true` is recorded as owner-issued.
- **Space Gate 4 = NOT_MET. Space Gate 5 = NOT_MET. Space Gate 6 = NOT_MET.** This document is not a Gate 6 countersignature and does not self-declare those gates.
- formal_t01_t27 remains NOT_RUN_NOT_ACCEPTED.
- AUTH-V21-04 named recipient remains vacant. No PRE-03 / EXT-02 package has been sent.

## 1. Team B authoritative anchors (this run)

| Anchor | Value | Status |
|---|---|---|
| Official current main | `8b83e4eba9b4eec5532046481ca98259c3bcf1d6` | Independently re-locked at Wave-V21-4 Step 0 (2026-11-28 16:10:44–16:10:54 CST) and again by `git ls-remote origin refs/heads/main` at 16:14:23–16:14:26 CST; still exact. Local `refs/heads/main` remains historically diverged at `ded9b6e160ab64c65a86490da1311e4411dae783` and was not reset. |
| Gate 3 | MET (owner ruling) at main@`8b83e4eb…` | Recorded as given by the owner; not re-litigated here |
| Wave-V21-3 joint accept | `WAVE_V21_3_JOINT_CLEAN_ACCEPT` | Owner ruling |
| W3B-1 | Merged to main as PR #365 merge commit `8b83e4eb…` (parents `04970e7f…` + `dc379780…`) | Officially accepted this wave's starting lock |
| W3B-2 frozen tip | `410bb78d4af9d961f9551a821ccf1c9bcd483173` (object unchanged; first parent of the tip is `7a727cbf7505089b715194563688bb9548d1d18b`; `ab6bd10b7768a1d026900242448fa31b10826078` is an ancestor of the three-commit W3B-2 landing chain and was not rewritten) | Read-only frozen; not amended or rebased |
| Wave-V21-4 isolation branch | `codex/openbot/v21-wave4-gate4-prep` at worktree `/Users/daniel/.codex/worktrees/knowledge-sdk-alignment/openbot-v21-wave4-gate4-prep` | Created from exact `8b83e4eb…` |
| W4B-2 lossless sync HEAD | `d7b86a1bd871383ee8a4178a1119ab655e0fdf7e` | `git merge --no-ff 410bb78d` exit 0, no conflicts. Parents exact `8b83e4eba9b4eec5532046481ca98259c3bcf1d6` + `410bb78d4af9d961f9551a821ccf1c9bcd483173`. Space ACL / PRE-02 paths unchanged vs main. Ordinary-pushed to origin (no `--force`). No PR opened. |
| W4B-2 empirical tests | 155/155, all exit 0, flags unset, window 2026-11-28 16:12:10–16:12:45 CST | wave0 9 files / 49 tests + acl-pre02 3/12 + b3 3/22 + vault-sync-handlers 1/12 + vault-sync 18/60 |
| contracts-pin | 20/20 `worktree==git_blob`; manifest SHA-256 `212537fd41bd4cc4d9d7343cacafaea225ee98b6586df716bf036a397cb2a382` computed afresh 16:13:17–16:13:18 CST and matched | Verify-only; pin bytes not mutated |
| OBS-W2-01 golden fixture | SHA-256 `f8033a902af06b005fa591ab872a74f9569a3783fd3e7cef90c6dc94cf9d0fef` (33863 bytes, git blob `5afaff1616ddd77dca604dc498fc691ae4a4f37b`) | Exact match this run; fixture not reworked |
| Freeze canonical JSON | SHA-256 `8ae627474a9f441584dfac840963f8a09a47cc67643aa25a5caf27fe18711559` | **Last independently proven** in AUTH-V21-08C / 09B. This Wave-V21-4 run did **not** re-execute the freeze scanner. Treat as last proven, not freshly re-hashed here. |
| Feature flags | Default false. `OPENBOT_KNOWLEDGE_SDK_V2_ENABLED` and `EXPERIMENTAL_V3_ENABLED` were unset in all W4B-2 test runs. Product defaults were not changed. | Binding |
| Schema | schema_v6_frozen; schema_v7_ddl_authorized=false (v8/v9 also unauthorized). No irreversible Schema v7/v8/v9 DDL was run. | Binding |
| Formal T-01–T-27 | NOT_RUN_NOT_ACCEPTED | Do not claim passed |
| AUTH-V21-04 recipient | Vacant (see W4B-1 vacancy table) | No send |
| Production shadow / dual-write / cutover | Not authorized; not performed | Binding |
| Controlled Data Bridge | Unauthorized (`CONTROLLED_DATA_BRIDGE_UNLOCKED` stays false) | Binding |
| Knowledge-object posture | Fail-Closed, knowledge-object-only | Binding |
| `/v2/spaces` and frozen M1 contract assets | No silent change. In-tree `docs/architecture/knowledge-sdk-alignment/M1_FREEZE_RECORD.json` remains present at isolation HEAD (status FROZEN, `runtime_readiness_claimed=false`). knowledge-sdk remains read-only. The standing official rule against silent change to `/v2/spaces` or the 28 frozen M1 contract assets is unchanged; this run did not mutate those assets. | Binding |

## 2. Statements that are Team A assertions (not independently re-verified this run)

Do not treat the following as independently re-verified by this Team B agent in Wave-V21-4 unless a later run re-checks them:

- Any Team A tip, worktree SHA, or knowledge-sdk SHA not listed as independently verified in the table above, including historical Team A candidate-schema provenance beyond the archived file hash `c68357ee…` already recorded in W4B-1.
- Team A concurrence language inside historical M1 freeze records, except the in-tree JSON bytes themselves.
- Unsigned title `CANDIDATE_PRE03_FORMAT_NOT_SIGNED` remains a Team A candidate, not a signed official PRE-03 contract.

## 3. PRE-03 / PRE-04 engineering boundaries

### 3.1 What Team B may prepare now (and has prepared in Wave-V21-4)

- Read-only specifications and field inventories based on in-pack / archived contracts, with explicit gaps where the isolation tree has no copy of a contract file.
- Fully synthetic / anonymized mock samples, clearly labeled, with `syn_` tokens only.
- An AUTH-V21-04 named-recipient **vacancy table** (empty slots only).
- Isolated-branch lossless sync of already-frozen W3B-2 onto accepted main, plus empirical tests with default-off flags, plus verify-only pin/fixture checks.
- Ordinary-push of the isolation branch so `ls-remote` can prove it. **Not** a pull request, and **not** a merge to `main`.
- Read-only Gate 6 countersign *inputs* (this document) for later joint editing.

### 3.2 What remains blocked

- Real AUTH-V21-04 export; any query, dump, copy, or export of prod DBs, Qdrant, or live tenant data.
- Sending PRE-03 / EXT-02 / any package to a DBA or any other recipient while the vacancy table is empty.
- Inventing a named recipient.
- Schema v7/v8/v9 irreversible DDL, or deleting old tables / RPCs / indexes.
- Self-declaring Space Gate 4, 5, or 6 as MET.
- Claiming formal T-01–T-27 passed.
- Opening a PR from `codex/openbot/v21-wave4-gate4-prep`, merging to `main`, force-pushing, or changing default feature flags.
- Production shadow, dual-write, cutover, or unlocking the Controlled Data Bridge.
- Rewriting frozen objects (`410bb78d`, `8b83e4eb`, and the other historical frozen SHAs) or already-merged Space ACL / PRE-02 semantics on main.
- Mutating `contracts-pin/` or OBS-W2-01 golden fixture bytes.
- Messaging teammate「A团队知识库SDK」or auto-forwarding this input.

### 3.3 PRE-03 boundary (historical inventory)

Team B required input remains **aggregate-only** (tenant counts, null-tenant KB/document/version counts, KB/team/group counts, favorites estimate, alias/name-or-ID collision counts; zero document text, emails, tokens, or raw identifiers). A later optional tokenized-row product exists only as an **unsigned** Team A candidate (`candidate-pre03-v1`) and must not be treated as a signed contract. See `PRE03_ANONYMIZATION_SPEC_FOR_GATE4.md`. AUTH-V21-04 is the future written authorization; it has not been issued.

### 3.4 PRE-04 boundary (leaver policy)

Archived Team B request `PRE_V7_TEAM_B/PRE-04_LEAVER_POLICY_REQUEST.md` remains **Unverified / blocking**. Product, legal, and architecture owners must approve identity-freeze timing, personal-space retention, dual-control work-product handoff, non-inheritance of private content, and expiry/archive cleanup. No administrator inheritance or personal sharing behavior is enabled by Wave-V21-4. Team B may continue to prepare policy wording and engineering boundaries; Team B may not enable those behaviors or treat PRE-04 as satisfied.

## 4. Residual for later joint editing (not claims of completion)

- Official signed PRE-03 field contract is still outstanding (candidate schema remains unsigned).
- AUTH-V21-04 named recipient, channel, and signatures are vacant.
- Gate 4 / 5 / 6 remain NOT_MET and require future official rulings, not self-declaration.
- Freeze canonical JSON `8ae62747…` should be independently re-hashed if a later official order requires a fresh freeze scan.
- This document may be jointly edited with Team A later; it has not been forwarded by this agent.
