# runtime-rule-adaptation — P0 现役规则盘点与首期范围 / P1 合约设计（仅规格）

## 任务标识

| 项                               | 值                                                                                                                |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Task ID                          | `runtime-rule-adaptation`                                                                                         |
| 建议 Agent ID                    | `grok-dynamic-rules`                                                                                              |
| 阶段                             | P0 已由验收方关闭；P1 类型化契约与纯校验器实施（规格已同步安全整数语义；未提交）                                  |
| 工作树                           | `/workspace/openbot-vp-runtime-rule-adaptation`（自 origin/main 新建的独立克隆，未复用其他 openbot-vp-\* 工作树） |
| 分支                             | `main`（已快进到当前 `origin/main`，未新建或切换额外 worktree）                                                   |
| 盘点 / 行号 / 验收文件名基线 SHA | `9b65109f41dee30b892a6faff493e46e735cab8d`（inventory baseline；引用与验收文件名固定于此，不改为后续 main SHA）   |
| 当前工作树 HEAD（登记用）        | `4a786626a1e2892043f57b3832ddf2a407be284a`（= 再 fetch 后的 `origin/main`，含 #277）                              |
| 开工时间                         | 2026-11-12（Asia/Shanghai）                                                                                       |
| 验收负责人                       | `codex-runtime-manager`                                                                                           |
| 本阶段授权                       | 只读盘点 + 规格文档 + 路径限定 loom 登记；**未获提交授权**，不 commit、不 push、不创建 PR、不合并、不部署         |

总目标保持：Agent 负责检索、选择及调整建议；确定性机制负责授权、校验和强制执行。

本阶段不做：创建 Agent、为规则适配调用模型、改变规则行为、启用策略、修改生产配置、实现规则校验器或策略激活、修复历史代码、扩大 T9。原迁移 T9 及成果投递缺口继续独立处理，不用本任务补偿或绕过。已获授权的是 P0 纠正收口、P1 规格内容放行，以及本轮类型化契约与纯校验器实施。提交与推送仍未获授权。P2 仍不放行。

## 开工与快进

1. 开工时 `git fetch origin`：当时 `origin/main` = `9b65109f41dee30b892a6faff493e46e735cab8d`，与 HEAD 相同，工作树干净。
2. 后续再 fetch：`origin/main` 快进到 `4a786626a1e2892043f57b3832ddf2a407be284a`（#277）。确认 `9b65109f…` 仍是祖先后，对工作树做快进合并（非 rebase、非强制）。未跟踪的 `.kiro/specs/runtime-rule-adaptation/` 四份 P0 文档在快进中保留，并有 `/tmp/p0-ff-preserve/` 备份。
3. 再 fetch 确认：HEAD 与 `origin/main` 仍为 `4a786626…`，未再前移。`9b65109f…` 仍为祖先。
4. #277 实际文件：`.env.example`、`.loom/registry.yaml`、`docs/exec-protocol/v1-isolation-gateway-artifact-auth.md`、`docs/gateway/trusted-proxy-auth.md`、`src/config/schema.help.ts`、`src/config/schema.labels.ts`、`src/config/types.gateway.ts`、`src/config/zod-schema.ts`、`src/gateway/auth.ts`、`src/gateway/auth.test.ts`、`src/gateway/exec-protocol-config.ts`、`src/gateway/exec-protocol-config.test.ts`、`src/gateway/exec-protocol-http.ts`、`src/gateway/exec-protocol-http.test.ts`、`src/gateway/exec-protocol-http.platform-auth.test.ts`、`src/gateway/server-http.ts`。**未触及** `src/agent-runtime/policy/**`、`src/agent-runtime/contracts/policy.ts` 及相关规则强制执行路径。因此盘点引用的实现仍按 `9b65109f…` 行号。关于 `4a786626…` 与盘点基线的行为兼容性，仅按当时团队报告记录（#277 未触及政策实现路径）；该 SHA 当时亦可能尚未进入验收方对象库。P1 不自行判断该兼容性，只接受宿主核准的兼容信息。
5. 仓库 `AGENTS.md` 要求：开工或接管须登记 `.loom/registry.yaml`，并保留 `sessions[]`。

## Loom 登记（已写入，路径限定，未提交）

