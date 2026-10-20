# Phase 1B Item 5 — 生产侧收尾协作指令（v2）

**签发**：cursor-data-governance  
**日期**：2026-08-18  
**受众**：生产运维（SRE/DevOps）、平台鉴权（registry/membership）、验收方（data-governance 或指定 reviewer）  
**前置**：本修复已合入 `origin/main`；**合入前禁止** 在生产执行旧版 runner。

---

## 1. 当前状态

| 项                          | 状态                                                                  |
| --------------------------- | --------------------------------------------------------------------- |
| item 5                      | **not-met**                                                           |
| `deployAuthorized`          | **true**（operator 已明确授权）                                       |
| `wiredToProductionResolver` | **false**（禁止只改旗）                                               |
| 生产 deploy runner          | **v2**：registry + Catalog **同一显式 stateDir**，预检失败 **零写入** |

---

## 2. 唯一生产 state 目标（必须三项 env 同时设置）

```bash
export OPENBOT_PRODUCTION_STATE_DIR=/root/.openbot
export OPENBOT_PRODUCTION_EXECUTION_MODE=production
export OPENBOT_PRODUCTION_ON_GATEWAY_HOST=1
```

| 变量                                 | 含义                                                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `OPENBOT_PRODUCTION_STATE_DIR`       | 生产 gateway 可见的 state 根目录（容器内 `/root/.openbot` 或宿主机挂载源）                                    |
| `OPENBOT_PRODUCTION_EXECUTION_MODE`  | 必须为 `production`；缺省或非 production 会被 **rejected**                                                    |
| `OPENBOT_PRODUCTION_ON_GATEWAY_HOST` | gateway 宿主机/容器内执行时设为 `1`；允许 stateDir 与 `resolveStateDir()` 相同（如 root 的 `/root/.openbot`） |

**禁止**：

- 仅设置 `OPENBOT_PRODUCTION_STATE_DIR` 而不设 `EXECUTION_MODE=production`
- 在开发者 laptop 上不设 `ON_GATEWAY_HOST=1` 却指向本机 `~/.openbot`（会报 `production_state_dir_dev_implicit_forbidden`）
- registry 与 Catalog 写入不同目录（runner 已统一，勿手工拆步）

---

## 3. 变更窗口执行步骤

### 3.1 备份

```bash
tar -czf openbot-state-pre-item5-$(date +%Y%m%d).tar.gz -C /root .openbot
```

记录备份路径与时间窗。

### 3.2 执行 deploy 包（一次完成 registry main 重绑 + Catalog compareAndPut）

从 **最新 `origin/main`** checkout：

```bash
cd /path/to/openbot
git fetch origin && git checkout origin/main

export OPENBOT_PRODUCTION_STATE_DIR=/root/.openbot
export OPENBOT_PRODUCTION_EXECUTION_MODE=production
export OPENBOT_PRODUCTION_ON_GATEWAY_HOST=1

bun docs/design/evidence/memory-workspace-phase1b-item5-deploy-execution-runner.ts \
  | tee /tmp/item5-deploy-execution-production.json
```

**成功 stdout 关键字段**：

```json
"executed": {
  "productionContainerWrite": {
    "status": "executed",
    "stateDir": "/root/.openbot",
    "registryStorePath": "/root/.openbot/openbot-agent-registry.json",
    "catalogPath": ".../data-governance/catalog.json",
    "registryMainRebind": { "assetReactivated": true, "membershipBindingCreated": true }
  }
}
```

**blocked 时看 `code` 字段**（勿再只看 `reason`）：

| code                                   | 含义                                                 |
| -------------------------------------- | ---------------------------------------------------- |
| `production_write_target_unconfigured` | 未设置 `OPENBOT_PRODUCTION_STATE_DIR`                |
| `production_write_target_rejected`     | 已配置但路径/模式不合法（dev 隐式、evidence 目录等） |
| `production_write_target_inconsistent` | registry 与 Catalog 目标不一致                       |
| `production_write_target_filesystem`   | 权限或文件系统错误                                   |

