# Phase 2 前向重放执行清单（2026-07-27，v2）

**方案：** `docs/design/local-worktree-consolidation-plan-2026-07-26.md` § Phase 2
**实测工具：** `phase2-replay-audit.py`（只读可复现，自带 P1–P7 断言）
**当前门禁状态：** **FAIL —— 存在 1 个未解阻塞项（P7）**
**状态：** 分析完成，**未向 SoT 开任何 PR**；等 D1 批准 + P7 解除

> 判定与数字随 SoT 推进变化，引用前必须重跑脚本。本文数字为
> SoT `origin/release/baseline-recovery-20260725` 于 2026-07-27 13:4x 的快照。
> v1 曾把「VERDICT: PASS(6/6)」写成结论，20 分钟后即失效 —— 不要再这样做。

## v1 被第三方验收判 FAIL，v2 是修正版

验收记录：`acceptance-phase2-2026-07-27.md`。v1 的四个实质缺陷：

| v1 缺陷                                                              | 后果                                                                                                                                                                                                                | v2 修法                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 分类按**路径前缀**，把整个 `deploy/production/` 与 `.loom/` 当记录类 | 会丢生产 nginx HSTS + 4 个 vhost 的 308 跳转（`00006f8360`）、门禁脚本 `verify-delivery-alignment.sh`（`783a0e3b61`）与 `verify-forward-only.sh`（`1c9f4beb04`）、企业路由规范化（`f5cd300911`）、registry 治理数据 | 改**内容判据**：仅当全部文件是 `*.md`/`*.mdx` 且位于 `docs/`、`.kiro/`、`deploy/production/` 或 `CHANGELOG.md` 才算记录类；`deploy/production/{proxy,scripts,*.yml,*.json5,Dockerfile*,env.*}` 与 `.loom/registry.yaml` 一律按运行时/治理数据重放 |
| merge-tree 退出码 0 一律算「干净重放」                               | 18 个空 cherry-pick 被算成工作量，「44 个干净代码重放」虚高                                                                                                                                                         | 结果树等于基线树 → 判为**空操作**，不计入                                                                                                                                                                                                         |
| 退出码非 0 一律算「需人工对账」                                      | 已被 SoT 取代的提交（如 runtime-health 三连）被算成待办                                                                                                                                                             | 提交内所有文件 blob 已等于 SoT → 判为**已取代**                                                                                                                                                                                                   |
| 逐条**独立**模拟                                                     | 只给上界；前序落地后后续冲突常自动消失                                                                                                                                                                              | 改 merge-tree + commit-tree **链式顺序模拟**                                                                                                                                                                                                      |

另新增：悬空引用检查（P6）、`.tmp/` 夹带检查（P7）、被排除范围量化（P5）。

## 修正后的实测结果

| 口径                       |                 v1 | v2（正确） |
| -------------------------- | -----------------: | ---------: |
| 独有提交                   |                120 |        123 |
| 记录类（只入台账）         |                 50 |     **34** |
| 合并提交（不 cherry-pick） |                  4 |          5 |
| 代码+配置                  |                 66 |     **84** |
| 可重放                     | 60（含 18 空操作） |     **56** |
| 真冲突（需人工对账）       |                 22 |     **44** |
| 空操作                     |             未识别 |          9 |
| 已取代                     |             未识别 |          9 |

**v1 把真实对账工作量低估了一半（22 → 44）**，同时把 16 个含运行时/配置内容的提交
误排除出重放范围。

## 被排除范围（v1 完全没量化，这是数量级低估）

| 分支                               | ahead(SoT) | 其中非 prose |
| ---------------------------------- | ---------: | -----------: |
| `main`                             |         40 |           39 |
| `origin/deploy/user-modeling-v92`  |         40 |           39 |
| `deploy/user-modeling-v92`（本地） |        196 |          152 |
| `release/candidate-20260712`       |        315 |          301 |

被排除的非 prose 提交约 **492 个**，是范围内 84 个的近 6 倍。
「Phase 2 = 44 干净 + 22 对账」这个说法只对 8 条小分支成立，
**不代表整体收敛工作量**。这三条大分支必须单独排期，不能继续挂在"待单独排期"里不给数。

## P0 —— `origin/main` 已被非快进强推（本轮新发现）