共享 registry 在快进后的 origin/main 树上操作。正式 `loom register` 曾试用（fresh clone 无 `node_modules`，以 bun + 隔离依赖运行），功能成功，但 `saveRegistry` / `stringifyYaml` 重写了整份约 1.4MB registry（约 1980 插入 / 1432 删除），属于不安全的共享 WIP，已立即按预写 sha256 `56acfcdb88954993123ca7dec9d3b8de649ed59f8ba4a61be507acacdc9601ae` 恢复。随后在 `landingStreams:` 之前**只插入本任务 18 行**，不改动其他任务或 landing stream。

实际写入（未 commit）：

- `id`: `runtime-rule-adaptation`
- `owner`: `grok-dynamic-rules`
- `intent`: `P0 wrap-up and P1 contract design (specs only)`（单条，避免逗号被 CLI 拆成两项）
- `paths`: 仅 `.kiro/specs/runtime-rule-adaptation/`
- `state`: `active`
- `sessions[]`：保留 `id=7c3e1d2a-9b54-4f10-8e6c-21a0d4f8b917`，`ide=cursor`，`agent=grok-dynamic-rules`，`status=active`，`lastSignalAt=2026-11-12T03:47:53.529Z`（Asia/Shanghai 2026-11-12 11:47:53）
- `since`: `2026-11-12`

路径未被其他 **task** 声明占用。Landing stream F 对 `.kiro/specs/**` 是落地流排他，不是任务所有权冲突；本任务不扩展源码路径，不申请运行时代码所有权。`bun scripts/loom.ts lint --strict` 退出码 0（仅既有共享路径告警，无本条目错误）。

registry 的这一处未提交修改是共享热文件编辑，**不计入** `limited.diff`。上一轮已另附 `registry-insert.diff` 与 `registry-evidence.md`，供独立确认既有 18 行外科插入；本轮不再改 registry 内容，也不把 registry 差异纳入本轮 `limited.diff`。上一轮 `limited.diff` 只含 P1 规格与样例。本轮 `limited.diff` 含同步后的 P1 规格／样例说明，以及新增的类型化契约、纯校验器与测试；不含 `.loom/registry.yaml`。源码路径扩展（`src/**`）应交给登记负责人另做路径声明，本轮不改共享 registry。

拟对照命令（若需由登记负责人重放，须避免全文件重写；优先外科插入或修复后的 register）：

```sh
# 勿在未修复 stringifyYaml 全量重写前对热 registry 再跑正式 register。
# 已采用的安全写法：恢复原文件后，仅在 landingStreams: 之前插入本任务块。
pnpm loom register \
  --task runtime-rule-adaptation \
  --owner grok-dynamic-rules \
  --session-id 7c3e1d2a-9b54-4f10-8e6c-21a0d4f8b917 \
  --ide cursor \
  --agent grok-dynamic-rules \
  --intent "P0 wrap-up and P1 contract design (specs only)" \
  --paths .kiro/specs/runtime-rule-adaptation/
```

## 交付位置

```
.kiro/specs/runtime-rule-adaptation/
├─ tasks.md
├─ current-rule-map.md
├─ first-scope-decision-table.md
├─ p0-acceptance-9b65109f41dee30b892a6faff493e46e735cab8d.md
├─ contracts-and-merge-semantics.md
├─ p1-validation-test-matrix.md
├─ p1-json-samples.md
└─ samples/
   ├─ 01-legal-tighten.input.json
   ├─ 01-legal-tighten.output.json
   ├─ 02-unauthorized-shadow-legal.input.json
   ├─ 02-unauthorized-shadow-legal.output.json
   ├─ 03-unknown-rule-missing-host-facts.input.json
   ├─ 03-unknown-rule-missing-host-facts.output.json
   ├─ 04-cancelled-missing-compatibility.input.json
   ├─ 04-cancelled-missing-compatibility.output.json
   ├─ 05-forged-authorization-field.input.json
   ├─ 05-forged-authorization-field.output.json
   ├─ 06-batch-conflict.input.json
   ├─ 06-batch-conflict.output.json
   ├─ 07-rule-candidate-validated.input.json
   └─ 07-rule-candidate-validated.output.json
```

副本（工作树之外，便于克隆被清理后仍可取用）：

```
/workspace/runtime-rule-adaptation-p0/
```

