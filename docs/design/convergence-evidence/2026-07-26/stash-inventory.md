# Stash 资产清点（2026-07-26）

**任务：** `local-worktree-consolidation`
**方案：** `docs/design/local-worktree-consolidation-plan-2026-07-26.md` § Phase 1 批 3
**范围：** 共享主树 `openbot` 的 22 个 `git stash` 条目（2026-04-04 → 2026-07-25）
**性质：** 只读清点 + 固定引用 + 定向抢救。**未 drop、未 clear、未 apply 任何 stash。**

## 事实修正

先前把 stash 列为「未探明的高风险资产池」，这一点需要修正：
stash 提交通过 `refs/stash` 的 reflog 是**可达对象**，`git gc` 不会回收它们 ——
内容本来就在 git 里。真实风险只有一个：**误 `git stash drop` / `git stash clear`**
（reflog 一删，提交立刻变悬挂，下次 gc 即消失）。

因此本次的处置重点不是「导出内容」，而是**把可达性钉死**：

```bash
# 22 个 stash 全部固定到专用命名空间（零字节成本，只是 ref）
git update-ref refs/stash-archive/2026-07-26/<NN> <stash-sha>
```

- 用 `refs/stash-archive/` 而非 `refs/heads/`，所以 `git branch` 列表不受影响（仍为 92 个 head）。
- 固定后即使 `git stash clear`，内容依然可达：`git show refs/stash-archive/2026-07-26/09`。
- 可逆：`git update-ref -d refs/stash-archive/2026-07-26/<NN>`。

## 清点结果

判定口径与批 2 一致：

- **唯一内容** = 该 stash 中 `path + blob` 组合在 294 个 ref（分支 + origin + tag，
  已排除 `refs/stash`）里找不到。多数属于**中间态快照**（同一文件后来在分支上演进过）。
- **孤儿路径** = 路径本身在任何 ref 都不存在（已过滤 `.build/`、`dist/`、`.o`、
  `.swiftdeps`、`node_modules/`）。这才是真正只存在于 stash 的资产。

数字为**抢救前**快照。

| stash        | 固定 ref | 日期       | 文件 | 唯一内容 | 孤儿路径 | 主题                                                       |
| ------------ | -------- | ---------- | ---: | -------: | -------: | ---------------------------------------------------------- |
| `stash@{0}`  | `…/00`   | 2026-07-25 |    2 |        1 |        0 | On deploy/user-modeling-v92: unrelated-chat-wip            |
| `stash@{1}`  | `…/01`   | 2026-07-25 |   22 |        0 |        0 | On deploy/user-modeling-v92: import-ia-all                 |
| `stash@{2}`  | `…/02`   | 2026-07-25 |   24 |        0 |        0 | On deploy/user-modeling-v92: import-ia-wip-checkout        |
| `stash@{3}`  | `…/03`   | 2026-07-25 |    1 |        1 |        0 | On deploy/user-modeling-v92: release-record-wip            |
| `stash@{4}`  | `…/04`   | 2026-07-24 |   63 |        4 |        0 | On deploy/user-modeling-v92: wip-before-v92                |
| `stash@{5}`  | `…/05`   | 2026-07-24 |   15 |        5 |        3 | On consolidation/main-wip-rescue-20260724: pre-merge-wip   |
| `stash@{6}`  | `…/06`   | 2026-07-24 |   10 |        1 |        0 | On consolidation/main-wip-rescue-20260724: loom registry w |
| `stash@{7}`  | `…/07`   | 2026-07-24 |   11 |       10 |        0 | On main: wip-before-archive-cherry-pick                    |
| `stash@{8}`  | `…/08`   | 2026-07-23 |   29 |       24 |        0 | On fix-scoped-package-templates: stash before checking res |
| `stash@{9}`  | `…/09`   | 2026-07-22 |   39 |       38 |        0 | WIP on fix-scoped-package-templates: bee5e0a580 UI: vault- |
| `stash@{10}` | `…/10`   | 2026-07-21 |    2 |        2 |        2 | WIP on fix/enterprise-channel-credentials-configure: 6f225 |
| `stash@{11}` | `…/11`   | 2026-07-19 |    3 |        1 |        0 | On release/candidate-20260712: wip-qiaomu-cut-and-cutover- |
| `stash@{12}` | `…/12`   | 2026-07-18 |  267 |      241 |       42 | On release/candidate-20260712: wip-unrelated-before-billin |
| `stash@{13}` | `…/13`   | 2026-07-13 |    2 |        2 |        0 | On fix-scoped-package-templates: enterprise-readonly-wip   |
| `stash@{14}` | `…/14`   | 2026-07-13 |   22 |       12 |        0 | On fix-scoped-package-templates: before-pr34-rebase        |
| `stash@{15}` | `…/15`   | 2026-07-13 |    7 |        3 |        0 | On pr/workbench-enterprise-ui: temp-all-before-pr44        |
| `stash@{16}` | `…/16`   | 2026-07-13 |    3 |        3 |        0 | On fix-scoped-package-templates: temp-before-pr44-rebase   |
| `stash@{17}` | `…/17`   | 2026-06-01 |  480 |      480 |      466 | On (no branch): codex-temp-push-residual-2026-06-01        |
| `stash@{18}` | `…/18`   | 2026-06-01 | 1296 |      612 |      108 | On codex/openbot/localization-workspace: codex-temp-push-2 |
| `stash@{19}` | `…/19`   | 2026-05-28 | 7294 |      299 |       96 | WIP on codex/openbot/localization-workspace: 963bf8969f fe |
| `stash@{20}` | `…/20`   | 2026-05-24 | 6165 |      108 |        2 | WIP on codex/openbot/localization-workspace: 963bf8969f fe |
| `stash@{21}` | `…/21`   | 2026-04-04 | 4925 |     1961 |        0 | WIP on codex/openbot/localization-workspace: b34af6fc99 ch |

