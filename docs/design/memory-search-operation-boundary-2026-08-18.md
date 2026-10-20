# Memory search operation boundary（CQ-O1a 前置设计）

| 字段     | 值                                                                                                                          |
| -------- | --------------------------------------------------------------------------------------------------------------------------- |
| 文档 ID  | `memory-search-operation-boundary-2026-08-18`                                                                               |
| 状态     | **Implemented**（设计 #500 Approved；实现 #506 已合入 `main`）                                                              |
| 日期     | 2026-08-19                                                                                                                  |
| 依据     | `docs/design/conversation-memory-collaboration-optimization-plan-2026-08-18.md` §7.1.6                                      |
| 生产输入 | CQ-O0 redacted report（22 agents：`authority.unknown` 22；search/documentState 全 `unknown`；storage ready 5 / missing 17） |
| 实现     | **已落地**。#506（`6c20a36170f76c4bc34e27e34b01ef9d7372618e`）：`acquireSyncAuth` + S1–S10 + `scheduleAuthorizedSearchSync` |

本文只定义 search 触发 sync 的 operation boundary。不授权 schema v2、Resolver 写切换、批量 reindex、LIVE 迁移、U1 Handle 接线、CogniWeave 第二条 destructive acquire。

---

## 1. 实现前的问题（#506 之前）

`MemoryManager.search`（`src/memory/manager.ts`）在 `settings.sync.onSearch` 且 `dirty || sessionsDirty` 时曾：

```ts
void this.sync({ reason: "search" }).catch(...)
```

这是 fire-and-forget。`sync` 内部经 `beginV1Operation` 自己 `createV1OperationAuth`。search 入口因此可以间接触发 `sync`，并在 `v1OperationCoversDestructive("sync","prune")` 下嵌套 prune。

CQ-O0 生产报告显示全部 agent `authority.unknown`（无 v1 root fingerprint）。在这种状态下继续让 search 自行 acquire，会把「只读检索」和「未注册根上的 destructive」绑在同一条异步路径上。O1a 必须先把这条缝封住。三维 status 契约已在 CQ-O0 HealthReport 中定义；本文件 **不** 另开一套 UI。

### 1.1 实现后调用点（#506）

`src/memory/manager.ts:278` 调用 `this.scheduleAuthorizedSearchSync(opts)`（`src/memory/manager-sync-ops.ts:1448`）。denied / unknown / `force|rebuild|reset` → **零 sync**。`reason=search` 不消耗 env grant。

---

## 2. 现状（只读描述，不改代码）

| 符号                            | 位置                             | 现状                                                                                                |
| ------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------- | ----- | ---------------------------------- |
| `V1OperationAuth`               | `src/memory/v1-root-guard.ts`    | `{ brand, op, sqliteInstance }`；brand 为 in-process Symbol                                         |
| `createV1OperationAuth`         | 同上                             | 任意调用方只要拿得到函数就能造 auth                                                                 |
| `beginV1Operation`              | `src/memory/manager-sync-ops.ts` | 公开 boundary：读 env grant → `evaluateDestructiveInDbTransaction` → 成功则 `createV1OperationAuth` |
| `endV1Operation`                | 同上                             | 将 `this.v1OperationAuth` 置 null                                                                   |
| `assertV1OperationAuthorized`   | 同上                             | 内部 destructive 检查 brand + sqliteInstance + `v1OperationCoversDestructive`                       |
| `v1OperationCoversDestructive`  | `v1-root-guard.ts`               | `sync` 覆盖 `prune`；`rebuild` 覆盖 `sync                                                           | prune | reset`；`reset`/`prune` 不互相覆盖 |
| `resolveV1RootGuardIndexStatus` | `v1-root-guard.ts`               | **不**重读 env grant（status 路径已符合本设计）                                                     |

缺口（设计时）：不存在 `acquireSyncAuth`。search 不检查 authority/topology，也不加入 single-flight。`sync({ force: true })` 会把 boundary op 升为 `rebuild`。#506 后该缺口已关闭。

---

## 3. 目标契约

`acquireSyncAuth` 是 **唯一** 允许 search/manual 触发 `op=sync` 的构造入口。search 不得调用 `createV1OperationAuth`，也不得直接 `beginV1Operation("rebuild"|"reset"|"prune")`。