预检失败时 **registry 与 Catalog 均不会部分写入**。

### 3.3 重启 gateway

按现场 runbook（Mac menubar / podman `openbot-gateway-rc` 等），确保进程 `resolveStateDir()` 指向 `/root/.openbot`。

---

## 4. 四个验收 runner（生产 gateway 可见环境）

```bash
# A. deploy 执行包（应 executed）
bun docs/design/evidence/memory-workspace-phase1b-item5-deploy-execution-runner.ts

# B. live caller 计量（只读）
bun docs/design/evidence/memory-workspace-phase1b-item5-host-live-caller-runner.ts

# C. registry/Catalog 对齐诊断（只读）
bun docs/design/evidence/memory-workspace-phase1b-item5-registry-catalog-mismatch-runner.ts

# D. tenant-context managed 路径证明（只读）
bun docs/design/evidence/memory-workspace-phase1b-item5-tenant-context-host-proof-runner.ts
```

**最低通过线**：

| 检查                                     | 期望                                        |
| ---------------------------------------- | ------------------------------------------- |
| deploy `productionContainerWrite.status` | **executed**                                |
| Catalog user-owned 行数                  | ≥ **7**（6 occupancy + 1 main）             |
| registry main asset                      | **active** + **membership** primary binding |
| `main` live caller                       | ≥ **1 hit**；允许 1 miss                    |
| `wiredToProductionResolver`              | **false**                                   |
| stdout / git 证据                        | **无 UUID**（仅哈希 ID）                    |

可选：`node docs/design/evidence/memory-workspace-phase1b-unlock-remaining.test.mjs`

---

## 5. 回填给 cursor-data-governance 的格式

1. **生产 deploy JSON**（§3 stdout），含 `status=executed` 与 `stateDir`
2. **备份路径** + 执行时间窗
3. **§4 四个 runner** 摘要（hit/miss 计数即可）
4. gateway 重启方式 + `resolveStateDir()` 确认
5. 若 blocked：`code` + `reason` + 三项 env 是否齐全

收到后更新 `tasks.md` / scorecard；**仍可能保持 item 5 not-met**。

---

## 6. 明确禁止

- ❌ 合入 main 前在生产跑旧 runner
- ❌ dev `~/.openbot` 整体 scp 覆盖生产
- ❌ 手工指定 main owner（须 historical seat + occupancy + membership 链）
- ❌ 翻 `wiredToProductionResolver=true`
- ❌ 改 Freeze 行：`tool-cwd.ts:52`，`tenant-context.ts:729/771/786`
- ❌ 把 deploy green 标成 item 5 **met**

---

## 7. 参考文件

| 文件                                                                                 | 用途                 |
| ------------------------------------------------------------------------------------ | -------------------- |
| `docs/design/evidence/memory-workspace-phase1b-item5-deploy-execution-decision.json` | deploy 授权 stamp    |
| `docs/design/evidence/memory-workspace-phase1b-item5-deploy-execution-runner.ts`     | 生产执行入口（v2）   |
| `src/gateway/data-governance/phase1b-item5-deploy-production-target.ts`              | 显式生产 target 解析 |
| `src/gateway/data-governance/phase1b-item5-deploy-execution.ts`                      | 预检 + 统一执行      |
| `src/gateway/data-governance/phase1b-item5-registry-main-rebind.ts`                  | main membership 重绑 |
| `src/gateway/data-governance/phase1b-item5-production-container-write.ts`            | 生产 Catalog 写入    |

---

## 8. 一句话摘要

> 在 production 设置三项 env，用 **v2 runner** 对 **同一 `/root/.openbot`** 完成 registry main→membership 重绑 + Catalog 写入，重启 gateway 后跑四个验收 runner；**不要翻旗**；把 executed JSON 与 hit/miss 交回 data-governance。