本轮在上述规格与样例之外，新增纯校验器源码与测试（见 `src/agent-runtime/contracts/rule-adaptation.ts` 与 `src/agent-runtime/policy/rule-adaptation/`）。未修改既有编译器、强制执行或生产接线，未调用模型，未读写生产配置或候选存储。本轮不改 `.loom/registry.yaml`，也不再跑正式 loom register。

## 阶段进度

- [x] 开工基线：完整 SHA、分支、工作树、未提交项、`origin/main` 祖先关系
- [x] 快进到含 #277 的 origin/main；确认快进合法且政策实现路径无重叠
- [x] 路径限定 loom 登记（外科插入，保留 session；正式 register 全量重写已撤销）
- [x] 阅读并按盘点基线源码核对 `contracts/policy.ts`、`policy/catalog.ts`、`policy/index.ts`、`policy/*.ts`
- [x] 沿实际消费者追踪 command / state / execution / capabilities / delivery / Gateway / cron / followup
- [x] `current-rule-map.md`（已登记 27 条 + 现役未登记项；已按 P0 纠正更新）
- [x] `first-scope-decision-table.md`（当前合并事实与建议；已按 P0 纠正更新）
- [x] 首期个人 / 协作 **shadow-proposal 候选**（不是运行时白名单；动态调整授权尚未建立）
- [x] P1 合约与校验矩阵（仅规格）
- [x] 路径、符号、引用核验，以及 `git diff --check`
- [x] P1 契约四处歧义收准（判定顺序、输入/结果分层、`activationAllowed`、宿主核准兼容性）并补登记证据；仍仅规格
- [x] P0 独立验收：验收方已关闭 P0（2026-11-12）；本轮不重做 P0，不扩写规则盘点
- [x] P1 契约三处内部矛盾收准（`candidate_validated`、禁止字段结构性拒绝、可独立判定拒绝前置），`activationAllowed` 恒为 `false`，并补 `authorizationAssessment` 与七组 JSON 样例；仍仅规格
- [x] 按安全整数语义同步契约、矩阵与样例说明；`fixture` 仅为测试标记；公开 API 为双参数入口
- [x] 实施类型化契约、两项字段适配描述（复用现有 catalog，不建第二目录）与纯校验器
- [x] 以七组样例及边界矩阵生成测试；类型检查、lint／format 与 `git diff --check` 见本轮交验
- [x] Owner 确认 P1 路径归属阻塞关闭、P1 阶段内容验收通过；通配符展开维护说明已补入登记；完整限定交付包已冻结
- [x] P1 代码通过独立验收前，不启动 P2，不扩大候选字段，不接入生产消费者；提交与推送仍未获授权（该约束在 P1 关闭前有效；Owner 已于 2026-11-12 关闭 P1 并放行 P2）
- [x] P2 只读规则适配 Agent 与影子模式实施（端口/替身、P1 纯校验器、预算与取消、候选受控入口仅设计拒绝路径）
- [ ] 提交、推送与 PR 仍未获授权；P2 仍不激活策略、不写配置、不执行业务工具、不发布新规则、不把候选落盘

## 首期 shadow-proposal 候选（摘要）

详细字段见 `first-scope-decision-table.md` §6 与 `contracts-and-merge-semantics.md`。候选在独立验收前不生效，**不是**运行时白名单；动态调整授权尚未建立，只允许影子提案。

| 场景 | 规则 ID                                                       | 建议允许的操作                                                          | 结论要点                                                                                                                                                                                                                                                        |
| ---- | ------------------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 个人 | `model.context_window.guard`                                  | 仅对已有配置项 `agents.defaults.contextTokens` 做有界收紧的 shadow 提案 | 合约：`hardMin ≤ proposedValue ≤ currentEffectiveValue`。上限是含已有帽的当前有效窗口，不只是模型窗口。删除帽或恢复更高值属放宽，须单独授权并重核，不是普通收紧。删除参数不是合法回退。有效值未知或低于 hardMin 时，不生成可执行调参提案。配置来源 ≠ 调整授权。 |
| 协作 | `collab.policy.compile` 的字段 `maxVisibleBotRepliesPerRound` | 仅对该字段做有界收紧的 shadow 提案                                      | 不得把整个 `collab.policy.compile` 当作可任意调参。不得放宽自进、外发、隔离或取消围栏；不得改 lane / 审批模式。非法提案须显式拒绝，不得用编译器钳制冒充原提案通过。                                                                                             |

