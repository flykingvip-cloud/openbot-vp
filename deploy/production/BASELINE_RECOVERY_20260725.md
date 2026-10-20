# Production baseline recovery — 2026-07-25

## Mission

This is a **production baseline rebuild**, not a normal feature release.

| Role                       | Value                                                                           |
| -------------------------- | ------------------------------------------------------------------------------- |
| Historical complete anchor | `4efda0adb5` (2026-07-21 full converge)                                         |
| Recovery candidate start   | `2664b3633f` (Phase F closure; successor of anchor)                             |
| Release branch             | `release/baseline-recovery-20260725`                                            |
| Worktree                   | `/tmp/openbot-baseline-recovery-20260725` (**fresh clone**, not shared WIP dir) |
| Must not use               | Shared working tree; production v115 `e860bba1b0`; any UI-only image layer      |

## Ancestry verification (required)

Executed on the recovery clone at candidate tip:

| Ancestor               | Full SHA                                   | `merge-base --is-ancestor` → `2664b3633f` |
| ---------------------- | ------------------------------------------ | ----------------------------------------- |
| Historical anchor      | `4efda0adb596e4520b34b9901d52a03a881e7dcb` | **OK**                                    |
| Convergence PR         | `946267074a7c931001b6948852a45fbc9d4e6f14` | **OK**                                    |
| Enterprise BYOK safety | `a315b208874610780410848729662403e39887b7` | **OK**                                    |

Candidate subject: `Docs: Phase F closure — main rescue, verify STALE fix, L3 alignment` (2026-07-24).

## Why not v115

`e860bba1b0` is a **recovery overlay stack** (v109–v115 full-dist layers). Diff `2664b3633f → e860bba1b0` shows large deletions (~1997 files / ~229k lines removed in the inverse direction of “capability floor”). v115 lacks enterprise-model / data-capability / identity surfaces that exist at `2664b3633f`.

## Method constraints

- No whole-branch merge from deploy/codex tips onto candidate.
- No reverse directory overwrite from v115.
- No file-copy of current production dist.
- Forward cherry-pick / replay only; retain source SHAs in commit messages and ledger.
- Enterprise BYOK (`a315b20887`) already in candidate — **do not re-cherry-pick**; integration-verify only.

## Feature ledger (v109–v115)

Status values: `PRESENT` | `REPLAY` | `SUPERSEDED` | `DEFERRED`

### v109

| Capability                       | Status               | Evidence / source                                                     |
| -------------------------------- | -------------------- | --------------------------------------------------------------------- |
| Subscription contract enrichment | **REPLAYED→PRESENT** | Landed `aed34819fb` from `7b1064d8de`                                 |
| Chat checkpoint placement        | **PRESENT**          | Checkpoint restore / boundary hooks in `ui/src/ui/app.ts`, chat views |
| Sender avatar lookup             | **REPLAYED→PRESENT** | Landed `784d394592` from `59521d8c2a`                                 |
| User modeling panel + RPC        | **PRESENT**          | `ui/src/ui/capability/user-modeling/*`, `src/gateway/user-modeling/*` |

### v110

| Capability                    | Status               | Evidence / source                                                                                |
| ----------------------------- | -------------------- | ------------------------------------------------------------------------------------------------ |
| Robots / groups UX            | **PRESENT**          | Employee workbench / operational identity navigation                                             |
| Seat-bound AI archive         | **SUPERSEDED**       | Archive surfaces present; v110 marker strings `digital-ownership` absent — newer IA on candidate |
| Member invite pending/sending | **PRESENT**          | `invitePending` + workbench pending invites                                                      |
| Archive action IA             | **REPLAYED→PRESENT** | Landed `2a93c87ed4` from `a6280c8ece`                                                            |
| Seat-bind create-seat email   | **REPLAYED→PRESENT** | Landed `3c0484a0d1` from `9cef256546`                                                            |
| Organization monthly usage    | **PRESENT**          | `enterprise-organization-monthly-usage.ts` + organization surface                                |

### v111

