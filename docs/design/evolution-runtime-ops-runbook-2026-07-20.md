# Evolution Runtime Ops Runbook

> Task: evolution-runtime-closure · 2026-07-20（安全默认：治理 assist + 技能 auto **off**）  
> 生产默认 **不** 自动安装技能、**不** 自动改 runtime。全自动需双重显式授权。  
> 2026-07-23：opt-in 就绪（人审 UI + critical scan + health_watch 回滚）；默认仍 fail-closed。

## 模式

### 治理姿态

| 值                   | 环境变量                                          | 行为                                                        |
| -------------------- | ------------------------------------------------- | ----------------------------------------------------------- |
| `assist`（**默认**） | `OPENBOT_EVOLUTION_GOVERNANCE_MODE=assist` 或不设 | 检测 + anomaly/pending，**不** limit/pause/redirect/recover |
| `auto`               | `...=auto`                                        | 可按策略自动 limit/pause；效果窗改善后可 resume/clear_limit |
| `off`                | `...=off`                                         | tick 不动作（RPC 只读仍可用）                               |

### 技能自动安装（非「静默审批」）

| 值                | 环境变量                                           | 行为                                                                                     |
| ----------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `off`（**默认**） | 不设 / `OPENBOT_SKILL_AUTO_EVOLUTION=off` / 非法值 | 完全关闭                                                                                 |
| `on`              | `OPENBOT_SKILL_AUTO_EVOLUTION=on`                  | 仅当治理 mode 也是 **auto** 时，对**已人工 approve** 的候选执行 publish→finalize→install |

**硬门禁：**

1. 后台 **从不** 调用 `approvePatternCandidate`；审批必须经 `pattern-detection.approve`（operator.approvals）。
2. 非法 env 值 **fail-closed**（关）。
3. skill-auto=on 但治理仍是 assist → **不安装**（返回 `mutations-require-governance-auto`）。
4. Agent allowlist 为必填：`OPENBOT_SKILL_AUTO_ALLOW_AGENTS=agent1,agent2`；未设、空值或解析后为空时 **不允许任何 agent**（fail-closed）。
5. 安装过程写 durable `skillAutoJobs`（pending_publish → draft_created → finalized → installed / failed / cancelled），下轮可补偿重试。
6. **只处理**有 `skillAutoJobs` 归属或候选 `autoInstallIntent=true` 的记录；**不会**接管历史上人工 publish 的 draft。
7. 重试前重新校验：审批状态、质量阈值、策略版本、agent allowlist；失败则 **cancel** 作业。
8. 人工入口：`evolution-governance.enroll-skill-auto` / `evolution-governance.cancel-skill-auto`；审批可带 `autoInstallIntent` + `approvedBy`。

阈值（仅影响已批准候选的安装门槛）：

- `OPENBOT_SKILL_AUTO_MIN_INDEPENDENT` 默认 3
- `OPENBOT_SKILL_AUTO_MIN_CONFIDENCE` 默认 0.7
- `OPENBOT_SKILL_AUTO_MIN_SUCCESS_RATE` 默认 0.7（有 successRate 时）

Kill switch：`evolution-governance.set-kill-switch` 同时阻断治理动作与技能自动安装。  
手动跑一轮：`evolution-governance.run-skill-auto-pass`（operator.approvals；仍不自动 approve）。

### 开启「已批准后自动安装」的安全清单

```bash
export OPENBOT_EVOLUTION_GOVERNANCE_MODE=auto
export OPENBOT_SKILL_AUTO_EVOLUTION=on
# 必填：空名单不允许任何 agent
export OPENBOT_SKILL_AUTO_ALLOW_AGENTS=prod-bot-a,prod-bot-b
```

并确认：

