---
date: 2026-10-10
status: gate_c_in_progress_live_observation
gate_c_passed: false
incubation_fully_passed: false
requested_mac_pin: 277f6c5304b00142a180effcf2c0062fa9b0d5e3
requested_pin_running: false
actual_running_commit: 156b03113c6cb45f2be56da57dccae65f4f8a5e3
actual_running_pr: 547
includes_553: false
hk_live_commit: 65564d30b25a41f49866f96e0efed9caacd80a9b
hk_repo_digest: sha256:52cb4039a395717a1381f94f4c276306f085ec15c9b2bd63ff6f539baa993e6f
mac_equals_hk_live: false
this_run_is_hk_live: false
this_run_is_post_553: false
live_rpc_attached: true
source: 性能评测 live
timezone: Asia/Shanghai
related:
  - 549
  - 550
  - 552
  - 553
product_code: false
---

# 员工技能生命周期：闸门 C 第 5.2 节现场观测笔记

> **文档状态：闸门 C 进行中 / 现场观测。本次 Mac 记录已填入。不宣称闸门 C 通过。不宣称孵化全通。**
>
> 日期：2026-10-10（Asia/Shanghai）
> 来源：性能评测 live
> **本次运行不是 `277f6c5304b00142a180effcf2c0062fa9b0d5e3`，不是 HK LIVE，也不是 #553 之后的构建。**
> 请求对照的 pin：`277f6c5304b00142a180effcf2c0062fa9b0d5e3`（未在跑）
> 实际在跑：`156b03113c6cb45f2be56da57dccae65f4f8a5e3`（#547，Control UI fullscreen preview）
> HK LIVE（#550，另一次提交）：`65564d30b25a41f49866f96e0efed9caacd80a9b`，RepoDigest `sha256:52cb4039a395717a1381f94f4c276306f085ec15c9b2bd63ff6f539baa993e6f`
> 相关：垂直切片 #549、闸门 A #550、代码路径笔记 #552、分层回报 #553（已合入 `main`，不在本次进程）
> 本文件只收现场观测。零产品代码。

独立验收要求先做闸门 C 现场笔记，再谈孵化 Phase B。下面的格子只转述性能评测 live 的这一次 Mac 记录。没有记录的层写「本次报告未给出」，不补推断。

## 1. 状态

| 项       | 本次现场                                                                                                          |
| -------- | ----------------------------------------------------------------------------------------------------------------- |
| 闸门 C   | **进行中。** §4 只勾了有完整现场 PASS 的项。未勾完，不宣称闸门 C 通过                                             |
| 孵化     | **不宣称孵化全通。** 孵化 Phase B 仍排在技能通道验收之后                                                          |
| 本次进程 | `156b03113c6cb45f2be56da57dccae65f4f8a5e3`。不是请求的 `277f6c53…`。不是 HK LIVE。不是 #553 之后                  |
| #553     | **进程不包含。** `robot-skills.install` 顶层键只有 `["skill"]`，没有分层的 relation / projection / runtimeBinding |
| #552     | 仍是代码路径笔记。本文件的格子来自这次 live，不沿用那份「未实测（只读源码）」                                     |

## 2. 环境

| 项                         | 现场值                                                                                                           |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 请求的 pin                 | `277f6c5304b00142a180effcf2c0062fa9b0d5e3`。**未在跑**                                                           |
| gateway commit（实际在跑） | `156b03113c6cb45f2be56da57dccae65f4f8a5e3`（#547 Control UI fullscreen preview）                                 |
| 工作目录                   | `/Users/daniel/AI VP/openbot-main-156b03113`                                                                     |
| 进程                       | pid `75562`。2026-10-10 14:27:42 CST 由 `start-main-156b03113-gw.sh` 启动。这是进程启动时刻，不是每条 RPC 的时刻 |
| health                     | live，端口 `:18789`。健康 live 不是 §5.2 的「真实执行上下文可见」                                                |
| #553 是否在该进程          | **否。** `robot-skills.install` 的键只有 `["skill"]`                                                             |
| 时间戳（Asia/Shanghai）    | 2026-10-10                                                                                                       |
| 来源                       | 性能评测 live                                                                                                    |
| 本次机器人与技能           | `agentId=main`。选中已有技能 `consult-win-advisor`，`lifecycle=approved`，`assetType=mcp`，`ver=1.0.2`           |

身份对照：

| 身份           | commit                                     | 与本次的关系                                                                                   |
| -------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| 请求的 Mac pin | `277f6c5304b00142a180effcf2c0062fa9b0d5e3` | 未在跑。本次笔记不把行为写成这个 pin                                                           |
| 实际 Mac 进程  | `156b03113c6cb45f2be56da57dccae65f4f8a5e3` | 本次五步只钉这一进程                                                                           |
| HK LIVE        | `65564d30b25a41f49866f96e0efed9caacd80a9b` | 不是本次。RepoDigest `sha256:52cb4039a395717a1381f94f4c276306f085ec15c9b2bd63ff6f539baa993e6f` |
| #553           | `17e11f1549531f2fc50c1d3b4417e8beff64f858` | 已在后来的 `main`。不是本次进程                                                                |