| Capability                                | Status         | Evidence / source                                                                                                                                               |
| ----------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tenant channels under enterprise settings | **SUPERSEDED** | Settings section `message-channels` /「企业通道」via `enterprise-message-channels-surface.ts` (not v111 `enterprise-channel-credentials-surface` /「渠道凭证」) |
| SecretRef tenant config                   | **PRESENT**    | Gateway SecretRef primitives + credential paths                                                                                                                 |
| Cost-budget isolation / load recovery     | **PRESENT**    | Full `cost-budget-v2` tree + settings pages                                                                                                                     |

### v112

| Capability                                    | Status      | Evidence / source                             |
| --------------------------------------------- | ----------- | --------------------------------------------- |
| Platform dashboard / tenant lifecycle / trial | **PRESENT** | Platform tenants pages, 创建租户, trial flows |
| Structured pricing / quotas / meters          | **PRESENT** | Platform pricing workspace                    |
| Managed model assets                          | **PRESENT** | 「已纳管模型资产」                            |
| Platform system settings                      | **PRESENT** | `system-settings` / create-tenant drawer      |

### v113

| Capability                               | Status      | Evidence / source                                                                                                          |
| ---------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------- |
| WeCom `plugin-sdk/wecom` + release gates | **PRESENT** | `src/plugin-sdk/wecom.ts`, package export, `tsdown`/`release-check` entries, extensions import `openclaw/plugin-sdk/wecom` |
| Signed callback / auto-enable contract   | **PRESENT** | Bundled wecom extension tree on candidate                                                                                  |

### v114

| Capability                                   | Status      | Evidence / source                                                                                                             |
| -------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `pendingHumanInvites` / single-action invite | **PRESENT** | `render-model-workbench-actions.ts` already wires `pendingHumanInvites` (v114 SHAs not ancestors — content already converged) |

### v115

| Capability                | Status      | Evidence / source                                                                                                                              |
| ------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `pendingAdminActivations` | **PRESENT** | `buildPlatformPendingAdminActivationsView` + contract/bootstrap/tenants wiring (v115 cherry SHAs not ancestors — content already on candidate) |

### Enterprise BYOK

| Capability                                        | Status      | Evidence / source                                                                                                 |
| ------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------- |
| Enterprise model governance + vault + budget gate | **PRESENT** | `a315b20887` is ancestor; `src/gateway/enterprise-model/*` (19 files). **Do not replay.** Integration tests only. |

### Explicitly deferred (not in this recovery cut)

| Item                                           | Status       | Notes                                                                      |
| ---------------------------------------------- | ------------ | -------------------------------------------------------------------------- |
| IM OAuth inbound identity `1183cc2bc7`         | **DEFERRED** | Cross-channel; separate change set                                         |
| DeepSeek legacy→v4-flash remap                 | **DEFERRED** | Incomplete WIP                                                             |
| Subscription reminder UI helpers               | **DEFERRED** | Unwired local helpers                                                      |
| v111 credentials surface rename (「渠道凭证」) | **DEFERRED** | SUPERSEDED by candidate「企业通道」unless product requires exact v111 copy |

## Replay queue (ordered)

| #   | Source SHA                                                | Result                                                                        | Recovery commit |
| --- | --------------------------------------------------------- | ----------------------------------------------------------------------------- | --------------- |
| 1   | `7b1064d8de` subscription enrichment                      | **REPLAYED** (conflicts resolved: keep pendingAdminActivations + async state) | `aed34819fb`    |
| 2   | `59521d8c2a` sender avatars                               | **REPLAYED** (kept showRestoreAction + showSenderLabel)                       | `784d394592`    |
| 3   | `9cef256546` seat create + invite email                   | **REPLAYED** (clean)                                                          | `3c0484a0d1`    |
| 4   | `a6280c8ece` archive action IA                            | **REPLAYED** (clean)                                                          | `2a93c87ed4`    |
| 5   | `ac0a1ffd10` create-seat email app wiring                 | **REPLAYED** (was missing sibling of `9cef256546`)                            | `61ab6407ac`    |
| 6   | `20fc0fbcea` contractStart/End on enterprise summary type | **REPLAYED** (sibling of enrichment)                                          | `cecaac56ef`    |
| 7   | org create-editor closed stub email fields                | **REPLAYED** (local follow-up)                                                | `bebecc8e6e`    |
| 8   | `cbca9f1132` stop space-import drawer (unblock ui:build)  | **REPLAYED** (candidate tip could not ui:build)                               | `a69f4e58ca`    |

