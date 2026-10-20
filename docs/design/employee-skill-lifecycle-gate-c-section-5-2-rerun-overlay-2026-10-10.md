---
date: 2026-10-10
status: gate_c_overlay_rerun_partial
gate_c_passed: false
gate_c_statement: "主切片 loader 路径在 overlay 上可勾大部分；binding synced 未过；纯 main 未含 565/567"
incubation_fully_passed: false
observation_origin_main: 041dfd8826ee5d9854e5d3aefc46ec90dd94fc15
observation_origin_main_includes_553: true
observation_origin_main_includes_565: false
observation_origin_main_includes_567: false
live_head: d9960b3167d77bd1466e8ea718ebcb7d5124e7f7
live_head_kind: temporary-mac-worktree-overlay
live_head_is_product_default: false
overlay_reversible: true
pr_565_state: OPEN
pr_567_state: OPEN
hk_live_commit: 65564d30b25a41f49866f96e0efed9caacd80a9b
this_run_is_hk_live: false
this_run_is_pure_main: false
source: 性能评测 live
timezone: Asia/Shanghai
agent_id: agt-daniel-hhd-gmail-com-nchn5ey
skill_id: skill_702b024b2d39
skill_deleted_after: true
related:
  - 549
  - 553
  - 562
  - 565
  - 567
product_code: false
---

# 员工技能生命周期：闸门 C 第 5.2 节 overlay 重跑笔记

> **文档状态：闸门 C 未通过。** 主切片 loader 路径在 overlay 上可勾大部分；binding synced 未过；纯 main 未含 #565 / #567。
>
> 日期：2026-10-10（Asia/Shanghai）
> 来源：性能评测 live，blocker 之后的重跑
> 观测当时的纯 `origin/main`：`041dfd8826ee5d9854e5d3aefc46ec90dd94fc15`（#564）。该 tip 包含 #553（`17e11f1549531f2fc50c1d3b4417e8beff64f858`）。#565 与 #567 当时仍是 GitHub OPEN，不在这棵 tip 里。
> 实际 live HEAD：`d9960b3167d77bd1466e8ea718ebcb7d5124e7f7`。这是临时 Mac worktree overlay：上述 `origin/main` 再 merge #567、再 merge #565。可逆，不是产品默认。
> 相关：切片设计 #549、分层回报 #553、上一份未全通现场笔记 #562、个人资产认证 #565（OPEN）、Node loader 导入 #567（OPEN）。
> 本文件只收这次现场。零产品代码。不改写 #562。

`main` 已经包含 #553，只说明分层回报的代码在纯主干上。这次能保存个人技能、并能用 `node --require tsx/cjs` 调用 `resolveEmbeddedRunSkillEntries`，是因为 live 进程跑在含 #565 与 #567 的 overlay 上。这两份 PR 没有合入 `main`。

## 1. 环境

| 身份 | commit / 状态 | 这次怎么用 |
| --- | --- | --- |
| 观测当时的纯 `origin/main` | `041dfd8826ee5d9854e5d3aefc46ec90dd94fc15` | 含 #553。不含 #565，不含 #567。不是 live HEAD |
| #553 | `17e11f1549531f2fc50c1d3b4417e8beff64f858`，已合入上述 tip | 分层字段 `relation` / `projection` / `runtimeBinding` 来自这条已合入的回报。不能把 #553 在主干上的存在写成闸门 C 通过 |
| #565 | GitHub **OPEN**，未合入 `main` | 只存在于 overlay 的第二次 merge。共享 token + 设备握手、无顶层 `user`、`pairedDeviceId` → `ownerId` 是这条未合入改动上的现场 |
| #567 | GitHub **OPEN**，未合入 `main` | 只存在于 overlay 的第一次 merge。`node --require tsx/cjs` 导入 `resolveEmbeddedRunSkillEntries` 成功，是这条未合入改动上的现场 |
| 实际 live HEAD | `d9960b3167d77bd1466e8ea718ebcb7d5124e7f7` | 临时 Mac worktree：`041dfd882…` + merge #567 + merge #565。可逆。不是产品默认。本仓库对象库没有这个 SHA，身份来自性能评测的现场报告 |
| HK LIVE | `65564d30b25a41f49866f96e0efed9caacd80a9b` | 不是这次。RepoDigest `sha256:52cb4039a395717a1381f94f4c276306f085ec15c9b2bd63ff6f539baa993e6f` |
| 撰写时的 `origin/main` | `f43330f00792a585df40f9be2cf27b4fad2f6e8b`（#562） | 观测 tip 之后只多了 #562 那份文档。仍不含 #565 / #567。撰写时的主干不是 live HEAD |