未把 `collaboration.task.requirePeerReview`、`botMaySelfAdvanceWithoutHuman`、`finalDecisionMode`、外发授权或保密层级上调纳入候选。`l2CannotWidenL1` 须区分 L1 强制边界与可覆盖默认；L2 将默认 false 改为 true 不得自动视为违反硬约束，记为「语义及授权边界待核准」。

## 阻塞与独立缺口（本阶段只记录，不修代码）

见验收文档与规则地图。特别声明：T9 已接受成果外发 / `outbound_auth_unwired` 等缺口保持独立，不在本任务中补偿或绕过。

## 会话历史

| 时间（Asia/Shanghai） | 事件                                                                                                                                                                                                                          |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-11-12            | 用户要求本地实施。自 origin/main 新建克隆并固定盘点 SHA `9b65109f41dee30b892a6faff493e46e735cab8d`。                                                                                                                          |
| 2026-11-12            | 确认共享 registry 无本任务条目；因当时无提交授权且 registry 为并发共享热文件，第一轮未写入 loom 登记。                                                                                                                        |
| 2026-11-12            | 完成 P0 只读盘点，交付四份规格文档（未提交）。                                                                                                                                                                                |
| 2026-11-12            | 再 fetch 发现 origin/main 已至 `4a786626…`（#277）。按规则停止写入并报告祖先/快进关系。                                                                                                                                       |
| 2026-11-12            | 用户批准：快进到最新 origin/main，完成路径限定 loom 登记，并做 P0 纠正收口 + P1 合约设计（仅规格）。                                                                                                                          |
| 2026-11-12 11:42 之后 | 快进成功：`9b65109f…` → `4a786626…`。#277 不触及政策实现。未跟踪 P0 文档保留。                                                                                                                                                |
| 2026-11-12 11:47:53   | 试用正式 loom register 后因全量重写撤销；外科插入本任务并保留上述 session。`loom lint --strict` 退出码 0。                                                                                                                    |
| 2026-11-12            | 按五项纠正更新四份 P0 文档，新增两份 P1 规格；刷新副本与 `limited.diff`。未 commit / push / PR，未实现校验器，未扩大 T9。                                                                                                     |
| 2026-11-12            | P0 内容收尾通过。P1 方向获认可，但四处契约歧义暂不放行校验器实现。本轮只修订 `contracts-and-merge-semantics.md` 与 `p1-validation-test-matrix.md`，并补登记证据；不重盘规则，不改运行时代码，不 commit / push / PR。          |
| 2026-11-12            | 验收方关闭 P0，并指出 P1 仍有三处内部矛盾。本轮修订两份 P1 契约与矩阵，新增 `p1-json-samples.md` 与七组 JSON 输入／输出样例；不实施校验器，不改运行时代码，不改 registry，不 commit / push / PR。                             |
| 2026-11-12            | 验收方放行 P1 类型化契约与纯校验器实施，并要求随实现修正安全整数语义（接受解析后的安全整数，不开发专用数字解析器）。本轮同步契约／矩阵／样例说明，实现双参数纯校验器与测试；不改 registry，不 commit / push / PR，不启动 P2。 |
| 2026-11-12 16:22      | Owner 确认 P1 路径归属阻塞关闭、P1 阶段内容验收通过。通配符展开维护说明已补入登记记录；完整限定交付包已冻结。未获提交授权，本轮不启动 P2、不改校验器。 |
| 2026-11-12 16:33      | Owner 放行 P2。实施只读规则适配 Agent 与影子模式：复用共享 model 治理，宿主限定视图，提案走已验收 P1 纯校验器，只记录影子结果并强制预算/取消/协议失败安全返回。未 commit / push / PR，未改 P1 校验器与契约源码，未激活策略，未写配置，未发起真实生产模型调用，未将候选落盘。 |

## P2 范围、授权边界与变更记录（追加，不改写已验收 P1 契约正文）