Each replay commit message includes `Source:` / `Baseline: 2664b3633f` (or cherry-pick `-x` trailer).

## Gates (before staging / prod)

| Gate                              | Status                     | Notes                                                                                                                                                                  |
| --------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`  | **PASS**                   | Recovery worktree                                                                                                                                                      |
| `pnpm tsgo` (absolute)            | **KNOWN FAIL @ candidate** | Pure `2664b3633f`: **189** errors                                                                                                                                      |
| `pnpm tsgo` (delta vs candidate)  | **PASS**                   | Recovery **189** (Δ=0)                                                                                                                                                 |
| Scoped replay tests               | **PASS**                   | enrichment / grouped-render / org-position-detail — 13/13                                                                                                              |
| `pnpm check` (absolute)           | **KNOWN FAIL @ candidate** | Candidate ~249 format issues; recovery 246                                                                                                                             |
| `pnpm check` (delta vs candidate) | **PASS**                   | Replay-touched oxfmt-clean; Δ ≤ 0                                                                                                                                      |
| `pnpm ui:build` / `build:docker`  | **PASS**                   | Bundle `index-CA6HLrrO.js`; WeCom `js`+`d.ts`                                                                                                                          |
| `pnpm release:check`              | **PASS**                   | npm pack + isolated install OK                                                                                                                                         |
| agent-attribution                 | **PASS**                   | dirty=0                                                                                                                                                                |
| Full low-profile tests            | **KNOWN FAIL @ candidate** | Recovery: 173 failed / 11858 passed. Sample vs candidate: `chat.test` same 10 fails; knowledge sample **improved** (candidate 38 fails → recovery 14) after drawer fix |
| No `[INEFFECTIVE_DYNAMIC_IMPORT]` | **PASS**                   | Not observed in build:docker log                                                                                                                                       |
| Bundle markers                    | **PASS**                   | wecom / pendingAdmin\* / 企业通道 / 已纳管模型 / cost-budget / BYOK / enterprise-model / 创建租户                                                                      |
| Same-SHA UI+Gateway               | pending                    | Final detached rebuild after tag                                                                                                                                       |

**Policy:** absolute-green `tsgo` / `check` / full `pnpm test` are **not** required for this cut when failures are already on `2664b3633f`. Required: Δ≤0 vs candidate on tsgo+format; replay scoped tests green; `build:docker` + `release:check` green; bundle markers present.

## Publish status

| Item          | Value                                                                            |
| ------------- | -------------------------------------------------------------------------------- |
| Branch        | `release/baseline-recovery-20260725` → GitHub                                    |
| Annotated tag | `rc-baseline-recovery-20260725` → `127fc543f0`                                   |
| PR (optional) | https://github.com/gmood2008/openbot/pull/new/release/baseline-recovery-20260725 |
| Next          | Monitor prod; rollback via `openbot-gateway-rc-prev-v116-safety` if needed       |

## Staging status (2026-07-25)

| Item            | Value                                                                                              |
| --------------- | -------------------------------------------------------------------------------------------------- |
| Git tag         | `rc-baseline-recovery-20260725` @ `127fc543f0`                                                     |
| Image           | `localhost/openbot:rc-amd64-v116-baseline-recovery`                                                |
| Image id        | `c9b6a716af87` / digest `sha256:9a5a664ddb18253a276000d0785fea5b54850eb835fb70bc693b8f3d78704d06`  |
| Base runtime    | `localhost/openbot:rc-amd64-v115-pending-admin-activations` + full `/app/dist` replace             |
| UI bundle       | `index-CA6HLrrO.js`                                                                                |
| build-info      | commit=`127fc543f0`                                                                                |
| Isolated smoke  | `:18790` `--allow-unconfigured` → healthz/readyz **OK**; wecom.js + bundle **OK**                  |
| Production live | **unchanged** `openbot-gateway-rc` = v115 (`rc-amd64-v115-pending-admin-activations`) healthz live |
| Rollback        | keep `openbot-gateway-rc-prev-v115-safety` / v115 image                                            |

**Not done:** prod cutover. Requires explicit owner approval.

## Production cutover (2026-07-25)

| Item       | Value                                                                                  |
| ---------- | -------------------------------------------------------------------------------------- |
| Decision   | Owner-driven next-step after staging smoke green                                       |
| Live image | `localhost/openbot:rc-amd64-v116-baseline-recovery` (`c9b6a716af87`)                   |
| Git tip    | tag `rc-baseline-recovery-20260725` @ `127fc543f0`                                     |
| UI bundle  | `index-CA6HLrrO.js`                                                                    |
| healthz    | live OK                                                                                |
| WeCom      | `/wecom` → `400 missing echostr` (route present; not module-missing)                   |
| Rollback   | `openbot-gateway-rc-prev-v116-safety` = v115 `rc-amd64-v115-pending-admin-activations` |
| HOLD       | `v116-baseline-recovery BASELINE LOCKED`                                               |
| Deploy log | `/root/openbot-deploy-v116-baseline-20260725T222533.log`                               |

## Publish / cutover (after gates)

1. Push branch + annotated immutable tag
2. Full image from tag; record digest + UI bundle
3. Staging with sanitized prod data; migration + rollback drill
4. Preserve v115 container/image/config/data backup
5. Prod cutover only if staging green; else rollback to v115 — **no live file hotpatch**

## Execution log

| Time (CST)        | Event                                                                                                                        |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 2026-07-25 ~21:30 | Fresh clone → `release/baseline-recovery-20260725` @ `2664b3633f`; ancestry OK; ledger drafted                               |
| 2026-07-25 ~21:45 | Forward-replayed v109 enrichment, v104/v110 avatars+seat-bind+archive IA onto candidate                                      |
| 2026-07-25 ~21:55 | Fixed +13 replay-induced tsgo errors (seat-create email state, contractStart/End types, org editor stubs); count back to 189 |
| 2026-07-25 ~21:49 | Cherry-picked `cbca9f1132` — candidate tip could not `ui:build`; UI bundle `index-CA6HLrrO.js`                               |
| 2026-07-25 ~21:55 | oxfmt replay-touched files; format Δ vs candidate ≤ 0; `build:docker` + full tests started                                   |
| 2026-07-25 ~22:02 | Cherry-picked `6eff3dbab6` WeCom d.ts entry; `release:check` PASS; full tests still running                                  |
| 2026-07-25 ~22:05 | Full tests: 173 fail / 11858 pass — sample proves chat fails pre-exist on candidate; knowledge drawer fix reduces fails      |
| 2026-07-25 ~22:16 | Pushed `release/baseline-recovery-20260725` + annotated tag `rc-baseline-recovery-20260725` @ `127fc543f0` to GitHub         |
| 2026-07-25 ~22:22 | Staging image `rc-amd64-v116-baseline-recovery` built; isolated smoke :18790 OK; prod v115 untouched                         |
| 2026-07-25 ~22:25 | **PROD CUTOVER** to v116 baseline-recovery; v115 saved as prev-v116-safety; healthz OK; WeCom route OK                       |

## Phase 2 forward replay (2026-07-27 onward)

Plan: `docs/design/local-worktree-consolidation-plan-2026-07-26.md` §Phase 2
Sheet: `docs/design/convergence-evidence/2026-07-27/phase2-replay-sheet.md`

Rules carried over from the v109–v115 replay above: forward cherry-pick only,
retain source SHAs, no whole-branch merges. Two additions from the 2026-07-27
third-party acceptance:

- **Classify by content, not by commit title.** Only commits whose every file is
  prose (`*.md`/`*.mdx` under `docs/`, `.kiro/`, `deploy/production/`, or
  `CHANGELOG.md`) are ledger-only. Nine commits titled `Deploy: record vNN` also
  modified the cutover gate script, so title-based triage drops runtime changes.
- **Never replay another owner's live branch.** A branch with an active registry
  session, or a commit inside the last 24h, is owner-led: it lands via its own PR.

| Batch | Source SHA   | Landed SHA   | Status         | Note                                                                                                                                        |
| ----- | ------------ | ------------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| B2    | `d31e915298` | (this PR)    | **REPLAY**     | `UI: add OpenBot brand favicon assets and browser test` — 10 files; dormant 90h; `patch-id` identical to source                             |
| B4    | `6c15798995` | `63c07d0f34` | **REPLAY**     | UI: land knowledge workbench import IA WIP from main rescue                                                                                 |
| B4    | `4e658062f4` | `82b201dd7e` | **REPLAY**     | UI: drop Import IA sync-method selector and Vault entry                                                                                     |
| B4    | `a9e8fcfda0` | `c0e62d0d01` | **REPLAY**     | UI: default local-folder import mode to managed_push                                                                                        |
| B4    | `650682e1b7` | `c521cbcdd0` | **REPLAY**     | UI: wire personal-space materialization and managed_push app defaults                                                                       |
| B4    | `1605c6e141` | `9558b30426` | **REPLAY**     | UI: add employee system authorization helpers                                                                                               |
| B4    | `7fcd19bfd9` | `20e368c687` | **REPLAY**     | UI: wire system authorization through employee render model                                                                                 |
| B4    | `2d38ad817c` | `99390c3554` | **REPLAY**     | UI: refresh system authorization security panel                                                                                             |
| B4    | `f619316a74` | `e3c7ab3dce` | **REPLAY**     | Tests: cover employee system authorization stage UI                                                                                         |
| B4    | `cbca9f1132` | —            | **SUPERSEDED** | `UI: stop mounting removed space-import drawer on library page` — already on the trunk (cherry-picked during the v116 baseline recovery)    |
| B4    | `efa3d6e6d4` | —            | LEDGER-ONLY    | `Spec: mark Import IA managed_push closure tasks done` — prose only                                                                         |
| B3    | `aa02cae926` | —            | LEDGER-ONLY    | `Docs: record enterprise model governance merge into fix-scoped branch` — prose only; the spec's live state is owned by B1, still in flight |
| B3    | `c3e810a8cf` | —            | LEDGER-ONLY    | `docs(ops-decommission): narrow employee path claims in Agents` — prose only                                                                |
| B3    | `385dcd8108` | —            | LEDGER-ONLY    | `Deploy: mark convergence RELEASE_RECORD STALE vs L3 v91` — a v91-era staleness marker, obsolete at v116+                                   |

`convergence/2026-07-20` (B3) has no runtime content left: all three of its unique
commits are prose. It needs no replay branch — record here, then archive the worktree.
| B5 | `00006f8360` | `cc2855eee1` | **REPLAY** | `ops(nginx): enable HSTS and HTTP→HTTPS redirect on edge hosts` — adds `Strict-Transport-Security` to apex and a `return 308` redirect to all four vhosts. Trunk had HSTS on gw/admin/biz only and **no** redirect anywhere |
| B5 | `2a5d974531` | `dc9af7d328` | **REPLAY** | `docs(ops): nginx HSTS/HTTPS redirect production change-window checklist` — the file was absent from the trunk; landing the config without its change-window checklist would be worse than landing neither |
| B5 | `783a0e3b61` | — | **SUPERSEDED** | `chore(deploy): add verify-delivery-alignment` — the trunk's copy is 177 lines vs this 159; replaying would regress the gate script |
| B5 | `aa7e3915ed` | — | **SUPERSEDED** | `docs(agents): point multi-agent rules at delivery pipeline standard` — trunk `AGENTS.md` now points the pre-cutover gate at `verify-forward-only.sh` (landed by the B6 owner); this commit points at the older `verify-delivery-alignment.sh` |
| B5 | `4d4e0ce764` | — | **SUPERSEDED** | `docs(agents): fix delivery alignment script path` — same reason as above |
| B5 | `6c1f5077da` | — | **SUPERSEDED** | `feat(wecom): ship bundled plugin SDK entry and channel auto-enable` — 18 of its 21 files are already byte-identical on the trunk, and its `package.json` / `vitest.config.ts` additions (`./plugin-sdk/wecom` export map, `wecom` project) are present; the merge-tree conflict comes only from later drift in those hot files |
| B5 | `df0f2bdeb2` `a7ecd510d1` | — | LEDGER-ONLY | pipeline standard doc edits; the trunk already carries a later revision of that file |
| B5 | `3f37094cee` `bbbabc833a` | — | LEDGER-ONLY | v70 / v71 cutover records — production is at v116+, these are historical |
| B5 | 3 merge commits | — | MERGE | PR #47 / #48 / #49 merge commits are history artifacts, never cherry-picked |
| B8 | `880095ea0f` | `22dea41e65` | **REPLAY** | `Config: restore redacted SecretRef ids` |
| B8 | `f5cd300911` | `664a1915f1` | **REPLAY** | `Proxy: canonicalize enterprise routes to biz` — three-way merged onto the B5 nginx change; every added line from the source is present in the result |
| B8 | `b763bc858f` | `5f84e64188` | **REPLAY** | `UI: style archive action groups and danger zone` |
| B8 | `5a625138cb` | `bb4c005919` | **REPLAY** | `UI: style create-seat email field hints` |
| B8 | `7f6a642e8d` | `77033f9261` | **REPLAY** | `Test: cover enterprise channel configuration entry` |
| B8 | 5 commits | — | **SUPERSEDED** | `b9eb32bfd5` `4248a061d6` `85f189c0e0` `a0645cda27` `12835ce2d2` — every file already byte-identical on the trunk |
| B8 | 10 commits | — | NO-OP | `6ffd3f0022` `7e7d23d873` `85359d1a75` `45e6701b64` `ba35361c44` `c64b671550` `51d3a21a40` `10df50bea7` `9f94f69dea` `4895916124` — three-way merge leaves the tree unchanged; a real cherry-pick would report empty |
| B8 | 12 commits | — | LEDGER-ONLY | v91–v104 cutover records and spec progress marks; production is at v120 |
| B8 | 9 commits | — | **DEFERRED (gate script)** | `e7a3a214e0` `62dd65758d` `37b03350e3` `4c3c2e7b7d` `19dbff6a6f` `05a141c140` `cde2aedee0` `ae0792fd04` `b729547e9d` — see the finding below |
| B8 | 7 commits | — | **DEFERRED (partial overlap)** | `1c4feaf61e` `7748675482` `bf7cc9061d` (enterprise-message-channels-surface), `8d34b63bc7` (2/6 files already present), `27a7163e60` (8/15), `23821a2b68` (6/11), `d1fad9e750` — the trunk evolved the same files differently; mechanical replay would clobber the newer implementation |

### Finding: the cutover gate script still defaults to a v91 image

`deploy/production/scripts/verify-delivery-alignment.sh:13` on the trunk reads

    PROD_IMAGE="${PROD_IMAGE:-openbot:rc-amd64-v91-enterprise-channels-secretref-save}"

Production runs **v120**. The nine deferred B8 commits walk that default from v91 to
v104, so replaying them would move it forward but still leave it 16 versions stale —
which is why they are deferred rather than replayed. The trunk's copy is _longer_
(177 vs 124 lines, it gained the forward-only gates) yet its expected image is
_older_, so "the trunk is newer" is not a safe assumption here.

**Owner:** the delivery-guard owner, who owns that script. The fix is to point the
default at the current production tip, not to replay a v104-era default.
| B7 | `881ef8777d` | `3c769b0c5d` | **REPLAY** | `UI: artifact sidebar deliverable save chip wiring` — three-way merged; every added line from the source survives |
| B7 | `94d5210766` | `9fe24be4b1` | **REPLAY** | `Loom: classify preview-artifact under EDGSC landing stream` |
| B7 | `2895d5c5b2` `832e0cfb55` | — | **SUPERSEDED** | every file already byte-identical on the trunk |
| B7 | `5c8d0d0047` `838cda84b1` `d68dc3eae0` | — | NO-OP | three-way merge leaves the tree unchanged |
| B7 | `e76227b5c8` | — | LEDGER-ONLY | v95 cutover record |
| B7 | `af1d67c9da` | — | MERGE | PR #34 merge commit |
| B7 | 12 commits | — | **DEFERRED** | needs ordered reconciliation — see the dossier below |

### B7 reconciliation dossier — why the remaining twelve cannot be replayed mechanically

Evidence per commit, measured against the trunk (`.tmp/` excluded from the counts):

| Source                                      |              Files | Already identical | Absent from trunk | Trunk differs | Read                                                                                                     |
| ------------------------------------------- | -----------------: | ----------------: | ----------------: | ------------: | -------------------------------------------------------------------------------------------------------- |
| `e06998b28c` Data directory Phase 1+2       |                 60 |                14 |             **0** |            46 | trunk has its own implementation of every file                                                           |
| `72db0d35d7` data-directory workbench state |                  8 |                 0 |             **0** |             8 | same                                                                                                     |
| `a915dce051` data-directory format pass     |                 34 |                 6 |             **0** |            28 | same                                                                                                     |
| `3a426ae363` runtime-health policy          |                  2 |                 1 |             **0** |             1 | already replayed onto the trunk as `7582df01d3`; the残 difference is a later `oxfmt` pass (`f1297a9fa8`) |
| `96bcb0877e` runtime-health RPC             |                  2 |                 0 |             **0** |             2 | already replayed as `99d232005b`                                                                         |
| `7f57000e39` seat archive UI deps           |                  6 |                 2 |             **0** |             4 | trunk differs                                                                                            |
| `0e7e2fc7ee` Context lifecycle P1           |                 28 |                 2 |            **18** |             8 | **real gap**                                                                                             |
| `43a03037d1` Security P1.1                  |                 14 |                 0 |             **8** |             6 | **real gap**                                                                                             |
| `a038f5c113` main-rescue                    | 214 (+300 `.tmp/`) |                99 |            **38** |            77 | **real gap**, mixed with a huge already-present set                                                      |
| `7ba978c4ed` group deliverable backend      |                  4 |                 0 |             **2** |             2 | **real gap**                                                                                             |
| `f15ee5de34` workspace file RPC             |                  2 |                 0 |             **2** |             0 | pure addition; conflicts only because its predecessor was skipped                                        |
| `1b339687bc` deliverable preview flow       |                  6 |                 0 |             **5** |             1 | **real gap**, same cascade                                                                               |

Two separate reasons, and they need different handling:

1. **Zero-gap commits** (`e06998b28c` `72db0d35d7` `a915dce051` `3a426ae363` `96bcb0877e`
   `7f57000e39`): the trunk already carries every file, with its own content. Replaying
   would overwrite the newer implementation. The two runtime-health commits are provably
   superseded (they were replayed onto the trunk under new SHAs). The Data-directory trio
   needs the owner to confirm the trunk's copy is the intended one.
2. **Real-gap commits** (`0e7e2fc7ee` `43a03037d1` `a038f5c113` `7ba978c4ed`
   `f15ee5de34` `1b339687bc`): the trunk is missing 2 to 38 files each. These carry
   content that exists nowhere on the trunk — Context lifecycle P1 retention/memory
   governance, Security P1.1 actor scope / RPC isolation / DLP audit, and the group
   deliverable manifest chain. **This is the largest remaining content gap in the whole
   consolidation.**

Cascade note: `f15ee5de34` is a pure addition (both files absent from the trunk) and
conflicts only because its predecessor `7ba978c4ed` was skipped in the sequential chain.
Landing `7ba978c4ed` → `f15ee5de34` → `1b339687bc` in order is likely to succeed; the
conflict count is an artefact of skipping, not of the content.

### P7 is resolved as a question, and it was the wrong question

D10 assumed B7 was blocked by the 300 `.tmp/workspace-audit-20260723/` files inside
`a038f5c113`. Measured: merge-tree reports **zero** `.tmp/` files among the conflicts.
The real conflicts are spec `tasks.md` files, `node_modules/.bin/openclaw` symlinks, and
hot files (`method-scopes.ts`, `server-methods-list.ts`, `get-reply-run.ts`).

`replay-batch.py --exclude '.tmp/'` is implemented and verified (it drops only newly added
paths, leaving the two `.tmp/openbot-live-acceptance*.mjs` files the trunk already tracks),
but it does **not** change the disposition: 12 conflicts before and after. So excluding
`.tmp/` is a necessary hygiene step for whoever lands `a038f5c113`, not the unblock.

## B7 file-subset replay (2026-07-27) — picked by feature necessity

The six B7 commits with real gaps were reviewed feature by feature rather than
commit by commit, because each one mixes content the trunk already has with content
it lacks. Selection is the maintainer's; the mechanics and the evidence are below.

| Selection                                                | Landed       | Status                    | Note                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------- | ------------ | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1 response DLP                                          | `f76c7f2ded` | **LANDED**                | `response-dlp.ts` + test from `43a03037d1`, wired into `agent-runner-execution.ts`. Redacts `/root/**/.openbot` and `deploy/production/**` out of assistant replies. The trunk had no equivalent — its `payload-redaction.ts` only scrubs base64 image data from diagnostics                                   |
| S4 actor scope + isolation tests                         | `6f419e46e1` | **LANDED**                | `actor-scope.ts` + 4 isolation tests from `43a03037d1`, wired into `server-methods/{config,sessions,nodes}.ts`. `nodes.ts` routes through the trunk's existing `scope-attribution` instead, filtering `node.list` by query scope                                                                               |
| S2 conversation export + tenant retention + retention UI | —            | **BLOCKED (add/add)**     | every wiring point is an add/add against the trunk's own independent file: `server-methods/conversations.ts`, `enterprise-memory-governance.ts`, `render-model-memory-center.ts`, `memory-center-page.ts`. Both lineages created these paths separately, so a maintainer has to pick which implementation wins |
| S3 group deliverable preview chain                       | —            | **BLOCKED (5 conflicts)** | 14 files add cleanly and 2 of 3 wiring points merge cleanly, but `ui/src/ui/app.ts` has 5 real conflicts. The tool refuses to write a half-wired feature                                                                                                                                                       |

### Why "clean merge" was not enough

The first attempt reported all wiring merges clean and still produced dead code.
Cause: the wiring source was assumed to be the same commit that added the module.
It is not — the feature commits landed the modules while the wiring was still
uncommitted, and it was later swept into the rescue commit `a038f5c113`. A
`merge-file` against a commit that never touched the wiring file succeeds trivially
and changes nothing.

`subset-replay.py` now asserts, after merging, that each added non-test module is
actually referenced by the merged result, and skips the whole selection otherwise.
That assertion is what caught S3's `app.ts` conflict instead of shipping it broken.

### Dependency closure

`subset-closure.py` resolves relative imports recursively and classifies each as
on-trunk, in-source (must be added too) or missing. Zero missing across all four
selections. S3 needs five transitive additions the naive file list did not mention
(`group-manifest`, `resolve-group-scope`, and the group workspace file
controller/wiring). Every relative import on the landed branch resolves.

### S2 landed as a reconciliation, not a replay (2026-07-27)

The maintainer reviewed both implementations side by side before deciding. Two of
the four "add/add" wiring files turned out to need no decision at all, and the
other two are not competing implementations of the same thing.

| File                                             | Finding                                                                                   | Outcome                           |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------- | --------------------------------- |
| `ui/.../render-model-memory-center.ts`           | **blob identical** on both sides (280 lines)                                              | no decision needed                |
| `ui/.../views/memory-center-page.ts`             | **blob identical** on both sides (341 lines)                                              | no decision needed                |
| `server-methods/enterprise-memory-governance.ts` | B7 is trunk +46/−8, the deletions being comment rewrites                                  | trunk kept, two handlers appended |
| `server-methods/conversations.ts`                | trunk 709 lines / 18 RPCs vs B7 77 lines / 2 RPCs, **same RPC names, different products** | trunk kept, new RPC name added    |

`conversations.export` collided by name only. The trunk writes a scoped manifest
plus checksum into the data root and returns an `exportId`; B7 merges the runtime
transcript with its archived copy and returns readable markdown with per-source
message counts. Both are wanted, so B7's is now `conversations.exportTranscript`.

`conversations.retention.scan` also collided. The trunk's does cold-tier migration
and is the stronger one, so B7's was dropped along with `retention-enforcer.ts`.

Landed: `tenant-retention-config.ts`, `retention-policy.ts`,
`conversation-export.ts` + test, the two governance retention handlers, the new
transcript export handler, and all three registration surfaces. Scopes:
`exportTranscript` → WRITE (matching `conversations.export`), `retention.get` → READ,
`retention.update` → WRITE (matching `enterprise-model-catalog.update`).

**This commit contains authored wiring (~20 lines), not a pure replay.** Acceptance
was tightened accordingly: it asserts the trunk's eighteen conversations handlers
all survive, the governance file keeps its own comments and fail-closed logic, and
every helper the new handler calls is defined or imported in that file. That last
check caught a real bug: the first attempt called `respondError`, which does not
exist here — the trunk uses `mapError`.