- 候选已由人工 approve（含安全/权限复核）
- Actions 页可勾选 **批准后自动安装**（`autoInstallIntent`），并可 **登记/取消** skill-auto 作业、查看 `skillAutoJobs`
- critical 扫描阻断已启用（skill-auto 路径比 CLI warn-and-continue 更严）
- 安装后进入 `health_watch`：样本足够且成功率低于阈值时自动 disable → `rolled_back`
- 租户/RBAC 与 shared-agent 写门禁已就位；开启 skill-auto 前必须设置非空的 `OPENBOT_SKILL_AUTO_ALLOW_AGENTS`，空名单不会放行全部 agent

## 常用 RPC

| 方法                                     | Scope     | 用途                                                                    |
| ---------------------------------------- | --------- | ----------------------------------------------------------------------- |
| `evolution-governance.snapshot`          | read      | 总览 mode / skillAuto / jobs / effects / limits / redirects             |
| `evolution-governance.pending-approvals` | read      | 待人工项                                                                |
| `evolution-governance.resolve-approval`  | approvals | `resume` / `hold` / `clear_limit` / `clear_redirect`                    |
| `evolution-governance.apply-redirect`    | approvals | 源 Agent → 目标 Agent（**双方 tenantCoverage 必填且相交**）             |
| `evolution-governance.human-resume`      | approvals | 恢复 pause 并关闭 open effects                                          |
| `evolution-governance.enroll-skill-auto` | approvals | 登记已批准候选的自动安装作业                                            |
| `evolution-governance.cancel-skill-auto` | approvals | 取消未完成作业（已安装/health_watch 不可取消）                          |
| `evolution-governance.set-kill-switch`   | admin     | 全局急停（阻断治理动作与技能自动安装）                                  |
| `pattern-detection.approve`              | approvals | **唯一** 将 candidate → approved 的正规入口（可带 `autoInstallIntent`） |

## Redirect 语义（运维）

1. **新入站流量**：`resolveAgentRoute` / `resolveSessionAgentIds` 会把源 agent 改写为 target，并重建 `sessionKey`（`agent:<target>:…`）。
2. **旧会话**：历史 transcript **不会**自动迁移；源会话仍在源 agent 下。
3. **租户**：源/目标任一缺少 `tenantCoverage` → 拒绝（`target-tenant-coverage-required`）；无交集 → `target-tenant-mismatch`。
4. **UI**：治理 Actions 页显示 redirects；若 session 解析到 target，`redirectedFromAgentId` 可用于角标。
5. **取消**：`clear_redirect` 或 `resolve-approval` decision=`clear_redirect`，再 `resume` 源 binding。

## Soft limit 语义

- 绑定 `degraded` + 降低 `routingPriority`（仍可调用）。
- 清除：`clear_limit` / pending 审批「清除限流」。
- 仅 governance **auto** 模式下 tick 自动施加；assist 只产生 pending。

## 飞行检查

```bash
pnpm exec vitest run src/gateway/evolution-governance/flight-check.test.ts
pnpm exec vitest run src/gateway/evolution-governance/skill-auto-evolution.test.ts
```

## 注意

- **默认仍 fail-closed**：未设 env 时 skill-auto=off、治理 mode=assist；禁止默认生产自动安装。
- **可安全 opt-in**：人审 UI（autoInstallIntent / enroll / jobs）、critical scan 硬门禁、health_watch 自动 disable 已就绪后，方可按上方双重 env 显式开启。
- draft 必须 finalize 后再进入可执行投影；身份工具受 lifecycle 门禁。
- 不要默认 `OPENBOT_PROMPT_NAMED_USE_ATTRIBUTION=1`（prompt-only 不可靠）。
- 自动安装目标为 **candidate.agentId** 源机器人；跨机器人分发仍靠人工/企业流。
- 健康观察：`OPENBOT_SKILL_AUTO_HEALTH_WATCH_MS`（默认 24h）、`OPENBOT_SKILL_AUTO_HEALTH_MIN_SAMPLES`（默认 3）；成功率阈值复用 `OPENBOT_SKILL_AUTO_MIN_SUCCESS_RATE`。