实测：旧 tip `0536504b9e` **不再是** `origin/main` 的祖先（强推发生在 2026-07-27
12:39 与 12:49）。那 40 个提交（含已合并 PR #90、#91、`Gateway: prevent ghost bot
ownership revival on mesh backfill`、type-drift 清理、`@noble/hashes` 依赖）
当时**只剩一条远端 ref 承载** —— 而那条是本方案标为 archive-only 的
`origin/deploy/user-modeling-v92`。

**已处置：** 推出专用备份 `origin/backup/main-pre-forcepush-20260727` →
`0536504b9e`。现有 2 条远端 ref 承载（断言 P2 校验 ≥2）。

**仍需人类决策：** `origin/main` 被强推到 SoT 线，说明有人已在事实上执行 T1
（把 main 对齐生产主干）。这与 D1 尚未批准的状态冲突 —— 请确认是否追认。

同类处置：`kiro/enterprise-ai-model-governance` 有 2 个本地未推送提交携带唯一的
`.loom/registry.yaml` 治理数据，已备份为
`origin/backup/enterprise-ai-model-gov-20260727`（未动其分支本身）。

## 未解阻塞：P7 —— `a038f5c113` 夹带 300 个 `.tmp/` 文件

`cursor-composer/collaboration-deliverable-v95`（B7）的
`a038f5c113 Rescue: main ahead-6 + collaboration/evolution WIP off shared tree`
共 514 个文件，其中 **300 个位于 `.tmp/workspace-audit-20260723/`**（临时审计 dump）。
原样 cherry-pick 会把临时产物落进生产主干。

**门禁规则：B7 在该提交被拆分（剔除 `.tmp/`）之前不得执行。** 其余批次不受影响。
这就是当前 `VERDICT: FAIL` 的唯一原因 —— 不是分析错误，而是一个必须在执行前解除的前置条件。

## 逐分支批次（v2 数据，按真实难度）

顺序建议：**B1 → B2 → B3 → B4 → B6 → B5 → B8 → B7**
（v1 的 B5→B6 顺序与难度尺度相反，已纠正：B6 冲突足迹 2 文件/8 行，B5 为 23 文件/12 模块。）

| #   | 分支                                            | 独有 | 备注                                                          |
| --- | ----------------------------------------------- | ---: | ------------------------------------------------------------- |
| B1  | `kiro/enterprise-ai-model-governance`           |  1+2 | 含 2 个本地 registry 提交，已备份                             |
| B2  | `codex-favicon/web-favicon-branding`            |    1 | 单条代码                                                      |
| B3  | `convergence/2026-07-20`                        |    3 | 全 prose → 只入台账                                           |
| B4  | `kiro-web-ui/knowledge-workbench-import-ia`     |   10 | 代码基本干净                                                  |
| B6  | `codex-delivery-guard/delivery-alignment-guard` |   23 | **含 `verify-forward-only.sh` 创建提交，必须重放**（v1 会丢） |
| B5  | `wip/ops-nginx-hsts-https-redirect`             |   13 | **含生产 HSTS + 308 跳转，必须重放**（v1 会丢）               |
| B8  | `codex/openbot-enterprise-channels-release`     |   48 | 9 条改门禁脚本，非纯记录（v1 判断有误）                       |
| B7  | `cursor-composer/collaboration-deliverable-v95` |   21 | 最难；**被 P7 阻塞**                                          |

## 前置门禁：活跃度判定（v3 新增，执行 B2 时发现的缺口）

原清单假设这 8 条分支的 owner 都已收工 —— **这个假设是错的**。执行时实测：

| 批  | 分支                                            | 变化                                                                               | 判定                       |
| --- | ----------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------- |
| B1  | `kiro/enterprise-ai-model-governance`           | 1 → **10** 个提交，1.5 小时前仍在提交（企业 AI 模型 UI + gateway plan projection） | **OWNER 在途，不代为重放** |
| B6  | `codex-delivery-guard/delivery-alignment-guard` | 23 → **1** 个提交，owner 已自行通过 PR #92 / #102 merge-back 落完                  | **OWNER 在途，不代为重放** |

**规则：** 满足任一条即为 owner-led，由其自行开 PR，收敛方不得代为 cherry-pick：

- `.loom/registry.yaml` 中有绑定该分支的 `active` 会话
- 最近一次提交在 24 小时内

依据 `AGENTS.md` §2「contributors signal, they do not land」。代为重放在途分支会与
owner 的后续提交产生重复落地，且剥夺其对自己工作的整合审查权。

判定工具：`phase2-liveness.py`（同目录）。**每批开工前必须先跑一次**，不能沿用旧清单。

B6 的走向反过来印证了 owner-led 路径有效：它自己从 23 个缺口降到 1 个，收敛方一行没动。

## 每批固定动作

0. **活跃度判定**（见上）：owner-led 的分支跳过，只记录不重放。
1. **剔除**：仅 prose-only 提交与合并提交不进 cherry-pick；配置/脚本/registry 一律重放。
2. **去重**：空操作与已取代提交标记后跳过，不计工作量。
3. **重放**：`git cherry-pick -x`，保留来源 SHA。
4. **台账**：`deploy/production/BASELINE_RECOVERY_20260725.md` 追加 `REPLAY → PRESENT` + provenance。
5. **验证**：`pnpm tsgo` + 受影响测试。
6. **验收**（门禁 G-ACC）：重跑本脚本，判定必须 PASS；FAIL 项须逐条给出真伪判断。
7. **回收**：ahead 归零后由人类 `worktree remove`。

## 已确认无需动作

| 项                                                                    | 实测                      | 结论                                                                                                                                       |
| --------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `fix-scoped-package-templates`                                        | ahead=0                   | 可直接回收（P3）                                                                                                                           |
| `pr85-conflict-resolved`                                              | 与本地 `main` 等价（0/0） | 内容已在 `origin/backup/main-pre-forcepush-20260727` 与 `origin/deploy/user-modeling-v92`。**注意：v1 写的"已在 origin/main"因强推已失效** |
| `codex-delivery-guard/delivery-alignment-guard`                       | 本地 = origin             | 无远端备份的 P0 已由 owner 于 07-27 10:28 自行关闭                                                                                         |
| `openbot-archive-attribution-replay`、`openbot-archive-layout-polish` | ahead=0                   | 可回收                                                                                                                                     |

## 需人类决策

- **D1**：唯一主干 T1（SoT 族）/ T2（回灌 main）。建议 T1；且 `origin/main` 已被事实上强推到 SoT 线，需追认。
- **D7 修正**：原表述「`Deploy: record …` 类只入台账」**不能按提交标题判断** ——
  B8 有 9 条标题是 `Deploy: record vNN` 的提交同时修改了可执行门禁脚本。
  改为按内容判据（prose-only 才入台账）。
- **D10（新）**：`a038f5c113` 的 `.tmp/` 拆分由谁执行（B7 owner 或收敛 owner）。

## 执行进度（活的记录，随批次更新）

| 批  | 分支                                            | 独有 | 处置                                             | PR                                                    | 验收                              |
| --- | ----------------------------------------------- | ---: | ------------------------------------------------ | ----------------------------------------------------- | --------------------------------- |
| B2  | `codex-favicon/web-favicon-branding`            |    1 | 1 REPLAY                                         | [#106](https://github.com/gmood2008/openbot/pull/106) | `verify-replay-b2.py` 8/8 PASS    |
| B3  | `convergence/2026-07-20`                        |    3 | 3 LEDGER-ONLY（无运行时内容，不需重放分支）      | 随 #109                                               | `verify-replay-b3-b4.py` 8/8 PASS |
| B4  | `kiro-web-ui/knowledge-workbench-import-ia`     |   10 | 8 REPLAY / 1 SUPERSEDED / 1 LEDGER-ONLY          | [#109](https://github.com/gmood2008/openbot/pull/109) | 同上                              |
| B1  | `kiro/enterprise-ai-model-governance`           |   12 | **跳过 —— OWNER 在途**                           | 由 owner 自开                                         | 活跃度门禁                        |
| B6  | `codex-delivery-guard/delivery-alignment-guard` |    1 | **跳过 —— OWNER 在途**（已自行从 23 降到 1）     | #92 / #102 已合                                       | 活跃度门禁                        |
| B5  | `wip/ops-nginx-hsts-https-redirect`             |   13 | 待做（含生产 HSTS + 308 跳转，必须重放）         | —                                                     | —                                 |
| B8  | `codex/openbot-enterprise-channels-release`     |   48 | 待做                                             | —                                                     | —                                 |
| B7  | `cursor-composer/collaboration-deliverable-v95` |   21 | **被 P7 阻塞**（`a038f5c113` 的 300 个 `.tmp/`） | —                                                     | —                                 |

PR 采用**堆叠**方式（#109 的 base 是 #106 的分支），避免多个 PR 同时向
`BASELINE_RECOVERY_20260725.md` 追加台账行而冲突；上游合入后 GitHub 自动改指 base。

### 重放忠实性的正确判据（B4 执行时纠正）

首版验收对源提交的**所有**文件比对 blob 全等 —— 这个判据是错的，B4 有 10 个文件报不同。
原因：cherry-pick 应用的是同一个 **delta**，落到不同基线上，**修改型**文件的结果 blob
必然与源不同。blob 全等只对**新增型**文件成立（B2 全为新增，所以首批侥幸通过）。

正确判据：

- 每个提交：`git diff <落地^> <落地> | git patch-id --stable` 必须等于
  `git diff <源^> <源> | git patch-id --stable`
- 新增型文件：额外比对 blob 全等
- 修改型文件：**不比 blob**，由上面的 delta patch-id 覆盖

这是本轮第三次「验收脚本自身判据错误」，前两次是反向 apply 误判补丁失真、
排除 ref 漏了抢救提交所在分支。共同模式：**把"结果相同"当成"变更相同"**。

## B5 执行记录（2026-07-27）

PR [#113](https://github.com/gmood2008/openbot/pull/113)，堆叠在 #109 → #106 之上。

| 判定           | 数量 | 内容                                                                                                       |
| -------------- | ---: | ---------------------------------------------------------------------------------------------------------- |
| **REPLAY**     |    2 | `00006f8360` 边缘主机 HSTS + 4 个 vhost 的 308 跳转；`2a5d974531` 配套生产变更窗口清单（主干原本缺该文件） |
| **SUPERSEDED** |    4 | 见下方证据表 —— 全部有据，不是"待办"                                                                       |
| LEDGER-ONLY    |    4 | pipeline 标准文档（主干已有更新版）× 2、v70/v71 cutover 记录 × 2                                           |
| MERGE          |    3 | PR #47/#48/#49 的合并提交                                                                                  |

实测效果：主干原本 `apex` 无 HSTS，`gw`/`admin`/`biz` 有 HSTS 但**四个 vhost 全都没有 308 跳转**；
重放后四个 vhost 均为 HSTS ✓ / 308 ✓。这正是第三方验收点名、v1 分类规则会整条丢掉的缺口。

### 4 个冲突的定性证据

| 源           | 判定       | 证据                                                                                                                                                  |
| ------------ | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `783a0e3b61` | SUPERSEDED | 主干 `verify-delivery-alignment.sh` 177 行 vs 本提交 159 行，重放即回退                                                                               |
| `aa7e3915ed` | SUPERSEDED | 主干 `AGENTS.md` 已指向 `verify-forward-only.sh`（B6 owner 落），本提交指向旧脚本                                                                     |
| `4d4e0ce764` | SUPERSEDED | 同上                                                                                                                                                  |
| `6c1f5077da` | SUPERSEDED | 21 文件中 18 个已与主干逐字相同；`package.json` 的 `./plugin-sdk/wecom` 导出与 `vitest.config.ts` 的 `wecom` project 均已在主干，冲突只来自热文件漂移 |

## 分类规则第二次修正：RECORD vs DOC

原规则「prose-only → 只入台账」会丢掉 `2a5d974531`（生产变更窗口清单，主干无此文件）。
**让配置变更落地却丢掉配套的变更窗口清单，比两者都不落更糟。**

修正后：

- **RECORD**（只入台账）= `deploy/production/RELEASE_RECORD.md`、`cutover-README.md`、
  `cutover-history.log`、`**/tasks.md` 进度标记
- **DOC**（必须重放）= 其余 prose；判据是**主干是否缺该文件**，缺则说明是真内容

## 工具 bug：`git rev-parse` 会回显不存在的路径

`git rev-parse <rev>:<不存在的路径>` 把参数**原样回显到 stdout**，再向 stderr 报错。
只读 stdout 的脚本会把「路径不存在」误判成「存在」。

影响与善后：

| 脚本                      | 影响                                                                          | 善后                                                                                                                |
| ------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `replay-batch.py`         | prose 提交的「主干缺该文件」判断永远为假 → `2a5d974531` 首轮被误判为 LEDGER   | 已修，改用 `rev-parse --verify --quiet` + 查退出码                                                                  |
| `orphaned-main-triage.py` | 「SoT 缺 N 个文件」分支永不触发 → 10 条提交的**理由**被写成「SoT 侧未再改动」 | 已修并重跑：16/18/2/4 分类结论不变，但理由更正为「SoT 缺文件」，其中 `a038f5c113` 缺 339/514、`0e7e2fc7ee` 缺 18/28 |

分类结论没变，但理由的准确度变了 —— 「主干根本没有这些文件」比「主干没再改过」紧急得多。

## B8 执行记录（2026-07-27）

PR [#117](https://github.com/gmood2008/openbot/pull/117)，堆叠链第四层（#113 ← #109 ← #106）。
48 个独有提交，逐条判定后**只有 5 个需要真重放**。

| 判定         | 数量 | 说明                                                                                          |
| ------------ | ---: | --------------------------------------------------------------------------------------------- |
| **REPLAY**   |    5 | SecretRef 脱敏恢复、biz 路由规范化（三方合并到 B5 的 nginx 改动之上）、两个 UI 样式、一个测试 |
| SUPERSEDED   |    5 | 每个文件已与主干逐字相同                                                                      |
| NO-OP        |   10 | 三方合并结果树未变 —— 真 cherry-pick 会报 empty                                               |
| LEDGER-ONLY  |   12 | v91–v104 cutover 记录与 spec 进度标记                                                         |
| **DEFERRED** |   16 | 9 个门禁脚本 + 7 个部分重叠，逐条有证据                                                       |

### 发现：门禁脚本的默认镜像停在 v91，生产在 v120

主干 `deploy/production/scripts/verify-delivery-alignment.sh:13`：

```
PROD_IMAGE="${PROD_IMAGE:-openbot:rc-amd64-v91-enterprise-channels-secretref-save}"
```

门禁在拿一个**落后 29 个版本**的镜像做对照。B8 有 9 个提交把它从 v91 推到 v104，
重放能往前挪但仍落后 16 个版本，所以标 DEFERRED 而不是重放。

**一个反直觉点值得记下：** 主干那份脚本**更长**（177 行 vs 124 行，多出 forward-only
门禁），但期望镜像**更旧**。「主干更新，所以源提交已过时」这个假设在这里不成立 ——
**长度不等于新**。B5 判 `783a0e3b61` SUPERSEDED 时用的正是行数论据，事后看那个论据
偏弱（结论仍成立，因为 B5 那条改的是 forward-only 部分），此处必须按字段逐个核。

归属：delivery-guard owner。正确修法是把默认值指向当前生产 tip。

### 7 个部分重叠的 DEFERRED

| 源                                     | 重叠                                                                |
| -------------------------------------- | ------------------------------------------------------------------- |
| `1c4feaf61e` `7748675482` `bf7cc9061d` | 同改 `enterprise-message-channels-surface.ts`，主干已按自己路线演进 |
| `8d34b63bc7`                           | 6 文件中 2 个已在主干                                               |
| `27a7163e60`                           | 15 文件中 8 个已在主干                                              |
| `23821a2b68`                           | 11 文件中 6 个已在主干                                              |
| `d1fad9e750`                           | 主干已有不同版本                                                    |

机械重放会覆盖更新的实现，需人工对账。

## 忠实性判据定版（三次踩坑后）

| 文件类型    | 判据                                                                          |
| ----------- | ----------------------------------------------------------------------------- |
| 新增型（A） | 结果 blob 必须与源逐字相同                                                    |
| 修改型（M） | **不能比 blob**。核「源提交的每一行新增是否都出现在结果里」                   |
| 全提交      | `merge-tree` 退出 0 是首要保证；`patch-id` 相等是加强证据，不等**不代表失真** |

三次同类错误：①反向 apply 失败误判补丁失真 ②排除 ref 漏了抢救提交所在分支
③blob 全等用于修改型文件（在 verify 脚本与 replay 工具内部各犯一次）。
共同模式：**把"结果相同"当成"变更相同"**。

验收脚本：`verify-replay-b5-b8.py`（11/11 PASS）。