```ts
/** 设计评审交付 — 非实现授权 */
type AcquireSyncAuthRequest = {
  op: "sync";
  reason: "search" | "manual";
  agentId: string;
  sqliteInstanceId: string; // normalizeSqliteInstanceId
  workspaceFingerprint: string;
};

type AcquireSyncAuthResult =
  | {
      ok: true;
      auth: V1OperationAuth;
      expiresAt: string; // ISO8601；≤ 单次 search 超时预算
      holder: "single-flight";
    }
  | {
      ok: false;
      reasonCode:
        | "destructive.denied"
        | "destructive.grant-required"
        | "authority.unknown"
        | "topology.multiple"
        | "auth.expired"
        | "auth.mismatch";
      reason: string;
    };
```

批准后的 search 伪代码（#506 已按此落地）：

```ts
if (!this.settings.sync.onSearch || !(this.dirty || this.sessionsDirty)) {
  // 只读检索
} else {
  const auth = await acquireSyncAuth({ op: "sync", reason: "search", ...ids });
  if (!auth.ok) {
    // 不调用 sync；检索继续或返回空集，由三维 status 表达
  } else {
    await inFlightSync; // follower 不重复 acquire
  }
}
```

---

## 4. 设计项答疑（§7.1.6 表）

### 4.1 auth 生命周期

- 一次成功的 `acquireSyncAuth` 对应 **一个** in-flight `sync` promise。
- `expiresAt` ≤ 当前 search 超时预算（建议上限 15s，可配置，不得大于 search timeout）。
- 失效条件（任一即 `endV1Operation()` 并拒绝后续 `assertV1OperationAuthorized`）：
  1. `sync` settle（fulfill 或 reject）；
  2. 超过 `expiresAt`；
  3. `auth.sqliteInstance` 与当前 store path 的 `normalizeSqliteInstanceId` 不一致（`auth.mismatch`）。
- 过期后 search **不得**自动再 acquire。下一次用户 search 才允许重新申请。

### 4.2 嵌套 prune

保持现有 `v1OperationCoversDestructive`：

| boundary          | 允许嵌套                   |
| ----------------- | -------------------------- |
| `sync`            | `prune` only               |
| `rebuild`         | `sync` / `prune` / `reset` |
| `reset` / `prune` | 仅自身                     |

search 路径 **只** 能拿到 `op=sync` 的 auth。因此 search 触发的 sync 最多嵌套 prune，**不能** reset/rebuild。`sync({ force: true })` 不得从 search 传入。

### 4.3 谁持有 auth

- 每个 `(agentId, sqliteInstanceId)` 一把 single-flight lock。
- leader：`acquireSyncAuth` 成功并启动 `sync`。
- follower：await **同一个** promise，不调用 `createV1OperationAuth` / `beginV1Operation`。
- 并发 search 不得产生第二个 auth。

### 4.4 防伪造

- `createV1OperationAuth` 从 `v1-root-guard.ts` **停止导出给 search 入口**（实现阶段：改为 boundary 模块内部或 `internal` 后缀文件）。
- `manager.ts` 的 `search` / `warmSession` 禁止 import `createV1OperationAuth`。
- Oxlint `no-restricted-imports`：`src/memory/manager.ts` 不得从 `v1-root-guard.ts` 导入 `createV1OperationAuth`。
- auth 对象不得序列化、不得出进程、不得写入 status/JSON。

### 4.5 env grant

- 仅 `acquireSyncAuth` → `beginV1Operation` 这一跳重读 `OPENBOT_V1_ROOT_GUARD_*`。
- `manager.status()` / doctor / CQ-O0 probe 继续走 `resolveV1RootGuardIndexStatus`，**不**读 grant。
- 生产 CQ-O0 结论（全员 `authority.unknown`）意味着无 fingerprint 时 acquire 必须失败为 `authority.unknown`，不得靠 env grant 静默放行 search-sync。maintenance grant 只覆盖已显式签发的 sqliteInstance + op，且仍不得从 search 申请 rebuild。

### 4.6 错误码映射

