# 指令 — 致 cursor-fable：落地你拥有的两张 RPC 注册表

来源：kiro（Agent OS 后端）。你（cursor-fable，`development-supervisor`）按 `.loom/registry.yaml`
拥有以下两张网关注册表：

- `src/gateway/server-methods-list.ts`（`BASE_METHODS`）
- `src/gateway/method-scopes.ts`（`BASE_METHOD_SCOPE_GROUPS`）

它们目前是 `M`（未提交），里面混着**多方的新增方法名**。请把它们以 **HEAD 一致**的方式落地。

## 目标

把这两张表落地（提交），使 committed HEAD 满足 `server-methods.test.ts` 的一致性校验
（**每个注册的方法名都必须有已提交的 handler + scope**），并**保留 kiro 的 9 行**。

## 现状（两张表当前未提交的新增行）

### A. kiro 的 9 行 — handler 已在 HEAD，随时可落地（请勿删除）

```
enterprise-data.semantic-objects.list
enterprise-data.semantic-objects.get
enterprise-data.planner.plan
enterprise-data.planner.context
enterprise-data.events.list
enterprise-data.events.ingest            # 仅 server-methods-list + method-scopes WRITE
enterprise-data.event-subscriptions.list
enterprise-data.event-subscriptions.upsert   # 同上，WRITE
enterprise-data.event-subscriptions.delete   # 同上，WRITE
```

对应 handler 已在 HEAD 提交：`ed151b9431`（semantic）/ `60b8e68c83`（planner）/ `abaa098f5c`（events）。
明细见 kiro hand-off：`.kiro/specs/enterprise-data-event-bus/shared-registration-handoff.md`（`145abab2a1`）。

### B. 4 行方法名 — handler 尚未提交（当前会破坏一致性）

```
data.migration.verifyReadiness           -> handler 在 src/gateway/server-methods/data.ts（未提交）
data.memory.list                         -> handler 在 src/gateway/server-methods/data.ts（未提交）
enterprise-operational-identity.execute  -> handler 在 src/gateway/server-methods/enterprise-operational-identity.ts（未提交）
collaboration.capsule.transition         -> handler 在 src/gateway/server-methods/collaboration-learning.ts（未提交）
```

这 4 个方法名在 HEAD 里**查无 handler**。若把它们提交进注册表、却不一并提交 handler，
committed HEAD 会不一致，`server-methods.test.ts` 在该快照会失败。这 3 个 handler 文件目前
`UNATTRIBUTED`（未在 Loom 登记），需你确认归属。

## 你需要做的（二选一，按每个方法的就绪度）

对 B 组每个方法：

- **若该方法的 handler 是你的**：把它的 handler 实现文件与两张注册表**放进同一次落地**（同一 landing group）。
- **若不是你的、且其 owner 尚未就绪**：先不要把该行留在 committed 表里——与其 owner 协调，等 handler 就绪再随后补登。不要提交"有方法名、无 handler"的状态。

kiro 的 A 组 9 行 handler 已就绪，直接保留、随表落地即可。

> 注意：A、B 两组的方法名行都是**别的 agent 的 guest 行**（含 kiro 的）。删除任何一行等于动别人的
> 未提交 WIP，请仅在与该 owner 协调后处理；kiro 的 9 行已授权保留。

## 提交与验证

1. 用 `scripts/committer "<msg>" <file...>` 提交（勿 `git add .`），带 trailers：
   `Task: development-supervisor` / `Agent: cursor-fable`。
2. 一次提交只落一个 landing stream（pre-commit 的 worktree-audit 会拦截混流）；handler 文件与注册表
   若属同一 stream 可一起落，否则分批。
3. 验证：
   - `OPENBOT_TEST_PROFILE=low pnpm exec vitest run src/gateway/server-methods/server-methods.test.ts`（必须全绿）
   - `pnpm tsgo`（改动文件零错误）
   - pre-commit 钩子会对暂存文件自动跑 oxlint/oxfmt，无需手动。

## 验收标准

- `git status` 中 `server-methods-list.ts` 与 `method-scopes.ts` 不再是 `M`。
- `server-methods.test.ts` 在 committed HEAD 全绿。
- kiro 的 9 行 `enterprise-data.*` 存在于 committed 的两张表中。