健康检查为 live。health live 不是 §5.2 的「真实执行上下文可见」。

## 2. 这次现场先成立的四件事

性能评测在 overlay 上记下：

1. **健康：** gateway health 为 live。
2. **loader 导入：** `node --require tsx/cjs` 导入 `resolveEmbeddedRunSkillEntries` 成功。#562 在 `156b03113…` 上的失败是 `ERR_PACKAGE_PATH_NOT_EXPORTED`。这次成功依赖 overlay 里的 #567，纯 `041dfd882…` 的 `patchedDependencies` 没有这条 Node `require` 导出补丁。
3. **认证：** 共享 token + 设备握手。连接没有顶层 `user`。个人资产主人走 `pairedDeviceId` → `ownerId`。这是 overlay 里的 #565。纯主干上的 `resolvePersonalAssetOwnerIdentities` 仍只收集平台用户 id 与邮箱，不读 `pairedDeviceId`。
4. **清理：** 跑完后已删除。下面的 `skillId` 是这次记录的键，不是仍留在 gateway 上的资产。

| 键 | 值 |
| --- | --- |
| agentId | `agt-daniel-hhd-gmail-com-nchn5ey` |
| skillId | `skill_702b024b2d39`（事后已删除） |
| 投影名 | `ob-asset-skill_702b024b2d39` |

## 3. §4.2 三层记录

表结构与 #549 §4.2 一致。可用性只写在结论栏。关系、投影、绑定分开记。主切片的下一次 loader 与对照入口的 loader 分开记。同一次安装 RPC 里的 `{ skill }` 或刚写的文件，不充当下一次 `resolveEmbeddedRunSkillEntries`。

| 步 | 安装关系 | 执行投影 | 运行时绑定 | 结论栏（仅笔记） | 失败原因原文 |
| --- | --- | --- | --- | --- | --- |
| 创建或选择 | 先保存 draft。第一次因缺少 `sourceAgentId` 失败；补上之后保存成功，再定稿 | 定稿前的 draft 没有被记成可执行投影 | 本步报告未单列绑定 | 定稿结果：`private`，`v1.0.0`。留下 `skillId=skill_702b024b2d39`。draft 不是后来被 loader 看见的终态 | 第一次：`sourceAgentId` required。报告没有另打印类名 |
| 保存 | `personal-skills.detail` 与保存结果一致。读的是个人技能资产，不是 `employee-install.json` | 本步报告未单列新投影 | 本步报告未单列绑定 | 再读 PASS | 第一次失败文案见上一行。成功路径没有失败文案 |
| 授权/安装（主切片 `robot-skills.install`） | `linked` | `ready` / action `materialised`。名字 `ob-asset-skill_702b024b2d39` | **未同步。** role `auxiliary`，state `failed`，`synced: false` | 三行取值彼此独立。关系 linked 与投影 ready 没有把绑定写成 `synced` | `membership-not-found` |
| 授权/安装（对照 `employee-install`） | 请求状态 `installed`。这是安装请求，不是主切片的 `robotRelations` | `not_materialized` | 未同步。`synced` 不是 true | `executable: false`，`availability: failed`，`nextStep: runtime-binding-failed`。随后的 loader 仍看不到该技能。**installed ≠ ready** | `membership-not-found` |
| 运行（主切片下一次 loader） | 本步报告未给出关系变化 | 下一次 `resolveEmbeddedRunSkillEntries` 看见 `ob-asset-skill_702b024b2d39` | 绑定仍是上一行的 `synced: false`。loader 看见投影，不把绑定升级成 `synced` | 来源 `openbot-lifecycle-binding`。证据是安装返回之后的另一次调用 | 无。导入本身已成功，见第 2 节 |
| 撤销（`robot-skills.remove`） | `absent` | 投影已移除 | 不把安装时的 `synced: false` 沿用成撤销通过 | 关系消失且投影移除。这还不是下一轮 loader | 无失败文案。响应里的成功标志没有被单独当成下一轮证据 |
| 撤销后的下一次 loader | 关系保持 absent | 该名字不再被加载 | 绑定 synced 仍未通过，且本步不需要它来证明名字消失 | 下一次 `resolveEmbeddedRunSkillEntries` 对该名字 **hitCount=0** | 无 |