- 授权边界：只读 Agent 与影子模式。不放行策略激活、配置写入、业务工具执行、新规则发布、compile/执行路径改动、规则目录行为改动，或把候选持久化进纯校验器。
- 新增源码全部位于已独占的 `src/agent-runtime/policy/rule-adaptation/shadow/`，规格新增 `p2-shadow-agent.md` 与 `p2-acceptance-matrix.md`。未修改 P1 冻结的校验器与契约源码，未改 `.loom/registry.yaml`，未新增 `contracts/**` 声明。
- 公开入口：`runShadowRuleAdaptation`（`shadow/index.ts`）。系统提示词版本 `runtime-rule-adaptation-shadow/v1` / `runtime-rule-adaptation.shadow.system` / `2026-11-12.1`。
- `submitRuleCandidate` 只作为受控入口设计：P2 固定拒绝激活、发布与落盘（`p2_persist_forbidden`）。
- 出口证明见运行结果中的 `readOnlyProof`、`limitProof`、`shadowDiff` 与 `controlUnchanged`。交付包：`/workspace/runtime-rule-adaptation-p2/`。

| 2026-11-12 17:00      | Owner 判定 P2 暂不通过，不启动 P3。本轮只修分层和实际限额边界：把模型编排从 `policy/rule-adaptation/shadow/` 归位到 command / model / context，跨层类型放入新契约 `contracts/rule-adaptation-shadow.ts`；补齐输出额度与超时取消传到实际 completion，取消/失败时用量保留并走共享记账；费用改为预估/事后核算。新增路径完成限定归属登记。未 commit / push / PR，未改 P1 校验器与 P1 契约源码，未激活策略，未写配置，未扩大候选，未落盘，未启动 P3。 |

## P2 r2 纠正记录（追加，不改写已验收 P1 契约正文）

- 产品入口仍是 `runShadowRuleAdaptation`，改为从 `src/agent-runtime/command/rule-adaptation/` 导出，不通过 P1 的 `policy/rule-adaptation/index.ts` 顺便导出。
- `policy/rule-adaptation/shadow/` 已删除，policy 中不再保留编排门面。P1 纯校验器与字段适配描述仍在 `policy/rule-adaptation/`，源码 sha256 与 P1 冻结销一致。
- 限额口径：调用次数、剩余输出 token（作为 `maxTokens`）、剩余时长（超时与组合 abort 信号）、修正次数为预先强制；费用与被模型忽略的超额输出为预估/事后核算，不再把费用称为绝对硬上限。
- 无控制权证据不仅包括控制板快照与 `businessToolsExecuted=[]`，还包括产品依赖未引入状态变更模块、注入端口类型与测试夹具不暴露变更器。常量字段本身不是独立证明。
- 本轮交付包：`/workspace/runtime-rule-adaptation-p2-r2/`。不覆盖原 `/workspace/runtime-rule-adaptation-p2/` 或 P1 冻结包。


| 2026-11-12 17:30      | Owner 确认分层整改通过，P2 仍有两项失败路径未收尾，暂不放行 P3。本轮只修：等待本身响应外部取消（completion 忽略 signal 且永不返回时及时结束等待，并如实记录底层请求未停止）；`session.dispose()` 抛错不得覆盖原判定或已保留用量；超时后晚到用量经共享记账一次性入账、晚到结果不推进任务；确实无法获得用量时标记 `usageKnown=false`，不得按零用量成功核算。交付包路径保持 `.kiro/specs/runtime-rule-adaptation/`，纠正上一份打包映射。未 commit / push / PR，未改 P1 校验器与 P1 契约源码，未激活策略，未写配置，未扩大候选，未落盘，未启动 P3。 |

## P2 r3 纠正记录（追加，不改写已验收 P1 契约正文）

- 等待不再只 `withTimeout(running, timeoutMs)`：在 rule-adaptation 模型层本地组合取消信号与超时，不修改共享 `withTimeout` 或 `interaction-completion.ts`。
- 底层请求忽略 abort 且仍挂起时，`limitProof.underlyingRequestStopped=false`，不声称已终止外部调用。
- `model-port` 的 `session.dispose()` 错误被隔离；若底层请求仍在跑，推迟 dispose 以便晚到用量仍可走 `session.recordUsage`。
- 用量未知时 `limitProof.usageKnown=false`，不把占位零值当作成功事后核算。可获得的晚到用量只记账一次，且不改变已返回判定、不推进影子循环。
- 本轮交付包：`/workspace/runtime-rule-adaptation-p2-r3/`。不覆盖原 P2 / P2 r2 包或 P1 冻结包。不改 `.loom/registry.yaml`。