## 3. §4.2 三层记录表

表结构与 #549 §4.2 一致。可用性只写在结论栏。关系、投影、绑定分开记。事后看到的 `SKILL.md` 不是下一次 `resolveEmbeddedRunSkillEntries`，也不是可用性 `ready`。

| 步                                 | 安装关系                                                                                                                                 | 执行投影                                                                                                                                  | 运行时绑定                                          | 结论栏（仅笔记）                                                                                              | 失败原因原文                                                                                                                                    |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 创建或选择                         | 选中已有技能 `consult-win-advisor`（`lifecycle=approved`，`assetType=mcp`，`ver=1.0.2`，`agentId=main`）。新建 draft 的保存/定稿没有落成 | 本次报告未给出本步新投影                                                                                                                  | 本次报告未给出本步绑定                              | 选择已有 `approved` 资产。draft 保存/定稿失败，没有把 draft 装成可执行                                        | `authenticated user required to save personal assets`。WS 带 `user` 连接：`invalid connect params: unexpected property 'user'`                  |
| 保存                               | 再读位置是 skill-assets，不是 `employee-install.json`                                                                                    | 本次报告未给出本步投影                                                                                                                    | 本次报告未给出本步绑定                              | 再读 PASS：`~/.openbot/skill-assets/store.json`。`personal-skills.detail` 需要认证，这次再读不是走 detail RPC | 保存/定稿失败文案见上一行。运行 SHA 上该句由 `SkillAssetStoreError` 抛出（`src/gateway/personal-skill-asset-scope.ts`）。现场报告没有另打印类名 |
| 授权/安装（主切片）                | PASS。关系 `rel_main_consult-win-advisor`，enabled                                                                                       | 事后文件系统核对 PASS：`skill-execution-bindings/main/ob-asset-consult-win-advisor/` 下有 `SKILL.md`。这不是 loader，也不是可用性 `ready` | RPC 中缺席。无 #553，响应没有 `runtimeBinding`      | 顶层键只有 `["skill"]`。关系与事后投影分开记。`{ skill }` 不证明绑定 `synced`，也不证明下一轮 loader          | 响应里没有绑定 reason。旁注：`health.broken`，`mcporter` 不在 PATH                                                                              |
| 授权/安装（对照 employee-install） | 请求 `status=installed`。这是安装请求，不是 `robotRelations`。探针请求随后从 `employee-install.json` 删除                                | 响应没有投影 `ready`                                                                                                                      | 响应没有 `reason`，没有 `executable`                | `nextStep=done`。**installed ≠ ready。** 不把这次确认写成可用性 `ready`                                       | 响应里没有 `syncInstallToRuntime` 的 reason，也没有 `console.warn` 记录                                                                         |
| 运行（下一次 loader）              | 本次报告未给出本步关系变化                                                                                                               | **PARTIAL。** 绑定切片经文件系统可见，名字与来源符合预期。完整函数没有跑成                                                                | 完整 loader 未返回绑定过滤结果                      | **PARTIAL，不是 PASS。** 不得据此勾「真实执行上下文可见」                                                     | `resolveEmbeddedRunSkillEntries` 导入失败：`ERR_PACKAGE_PATH_NOT_EXPORTED`（`@earendil-works/pi-coding-agent`）                                 |
| 撤销                               | PASS。关系已清除，列表为空                                                                                                               | 目录已消失                                                                                                                                | 本次报告未给出绑定复核。`{ ok: true }` 不是绑定证据 | 关系清除、目录消失、列表为空，响应 `{ ok: true }`。这三条都不是下一次 `resolveEmbeddedRunSkillEntries`        | 无失败文案。`{ ok: true }` 不单独当作下一轮 loader 证据                                                                                         |
| 撤销后的下一次 loader              | 本次没有成功的 loader 调用                                                                                                               | 不把「目录已消失」升级成 loader 结果                                                                                                      | 本次没有成功的 loader 调用                          | **未形成 PASS。** transcript 没有撤销之后另一次成功的 `resolveEmbeddedRunSkillEntries`                        | 安装后的导入失败仍是 `ERR_PACKAGE_PATH_NOT_EXPORTED`。没有另一次成功调用                                                                        |

幂等补行：本次现场没有对同一机器人、同一技能再执行第二次 `robot-skills.install`。不记幂等通过。并发未测。

## 4. §5.2 十一条

按 #549：缺完整现场 PASS 不勾。需要 #553 分层字段、创建/定稿成功路径、或完整 `resolveEmbeddedRunSkillEntries` 的项保持未勾。

- [ ] 创建或选择留下了 `skillId` 与 lifecycle；`draft` 没有被当成已可执行
  - 选择侧有记录：`consult-win-advisor`，`lifecycle=approved`。创建/定稿失败，draft 没有保存成功，也就没有「draft 未被当成可执行」的执行证据。不勾。