| reasonCode                   | 何时                                  | search 行为                      |
| ---------------------------- | ------------------------------------- | -------------------------------- |
| `authority.unknown`          | 无已登记 v1 fingerprint（CQ-O0 现状） | 不 sync；search 三维 `unknown`   |
| `topology.multiple`          | sidecar / 多指纹冲突                  | 不 sync；`rootTopology=multiple` |
| `destructive.denied`         | guard refuse 且非 grant               | 不 sync                          |
| `destructive.grant-required` | 需要 maintenance token                | 不 sync                          |
| `auth.expired`               | 过期后再用同一 auth                   | 不 sync；不自动续期              |
| `auth.mismatch`              | sqliteInstance / fingerprint 对不上   | 不 sync；fail-closed             |

denied / unknown：**零 sync**（§7.1.1–7.1.4）。

---

## 5. 与 CQ-O0 生产证据的衔接

生产 22 个 agent 全部 `authority.unknown`。因此若今天按本契约实现，**search 不得再触发 sync**，直到 fingerprint 经独立、已授权的登记流程写入。O1a 实现不得把「search 时顺便注册 fingerprint」当作 acquire 成功路径。

storage `missing`（17/22）与 `ready`（5/22）都不改变上述规则：missing 时没有合法 sqliteInstance 可绑定，acquire 仍应 `authority.unknown` 或等价 fail-closed，不得创建主库。

---

## 6. §7.1.4 十场景矩阵 — CI 计划（已批准）

实现阶段新增 `src/memory/manager-search-operation-boundary.test.ts`（名称可调整）。**#500 已批准本表纳入 CI。**

| ID  | 前置                                        | onSearch | 期望                               |
| --- | ------------------------------------------- | -------- | ---------------------------------- |
| S1  | dirty=false                                 | true     | 不调用 acquire / sync              |
| S2  | dirty=true，fingerprint 已登记，guard allow | true     | leader acquire sync；一次 sync     |
| S3  | 同 S2，第二次并发 search                    | true     | follower await；acquire 次数 = 1   |
| S4  | `authority.unknown`（无 fingerprint）       | true     | acquire 失败；sync 次数 = 0        |
| S5  | `topology.multiple`                         | true     | acquire 失败；sync 次数 = 0        |
| S6  | `destructive.denied`                        | true     | acquire 失败；sync 次数 = 0        |
| S7  | `destructive.grant-required`                | true     | acquire 失败；sync 次数 = 0        |
| S8  | search 传入 force/rebuild/reset             | true     | 拒绝；不 begin 这些 op             |
| S9  | acquire 成功后超过 expiresAt                | true     | 后续 assert 失败；不自动再 acquire |
| S10 | `manager.status()` / health probe           | n/a      | 不读 env grant；不 create auth     |

\#500 批准本设计即同时批准将上表纳入 CI。§7.1.5「矩阵纳入 CI」已由 #506 勾选（`src/memory/manager-search-operation-boundary.test.ts`）。

---

## 7. 非目标

- 不改 UI / Resolver / schema v2 / Catalog；`manager.ts` 仅允许 onSearch 改走 `acquireSyncAuth`
- 不改 UI
- 不批量 reindex、不写 Catalog、不切 Resolver
- 不把 CQ-O1b / CQ-A2 纳入本评审
- 不在本文件把 `deployAuthorized` 设为 true

---

## 8. 评审结论栏

| 项                | 值                                                                     |
| ----------------- | ---------------------------------------------------------------------- |
| 评审状态          | **Approved**（#500，`90bb375045c72d1cfa3061afde255d25a06af955`）       |
| 实现状态          | **Complete**（#506，`6c20a36170f76c4bc34e27e34b01ef9d7372618e`）       |
| Approved 后已完成 | `acquireSyncAuth` + S1–S10 + onSearch → `scheduleAuthorizedSearchSync` |
| 拒绝时            | 不再适用                                                               |

---

## 9. 修订

| 版本          | 日期       | 说明                                                               |
| ------------- | ---------- | ------------------------------------------------------------------ |
| draft.1       | 2026-08-19 | 按 §7.1.6 首次提交评审；纳入 CQ-O0 生产结论与 S1–S10 CI 计划       |
| approved.1    | 2026-08-19 | #500 合入；设计 Approved；授权独立实现 PR                          |
| implemented.1 | 2026-08-19 | #506 合入；builtin search 已走 `acquireSyncAuth`；本文件不再待实现 |