| 2026-11-12 18:30      | Owner 确认 r3 的取消、清理和打包问题已验证改善，但 P2 仍有租约占用与记账状态两项阻塞，暂不放行 P3。本轮只修：复用既有 agent-run 注册表并发上限与官方孤立回收，证明永不返回的超时／取消循环占用有界，并在官方回收后才释放对应内存会话；记账区分用量已知、是否尝试、成功／失败／未知，失败可诊断且不改写原判定，重试复用既有 `(enterpriseId, taskId=runId)` 幂等身份；延迟 dispose／晚到记账通过诊断端口报告，不修改已返回快照。交付包：`/workspace/runtime-rule-adaptation-p2-r4/`。未 commit / push / PR，未改 P1 校验器与 P1 契约源码，未激活策略，未写配置，未扩大候选，未落盘，未启动 P3。 |

## P2 r4 纠正记录（追加，不改写已验收 P1 契约正文）

- 占用有界：复用 `tryAcquireAgentRunSlot` / `finishAgentRun` / `reapStaleActiveAgentRunsOnStartup` 与 `createRunAdmissionLease`，经可注入临时 `storePath` 的影子适配，不调用会写入生产注册表的 `tryAcquireEnterpriseAgentRun`，不改生产默认 3 小时孤立策略。官方 stale reap 完成后再 dispose 对应内存会话，不是对仍在计数的运行中请求做提前释放。
- 未注入该占用适配的治理端口将 `governanceOccupancyReady=false`，不得据此完成 P2 治理验收。
- 记账状态：`usageKnown`、`usageAccountingAttempted`、`usageAccountingStatus`（`not_attempted` / `succeeded` / `failed` / `unknown`）进入产品类型与 `limitProof`。失败不改写原判定，不得称为成功入账；重试使用既有幂等身份，避免重复收费。
- 已返回结果为返回时快照（冻结）。延迟 `session.dispose()` 失败与晚到记账结果只通过既有诊断 sink 报告。
- 本轮交付包：`/workspace/runtime-rule-adaptation-p2-r4/`。不覆盖原 P2 / r2 / r3 包或 P1 冻结包。不改 `.loom/registry.yaml`。


## P3 激活契约设计（追加，不改写已验收 P1／P2 契约正文）

- 时间：2026-11-12 18:56（Asia/Shanghai，UTC+8）。
- Owner 已确认 P2 影子组件阶段验收通过（受控端口与替身测试；不代表生产治理已接通或可以激活策略），并授权先交激活契约设计，不直接接入执行。
- P2 完整冻结包已密封只读：`/workspace/runtime-rule-adaptation-p2-frozen/`（密封后再写本段与 P3 新文档，未把 P3 文件混入该包）。
- 本轮仅新增规格：`effective-policy-lifecycle.md`、`p3-activation-test-matrix.md`。不实现激活入口，不接线，不改 P1／P2 源码，不改变 `activationAllowed=false`，不改 `.loom/registry.yaml`，不启用策略，不写生产配置，不启动 P4／P5。
- 评审包：`/workspace/runtime-rule-adaptation-p3-design/`。提交／推送／PR 仍未获授权。

| 2026-11-12 18:56      | P2 完整交付包已冻结。本轮只提交 P3 激活契约与状态转换／失败测试矩阵供验收，不实施激活器，不接入执行。 |

## P3 有限实施（追加，不改写已验收 P1／P2 契约正文；本轮不是代码验收）