## 已抢救（提交并推送）

孤儿路径中，**无编译风险且有长期价值**的部分已直接落地：

| 提交         | stream | 文件 | 来源         | 内容                                                                                                                                                                                                                                                                 |
| ------------ | ------ | ---: | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `366551748a` | DDOC   |   10 | `stash@{18}` | 设计记录：capability installation governance（验收/任务分解/返工清单）、employee-enterprise asset intake、agent asset binding & handover、openclaw→openbot cutover audit、platform auth 注册登录流、platform port gap、UI capability parity、ai-workforce-governance |
| `de0d990a8a` | SKL    |   13 | `stash@{18}` | `skills/pptx/**`（4）、`skills/wechat-article/**`（9）                                                                                                                                                                                                               |

skill 落地前做过凭据检查：`wechat-config.md` / `ASSET.md` 只含占位符
（`your-app-secret`、环境变量名），并扫过 `sk-…` / `AKIA…` / PRIVATE KEY 形态，无命中。
`ASSET.md` 自身即写明「不得写入 live secrets」。

## 未抢救的孤儿路径（保留在固定 ref 中，按需提取）

**处置理由：** 这些内容来自 2026-04 ～ 2026-06 的旧快照，与当前树差异巨大；
直接落进现树会引入不编译的死代码或激活副作用。已固定可达，按需提取即可。

### 决策项 D9 — `openbot-web/`：一个只存在于 stash 里的完整 Next.js 应用

| 项   | 值                                                                                                                                                             |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 位置 | `stash@{18}`（`…/18`）、`stash@{19}`（`…/19`）                                                                                                                 |
| 规模 | 40 个非构建文件（源码 + 部署脚本 + 品牌资源），另有约 440 个 `.next/` 构建产物                                                                                 |
| 内容 | `src/app/(auth)/**` 登录/找回密码页、`deploy/nginx/openbot.love.conf`、`deploy/scripts/01~04`（建站/部署/nginx/SSL）、`ecosystem.config.cjs`、`next.config.ts` |
| 现状 | 该路径在 294 个 ref 中**完全不存在**；本机也**没有** `openbot.love` 兄弟仓库目录                                                                               |

`AGENTS.md` 记载 `https://openbot.love/*` 的安装脚本「live in the sibling repo
`../openbot.love`」，但该目录当前不在本机。所以这份 web 应用要么是那个兄弟仓库的
早期版本（已在别处独立演进），要么就是**唯一副本**。

