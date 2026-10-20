# Phase 1B Item 5 — 生产收尾指令（运维执行）

**签发**：cursor-data-governance  
**日期**：2026-08-18  
**受众**：生产运维（SRE / DevOps）  
**目的**：在已合入主干上，对唯一生产 state 完成 registry `main` 重绑 + Catalog 写入，验收后回填，让 item 5 生产侧可被独立判定。  
**代码修复已完成**：<https://github.com/gmood2008/openbot/pull/490>  
**必须使用的主干 SHA**：[`5862cf1de018902781a559b7309661f098f49d81`](https://github.com/gmood2008/openbot/commit/5862cf1de018902781a559b7309661f098f49d81)

本指令是当前任务的**最后一段可执行工作**。运维做完并回填后，data-governance 才能关账；在此之前 item 5 保持 **not-met**。

---

## 0. 先读这 8 条

1. **只操作** `/root/.openbot`（生产 gateway 的 `resolveStateDir()`）。
2. **必须先** `git fetch origin`，确认 HEAD = `5862cf1de018902781a559b7309661f098f49d81`（或其后的 `origin/main`，且该 SHA 是 ancestor）。
3. **三项 env 缺一不可**，缺了会被拒绝或误写入维护用户自己的 `~/.openbot`。
4. runner 会在**同一变更窗口**写 registry 与 Catalog；预检失败则**两边都不写**。
5. **不要**把开发机 `~/.openbot` scp 覆盖生产。
6. **不要**翻 `wiredToProductionResolver`。
7. **不要**把本次 executed 自行标成 item 5 **met**。
8. stdout / 回填材料里 **不要出现 UUID**（只回哈希 ID 与计数）。

---

## 1. 唯一 state 目标

| 项                | 值                                            |
| ----------------- | --------------------------------------------- |
| 生产 state 根目录 | `/root/.openbot`                              |
| registry          | `/root/.openbot/openbot-agent-registry.json`  |
| Catalog           | `/root/.openbot/data-governance/catalog.json` |

```bash
export OPENBOT_PRODUCTION_STATE_DIR=/root/.openbot
export OPENBOT_PRODUCTION_EXECUTION_MODE=production
export OPENBOT_PRODUCTION_ON_GATEWAY_HOST=1
```

| 变量                                           | 作用                                                                      |
| ---------------------------------------------- | ------------------------------------------------------------------------- |
| `OPENBOT_PRODUCTION_STATE_DIR`                 | 显式生产目录；registry 与 Catalog 都用它                                  |
| `OPENBOT_PRODUCTION_EXECUTION_MODE=production` | 声明这是生产执行，不是开发机试跑                                          |
| `OPENBOT_PRODUCTION_ON_GATEWAY_HOST=1`         | 允许目标等于当前进程 `resolveStateDir()`（root 的 `/root/.openbot` 合法） |

非 root 维护账号也可以跑，但必须把上述三项指到 **`/root/.openbot`**，不能落到维护用户自己的 `~/.openbot`。

---

## 2. 变更窗口（按顺序，不要跳）

### 2.1 对齐代码

```bash
cd /path/to/openbot
git fetch origin
git checkout 5862cf1de018902781a559b7309661f098f49d81

# 必须为 0
test "$(git rev-parse HEAD)" = "5862cf1de018902781a559b7309661f098f49d81"

# 必须存在（证明用的是修复后的 v2 runner）
test -f docs/design/evidence/memory-workspace-phase1b-item5-deploy-execution-runner.ts
test -f src/gateway/data-governance/phase1b-item5-production-container-write.ts
test -f src/gateway/data-governance/phase1b-item5-registry-main-rebind.ts
```

若现场已快进到更新的 `origin/main`，先确认：

```bash
git merge-base --is-ancestor 5862cf1de018902781a559b7309661f098f49d81 origin/main
```

必须成功，否则停下来，不要用旧树。

### 2.2 备份

```bash
BACKUP=/var/tmp/openbot-state-pre-item5-$(date +%Y%m%d-%H%M%S).tar.gz
tar -czf "$BACKUP" -C /root .openbot
ls -lh "$BACKUP"
echo "BACKUP=$BACKUP"
```

记下备份路径与开始时间。回滚：`tar -xzf "$BACKUP" -C /root`（仅在本窗口失败且需要恢复时）。

### 2.3 执行（一次完成，禁止拆成手工改 JSON）

```bash
export OPENBOT_PRODUCTION_STATE_DIR=/root/.openbot
export OPENBOT_PRODUCTION_EXECUTION_MODE=production
export OPENBOT_PRODUCTION_ON_GATEWAY_HOST=1

bun docs/design/evidence/memory-workspace-phase1b-item5-deploy-execution-runner.ts \
  | tee /tmp/item5-deploy-execution-production.json
```

**成功必须同时满足**：

```json
"status": "not-met"
"wiredToProductionResolver": false
"executed.productionContainerWrite.status": "executed"
"executed.productionContainerWrite.stateDir": "/root/.openbot"
```

以及 `registryMainRebind.assetReactivated` / `membershipBindingCreated` 为 true（若生产 main 此前已是 active + membership，以现场 JSON 为准，但 `stateDir` 必须是 `/root/.openbot`）。

**失败看 `code`，不要只看 `reason`：**

| code                                              | 含义                                                                    | 处理                                   |
| ------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------- |
| `production_write_target_unconfigured`            | 未设 `OPENBOT_PRODUCTION_STATE_DIR`                                     | 补三项 env 后重跑                      |
| `production_write_target_rejected`                | 已配置但不合法（开发机隐式目录、缺 `MODE=production`、evidence 目录等） | 核对三项 env 与 `/root/.openbot`       |
| `production_write_target_inconsistent`            | registry / Catalog 目标不一致                                           | 停；不要手工补写；联系 data-governance |
| `production_write_target_filesystem`              | 权限或文件系统                                                          | 确认对 `/root/.openbot` 可读写后再重跑 |
| `main_asset_membership_rebind_derivation_missing` | 推不出 main 的 membership 链                                            | 停；不要手工指定 owner                 |

预检失败时 **registry 与 Catalog 都不应被改**。若已 executed 但字段不对，用 §2.2 备份回滚并停。

### 2.4 重启 gateway

按现场 runbook 重启，使进程重新读取 `/root/.openbot`：

- 容器：`podman restart openbot-gateway-rc`（名称以现场为准）
- 或等价 reload

重启后确认进程 `resolveStateDir()` = `/root/.openbot`（容器 env / 日志一行即可，可脱敏）。

---

## 3. 四个验收 runner（同一环境、同一 state）

三项 env **保持不变**，在生产 gateway 可见的环境执行：

```bash
export OPENBOT_PRODUCTION_STATE_DIR=/root/.openbot
export OPENBOT_PRODUCTION_EXECUTION_MODE=production
export OPENBOT_PRODUCTION_ON_GATEWAY_HOST=1

# A. deploy 包（应已 executed；再跑一次若目标已写入，应保持 executed / 幂等，不得改到别的目录）
bun docs/design/evidence/memory-workspace-phase1b-item5-deploy-execution-runner.ts \
  | tee /tmp/item5-A-deploy.json

# B. live caller（只读）
bun docs/design/evidence/memory-workspace-phase1b-item5-host-live-caller-runner.ts \
  | tee /tmp/item5-B-live-caller.json

# C. registry / Catalog 对齐（只读）
bun docs/design/evidence/memory-workspace-phase1b-item5-registry-catalog-mismatch-runner.ts \
  | tee /tmp/item5-C-mismatch.json

# D. tenant-context managed 路径（只读）
bun docs/design/evidence/memory-workspace-phase1b-item5-tenant-context-host-proof-runner.ts \
  | tee /tmp/item5-D-tenant-context.json
```

**收尾通过线（生产）：**

| 检查                                     | 期望                                |
| ---------------------------------------- | ----------------------------------- |
| A `productionContainerWrite.status`      | `executed`                          |
| A `stateDir`                             | `/root/.openbot`                    |
| Catalog user-owned 行                    | ≥ **7**（6 occupancy + 1 main）     |
| registry `main`                          | **active** + **membership** primary |
| `main` live caller                       | ≥ **1 hit**；允许 1 miss            |
| 全部 JSON 的 `wiredToProductionResolver` | **false**                           |
| 全部 JSON                                | **无 UUID**                         |

A 已 executed 后再跑 A：不要改 env，不要换目录。

---

## 4. 回填模板（原样填好发给 cursor-data-governance）

不要把 unredacted UUID 贴进 git / 群聊公开区。计数与哈希即可。

```text
【Item 5 生产收尾回填】

主干 SHA：5862cf1de018902781a559b7309661f098f49d81
执行人：
开始时间：
结束时间：
备份路径：

三项 env：
  OPENBOT_PRODUCTION_STATE_DIR=/root/.openbot
  OPENBOT_PRODUCTION_EXECUTION_MODE=production
  OPENBOT_PRODUCTION_ON_GATEWAY_HOST=1

A deploy：
  status=
  stateDir=
  persisted=
  compareAndPutConfirmed=
  assetReactivated=
  membershipBindingCreated=
  wiredToProductionResolver=

B live caller：
  hostCatalogUserOwnedRows=
  liveCallerHits=
  liveCallerMisses=
  exactIdHits=

C mismatch：
  usersWithRegistryResolvedNotInCatalog=
  rootCause=

D tenant-context：
  mainPathMisses=
  mainPathMembershipFallbacks=
  legacyPathHits=

gateway 重启方式：
resolveStateDir 确认：

blocked（若有）：
  code=
  reason=

附件（运维本地，勿提交 git）：
  /tmp/item5-deploy-execution-production.json
  /tmp/item5-A-deploy.json
  /tmp/item5-B-live-caller.json
  /tmp/item5-C-mismatch.json
  /tmp/item5-D-tenant-context.json
```

---

## 5. 明确禁止

- 使用 #490 合入前的旧 runner
- 只设一个 env，或指向维护用户 `~/.openbot`
- 手工改 registry / catalog.json
- 翻 `wiredToProductionResolver=true`
- 改 Freeze 行：`tool-cwd.ts:52`，`tenant-context.ts:729/771/786`
- 删除 item 7 的 38 个 write-watch 点
- 把本次 executed 写成 item 5 **met**

---

## 6. 做完之后谁关账

运维回填 → cursor-data-governance 更新 `tasks.md` / scorecard。  
item 5 **仍可能 not-met**（例如 `main` 仍 1 hit / 1 miss）。那是独立判定，不是运维失败。

运维这一段的完成标准只有：同一 `/root/.openbot` 已 executed、已备份、已重启、四个 runner 已跑、回填模板已交。