幂等补行：报告没有对同一机器人、同一技能做第二次 `robot-skills.install`。不记幂等通过。并发未测。

## 4. §5.2 十一条

勾选只覆盖性能评测这次 overlay 现场里已经写下的 PASS。`runtimeBinding.synced` **不勾、未通过**：主切片是 `auxiliary` / `failed` / `synced: false` / `membership-not-found`；对照入口同一原因，`availability: failed`。原因可读，所以下面第 7 条可以勾；勾第 7 条的意思是「未同步时读得到 reason」，不是绑定已同步。

缺「其他投影仍在」或「第二次安装」的项保持未勾。这些勾选属于 overlay `d9960b316…`，不能挪到纯 `041dfd882…` 上，也不能因为主干已有 #553 就挪到产品默认。

- [x] 创建或选择留下了 `skillId` 与 lifecycle；`draft` 没有被当成已可执行
  - `skill_702b024b2d39`，定稿后 lifecycle `private`、版本 `1.0.0`。第一次保存缺少 `sourceAgentId` 被拒绝。loader 看见的是定稿后的投影名，不是一份仍为 draft 的可执行资产。
- [x] 保存结果能再次读到，读到的位置是 skill-assets；失败时能看到 `SkillAssetStoreError` 文案
  - 再读 PASS：`personal-skills.detail` 与保存结果一致。第一次失败原文按报告记为 `sourceAgentId` required（进入 store 之前的 `INVALID_REQUEST`，句子形如 `sourceAgentId is required`）。现场没有另打印 `SkillAssetStoreError` 类名；勾的是再读位置与这次可读的拒绝文案。
- [x] 主切片安装后，关系、投影、绑定三行都有独立取值，没有用一个 `installed` 填满三行
  - 关系 `linked`。投影 `ready` / `materialised`。绑定 `auxiliary` + `failed` + `synced: false`。三行独立。绑定这一格的值是失败，不是 `synced`。
- [x] 真实执行上下文可见：安装返回之后的下一次 `resolveEmbeddedRunSkillEntries` 看见 `ob-asset-<skillId>`，来源是 `openbot-lifecycle-binding`
  - 看见 `ob-asset-skill_702b024b2d39`，来源 `openbot-lifecycle-binding`。这是 overlay 上的下一次调用。纯主干没有 #567 时，#562 的导入失败仍然成立。
- [x] 同一次安装 RPC 内读回的文件或 `{ skill }` 响应，没有被用作上一条的证据
  - 上一条的证据是安装返回之后的另一次 `resolveEmbeddedRunSkillEntries`。