**需要人类决策：** 它属于 openbot 仓库边界之外的独立应用，不应直接并入本仓库。
建议由维护者确认兄弟仓库是否存在于其他机器/远端；若不存在，从
`refs/stash-archive/2026-07-26/18` 提取到独立仓库。

**安全提示：** `openbot-web/.env.local`、`.env.production` 在该 stash 中，
**不得**提交进任何仓库或补丁；提取时必须排除。

### 其他未抢救簇

| 簇                             | 位置                   | 文件数 | 说明                                                                                                                                                                                                                                                |
| ------------------------------ | ---------------------- | -----: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| style-contract 强制子系统      | `…/18`、`…/19`         |      3 | `.kiro/steering/frontend-style-contract.md`、`.kiro/hooks/style-contract-check.kiro.hook`、`ui/tools/style-contract/verify-contract.ts`。**未落地原因：** hook 文件一旦提交即生效，会给所有会话加钩子，属行为变更，需单独决策                       |
| 治理/迁移脚本                  | `…/18`、`…/19`         |      9 | `scripts/check-no-hardcoded-colors-in-enterprise.mjs`、`check-no-raw-svg-in-ui.mjs`、`enterprise-usage-terminology-lint.ts`、`migrate-upbeyond-tenant-id.ts`、`publish_model_war.js`、`rebrand-docs-openclaw-to-openbot.sh`、`scripts/__tests__/**` |
| 测试套件                       | `…/18`、`…/19`         |     10 | `test/generators/**`（4）、`test/integration/**`（5）、`test/scripts/snapshot-plugin-registry.test.ts`；均为 2026-05 的旧契约，跑不通当前树                                                                                                         |
| enterprise capability usage UI | `…/19`、`…/20`         |      5 | `ui/src/ui/views/enterprise-capability-usage-management/**`、`ports/enterprise/views/enterprise-usage-management-surface.ts`                                                                                                                        |
| collaboration-learning 测试    | `…/05`                 |      3 | `embedded-profile-members.test.ts`、`event-entry.test.ts`、`mesh-ownership-backfill.test.ts`（被测实现路径已在 ref 中，但这三个测试文件路径不存在）                                                                                                 |
| RC 构建层 Dockerfile           | `…/10`、`…/12`         |     44 | `Dockerfile.rc-v10-layer` … `Dockerfile.rc-v74-layer`。历史构建层，2026-07-23 整理时已按噪声删除同类文件（`Dockerfile.rc-v68-layer`），**判定为可弃**                                                                                               |
| 构建产物                       | `…/17`、`…/19`、`…/21` | ~1000+ | `openbot-web/.next/**`、`apps/macos/.build/**`。**判定为可弃**                                                                                                                                                                                      |
| 一次性本机材料                 | `…/18`、`…/19`         |      8 | `generate_ai_ppt.py`、`workspace-bot/*.py`、`create-openbot-web.sh`、`migrate-homepage-guide.md`、`interface-contract-report.md`、`openbot-web-plan.md`、一个 `.pptx`。属 2026-04-09 manifest 的 CLEAN 类                                           |

## 提取命令

```bash
G=/usr/bin/git
REF=refs/stash-archive/2026-07-26/18

# 看这个 stash 改了什么
$G stash show --name-only --include-untracked "$REF"   # 或 $G show --stat "$REF"

# 取单个文件（未跟踪部分在 ^3 树里）
$G cat-file blob "$REF^3:skills/pptx/SKILL.md" > /tmp/out.md
$G cat-file blob "$REF:src/gateway/foo.ts"     > /tmp/out.ts

# 整目录提取到目标位置（示例：openbot-web，排除构建产物与 env）
$G ls-tree -r --name-only "$REF^3" -- openbot-web \
  | grep -v '/\.next/' | grep -v '\.env' \
  | while read -r f; do
      mkdir -p "/tmp/extract/$(dirname "$f")"
      $G cat-file blob "$REF^3:$f" > "/tmp/extract/$f"
    done
```

## 禁止操作

- 勿 `git stash clear` / `git stash drop`，除非本台账已把对应条目标为可弃**且**
  固定 ref 已按需保留。
- 勿把 `openbot-web/.env*` 提交进任何仓库或补丁。
- 勿直接 `git stash apply` 到共享主树 —— 会与其他 agent 的在途改动混合。
