# Slice2 最终验收包（三项收尾证据）

- **时间**：Asia/Shanghai 2026-11-03 11:33–11:43
- **工作树**：`/Users/daniel/AI VP/openbot-pr216-slice2`
- **分支**：`docs/slice2-final-acceptance-evidence`（证据/驱动；**不合并、不部署**）
- **隔离网关**：`ws://127.0.0.1:19101`（非生产）；`OPENBOT_STATE_DIR=/tmp/openbot-pr216-e2e-state-01e15de99`
- **模型**：`api-proxy-deepseek/deepseek-v4-flash`
- **声明**：**未合并、未部署**（PR #216 已于 `2ab9ded920287b40f010bfb0b8742b1ab4a45629` squash 入 main；本包只补验收证据）

## 统一 SHA

| 角色                                                                              | 完整 SHA                                                                        |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| main 合入（#216 squash）                                                          | `2ab9ded920287b40f010bfb0b8742b1ab4a45629`                                      |
| 运行时网关构建 tip（`dist/build-info.json` / UI `data-openbot-build-commit`）     | `f7b459fd8691cb7f0b737ea95ddee5de3017fda4`                                      |
| SessionTaskBoard 类型补丁（本树 `b38ad374e…`；main 侧已有等价 #220 `605e7c296…`） | `b38ad374eb395396292e0b181fa298b9d275bc5b`                                      |
| 证据分支 tip（验收包正文）                                                              | `90f6763240b0df0c4f37ec303f316e700179eccf`                                                              |
| 行为祖先（信任边界）                                                              | `c533c4d79f33861379922534a1341a66f9fcd42b`                                      |

**本轮验收所跑产品构建 tip = `f7b459fd8691cb7f0b737ea95ddee5de3017fda4`。**

## 网关构建来源

1. **构建命令（Asia/Shanghai ~11:33）**：工作树内 `pnpm`/`tsdown` 重建 + `scripts/write-build-info.ts` + `pnpm ui:build`；日志 `/tmp/openbot-pr216-e2e-out/final/rebuild.log`（及 `docs/slice2-final-acceptance-evidence/rebuild-tail.txt`）。
2. **产物**：`dist/build-info.json` → `commit=f7b459fd8691cb7f0b737ea95ddee5de3017fda4`，`builtAt=2026-11-03T03:34:18.781Z`（UTC）。
3. **Control UI**：`OPENBOT_CONTROL_UI_FORCE_SYNC=1` 同步到 state `control-ui`；配置 `gateway.controlUi.root` 指向隔离 state；HTML `data-openbot-build-commit="f7b459fd8691cb7f0b737ea95ddee5de3017fda4"`。
4. **启动**：cwd=`/Users/daniel/AI VP/openbot-pr216-slice2`，监听 `127.0.0.1:19101`；首启 PID 77225（11:34:46），`gateway.controlUi.root` 变更后进程重启为 **PID 77323**（11:34:57，见 `gateway-tip2.log`）。state=`/tmp/openbot-pr216-e2e-state-01e15de99`。

## 三项收尾结论

| #   | 项                                              | 结果                                             |
| --- | ----------------------------------------------- | ------------------------------------------------ |
| 1   | 活动执行期间停止（暂停+取消）                   | **PASS**                                         |
| 2   | 实际浏览器交互（Playwright Control UI）         | **PASS**                                         |
| 3   | 诊断与构建（format/lint/tsgo/boundaries/build） | **RECORDED**（见下；非全绿基线，预存噪音已标明） |

### 1. 活动执行期间的停止 — PASS

- **驱动**：`src/auto-reply/reply/slice2-e2e-mid-exec-interrupt.mjs`
- **JSON**：`docs/slice2-final-acceptance-evidence/slice2-e2e-mid-exec-interrupt.json`（同源 `/tmp/openbot-pr216-e2e-out/final/`）
- **模型/口**：`:19101` + `deepseek-v4-flash`；connect cap `tool-events`
- **要点**：在 `agent` tool-events `phase=start` name=`exec`（sleep 50）且 **A 尚无 terminal final** 时发送「暂停」/「取消当前」

| Asia/Shanghai | 事件                            | 可见结果                                                                 |
| ------------- | ------------------------------- | ------------------------------------------------------------------------ |
| 11:35:17      | pause.occupancy_active          | toolStart exec；`aFinalBeforeInterrupt=false`                            |
| 11:35:17      | pause.interrupt.send            | 文本「暂停」                                                             |
| 11:35:18      | chat.aborted + owner_pause      | ack 点名「任务A-活动暂停测」；停止新增业务动作、旧唤醒不复活             |
| 11:36:28      | pause.no_revive                 | `lateDone=0` `lateBusinessFinal=0` `aAborted=true`（观察窗 70s > sleep） |
| 11:36:29      | cancel.occupancy_active         | toolStart exec；A 未终局                                                 |
| 11:36:29      | cancel.interrupt + owner_cancel | ack 点名「任务A-活动取消测」；移出任务板                                 |
| 11:37:39      | cancel.no_revive                | `lateDone=0` `lateBusinessFinal=0` `aAborted=true`                       |

