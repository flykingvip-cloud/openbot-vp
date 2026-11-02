# 00 — Pin (credentials-omit acceptance, 2026-11-02)

**When:** 2026-11-02 Asia/Shanghai (CST, UTC+8)  
**Repo:** `flykingvip-cloud/openbot-vp` (remote verified `git@github.com-flykingvip:flykingvip-cloud/openbot-vp.git`)  
**Worktree (isolated):** `/Users/daniel/AI VP/openbot-acceptance-main-d42fbc3ca2` (detached `origin/main`)  
**Docs land worktree:** `/Users/daniel/AI VP/openbot-acceptance-coverage-20261101` (branch `docs/acceptance-coverage-20261101` → PR #193)  
**Shared dirty tree:** `/Users/daniel/AI VP/openbot/` — **not modified for product**; used read-only for same-SHA toolchain (`node_modules`, Control UI build into gitignored `dist/`).

## origin/main pin

| Item | Value |
| --- | --- |
| Full SHA | `d42fbc3ca2b4041ee70bb1dfb9cd70f33678370c` |
| Subject | `docs(memory): final closeout acceptance (draft) (#182)` |
| Commit time (author) | 2026-11-01 23:34:27 +0800 Asia/Shanghai |

## Compare to prior evidence pins

| Prior pin | Full SHA (abbrev ok in table) | Relation to current main | Reuse? |
| --- | --- | --- | --- |
| Prior coverage tip / dirty HEAD | `d42fbc3ca2…` | **identical** to current `origin/main` | Product tree unchanged vs last coverage tip |
| PR #192 merge | `bc843c70ecdd3afdae0020403d4b4b22c8849371` | ancestor (−7) | P1 DEF-001/002/004 product fixes still on main — **reuse PASS** |
| Old acceptance main WT | `3f7786f4aad2d439e499c42df9f8bcbd0480e313` | ancestor (−10) | Too old for Stage4 omit re-run claims |
| PR192 review evidence batch | `1ce8f5ee4e8c852d45a9c6a30a623e0bed082587` | not on main lineage (docs/fix branch tip that merged) | Stage4 FAIL log reusable as **historical**; must re-run omit on main tip |
| Coverage docs tip (PR #193 HEAD) | 见分支 tip（含后续口径提交） | ahead of main（`docs/acceptance/**` + `.loom/registry.yaml`） | Docs/evidence for N≈118 reusable as draft; **行数≠功能分母**；须硬化口径 |

## What remains reusable vs must re-run

### Reusable (do not claim as new product verification)

- PR #192 independent review: DEF-001 / DEF-002 / DEF-004 **PASS** on merged product (`bc843c70…`) — still on main.
- Channel plugins↔docs static 24↔24 inventory shape (reconfirmed counts this run; live still NOT RUN).
- Multi-end PRESENT inventory (6 apps); toolchain BLOCKED list (SwiftPM policy, ios xcodegen, windows SDK, harmony hvigor).
- CLI `--help` surface count **49** (re-smoked this run).
- Committed SBOM static presence ≠ regen/audit PASS (prior Stage6 timeout still stands; not re-run network audit).

### Must re-run / newly required this run

- **Stage4 / backup credentials-omit** on pin `d42fbc3ca2…` (PRIORITY) — prior FAIL was on `1ce8f5ee…`.
- Security-boundary classification for omit failure (redaction gap vs secret leak).
- Row-tracked coverage denominator (replace “约 N=118” soft claim).
- Control UI credential-free compile/static smoke on current tip.
- PR #193 docs review (merge verdict only; **do not merge**).

### Explicitly NOT RUN (policy)

- Live credentials / Enterprise IM live I/O / live gateway doctor against prod.
- SwiftPM full `swift build` (policy + prior hang).
- No product patch for credentials-omit without separate authorization.

## 2026-11-02 independent reviewer corrections（口径收紧）

- DEF-008：**代码根因与团队归档证据相互吻合** → 可接受为产品缺陷登记。
- **验收方独立运行复现尚未完成**（**双阻断**：缺 `node_modules/@openbot` 链接 **且** 无 `packages/collaboration-core/dist`；单项恢复未必够）。不得把团队复现写成「验收方已独立复现」。
- 安全：凭证排除失效；可能在备份分享/上传/存储时暴露凭证；**无**远程攻击 / 提权 / 真实泄露已发生之证明。
- 总评继续 **FAIL / NOT READY**。接受 DEF-008 登记及 Stage4 FAIL；**不核准**全栈通过；**不据此批准 #193 合并**。
- 本轮：文档/口径 + `.loom/registry.yaml` 管理登记；未改产品代码、未装工具链、未 merge。详见 `../2026-11-02-independent-reviewer-corrections/`（含 `01-owner-confirm-round2.md`）。
