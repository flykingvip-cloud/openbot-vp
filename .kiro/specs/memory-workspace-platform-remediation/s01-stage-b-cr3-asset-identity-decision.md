# S01 Stage B CR3: Plan A asset-identity decision

- **Owner**: `cursor-data-governance`
- **Task**: `memory-workspace-platform-remediation:cursor-data-governance-s01-stage-b-shadow`
- **日期**: 2026-08-31
- **基线**: `origin/main` `20896115d6de6350f271c71b096d25ded0754410`（#851 CR1 merged; #857 CR2 merged; #858 Stage C CR2 observation on main）
- **selfAccepted**: `false`
- **decision**: `plan-a-position-asset`
- **decisionStatus**: `proposed`
- **authorizesCr3Implementation**: `false`
- **申请**: S01 Stage B CR3 Plan A asset-identity decision Review

这不是 CR3 实现，不是 Stage B Implementation Accept，不是 Stage C Accept，不是 Stage D cutover，不是 LIVE。

## 要关闭的矛盾

Stage B identity 链要求 managed asset identity：

`tenant → steward slug → unique agentAssetId → Catalog workspace → canonical binding → fencing`

CR2（#857）生产 Registry wrap 仍执行另一条 ADR：builtin steward `main` 是 universal builtin，**永远没有** enterprise `agentAssetId`。`createProductionS01StewardRegistryPort` 在 `agentAssetId === agentId` 或无法 resolve 时返回 `null`。identity 诚实落到 `catalog_miss`。

不得继续保持「要求 managed asset identity，但又规定 `main` 永远没有 assetId」。

## 方案 A（本包提议，尚未独立接受）

builtin steward 是**岗位资产**：

- 每个企业 / 岗位拥有稳定 `agentAssetId`（不等于 steward slug `main`，不等于 `agentId`）
- Registry 通过 **tenant + steward slug**（`S01_STEWARD_SLUG = "main"`）从权威 Agent Registry 精确解析该 `agentAssetId`
- workspace 使用 **position-owned** 或 **user-owned** canonical binding：
  - 岗位优先：`ws:{tenantId}:seat:{seatId}:asset:{agentAssetId}`
  - 也可 user-owned：`ws:{tenantId}:user:{employeeOwnerId}:asset:{agentAssetId}`
- `agentId` 不得冒充 `agentAssetId`
- fencing 必须来自所解析 canonical binding
- 本包不发明具体生产 asset id 字符串，不写 Registry / Catalog，不改 `src/`

## 方案 B（明确不采用）

builtin steward 只属于 personal-local：S01 不进入 managed enterprise cutover；恢复既有 personal-local residual acceptance；停止为 S01 构造企业 Catalog shadow；managed cwd 继续走现有 C17 authorized resolver。

仅当产品确认 steward **永远不是**企业资产时才必须采用方案 B。本包不采用。

## 本包不实施的 CR3（待方案 A 被独立接受）

独立接受之后的 CR3 才允许：

- 从权威 Agent Registry 读取稳定 `agentAssetId`
- 禁止 `agentId` 直接冒充 `agentAssetId`
- 不允许 always-success adapter
- 将服务端 session identity 传入 shadow
- 从现有 PlatformAuth SoT 加载 membership
- principal 必须由 verified server session 签发
- fencing 必须来自所解析 canonical binding
- wire 不得写 tenant / user / resource / fencing 字段

生产入口届时必须能产生：`identity_and_authorization_match`、`catalog_miss`、`tenant_mismatch`、`fencing_stale`、`fail_closed_missing_authorization`、`authorization_denied`。本包不产生这些收据。

## 锁

- `get-reply.ts:164` 仍是 `resolveEmployeeBuiltinStewardWorkspaceDir`
- flag 默认 off；helper 仍决定 cwd
- scan `remaining=10` / `liveWriteWatchIndex=10`；P5 仍在
- `implementationVerified=false`；`deployAuthorized=false`；LIVE forbidden
- Stage C 仍 `prepared-not-accepted`
- 不删除 P5；不改 scan；不切 C1-C5 / S33-S35 生产；不 Phase 1B unlock