`verdict`: `mid_exec_pause=true`, `mid_exec_cancel=true`。

### 2. 实际浏览器交互 — PASS

- **驱动**：`src/auto-reply/reply/slice2-e2e-browser-ui.mjs`（Playwright via `ui/node_modules`）
- **JSON**：`docs/slice2-final-acceptance-evidence/slice2-e2e-browser-ui.json`
- **截图**：`docs/slice2-final-acceptance-evidence/screenshots/01-connected.png` … `05-after-refresh.png`
- **会话**：`agent:main:main`（Control UI 会 canonicalize 自定义 key）；stamp `BR056mxl`（Asia/Shanghai 11:42:31–11:42:41）

| 检查                                                    | 结果                                                                      |
| ------------------------------------------------------- | ------------------------------------------------------------------------- |
| A 运行中停止按钮可见（`chat-compose__send-btn--stop`）  | PASS                                                                      |
| A 运行中输入框 Enter 发普通插问 B（preserve occupancy） | PASS（`usedEnter=true`）                                                  |
| B 提示进入线程                                          | PASS（`插问B-浏览器-BR056mxl`）                                           |
| B 助手回答气泡                                          | PASS（aside-dialogue：`assistant 二`；主会话有 `exec sleep 55` toolCall） |
| A/B 气泡同线程                                          | PASS                                                                      |
| 停止按钮可点                                            | PASS（class stop）                                                        |
| 硬刷新后 UI 仍见 A+B stamp                              | PASS                                                                      |

板证路径（operator-scoped）：
`…/operators/fb5e3919…/agents/main/sessions/9a1d82c9-….jsonl` + `.aside-dialogue.jsonl`。

### 3. 诊断与构建结果 — RECORDED

命令与退出码（日志：`docs/slice2-final-acceptance-evidence/diagnostics-final.log`，Asia/Shanghai ~11:35）：

| 检查                 | 命令（仓库脚本）                            | 结果                                                                                                                                         |
| -------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 格式                 | `pnpm format:check`（oxfmt）                | **EXIT 1** — 仓库既有未格式化文件（本轮未整库 `--write`）；本包相关 e2e/docs 已 `oxfmt --write`                                              |
| Lint                 | `pnpm lint`（oxlint --type-aware）          | **EXIT 0**（0 warnings / 0 errors）                                                                                                          |
| AOR 边界             | `pnpm lint:aor:boundaries`                  | **OK / AOR:0**                                                                                                                               |
| UI capability 边界   | `pnpm lint:ui:capability-boundaries`        | PASS（见 diagnostics 日志）                                                                                                                  |
| 架构清单             | `pnpm lint:core:architecture-manifest`      | **ARCH:0**                                                                                                                                   |
| Gateway method packs | `pnpm lint:gateway:method-packs`            | PASS（见日志）                                                                                                                               |
| 类型                 | `pnpm tsgo`                                 | **EXIT 2** — **41** 条既有 `error TS*`（测试/协作/UI 等），**非本轮产品缺口**；本轮曾修 `SessionTaskBoard` 缺失 import（#220 / `b38ad374e`） |
| 构建                 | tsdown + write-build-info + `pnpm ui:build` | **成功写出** `dist/build-info.json` 与 Control UI；`rebuild.log`                                                                             |
| 模块边界构建警告     | tsdown `INEFFECTIVE_DYNAMIC_IMPORT`         | **209** 条警告（动态+静态双引入，不搬 chunk）；样例见 `rebuild-ineffective-sample.txt`；**未阻断构建**                                       |

说明：「4000」= **历史正文预算**（`ASIDE_NORMAL_REPLY_CONTEXT_MAX_CHARS`），不是整个提示块硬上限。

## 缺口修复（仅对应失败点）

1. **类型**：`mid-task-aside-reply-lane.ts` 补 `import type { SessionTaskBoard }`（阻塞构建/类型；main 已有 #220）。
2. **浏览器验收驱动**：消除「星期」用户提示误报；Lit draft 同步后 Enter；固定 `agent:main:main` + runStamp；刷新硬导航。**无产品调度路径扩展**。

## 证据索引

- 本目录：`docs/slice2-final-acceptance-evidence/`
- 机器临时：`/tmp/openbot-pr216-e2e-out/final/`
- Box 同步：`/workspace/docs/slice2-e2e-final-acceptance-pack.md` + json 副本（由执行助手写入）

## 声明

停止功能扩展。三项收尾已补证据。**未合并、未部署。**