- [x] 不得把 UI 的已安装、或 `employee-install` 的 `request.status=installed`，当成可用性 `ready`
  - 对照入口：`installed`，`executable: false`，`availability: failed`，`nextStep: runtime-binding-failed`，投影 `not_materialized`。该入口之后的 loader 仍没有这个技能。installed ≠ ready。
- [x] 对照入口在绑定未 `synced` 时，响应或笔记里能读到 `syncInstallToRuntime` 的 reason；只有 `console.warn` 时此项不勾
  - reason 原文 `membership-not-found`，写在响应/笔记里，不是只有 `console.warn`。`synced` 仍为 false。本条不表示绑定已同步。
- [ ] 投影失败或绑定失败时，原因可读（`reason` 或 RPC 错误文案），并且该机器人上其他原本有效的投影仍在
  - 绑定失败原因 `membership-not-found` 可读。主切片投影本身是 `materialised`，不是投影失败。报告没有清点该机器人上其他原本有效的投影是否仍在。后半句没有现场，整条不勾。
- [ ] 幂等：同一机器人、同一技能再安装一次，关系仍是一条，授权投影仍是一份，三行终态与第一次成功相同
  - 没有第二次 `robot-skills.install`。不勾。
- [x] 撤销后下一轮不可用：`robot-skills.remove` 之后的下一次 `resolveEmbeddedRunSkillEntries` 不再包含该 `ob-asset-<skillId>`
  - 关系 `absent`，投影已移除，下一次 loader 对该名字 hitCount=0。
- [x] 撤销 RPC 的 `{ ok: true }` 没有被单独当成上一条的证据
  - 上一条用的是关系消失、投影移除，以及下一次 loader 的 hitCount=0。

十一条勾了九条（1、2、3、4、5、6、7、10、11）。第 8、第 9 条未勾。`runtimeBinding.synced` 未通过，不在这十一条里另造一个「已同步」勾选。§5.1 仍属于 #549，不在这里重勾。

## 5. 闸门 C

`gate_c_passed: false`。

可以同时说清楚的只有这三句：

1. 主切片 loader 路径在 overlay `d9960b3167d77bd1466e8ea718ebcb7d5124e7f7` 上可勾大部分（上列九条）。
2. binding `synced` 未过。原因是 `membership-not-found`（`syncInstallToRuntime` 在找到用户、但没有唯一 membership 时返回的既有 reason）。
3. 纯 `origin/main` `041dfd8826ee5d9854e5d3aefc46ec90dd94fc15` 含 #553，不含仍为 OPEN 的 #565 与 #567。

因此：

- 不因为主干已有 #553 就写成闸门 C 通过。
- 不把 #565 或 #567 写成已合入 `main`。
- 不把 overlay 写成产品默认。去掉这两次 merge，live HEAD 就回到观测当时的纯主干；#562 里的保存认证与 loader 导入阻塞在那棵树上仍然在。
- 不宣称孵化全通。对照入口的 `installed` 不是可用性 `ready`。

## 6. 与 #562 的关系

#562（`docs/design/employee-skill-lifecycle-gate-c-section-5-2-live-2026-10-10.md`）记录的是另一进程：`156b03113c6cb45f2be56da57dccae65f4f8a5e3`，不是 #553 之后，loader 导入失败，个人资产保存失败。那份笔记保持原样。

这次重跑换了进程身份（overlay），换了技能（`skill_702b024b2d39`，事后已删），并在 #565 / #567 未合入的前提下观察主切片 loader。它不追溯修改 #562 的勾选。

## 7. 本轮边界

- 本轮只新增本文件。没有修改产品逻辑、测试、配置、提示词、`docs/tools/`、`docs/cli/` 或 `docs/zh-CN/`。
- 格子只来自性能评测这次 live 报告，外加观测 tip 上对 #553 祖先关系、#565/#567 仍为 OPEN、以及 `membership-not-found` 既有 reason 字符串的核对。
- 没有补写第二次安装，没有补写其他投影清单，没有把 `synced: false` 改成通过。
