# 交接指令：落地 `data.migration.verifyReadiness` RPC（注册切片随你们的提交带上）

> **发起 agent**：`kiro`（工作流 `saas-tenant-data-architecture` / P1）
> **收件**：`cursor-fable`（owns `server-methods-list.ts` / `method-scopes.ts`）、`cursor-data-directory`（owns `memory-lifecycle.ts`，提交 `server-methods/data.ts` 落 `data.memory.list`）
> **日期**：2026-07-11
> **优先级**：低（引擎与 CLI 已可用；本 RPC 只是程序化/UI 便利层，不阻塞归集）

---

## 1. 背景

`verify-migration-readiness`（P1 归集就绪检查）的**引擎**（`src/data/migration-readiness.ts`）与 **CLI**（`register.data.ts` 的 `data verify-migration-readiness`，含 `--fail-on-legacy-workspace` 退出码 1）都已可用。缺的只是 **RPC dispatch 接线** `data.migration.verifyReadiness`——它的 handler + 方法列表 + scope 分散在**你们正在编辑的共享文件**里，与你们的 WIP（`data.memory.list` 等）交织，我无法只提交自己的行而不带上你们的 WIP。

**一致性约束**：handler、方法列表、scope 三者必须**同批落地**，否则 `server-methods.test.ts`（list ↔ handlers ↔ scopes 一致性）会红。所有相关行**已在工作树**，你们提交对应文件时带上即可，**请勿回退**。

## 2. 分工（各自提交自己文件时带上我的行）

### `cursor-fable`

**`src/gateway/server-methods-list.ts`** — 保留这行（已在工作树）：

```ts
"data.migration.verifyReadiness",
```

**`src/gateway/method-scopes.ts`** — 保留 **READ scope 组**内这行（已在工作树，`method-scopes.ts:342`，紧邻你们的 `data.memory.list` / 我已合入的 `platform.tenant.import.preflight|status`）：

```ts
"data.migration.verifyReadiness",
```

### `cursor-data-directory`（提交 `server-methods/data.ts` 落 `data.memory.list` 时）

**`src/gateway/server-methods/data.ts`** — 保留我的 import 与 handler（已在工作树，紧挨你们的 `data.memory.list` handler）：

```ts
import { evaluateMigrationReadiness } from "../../data/migration-readiness.js";
// …handlers 内：
"data.migration.verifyReadiness": async ({ params, respond }) => {
  if (rejectWhenManaged("data.migration.verifyReadiness", respond)) {
    return;
  }
  // Local Data Space collection preflight (SaaS §8.2).
  const report = evaluateMigrationReadiness({
    cfg: loadConfig(),
    options: {
      checkPaths: params.checkPaths !== false,
      checkAgentsConfig: params.checkAgentsConfig !== false,
      failOnLegacyWorkspace: params.failOnLegacyWorkspace === true,
    },
  });
  respond(true, report);
},
```

**`src/gateway/server-methods/data.test.ts`** — 保留我的 2 条测试（已在工作树）：

```ts
it("rejects data.migration.verifyReadiness on managed gateway", …)
it("returns a migration readiness report in local mode", …)
```

## 3. 落地顺序（同一窗口）

一致性要求三者同批，建议一个短窗口内：

1. `cursor-data-directory` 提交 `server-methods/data.ts` + `data.test.ts`（带上我的 handler / import / 2 测试 + 你们的 `data.memory.list`）。
2. `cursor-fable` 提交 `server-methods-list.ts` + `method-scopes.ts`（带上我的 `data.migration.verifyReadiness` 行 + 你们的 WIP）。

（谁先谁后不影响一致性测试的最终结果，只要两步落在同一批、且中间不单独跑 `server-methods.test.ts`。）

## 4. 验证（两步都落后）

```ts
OPENBOT_TEST_PROFILE=low pnpm test --run \
  src/gateway/server-methods/data.test.ts \
  src/gateway/server-methods.test.ts
```

验收：`data.migration.verifyReadiness` 可 dispatch，list/handlers/scopes 一致性通过；managed 模式返回 `LOCAL_ONLY`；local 模式返回就绪报告。各提交带你们自己的 `Agent:` trailer 即可（handler/注册行归属仍是 `saas-tenant-data-architecture:kiro`，git trailer 记落地者）。

## 5. 备注

- **CLI 面 `src/cli/program/register.data.ts`（全为 kiro 的 P1 verify + P2 export/restore，无 task 归属）不在本次协调内**——它独立于 RPC dispatch（CLI 直接调引擎），kiro 会单独落（或按需）。
- 本 RPC 是便利层：CLI + 引擎已可用，若窗口难凑，可继续搁置，不阻塞任何归集/迁移流程。

有疑问回我。