- 时间：2026-11-12 19:18（Asia/Shanghai，UTC+8）。
- Owner 已确认 P2 冻结包核验通过，并放行有限 P3 实施（类型化请求／绑定／结果、纯预检、state CAS 夹具、激活失败／竞争／持久化失败／重启读取测试）。本轮**不是** P3 代码验收、合并或部署批准。
- 已锁定：个人快照写入既有 `SessionTaskBoard.runtimeRuleAdaptationByTaskId`（board 级、按 taskId 索引），与 `writeEpoch` 同一锁、同一次原子写入；生产白名单保持为空，仅测试夹具白名单可用于 E-04 类成功路径。
- 已对他人所有的 `contracts/task.ts` 与 `state/repository/task-board-file.ts` 做最小协调修改，使该可选映射能被官方 read／clone 保留。这两份文件不登记为本任务独占路径。
- 新增独占文件：`src/agent-runtime/contracts/rule-adaptation-activation.ts`（外科登记，未跑正式 `loom register`）。预检位于 `policy/rule-adaptation/`，宿主入口位于 `command/rule-adaptation/`。未改 P1 校验器与 `contracts/rule-adaptation.ts` 正文，未改 P2 影子入口行为，`activationAllowed` 仍为 `false`。
- 未修改生产配置或 operatingState，未打开 `collaboration.policySnapshot`，未接线个人或协作主执行链，未创建真实非空生产白名单，未接入真实租户授权或渠道，未启动 P4。
- 交付包：`/workspace/runtime-rule-adaptation-p3-r1/`。不覆盖 P2 冻结包或 P3 设计包。提交／推送／PR 仍未获授权。

| 2026-11-12 19:18      | Owner 锁定个人快照落点与首期空白名单，并放行有限 P3 实施。本轮交付类型、预检、CAS 夹具与失败／重启测试，不是代码验收、合并或部署批准。 |


## P3 r2 最小修复（追加，不改写已验收 P1／P2 契约正文；本轮仍不是代码验收）

- 时间：2026-11-12 19:46（Asia/Shanghai，UTC+8）。
- Owner 对 P3 r1 暂不通过：锁内事务仍由 command 持有；拒绝结果可能泄漏其他作用域快照；两个共享官方文件需要限定归属证据。本轮只做这两项最小修复并补归属证据，再重交。本轮**不是** P3 代码验收、合并或部署批准。
- 将锁内重读、CAS、快照与历史写入移入 state mutation 入口 `mutateRuntimeRuleAdaptationBoard`（`src/agent-runtime/state/mutations/runtime-rule-adaptation.ts`）。command 只保留用例组织（授权／预检 → 调用 state 入口 → 映射结果），不再持有任务板锁或对激活／撤销／回退做裸 repository 读写。policy 仍为纯预检。
- 身份或作用域校验失败时，激活、撤销、回退及读取均不再返回快照、历史或不应暴露的状态；磁盘不变。只有访问范围已验证的失败，才可以返回允许查看的 retained 信息。
- 为 `contracts/task.ts`、`state/repository/task-board-file.ts` 及上述 state mutation 入口写入限定落地登记（`metadata.limitedLandings`）。不把这些文件登记为本任务独占路径。未声称其他任务负责人已签字确认。未跑正式 `loom register`。
- 维护备忘：`activation-precheck.ts` 已超过千行，后续应按结构校验、身份版本、各操作预检拆分；本轮不因行数单独阻塞，也不机械拆文件。
- 生产白名单仍为空，`activationAllowed` 仍为 `false`，未接线主执行链，未打开 `collaboration.policySnapshot`，未发明默认 TTL，未启动 P4。
- 交付包：`/workspace/runtime-rule-adaptation-p3-r2/`。不覆盖 P2 冻结包、P3 设计包或 P3 r1 包。提交／推送／PR 仍未获授权。

| 2026-11-12 19:46      | Owner 对 P3 r1 暂不通过。本轮将锁内事务移入 state 入口，堵住跨作用域快照泄漏，并补共享文件限定归属证据后重交。不是代码验收、合并或部署批准。 |

## P4 个人主链接入设计修订与限定测试接入（追加，不改写已验收 P0–P3 规格正文）

- 时间：2026-11-12 22:18（Asia/Shanghai，UTC+8）。
- 修订设计文：`p4-personal-main-chain-integration.md`、`p4-personal-enforcement-decision-table.md`（新文件；评审包仍在 `/workspace/runtime-rule-adaptation-p4-design/`）。交付包：`/workspace/runtime-rule-adaptation-p4-r1/`。本轮不是生产生效、合并或部署批准。

| 2026-11-12 22:18      | Owner（t20u）通过设计方向并锁定三项选择，修正失效快照不得静默放宽。本轮修订设计文并做个人场景限定测试接入；生产白名单仍空，不启动生产接线。 |
