# ConversationTask Runtime — P2 生产灰度准备(rollout plan)

> Owner(实施): `kiro-conversation-task-runtime` · Task: `conversation-task-runtime`
> 关联: `./p2-admission-package.md`、`./p2-ops-review.md`、`./p2-security-review.md`、`./p2-ops-runbook.md`、`./p2-rollback-drill.md`、`./p2-design-freeze.md`
> 状态: **准备材料。本轮仅完成运维接线设计、回滚演练与发布证据;未打开任何生产 flag、未创建正式任务、未接 Progress Ledger / Agent / Mission / 真实副作用、未部署、未 cutover。** 四态:`P2 implementation = ACCEPTED` · `main landing = ACCEPTED` (PR #680, `4ef2a43534`) · `production integration = NOT IMPLEMENTED` · `production rollout = NOT APPROVED`。合入主干 ≠ 已上线;等待独立生产发布审批。

## 0. 红线(本轮持续生效)

- `activation` / `projection` / `authorization` flag **持续 OFF**;不创建正式 ConversationTask、不接 `chat.send` / Progress Ledger / Agent / Mission、不产生真实副作用。
- 未部署、未 cutover、未开启任何灰度流量。未经独立发布审批,不得打开 `activation`,不得执行生产 cutover,不得进入 P3。

## 1. 基线与 forward-only 证据(发布前置)

- `git fetch origin` 已执行。
- **候选(candidate)= 新鲜 `origin/main` tip**:`a7adcfea9d085f126c25bbae3cd06b7c4f674714`。
- 当前工作分支 `kiro-loom/phase1a-section141-ownership-v2`(HEAD `28560e05cc`)**不是** `origin/main` 的后代(`git merge-base --is-ancestor origin/main HEAD` = 否)。**该分支不是部署输入。** 任何 cutover 必须从**新鲜 `origin/main`** 构建,不得使用 dirty worktree、侧分支或未合并提交(与仓库 Trunk baseline 规则一致)。本轮为文档准备,**不 rebase 共享多 agent 分支**。
- `./deploy/production/scripts/verify-forward-only.sh --candidate a7adcfea9d…` → **verdict `allow`**、`forwardOnly: true`;LIVE `a12e4c59e5…`(来源 container)被候选历史包含。
  - 观察(非本 spec 项):脚本 warning 显示"running artifact LIVE 与 release record `7cd74d4c5c…` 不一致";属交付对齐问题,发布审批方须先核对 `verify-delivery-alignment.sh` 与 `RELEASE_RECORD.md`,不在本 spec 范围。
- **发布当刻必须再次执行**(因 `origin/main` 可能推进):

```bash
git fetch origin
CANDIDATE_SHA=$(git rev-parse origin/main)
./deploy/production/scripts/verify-forward-only.sh --candidate "$CANDIDATE_SHA"
```

## 2. 控制面与生产配置核对(必须全部满足才允许灰度)

| 项                     | 要求                                                                    | 实现依据                                                                        |
| ---------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `activation` 默认      | **OFF**                                                                 | `feature.ts`(env 默认关闭);`control-plane.ts` 新库/丢失 fail-safe-off           |
| `projection` 默认      | **OFF**                                                                 | `feature.ts`;灰度期禁止开启                                                     |
| `authorization` 默认   | **OFF**(延后 P5)                                                        | `feature.ts`                                                                    |
| 控制面数据库           | **持久共享路径** `<root>/conversation-task/control-plane.db`(共享卷)    | `SqliteActivationControlPlane`(WAL + busy_timeout)                              |
| 控制面缺失/损坏/不可读 | **保持 OFF**(fail-safe-off)                                             | 新库/缺行/schema 异常/读异常 ⇒ `forced_off=1 reason=uninitialized_or_recovered` |
| 多实例                 | **同一控制面数据库**(同一共享卷)                                        | 跨进程读同一行;`state_version` CAS 防丢失更新                                   |
| 直接改库               | **禁止**手工 `UPDATE`/绕过 `ActivationDegradeController` 重开           | 无公开 `clear()`;唯一出路 `attemptReopen`(版本化原子 CAS)                       |
| 首次启用               | **必须经受控人工重开**(确认+冷却+RCA+actor);不得因 env flag=ON 自动激活 | Gate 读控制面 `isForcedOff()`,首启即 `shadow_frozen`                            |
| 时间                   | **仅服务端时钟**;公共类型无 `nowMs`,调用方不能伪造绕过冷却              | `control-plane.ts` `this.now()`                                                 |

## 3. 实时观测指标(全部脱敏:不落原始用户文本 / 实体 / 密钥)

| 指标                           | 来源                                                            | 阈值/用途                         |
| ------------------------------ | --------------------------------------------------------------- | --------------------------------- |
| Upgrade Precision              | 影子/灰度判定滚动窗(7 天或最近 N=200)                           | < 95% ⇒ 自动 force-off            |
| over-upgrade rate              | 同上                                                            | > 5% ⇒ 自动 force-off;> 2% ⇒ 告警 |
| duplicate task rate            | Task 幂等冲突计数                                               | > 1% ⇒ 告警                       |
| Reminder over-upgrade          | reminder 误升级计数                                             | > 0 ⇒ 告警 + 要求 RCA             |
| forced-off 状态                | 控制面 `snapshot().forcedOff` + reason + stateVersion           | 面板常显;转移可审计               |
| 控制面读取失败                 | `snapshot()` fail-safe 触发计数                                 | P0 告警(见 §4)                    |
| `state_changed_retry_required` | `attemptReopen` CAS 冲突计数                                    | 观测并发重开竞态频率              |
| 跨租户 ACL 拒绝                | `ConversationTaskAccessError`(tenant_binding/detection_scope/…) | 安全告警;应恒为 0 正常流量        |
| Candidate/Task 幂等冲突        | `ON CONFLICT DO NOTHING` 命中(changes=0)                        | 观测重复投递/并发收敛             |

- 指标只记 reason code / decisionVersion / 结果 / 脱敏指纹(shadow keyed HMAC),**永不落原文、实体或密钥**(与 O4 一致)。

## 4. 告警规则与停止条件

| 触发                      | 动作                                              |
| ------------------------- | ------------------------------------------------- |
| Upgrade Precision < 95%   | **自动 force-off** activation(控制面持久)+ 告警   |
| over-upgrade rate > 5%    | **自动 force-off** + 告警                         |
| over-upgrade rate > 2%    | 告警(不自动降级)                                  |
| duplicate task rate > 1%  | 告警                                              |
| Reminder over-upgrade > 0 | 告警 + **要求 RCA**(重开前必须完成)               |
| 控制面不可读              | **P0 告警并保持 OFF**(fail-safe-off,不得静默放行) |
| 控制面卷丢失 / 状态行异常 | **P0 告警并保持 OFF**                             |

- 自动 force-off 单向;**重开必须经受控 `attemptReopen`**(人工确认 + 服务端冷却 + RCA + 记录 actor/time/stateVersion);不得自动回升。渠道 = 内部控制通道 + 运维值班。

## 5. 灰度方案

- **范围**:仅内部测试租户或明确 allowlist(可信 `tenantId`);其余租户 Gate 恒 `shadow_frozen`。
- **默认生产流量 = 0%**;`activation` 生产默认 OFF。灰度开启须经独立发布审批 + 受控人工重开(非 env 变量)。
- **比例 / 观察窗口 / 停止条件 / 回滚命令**:见 `./p2-ops-runbook.md` §5.1(canary)。
- **禁止**通过环境变量临时绕过控制面(env flag=ON 也不激活;唯一权威是持久控制面 + 受控重开)。
- **禁止**灰度期间开启 `projection` 或 `authorization`。
- 停止条件命中 ⇒ 控制面自动/人工 force-off ⇒ 全实例即时 `shadow_frozen`(灰度租户回落到影子);回滚不依赖重新部署。

## 6. 回滚演练证据

- 见 `./p2-rollback-drill.md`:首启即 OFF、指标越阈自动 force-off、重启仍 OFF、第二实例共享 OFF、未确认/冷却未到/RCA 未完拒绝重开、受控重开记录 actor/time/stateVersion、控制面丢失/损坏/删行后 Gate 始终 `shadow_frozen`、时间伪造无通道;附可审计 receipt(sha256)。

## 7. 声明

- **本轮尚未打开任何生产 flag、尚未部署、尚未 cutover、尚未开启灰度流量。** 四态:`P2 implementation = ACCEPTED` · `main landing = ACCEPTED` (PR #680, `4ef2a43534`) · `production integration = NOT IMPLEMENTED` · `production rollout = NOT APPROVED`。
- 未经独立生产发布审批,不得打开 `activation`,不得执行生产 cutover,不得进入 P3。

## 8. 发布就绪门禁结果 —— 2026-08-24:BLOCKED(前置门禁未通过,已停止)【SUPERSEDED 2026-08-24】

> **⚠️ SUPERSEDED(2026-08-24):本节为历史记录,保留作证据,不得删除。** 其中的阻断项 1(候选不含功能、`origin/main` 下 `src/conversation-task` 文件数 = 0)与阻断项 2(侧分支未合并)**已由 PR #680(合并提交 `4ef2a43534`)解除** —— 模块现已合入 `origin/main`(43 文件)。阻断项 3(无独立发布审批记录)与阻断项 4(打开 activation 的红线)对**生产 rollout** 仍然成立:`production rollout = NOT APPROVED`。当前阶段为 **P2.5 生产集成准备**,尚未接入生产 gateway(`production integration = NOT IMPLEMENTED`)。以下为当时(候选 `a327d71819`,main 尚不含本模块)的原始只读门禁记录:

> 收到"生产发布与受控灰度"指令后执行只读前置门禁。**Gate 1 失败 → 立即停止**(遵循"任一门禁失败立即停止")。未构建、未部署、未 cutover、未打开任何 flag、未写 `deploy/production/*`、未 mint provenance tag、未合并 main、未 force-push。

- `git fetch origin` 已执行;`origin/main` tip = `a327d71819b16d0d33e94376cad45ef1d45ec158`。
- `verify-forward-only.sh --candidate a327d71819…` = `allow`(`forwardOnly:true`,LIVE `a12e4c59e5…`)。**注意:forward-only 通过仅表示历史前向,不代表候选包含本功能。**
- **阻断项 1(致命):候选不包含 ConversationTask 功能。** `origin/main` 下 `src/conversation-task/**` 文件数 = **0**;P0/P1/P2 模块**全部未合并**到 main(候选提交 `1272e8fead`/`24e3eb0bcd`/`b3f98f74b8`/`28560e05cc` 均 NOT-MERGED)。从 `origin/main` 构建将发布**不含 P2 runtime**的版本,"逐步开启 activation"无意义。
- **阻断项 2:侧分支未合并。** 本 P2 代码仅在共享分支 `kiro-loom/phase1a-section141-ownership-v2`(非 `origin/main` 后代)。按指令"若从侧分支构建,必须先合并到 main,再重新 fetch、验证、构建和部署";且仓库 `require-pr-on-trunk` ruleset 要求 **main 只经 PR 合并**(无 bypass)——属维护者/PR 门禁流程,不在本执行范围。
- **阻断项 3:无独立发布审批记录。** 门禁要求"发布审批人、时间、候选 SHA 已记录",当前未提供审批人身份/时间/审批凭据。
- **阻断项 4:红线。** 打开 `activation` = 对真实租户产生真实副作用(创建正式 ConversationTask 等),属历轮反复重申的红线,需独立书面发布审批;高风险且难以回退。

**解除阻断的前置(须由具备相应权限的角色完成,非本执行团队单方可为):**

1. 将 P2 分支经 **PR 合并入 `origin/main`**(通过 trunk ruleset 与评审);
2. 记录**独立发布审批人 + 时间 + 候选 SHA**;
3. 重新 `git fetch origin`,确认候选 = 新鲜 `origin/main` **且包含** `src/conversation-task/**`;
4. 重跑 `verify-forward-only.sh` 与 `verify-delivery-alignment.sh` 通过;
5. 具备生产部署管道访问与回滚就绪(演练 receipt 已归档,见 `./p2-rollback-drill.md`)。

在上述全部满足前,**不宣布"已上线",不打开 `activation`,不执行生产 cutover,不进入 P3**。