- [x] 保存结果能再次读到，读到的位置是 skill-assets；失败时能看到 `SkillAssetStoreError` 文案
  - 再读 PASS：`~/.openbot/skill-assets/store.json`，不是 `employee-install.json`。失败文案 `authenticated user required to save personal assets` 与运行 SHA 上的 `SkillAssetStoreError` 句子相同。`personal-skills.detail` 需要认证，不是这次再读通道。新建保存本身没有成功。
- [ ] 主切片安装后，关系、投影、绑定三行都有独立取值，没有用一个 `installed` 填满三行
  - 关系与事后 `SKILL.md` 分开有记录。绑定在 RPC 里缺席（无 #553，键只有 `["skill"]`）。三行没有独立取值。不勾。
- [ ] 真实执行上下文可见：安装返回之后的下一次 `resolveEmbeddedRunSkillEntries` 看见 `ob-asset-<skillId>`，来源是 `openbot-lifecycle-binding`
  - **PARTIAL，不勾。** 导入失败 `ERR_PACKAGE_PATH_NOT_EXPORTED`。文件系统上的名字/来源不能代替这次调用。
- [ ] 同一次安装 RPC 内读回的文件或 `{ skill }` 响应，没有被用作上一条的证据
  - `{ skill }` 与事后 `SKILL.md` 没有被用来勾上一条。上一条本身未通过，本条无从勾。
- [x] 不得把 UI 的已安装、或 `employee-install` 的 `request.status=installed`，当成可用性 `ready`
  - 对照确认返回 `status=installed`、`nextStep=done`，没有 `ready` / `reason` / `executable`。笔记结论是 installed ≠ ready。
- [ ] 对照入口在绑定未 `synced` 时，响应或笔记里能读到 `syncInstallToRuntime` 的 reason；只有 `console.warn` 时此项不勾
  - 响应没有 reason。现场也没有 `console.warn`。此项要求的分层 reason 属于 #553 响应形状。不勾。
- [ ] 投影失败或绑定失败时，原因可读（`reason` 或 RPC 错误文案），并且该机器人上其他原本有效的投影仍在
  - 安装 RPC 没有投影/绑定 reason。其他投影是否仍在，本次报告未给出。旁注 `mcporter` 不在 PATH 不是这条 reason。不勾。
- [ ] 幂等：同一机器人、同一技能再安装一次，关系仍是一条，授权投影仍是一份，三行终态与第一次成功相同
  - 没有第二次安装。不勾。
- [ ] 撤销后下一轮不可用：`robot-skills.remove` 之后的下一次 `resolveEmbeddedRunSkillEntries` 不再包含该 `ob-asset-<skillId>`
  - 关系清除、目录消失、列表为空已记录。下一次 `resolveEmbeddedRunSkillEntries` 没有成功调用。不勾。
- [ ] 撤销 RPC 的 `{ ok: true }` 没有被单独当成上一条的证据
  - `{ ok: true }` 没有被单独当成 loader 证据；同时还有关系清除、目录消失、列表为空。上一条 loader 未通过，本条不勾。

勾选：上列第 2、第 6 条。其余九条未勾。§5.1 仍属于 #549，不在这里重勾。

## 5. 明确禁止

这次记录填进之后，下面三条仍然有效：

1. **同一次 RPC 内读回刚写入的文件，不算 `ready`。** 事后看到的 `SKILL.md` 和响应 `{ skill }` 都没有被写成下一轮 loader 通过，也没有被写成可用性 `ready`。
2. **`installed` 不算 `ready`。** 对照入口是 `status=installed` 且 `nextStep=done`，结论停在 installed ≠ ready。
3. **§5.2 未勾完，不得宣称闸门 C。** 十一条里仍有九条未勾。健康 live、`main` 已含 #553、或 #552 的代码路径笔记，都不使闸门 C 通过。

## 6. 后续产品 PR 的阻塞

本次不改产品。下面三项另开 PR，不放进本文件：

1. **个人资产保存的认证用户。** 保存/定稿失败：`authenticated user required to save personal assets`。WS 连接若带 `user`：`invalid connect params: unexpected property 'user'`。
2. **`pi-coding-agent` 的导出。** `resolveEmbeddedRunSkillEntries` 导入失败：`ERR_PACKAGE_PATH_NOT_EXPORTED`（`@earendil-works/pi-coding-agent`）。在这修好之前，完整 loader 项不能勾。
3. **可选：在包含 #553 的构建上重跑。** 本次是 `156b03113…`，安装响应没有分层字段。重跑之前，依赖 relation / projection / runtimeBinding 响应字段的勾选保持打开。

现场旁注（不单列成上面的产品 PR）：安装时 `health.broken`，`mcporter` 不在 PATH。

下一步：把这份未全勾的现场笔记送技能通道验收。产品缺口走上面的另开 PR。验收完成前不开始孵化 Phase B，不宣称孵化全通。

## 7. 本轮边界

- 本轮只更新本文件。没有修改产品逻辑、测试、配置、提示词、`docs/tools/`、`docs/cli/` 或 `docs/zh-CN/`。
- 格子只来自性能评测 live 的这次 transcript，外加运行 SHA 上对那句保存错误的类名核对。没有补写第二次安装、其他投影是否仍在、或撤销后的成功 loader。
- #552 不改写。
