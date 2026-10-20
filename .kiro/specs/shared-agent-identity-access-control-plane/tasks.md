# Implementation Plan: Shared Agent Identity and Access Control Plane

## Overview

本计划执行 Growth 云化 Phase -1。用户已授权启动本地、可回滚实现；专家签署、生产数据库、云资源和多实例仍保持 `BLOCKED`。

## Agents

- `kiro-growth-pipeline` · role: owner · scope: active membership、权威 Gateway 企业上下文、Agent identity/access control plane · paths: `.kiro/specs/shared-agent-identity-access-control-plane/**`, `src/gateway/platform-auth/store-types.ts`, `src/gateway/platform-auth/memberships.ts`, `src/gateway/platform-auth/active-membership*.ts`, `src/gateway/platform-auth/session-context.ts`, `src/gateway/platform-auth/auth-helpers.ts`, `src/gateway/server-methods/types.ts`, `src/gateway/server/ws-connection/message-handler.ts`, `src/gateway/platform-auth/routes-auth.ts`, `src/gateway/platform-auth/routes-login-password.ts`, `src/gateway/platform-auth/routes-enterprise.ts`, `src/gateway/platform-auth/routes-employee-register.ts`, `src/gateway/platform-auth/routes-employee.ts`, `src/gateway/native-bootstrap-http.ts`, `src/gateway/native-bootstrap-http.test.ts`, `src/gateway/employee-shell/bootstrap-token-store.ts`, `src/gateway/employee-shell/bootstrap-token-store.test.ts` · since: 2026-07-30

## Constraints

- 禁止 first-match membership 作为请求授权依据。
- 客户端 tenant/owner 只表达意图。
- 一期 owner 仅 membership、seat。
- 不修改 `auth.mode=token`/device token 语义。
- 不创建数据库、云资源或多实例写能力。
- 避开其他代理正在修改的 `session-domain.ts`、`platform-auth.test.ts`。
- `routes-employee.ts` 已完成 verified takeover 并通过 Loom 注册到本任务；只在该路径内处理 membership revoke。— kiro-growth-pipeline
- `src/gateway/billing/**` 由 enterprise-ai-model-governance 活跃任务持有；本规格只定义消费契约，待 owner 协调后接入。
- `src/gateway/server/ws-types.ts` 原为 UNATTRIBUTED（仅出现在 landingStreams 审计规则中，无 ownership 任务声明），已按协议用 `loom claim` 签入本任务后才修改。— kiro-growth-pipeline
- WebSocket 传播按 verify-then-take 执行：前任 `platform-pricing-gateway-instability:codex-pricing-incident` 的相关任务项已勾选完成并随 `af1687992f` 落地、无注册 session、该文件无未提交 WIP，因此本任务为该路径唯一在场执行者；Registry 的 overlap 仍需其 owner 终态化。— kiro-growth-pipeline
- 2026-07-30 ownership/consumer audit：`src/gateway/server/ws-connection/message-handler.ts` 同时被本任务与 `platform-pricing-gateway-instability:codex-pricing-incident` 的活跃 claim 覆盖；后者任务文本虽均已勾选完成、无注册 session，Registry 仍未终态化。`src/gateway/billing/**` 则被 `enterprise-ai-model-governance:codex-production-release` 的活跃广域 claim 覆盖，其已登记 session 均为 dead 且任务仍有未完成阶段。Loom 仅支持 additive register/accept/claim，不能安全释放或转移单一路径；不得手改共享 `.loom/registry.yaml`。两个 runtime consumer 均等待 Registry owner 的显式路径归属收口。
- consumer audit 还确认 `src/gateway/enterprise-data/enterprise-data-seat-context.ts` 的 execution-context 路径独立调用 `findMembershipByUserId`；它不属于本次 Billing path，必须在统一 ACL/consumer migration 中按权威 pair 单独迁移，不能因 Billing 完成而宣称已消除全部 request-time first-match。

## Tasks

- [x] 0. 建立实施规格与 Loom 归属 — kiro-growth-pipeline
  - [x] 0.1 建立 requirements、design、tasks — kiro-growth-pipeline
  - [x] 0.2 注册 owner、session 与精确路径 — kiro-growth-pipeline
  - _Requirements: all_

> 验收状态（2026-07-31）：**整体 BLOCKED，安全验收未通过。** 本规格内已完成的条目仅表示
> “现有定向回归通过”，不代表 Phase -1 退出门通过。任务 3、4、5 与 Phase 1-4 仍未实现。

- [-] 1. Active membership 本地权威会话切片
  - [x] 1.1 新增严格 membership helper — kiro-growth-pipeline
    - 已增加按 user 列表、按 membership ID + user 精确解析、唯一 legacy membership 解析。
    - 旧 helper 仅供尚未迁移的管理路径；禁止新增 request consumer。
    - _Requirements: 1, 2, 6_
  - [x] 1.2 扩展 session record 与 trusted context — kiro-growth-pipeline
    - enterprise/employee session 持久化成对的 `membershipId + enterpriseId`；platform session 明确保持无 binding。
    - trusted context 仅在成功验证 exact pair 后暴露权威字段，store normalization 仍兼容 legacy record。
    - _Requirements: 1, 2, 6_
  - [x] 1.3 session 读取时重新验证 binding — kiro-growth-pipeline
    - user、membership、enterprise、domain/session kind 与生命周期必须一致；partial、无效或多 membership legacy binding fail closed。
    - membership 被删除或 enterprise 不可用时不回退到另一条 membership。
    - _Requirements: 2, 3_
  - [x] 1.4 向 GatewayClient 传播权威字段 — kiro-growth-pipeline
    - [x] 已定义 `sessionMembershipId/sessionEnterpriseId`，并保留 `sessionTenantId` 为 hint。— kiro-growth-pipeline
    - [x] WebSocket 握手改为按整块 identity 写入：`resolveClientSessionIdentity` 从已验证 session 一次性产出 `user`、`sessionDomain`、权威 pair 与 tenant hint，`GatewayWsClient` 同步声明该 pair。— kiro-growth-pipeline
      - fail-closed：仅单侧、空白或 unbound platform session 一律不产出 pair；tenant hint 不能伪造权威上下文，也不能覆盖已验证 pair。
      - 该 pair 目前仍无运行时消费者（Billing 见 1.5），因此本项验收为 helper 单元回归 + 类型/构建接入，不含端到端行为证据。
    - _Requirements: 4_
  - [x] 1.5 Billing 迁移为首个消费者 — kiro-growth-pipeline
    - [x] 权威 binding 优先；requested tenant 只校验 equality。— kiro-growth-pipeline
      - 权威判定收敛到本任务拥有的 `active-membership-scope.ts`：精确 pair 每次读取都重验 `membershipId → user` 与 `enterpriseId` 一致性；无 pair 时只接受唯一 membership。
      - `scope.ts` 仅做最小委托，不再调用 `findMembershipByUserId`。
    - [x] 有登录用户但上下文无效或歧义时 fail closed，不得降级为本地管理员。— kiro-growth-pipeline
      - 多 membership 无权威选择、pair 半绑定、pair 指向他人 membership、pair 与企业不一致、requested tenant 不匹配：全部返回空作用域。
      - 用户被暂停、企业 suspended/expired 或企业记录缺失：请求时即 fail closed（2026-07-31 P0-1 修复）。
    - [x] 回退仅限「无任何身份声明的本地调用」或「已验证平台运营者」；未知 trusted-proxy 身份与普通无 membership 账号一律拒绝（2026-07-31 P0-1 修复）。— kiro-growth-pipeline
    - `src/gateway/billing/**` 仍在 enterprise-ai-model-governance 的 registry glob 内；本次仅改 `scope.ts` 与 `scope.fallback.test.ts`，两者均不在该任务 spec `## Agents` 声明的 billing 范围（其只声明 `src/gateway/billing/usage-ledger-store.ts`），且改动前无未提交 WIP。
    - _Requirements: 5, 6_
  - [x] 1.6 定向测试与兼容验证 — kiro-growth-pipeline
    - strict helper、persisted/revoked binding、legacy unique/ambiguous、login/switch rotation、native bootstrap、activation issuer 与 member-removal multi-membership 覆盖通过。
    - WebSocket propagation 与 Billing consumer 仍分别受 1.4、1.5 的共享路径 blocker 限制。
    - _Requirements: 1, 2, 3, 4, 5, 6_
  - [x] 1.7 Checkpoint：多 membership 不再由 Billing first-match 选企业 — kiro-growth-pipeline
    - `scope.fallback.test.ts` 以「`001` 先于 `aegis` 存放」的多 membership store 复现 first-match 选错租户，迁移后该路径 fail closed。
    - 仍未迁移：`src/gateway/enterprise-data/enterprise-data-seat-context.ts` 的 `resolveTrustedEnterpriseDataExecutionContext` 与 `resolveTrustedSessionEmployeeId` 各自直接解析平台用户/membership，属任务 5.4 范围，不在本 checkpoint 内。

- [x] 2. Active membership 选择与切换 — kiro-growth-pipeline
  - [x] 2.1 冻结 login/switch 请求契约与通用错误码 — kiro-growth-pipeline
    - `membershipId` 是精确选择；`tenantId` 仅为 equality constraint；多 membership 且无选择返回 `PLATFORM_AUTH_MEMBERSHIP_SELECTION_REQUIRED`。
  - [x] 2.2 新 session 强制持久化 binding — kiro-growth-pipeline
    - login、password rotation、enterprise-admin activation 与 employee activation 都从已验证 membership 建立 scoped session。
  - [x] 2.3 实现 enterprise switch 安全审计与 session rotation — kiro-growth-pipeline
    - switch 验证 cookie HMAC 和 exact membership，删除旧 session、签发新 cookie 并写入审计事件。
  - [x] 2.4 实现 membership revoke/session invalidation — kiro-growth-pipeline
    - 经 verified takeover 后，member removal 按 acting enterprise 使用唯一、精确的 target membership 选择，拒绝 object-order first match。
    - 删除 membership 后保留 target 的有效其他 enterprise pair；被撤销 pair、partial binding、旧式 employee binding 均失效，只有权威 resolver 认定的旧式 platform session 可保留。
    - 最后一个非 platform membership 保持 suspend + 全局 session invalidation；actor reply 以原已验证 `enterprise-admin` membership 重建并显式处理失效 context。
    - 已记录 fail-before `404`/预期 `200` 与 pass-after HTTP regression。— kiro-growth-pipeline
  - [x] 2.5 Checkpoint：两个 enterprise 来回切换且不会串租户 — kiro-growth-pipeline
    - login/switch/activation 测试验证 exact pair 在新增第二 membership 后仍固定到签发企业。
  - _Requirements: 1, 2, 3_

- [x] 3. Agent terminology ADR and Registry — kiro-growth-pipeline
  - [x] 3.1 冻结 Definition、Asset、Deployment、Revision 术语 — kiro-growth-pipeline
    - ADR：`docs/design/agent-registry-unified-acl-adr-2026-07-31.md`；`AgentAsset` 为 ownership 与 Growth 的唯一 canonical 主体。
  - [x] 3.2 决定既有 AgentInstance 保留或迁移 — kiro-growth-pipeline
    - 裁决为 deprecated legacy alias，只能映射到 `AgentDeployment`，禁止表示资产。
  - [x] 3.3 建立 enterprise-local alias 与 legacy resolver 契约 — kiro-growth-pipeline
    - `AgentRef = (enterpriseId, agentAssetId)`；`agentSlug` 企业内唯一且仅为别名，不作授权输入；resolver 只接受精确 `legacyAgentId`。
  - [x] 3.4 建立 ambiguity quarantine — kiro-growth-pipeline
    - 三态结果 resolved/not-found/ambiguous；歧义进入 quarantine 且同一 legacy id 复用未结条目。
  - _Requirements: 7_

- [-] 4. Ownership and unified ACL
  - [x] 4.1 membership-owned 与 seat-owned binding/history — kiro-growth-pipeline
    - 每资产恰好一个 open primary binding；变更关闭旧行并保留历史；多 open binding 视为数据缺陷并 fail closed；禁止跨企业转移。
  - [x] 4.2 裁决并实施 EnterpriseAccessPolicy extension/replacement — kiro-growth-pipeline
    - 裁决：同一控制面内 `EnterpriseAccessPolicyV2` 版本化替换 + v1 migration adapter，单一 authoritative policy set。
  - [x] 4.3 membership、seat、service principal actor — kiro-growth-pipeline
    - v1 的 `employee`（user 作用域）不再是主体；service principal 与 `onBehalfOfMembershipId` 取权限交集，禁止 union 扩权，且不继承 owner baseline。
  - [x] 4.4 permission、deny、条件和审计 — kiro-growth-pipeline
    - 冻结 10 项权限；default deny、explicit deny wins、enterprise 不一致硬拒绝、inactive subject/asset fail closed、未知 condition 整体 fail closed；owner baseline 物化为可审计派生 policy。
  - [-] 4.5 将 evaluator 接入运行时 handler 与审计写入 — kiro-growth-pipeline
    - [x] 审计落盘位置已定：`CONFIG_DIR/audit/access-control-decisions.jsonl`（高频、短保留）与 `CONFIG_DIR/audit/access-control-governance.jsonl`（policy/ownership/correction/repair/export，长保留），沿用 `platform-auth/login-audit.ts` 的 JSONL + 0o600/0o700 + best-effort 约定，只记录标识符。
    - [x] `authorizeAgentAssetAccess` 默认 `shadow` 模式：Registry 为空且 v1 未迁移时强制会全量拒绝，故先记录「若强制会如何」，`OPENBOT_ACCESS_CONTROL_MODE=enforce` 才返回 evaluator 判定。审计写失败不改变判定结果。
    - [x] 首个接入点为 `agents.create`（见 5.1），写入 asset/ownership 治理审计并执行 shadow 判定。
    - [ ] 其余读写 handler 尚未接入；`enforce` 模式尚未在任何租户启用（需先完成 v1 policy 迁移与 Registry 回填）。
  - _Requirements: 7, 8_

- [-] 5. Consumer migration
  - [x] 5.1 Agent create 服务端 tenant/owner 解析 — kiro-growth-pipeline
    - `agents.create` 不再采信请求体的 tenant/owner：tenant 取自已验证会话，requested tenant 仅做等值校验，audit actor 必须是调用者本人，企业 Agent 必须指明 owning seat，无权威企业的调用者不得请求 tenant。
    - 成功创建后写入 canonical `AgentAsset`、绑定 seat 为唯一 primary owner，并记录 asset/ownership 治理审计与一次 shadow 判定。
    - 新增 `agent-registry/store.ts` 持久化（temp + rename 原子写；读失败降级为空 store 以便授权路径仍能 fail closed）。
  - [ ] 5.2 entitlement 使用统一上下文（未开始）
  - [ ] 5.3 Growth 使用 AgentAccessContext（受 Growth boundary 阻塞）
  - [-] 5.4 清理请求授权中的 first-membership 调用 — kiro-growth-pipeline
    - 已迁移请求时路径（改用权威 pair，歧义/暂停即 fail closed）：`knowledge/context.ts`、`employee-workbench-scope.ts`、`enterprise-data/enterprise-data-seat-context.ts`、`server-methods/employee-capability.ts`（3 处）、`server-methods/enterprise-capability.ts`（2 处）。
    - 已迁移无会话归属路径（改用唯一 membership，歧义返回空）：`agent-tenant.ts`、`runtime-binding-sync.ts`、`user-operational-identity-governance.ts`、`user-operational-identity-enterprise-authorization.ts`。
    - [ ] 剩余：`src/gateway/enterprise-seat-assets.ts:295` 与 `:327`。该文件带其他代理未提交的 WIP（含尚未实现的 `revokePendingEmployeeProvisionsForSeat`），按多代理规则 2 未触碰，需由其 owner 迁移。
  - _Requirements: 2, 4, 5, 8_

- [-] 6. Phase -1 exit gate
  - [x] 6.0 本地 active-membership 验收证据已记录。— kiro-growth-pipeline
  - [ ] 6.1 多企业、多 Agent 租户隔离证据
  - [ ] 6.2 tenant/owner 篡改拒绝证据
  - [x] 6.3 revoke 和 session invalidation 本地证据 — kiro-growth-pipeline
  - [ ] 6.4 Security、Platform Architecture 书面批准
  - [x] 6.5 PostgreSQL Growth 继续 `BLOCKED`：Identity/Registry/ACL、Growth boundary、Security/Data/SRE 批准、SLO/RPO/RTO/retention 和跨实例权威性均未满足。— kiro-growth-pipeline

## Local acceptance evidence — 2026-07-30

- `OPENBOT_TEST_PROFILE=low OPENBOT_TEST_SERIAL_GATEWAY=1 pnpm test "src/gateway/platform-auth/active-membership.test.ts" "src/gateway/platform-auth/active-membership-session.test.ts" "src/gateway/platform-auth.test.ts" "src/gateway/native-bootstrap-http.test.ts" "src/gateway/employee-shell/bootstrap-token-store.test.ts"` passed: 5 files, 54 tests.
- `active-membership-session.test.ts` first reproduced the member-removal defect: a target with enterprise B inserted before enterprise A returned `404` where the route must return `200`; after the exact-selection fix, the same HTTP route regression passes.
- The member-removal regression proves A-only deletion, B scoped-session preservation, revocation of legacy employee and both partial bindings, preservation of a resolver-valid legacy platform session, actor response binding, provision revocation, seat decrement, and final non-platform membership suspension/global session invalidation.
- active-membership-session exercises real enterprise-admin and employee activation routes, then adds a second membership and proves the persisted session still resolves only to its issued membership/enterprise pair.
- Two focused semantic reviews found no actionable issue: exact binding persists and fails closed, login/switch rotates securely, activation uses its newly created membership, native bootstrap revalidates the same pair, and member removal now follows the authoritative session resolver. — kiro-growth-pipeline
- `pnpm exec oxfmt --check` and `pnpm exec oxlint` passed for all 16 owned Phase -1 files; scoped `git diff --check` passed; language diagnostics are empty for those files.
- 2026-07-30 follow-up regression: `OPENBOT_TEST_PROFILE=low OPENBOT_TEST_SERIAL_GATEWAY=1 pnpm test "src/gateway/platform-auth/active-membership.test.ts" "src/gateway/platform-auth/active-membership-session.test.ts" "src/gateway/platform-auth.test.ts" "src/gateway/native-bootstrap-http.test.ts" "src/gateway/employee-shell/bootstrap-token-store.test.ts" "src/gateway/auth.platform-identity.test.ts"` passed: 6 files, 57 tests. This is evidence for the completed strict session/auth slice only; it does not exercise the still-blocked WebSocket client-field propagation or Billing fail-closed consumer migration. — kiro-growth-pipeline
- Direct Loom lint still reports the active ownership overlap between `platform-pricing-gateway-instability:codex-pricing-incident` and this task for `src/gateway/server/ws-connection/message-handler.ts`. — kiro-growth-pipeline
- Full `pnpm tsgo` still reports 67 errors in 23 shared-tree files. Neither `message-handler.ts` nor `billing/scope.ts` appears in the reported file list, but the full repository check remains a release blocker and cannot substitute for the unimplemented consumer behavior. — kiro-growth-pipeline

### WebSocket authoritative propagation (task 1.4)

- `OPENBOT_TEST_PROFILE=low OPENBOT_TEST_SERIAL_GATEWAY=1 pnpm test "src/gateway/platform-auth/active-membership.test.ts" "src/gateway/platform-auth/active-membership-session.test.ts" "src/gateway/platform-auth/active-membership-client-context.test.ts" "src/gateway/platform-auth.test.ts" "src/gateway/native-bootstrap-http.test.ts" "src/gateway/employee-shell/bootstrap-token-store.test.ts" "src/gateway/auth.platform-identity.test.ts" "src/gateway/server/ws-connection/connect-policy.test.ts" "src/gateway/server/ws-connection/auth-messages.test.ts" "src/gateway/server.canvas-auth.test.ts"` passed: 10 files, 82 tests. — kiro-growth-pipeline
- `active-membership-client-context.test.ts` (12 tests) covers pair propagation, partial-pair fail-closed, unbound platform session, tenant-hint-only, blank/trimmed values, hint-cannot-overwrite-pair, and the no-session case.
- `pnpm build` succeeded; the only `[INEFFECTIVE_DYNAMIC_IMPORT]` warnings are the pre-existing `user-operational-identity-xiaohongshu-connector.ts` ones, unrelated to this change.
- `pnpm exec oxfmt --check` and `pnpm exec oxlint` passed for the 4 touched files; language diagnostics are empty for all of them.
- Scope limit at the time of 1.4: the pair had no runtime consumer yet, so that slice alone carried no observable behavior change. Billing (1.5) is now that consumer. — kiro-growth-pipeline
- Pre-existing shared-tree failure, not caused by this change: `src/gateway/gateway-misc.test.ts > returns 404 for missing static asset paths instead of SPA fallback` expects `404` but gets `200`. Verified against committed `HEAD`, where `resolveControlUiRelativePath` already maps `/webchat/favicon.svg` to the root `favicon.svg`; none of the touched files is in that import path. — kiro-growth-pipeline

## Blocking and deployment state

- No commit, cloud resource, PostgreSQL schema, migration, multi-Gateway writer, or production deployment has been created by this task.
- Commit/deployment remains blocked until WebSocket propagation and Billing consumer work are accepted, Identity/Registry/ACL and Growth boundary work is complete, required Security/Platform Architecture/Data/SRE approvals are recorded, all shared-tree validation failures are resolved, and the operator gives final explicit production confirmation. — kiro-growth-pipeline

### Review verdict 2026-07-31: acceptance REJECTED, whole plan stays BLOCKED

- Reviewer rejected the "final plan complete" claim. The active-membership/session/Billing slice may only be recorded as "existing regressions pass, security acceptance not passed".
- No merge/release, production database, cloud Growth write path, or multi-Gateway writer expansion is permitted.

#### P0-1 request-time privilege escalation — fixed in this pass

- Fail-before evidence (12 failing assertions before the fix, same commands as below):
  - `resolveAuthoritativeEnterpriseScope` returned `kind: "authoritative"` for a suspended user and for a suspended / expired / missing enterprise;
  - Billing granted `001` enterprise-admin-equivalent scope to an unknown claimed trusted-proxy identity and to a recognized plain account with no membership.
- Fix: request-time revalidation now denies `user-inactive` and `enterprise-unavailable` on both the exact-pair and the legacy unique-membership path, matching the checks the session reader already performed. Suspension/freezing therefore takes effect on the next request instead of at next login.
- Fix: the local-operator fallback is now gated. `no-platform-identity` is split by `claimedIdentity`, so only a caller presenting no identity at all may fall back; `no-enterprise-membership` carries `isPlatformOperator`, so only a verified platform admin / super-admin keeps the requested-tenant operator path. Plain and self-created accounts fail closed.
- Pass-after: `src/gateway/platform-auth/active-membership-scope.test.ts` (16 tests) and `src/gateway/billing/scope.fallback.test.ts` (15 tests) pass, plus 10 files / 104 tests and 12 files / 114 tests of consumer regressions.
- Not claimed: this closes P0-1 only. P0-2 (Registry/ownership/ACL/consumer migration), P0-3 (Growth Application Boundary) and P0-4 (PostgreSQL/migration/multi-instance) remain unimplemented, so Phase -1 through Phase 4 stay `BLOCKED`. — kiro-growth-pipeline

#### Remaining blockers not addressable by this task

- Repo-wide `findMembershipByUserId` request paths still exist (`employee-capability.ts`, `enterprise-capability.ts`, `employee-workbench-scope.ts`, `enterprise-data-seat-context.ts`, `context.ts`); the cross-tenant first-membership risk is NOT eliminated repo-wide.
- `revokePendingEmployeeProvisionsForSeat` is **never defined anywhere in the repo**: it is only imported at `src/gateway/enterprise-seat-assets.ts:55` and called at `:705`, so this is a missing implementation, not just a missing barrel re-export (MISSING_EXPORT warning + tsgo TS2305). Expected shape from the call site: `({ store, enterpriseId, seatId, nowIso, reason: "seat_deleted" }) => number` (count of revoked pending provisions), sitting next to `findPendingEmployeeProvisionByEmail` / `hasPendingEmployeeProvision` in `platform-auth/auth-helpers.ts`, plus a re-export from the barrel `src/gateway/platform-auth.ts` (owned by `gateway-plugins-monolith-decomposition:cursor-daibai`). Not implemented here: inventing seat-provision revocation semantics would be a speculative authorization/lifecycle change, so it is handed to that owner. — kiro-growth-pipeline
- `ui/src/ui/ports/employee/views/workbench-stage-growth-prelude.node.test.ts` (copy assertion + CTA callback) is owned by the `agent-growth-lifecycle` UI task; those two failures remain open and block the "target tests green" gate.
- `pnpm tsgo` remains 67 errors / 23 files; `bun scripts/agent-attribution.ts` reports 15 CONFLICT and 128 UNATTRIBUTED dirty files.
- No implementation commit SHA exists yet, so the section 18.7 evidence format (SHA + command + environment + timestamp + raw report location) cannot be satisfied. — kiro-growth-pipeline

### Billing authoritative consumer migration (tasks 1.5 / 1.7)

- `OPENBOT_TEST_PROFILE=low OPENBOT_TEST_SERIAL_GATEWAY=1 pnpm test "src/gateway/platform-auth/active-membership.test.ts" "src/gateway/platform-auth/active-membership-session.test.ts" "src/gateway/platform-auth/active-membership-client-context.test.ts" "src/gateway/platform-auth/active-membership-scope.test.ts" "src/gateway/platform-auth.test.ts" "src/gateway/native-bootstrap-http.test.ts" "src/gateway/employee-shell/bootstrap-token-store.test.ts" "src/gateway/auth.platform-identity.test.ts" "src/gateway/billing/scope.fallback.test.ts" "src/gateway/billing/scope.isolation.property.test.ts"` passed: 10 files, 92 tests. — kiro-growth-pipeline
- Fail-before evidence: with the pre-migration resolver, `scope.fallback.test.ts` asserted that a platform user resolved through `findMembershipByUserId`, i.e. object-order first match. The multi-membership store used now stores `001` before `aegis-99491024`, so that path selected the wrong tenant; after the migration the same input fails closed and the authoritative pair selects `aegis-99491024`.
- Consumer non-regression: all downstream `resolveBillingScope` consumers were exercised and passed — `scope-attribution`, `server-methods/billing` (42 tests), `enterprise-data` tenant/admin scope, `enterprise-data-m2..m6`, `enterprise-data-seat-context` (+ session), `cli-backend-scoped-credential`, `commercial`, `model-entitlement-management`, `billing/p1-runtime-wiring`: 9 files / 92 tests and 6 files / 58 tests. `server-methods/enterprise-data-m1.ts` has no direct test file, so its two call sites are covered only indirectly.
- `pnpm build` succeeded; the only `[INEFFECTIVE_DYNAMIC_IMPORT]` warning remains the pre-existing `user-operational-identity-xiaohongshu-connector.ts` one.
- `pnpm exec oxfmt --check`, `pnpm exec oxlint` and language diagnostics are clean for `billing/scope.ts`, `billing/scope.fallback.test.ts`, `platform-auth/active-membership-scope.ts`, `platform-auth/active-membership-scope.test.ts`.
- `pnpm tsgo` stays at the pre-existing baseline of 67 errors, and none of `billing/scope.ts`, `platform-auth/active-membership-*.ts`, `server/ws-types.ts` or `server/ws-connection/message-handler.ts` is reported, so this work introduces no new type errors. The full check remains a release blocker for the shared tree. — kiro-growth-pipeline
- Remaining first-match consumers (task 5.4, not claimed complete here): `resolveTrustedEnterpriseDataExecutionContext` and `resolveTrustedSessionEmployeeId` in `src/gateway/enterprise-data/enterprise-data-seat-context.ts`. — kiro-growth-pipeline
- Landing constraint: `bun scripts/agent-attribution.ts` attributes `src/gateway/billing/scope.ts` and `src/gateway/billing/scope.fallback.test.ts` to `enterprise-ai-model-governance:codex-production-release` (owner `cursor-main-recovery`), so per multi-agent rule 2 this task must not land them. Either that path is split/transferred to this task, or that task's owner lands those two files. — kiro-growth-pipeline

## Implementation commits and evidence record (section 18.7 format)

- Environment: macOS 26.5.2 (arm64), Node v22.18.0, Vitest via `pnpm test` (`scripts/test-parallel.mjs`), branch `deploy/user-modeling-v92`.
- Recorded at: 2026-07-31T00:24:03Z. Operator explicitly authorized landing this slice; acceptance remains REJECTED and the plan stays BLOCKED.

| Commit                                     | Subject                                                                     |
| ------------------------------------------ | --------------------------------------------------------------------------- |
| `ea227297b2ff9d996dc2fe65595112e284921873` | Gateway: bind platform sessions to an exact membership and enterprise       |
| `60bf8aa0bef49ce7927aeda907fc4ed23da01f24` | Gateway: revalidate the exact membership pair on native bootstrap           |
| `9ee2f12d856cb73f42f7cb633cbdd239aa1deb38` | Gateway: propagate authoritative membership context to WebSocket clients    |
| `ac424e6d2999fa1f4e06fce34bcbbc6bb5ead3e6` | Gateway: add authoritative enterprise scope resolution for request paths    |
| `36d70421632b9c6a7849b49b1e9ab26bdc9a683e` | Billing: resolve tenant scope from authoritative membership and fail closed |

Commands run for this slice (raw output was reviewed in the authoring session; no report file is committed):

```sh
OPENBOT_TEST_PROFILE=low OPENBOT_TEST_SERIAL_GATEWAY=1 pnpm test \
  "src/gateway/platform-auth/active-membership.test.ts" \
  "src/gateway/platform-auth/active-membership-session.test.ts" \
  "src/gateway/platform-auth/active-membership-client-context.test.ts" \
  "src/gateway/platform-auth/active-membership-scope.test.ts" \
  "src/gateway/platform-auth.test.ts" \
  "src/gateway/billing/scope.fallback.test.ts" \
  "src/gateway/billing/scope.isolation.property.test.ts" \
  "src/gateway/native-bootstrap-http.test.ts" \
  "src/gateway/employee-shell/bootstrap-token-store.test.ts" \
  "src/gateway/auth.platform-identity.test.ts"
# => 10 files, 104 tests passed

OPENBOT_TEST_PROFILE=low OPENBOT_TEST_SERIAL_GATEWAY=1 pnpm test \
  "src/gateway/scope-attribution.test.ts" "src/gateway/server-methods/billing.test.ts" \
  "src/gateway/enterprise-data/enterprise-data-tenant-scope.test.ts" \
  "src/gateway/enterprise-data/enterprise-data-admin-scope.test.ts" \
  "src/gateway/enterprise-data/enterprise-data-seat-context.test.ts" \
  "src/gateway/enterprise-data/enterprise-data-seat-context.session.test.ts" \
  "src/gateway/server-methods/enterprise-data-m2.test.ts" \
  "src/gateway/server-methods/enterprise-data-m5.test.ts" \
  "src/gateway/server-methods/cli-backend-scoped-credential.test.ts" \
  "src/gateway/server-methods/commercial.test.ts" \
  "src/gateway/server-methods/model-entitlement-management.test.ts" \
  "src/gateway/billing/p1-runtime-wiring.integration.test.ts"
# => 12 files, 114 tests passed

pnpm build          # exit 0; pre-existing MISSING_EXPORT + xiaohongshu dynamic-import warnings only
pnpm tsgo           # 67 errors / 23 files (pre-existing baseline); none in this slice's files
pnpm exec oxfmt --check <slice files>   # clean
pnpm exec oxlint <slice files>          # 0 warnings, 0 errors
```

Not committed by this task, by multi-agent rule 2 (another agent's WIP in the same file or a foreign-owned shared file):

- `.loom/registry.yaml` (owner `main-recovery-routing:kiro-loom`) — contains other agents' uncommitted takeovers, so the `ws-types.ts` claim from this task is not landed.
- `src/gateway/platform-auth/session-domain.ts` — the dirty diff there is another task's enterprise-model provider/catalog method domains.

Still BLOCKED after these commits: P0-2 (Registry / ownership / unified ACL / consumer migration), P0-3 (Growth Application Boundary), P0-4 (PostgreSQL, migration, multi-instance), the repo-wide `findMembershipByUserId` request paths, the Growth Prelude UI failures, the `revokePendingEmployeeProvisionsForSeat` missing implementation, and all Security / Platform Architecture / Data / SRE approvals. — kiro-growth-pipeline

## Registry and unified ACL implementation record (2026-07-31)

Architecture decisions were supplied by the operator and are recorded in
`docs/design/agent-registry-unified-acl-adr-2026-07-31.md`. Organization level
Security, Data Governance, and SRE sign off is still outstanding and was not
self certified.

| Commit                                     | Subject                                                                       |
| ------------------------------------------ | ----------------------------------------------------------------------------- |
| `81a5f11a1162889238c38f9c7b305fbcbd3a2aa1` | Gateway: add canonical Agent Registry, legacy resolver, and ownership history |
| `550df0dff8cd520789e86925bebfbf1aff781092` | Docs: record the Agent terminology, Registry, and unified ACL ADR             |
| `25b2bc9fdf5ee3d4a0ed288c43cfce6884bce20e` | Gateway: add EnterpriseAccessPolicyV2 evaluator and v1 migration adapter      |

```sh
OPENBOT_TEST_PROFILE=low OPENBOT_TEST_SERIAL_GATEWAY=1 pnpm test \
  "src/gateway/agent-registry" "src/gateway/access-control"
# => 3 files, 45 tests passed

pnpm exec oxlint --type-aware src/gateway/access-control src/gateway/agent-registry  # 0/0
pnpm exec oxfmt --check src/gateway/agent-registry/*.ts src/gateway/access-control/*.ts  # clean
pnpm tsgo   # 67 errors / 23 files (unchanged baseline); no new module reported
```

Defect found and fixed by its own regression: the evaluator initially returned
`allowed` when an allow matched while a later deny carried an unrecognized
condition, which let an unenforceable deny be bypassed. An unknown condition now
fails the whole decision closed.

Deliberate gaps, not claimed complete:

- The evaluator is not wired into any runtime handler yet, and no audit sink is
  attached (task 4.5). Nothing in production authorization currently calls it.
- Repo-wide `findMembershipByUserId` request paths still exist, so task 5 consumer
  migration is untouched.
- Growth boundary and PostgreSQL stages stay `BLOCKED` pending the approvals above.

Landing note: `src/gateway/agent-registry/**` and `src/gateway/access-control/**`
had no landing-stream disposition, so an `AGENT-ACL` stream was added to
`.loom/registry.yaml`. That file also carries other agents' uncommitted takeovers,
so it remains unlanded by this task. — kiro-growth-pipeline

## Consumer migration record (2026-07-31)

| Commit                                     | Subject                                                                           |
| ------------------------------------------ | --------------------------------------------------------------------------------- |
| `53d69f6ed71314278939f4c1eedbaf472e4dd112` | Gateway: add a client-facing authoritative scope resolver and bind login sessions |
| `96c7541f1555342c386628a6ff87695bd4675787` | Gateway: migrate knowledge and enterprise data scope off first-match membership   |
| `45532299376e29fba5712b3540124fdeeb42d2ae` | Gateway: stop resolving the employee workbench actor by first-match membership    |
| `d4f3132904af53ae8eb0016f1568b383c0f723a7` | Gateway: fail closed when a stored agent owner has several memberships            |
| `f55264fec914e967a05b5145ef9c2d59058b711e` | Gateway: require an unambiguous membership for runtime binding sync               |
| `82743c88a2c7e3babd029c0d8dac252b6b2f8c8a` | Reply: use a realistic platform store in knowledge universe context tests         |
| `05960d559067bd210c7b26dab4397de5b019809e` | Gateway: resolve capability handler scope from the authoritative membership       |
| `e411b4fee08caac406abce3f044ce7c2ebecfe6d` | Gateway: fail closed on ambiguous owners in operational identity governance       |

Two classes were separated deliberately, because they have different available
evidence:

- Request-time paths hold a connected client, so they resolve the validated
  `membershipId + enterpriseId` pair through `resolveAuthoritativeEnterpriseScopeForClient`.
- Owner-attribution paths (a stored `ownerId`, no session) cannot bind to a pair, so
  they require an unambiguous single membership and return nothing when the owner
  belongs to several enterprises.

```sh
OPENBOT_TEST_PROFILE=low OPENBOT_TEST_SERIAL_GATEWAY=1 pnpm test \
  "src/gateway/server-methods/employee-capability" "src/gateway/server-methods/enterprise-capability" \
  "src/gateway/user-operational-identity" "src/gateway/platform-auth" "src/gateway/knowledge/context.test.ts"
# => 31 files, 232 tests passed

pnpm exec oxlint --type-aware <migrated files>   # 0/0
pnpm exec oxfmt --check <migrated files>         # clean
pnpm tsgo                                        # 67 errors / 23 files (unchanged baseline); no migrated file reported
```

Defect found and fixed during this migration, introduced by commit `ea227297b2`:
login classified a membership-less platform account at the default entry as a
platform login, which handed the employee entry an MFA gate and platform
capabilities. The rule is now explicit — an enterprise or employee session must
carry an exact membership pair, so such an account can only hold an MFA-gated
platform session, and a non-platform account with no membership is refused with
`PLATFORM_AUTH_NO_ENTERPRISE_MEMBERSHIP`. `login-mfa.integration.test.ts` pins both
outcomes, including the positive case where a membership makes the employee entry
MFA-free again.

Pre-existing failures confirmed unrelated to this migration (all in other agents'
in-progress areas, verified by reading the failing subject):

- `src/gateway/billing/commercial-run-entrypoints-audit.test.ts` reports
  `server-methods/supervisor.ts` missing `assertSupervisorTenantCommercialCapacity`.
- `src/gateway/billing/runtime.enterprise-budget.test.ts` and
  `resolve-enterprise-ai-governance.test.ts` depend on the untracked
  `src/gateway/enterprise-model/` work.
- `src/gateway/knowledge/kb-retrieve.test.ts`, `knowledge-base-library-content.test.ts`,
  and `workspace-search-step9b.integration.test.ts` fail on index/shape changes with
  no membership resolution involved.

Still open after this round: task 4.5 (evaluator is still not wired into any runtime
handler and has no audit sink), tasks 5.1 to 5.3, the two
`enterprise-seat-assets.ts` sites owned by another agent's WIP, and the Growth and
PostgreSQL stages, which stay `BLOCKED` pending Security, Data Governance, and SRE
sign off. — kiro-growth-pipeline

## Evaluator wiring and agent create ownership (tasks 4.5 / 5.1, 2026-07-31)

| Commit                                     | Subject                                                                       |
| ------------------------------------------ | ----------------------------------------------------------------------------- |
| `46f469e136d56f3566ba538017e57f6d2ad1a2ac` | Gateway: add access control audit sinks and a shadow-mode authorization entry |
| `9ebe16f5a046159619670257bc52a4f8f12b277d` | Gateway: persist the agent registry and resolve create ownership server-side  |
| `6cef18d916cac3bd7277037e2923c4f2d006d18d` | Gateway: stop trusting client tenant and owner on agents.create               |

Audit landing spots, chosen to match the retention split in the review:

- `CONFIG_DIR/audit/access-control-decisions.jsonl` — one line per authorization
  check, carrying mode, subject, resource, permission, evaluated verdict, deny
  reason, matched policy, and the effect the caller actually experienced.
- `CONFIG_DIR/audit/access-control-governance.jsonl` — asset creation, ownership
  transfer/release, policy mutation, correction, repair, and export.

Both reuse the `platform-auth/login-audit.ts` convention: JSONL, 0o600 file inside a
0o700 directory, identifiers only, and best-effort writes. A regression asserts that
an `appendFile` failure still leaves the authorization outcome intact.

Enforcement is deliberately **not** on. The Registry starts empty and v1 policies are
unmigrated, so enforcing would deny every request; `shadow` records what enforcement
would do and leaves traffic untouched. `OPENBOT_ACCESS_CONTROL_MODE=enforce` flips a
deployment once its assets and policies exist.

```sh
OPENBOT_TEST_PROFILE=low OPENBOT_TEST_SERIAL_GATEWAY=1 pnpm test \
  "src/gateway/access-control" "src/gateway/agent-registry/store.test.ts" \
  "src/gateway/agent-registry/agent-create-ownership.test.ts" \
  "src/gateway/agent-registry/registry.test.ts" "src/gateway/server-methods/agents-mutate.test.ts"
# => 97 passed; 2 pre-existing failures in agents-mutate (see below)

pnpm exec oxlint --type-aware <touched files>   # 0/0
pnpm exec oxfmt --check <touched files>         # clean
pnpm tsgo                                       # 67 errors / 23 files (baseline restored)
pnpm build                                      # only the pre-existing MISSING_EXPORT and xiaohongshu warnings
```

`pnpm tsgo` briefly reported 68 errors: the new `agents.create` block lost the
`enterprise` narrowing inside a nested try, so `actorMembershipId` was accessed on a
union. Fixed by capturing the narrowed ownership once; the baseline is back to 67.

Pre-existing failures in `agents-mutate.test.ts`, verified against committed `HEAD`
(`memoryDisposal` already exists in the shipped handler, so these expectations were
stale before this work): `deletes an existing agent and trashes files by default` and
`allows in-workspace symlink reads but rejects writes through symlink aliases`. They
belong to whoever added `memoryDisposal`.

Honest limits of this slice:

- Only `agents.create` consults the evaluator, and only in shadow mode. No tenant is
  enforced, so authorization behavior is unchanged for existing traffic.
- The Registry is populated only for newly created enterprise agents; existing agents
  are not backfilled, so `legacy-agent-unresolved` is the expected resolver answer for
  them until a backfill runs.
- v1 policy migration has not been executed against any real store. — kiro-growth-pipeline

## Registry backfill for pre-Registry agents (2026-07-31)

| Commit                                     | Subject                                                          |
| ------------------------------------------ | ---------------------------------------------------------------- |
| `b43fca84b6477cd4cc0f93e907aaae70a1d26875` | Gateway: backfill canonical agent assets for pre-Registry agents |
| `ab892892a83b60683d1381e5fa92416c525ece11` | Scripts: add a dry-run first agent registry backfill entry point |

Backfill keys on `legacyAgentId` inside its enterprise, so it is idempotent: a second
run reports `already-present`, and ownership history is not churned. Nothing is
guessed — a duplicated legacy id is quarantined, a slug already held by a different
asset is reported as `slug-conflict`, and unusable rows are skipped with a reason.
Candidates come from **active** agent ownership records only; revoked or transferred
records no longer state current ownership.

```sh
OPENBOT_TEST_PROFILE=low OPENBOT_TEST_SERIAL_GATEWAY=1 pnpm test \
  "src/gateway/agent-registry/backfill.test.ts"
# => 11 tests passed (9 backfill, 2 candidate selection)

node --import tsx scripts/agent-registry-backfill.ts --json
# dry run against the real stores: 8 candidates in tenant "001",
# created=8, quarantined=0, slug-conflict=0, skipped-invalid=0,
# and no registry file was written

pnpm exec oxlint --type-aware <files>   # 0/0
pnpm exec oxfmt --check <files>         # clean
pnpm tsgo                                # 67 errors / 23 files (unchanged baseline)
```

The dry run has **not** been applied. `--apply` is an operator decision because it
writes the first canonical identities for existing agents; `--tenant <id>` allows
staging one enterprise at a time.

Remaining order of work before any tenant can move to `enforce`:

1. apply the backfill per tenant and review the report;
2. run the v1 to V2 policy migration for that tenant and reconcile its `skipped`
   list (`unmappable-action` for v1 `write`, `membership-unresolved`,
   `legacy-agent-unresolved`, `unsupported-resource`);
3. only then set `OPENBOT_ACCESS_CONTROL_MODE=enforce`, after
   `assertSingleAuthoritativePolicySet` passes for that tenant.

Growth and PostgreSQL stages remain `BLOCKED` pending Security, Data Governance, and
SRE sign off. — kiro-growth-pipeline

## v1 to V2 policy migration entry point (2026-07-31)

| Commit                                     | Subject                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------- |
| `41ffd63800f9df6bb47ea8fadef57199ada8979a` | Gateway: persist V2 policies and add a tenant migration runner            |
| `151a470fe0042ad39b892eab5bd00d8c43b9327b` | Scripts: add a dry-run first v1 to V2 access policy migration entry point |

The policy store keys on `policyId`, and migration ids are derived from the source
policy id (`v1:<policyId>:<permission>`), so re-applying updates in place instead of
duplicating grants. Revocation is soft so audit history survives, and a missing or
malformed file degrades to an empty set, which means default deny.

The runner binds a v1 `employee` subject to an exact membership **inside that tenant
only**: it refuses to borrow a membership from another enterprise and refuses to pick
one when the user has two. Expected skips (`revoked`, `unsupported-resource`) are
separated from the four reasons that require a human decision.

```sh
OPENBOT_TEST_PROFILE=low OPENBOT_TEST_SERIAL_GATEWAY=1 pnpm test "src/gateway/access-control"
# => 5 files, 48 tests passed

node --import tsx scripts/access-policy-migrate.ts
pnpm exec oxlint --type-aware <files>   # 0/0
pnpm exec oxfmt --check <files>         # clean
pnpm tsgo                                # 67 errors / 23 files (unchanged baseline)
```

Dry run against the real stores (nothing written):

- 80 v1 policy rows, all in tenant `001`.
- Inventory: 43 `seat` and 37 `employee` subjects; resources 22 `agent`, 22 `memory`,
  16 `space`, 14 `seat`, 6 `capability`; actions 41 `read`, 28 `execute`, 11 `write`.
- Result: `migrated=0`, `revoked=17`, `unsupported-resource=50`,
  `legacy-agent-unresolved=13`. The 13 rows needing a decision reference legacy agent
  ids the Registry does not know (`main`, `bot`, `bot--agent`, `bot-2`, `bot-skill`,
  and two `agt-elledecke204-...` variants).
- `unmappable-action` is `0` in this run only because those `agent` rows failed id
  resolution first; the 11 v1 `write` rows will surface once resolution succeeds.

Two facts this dry run established, both of which confirm the required ordering:

1. The Registry backfill has not been applied, so every `agent` row is unresolved.
   Migration must follow the backfill, not precede it.
2. This machine has no `gateway.auth.trustedProxy`, so platform auth is unconfigured
   and no `employee` row can be bound. The script therefore refuses `--apply` in that
   state rather than dropping half the grants silently; a dry run still runs, because
   the inventory itself is what an operator needs to see.

Not done, and requiring an operator decision: `--apply` for either script, adjudicating
the 13 unresolved agent rows (several look like local, non-enterprise agents that
should not become enterprise asset grants at all), and deciding the fate of the 11 v1
`write` grants, which have no counterpart in the frozen permission set.
`OPENBOT_ACCESS_CONTROL_MODE=enforce` stays off. — kiro-growth-pipeline

## Backfill applied to tenant 001, migration re-measured (2026-07-31)

Operator authorized applying the backfill for a single tenant. This wrote one new local
file, `~/.openbot/openbot-agent-registry.json` (mode 0600), and changed no existing
data and no authorization outcome (`OPENBOT_ACCESS_CONTROL_MODE` is still `shadow`, and
only `agents.create` consults the evaluator). Reverting is deleting that file.

```sh
node --import tsx scripts/agent-registry-backfill.ts --tenant 001 --apply
# => Applied: 8 candidate(s), created: 8

node --import tsx scripts/agent-registry-backfill.ts --tenant 001            # already-present: 8
node --import tsx scripts/agent-registry-backfill.ts --tenant 001 --apply    # already-present: 8
```

Idempotency is therefore confirmed against real data, not only in unit tests. Store
state after apply: 8 assets, 8 owner bindings (all open, all `seat`), 0 quarantine
entries, single enterprise `001`, every asset carrying its `legacyAgentId`. Assets:
`agt-elledecke204-gmail-com-`, `agt-elledecke204-gmail-com-n1dwf0gz`, `bot--agent`,
`bot-2`, `bot-skill`, `ghost-bot-mesh-test-orphan-debug`, `main`, `panda`.

Migration dry run re-measured after the backfill (still nothing written):

| Bucket                  | Before backfill | After backfill |
| ----------------------- | --------------- | -------------- |
| migrated                | 0               | 4              |
| revoked                 | 17              | 17             |
| unsupported-resource    | 50              | 50             |
| legacy-agent-unresolved | 13              | 2              |
| membership-unresolved   | 0               | 7              |

Corrections to earlier speculation, now measured:

- `main`, `bot-2`, `bot--agent`, `bot-skill` are **not** local non-enterprise agents.
  They hold active ownership records in tenant `001`, so the backfill created canonical
  assets for them and their grants now resolve.
- The remaining 2 `legacy-agent-unresolved` rows both reference `bot`, which has no
  active ownership record in tenant `001`. That is the genuine adjudication item: either
  the agent was removed, or it never was an enterprise agent, in which case its v1 grant
  should be revoked rather than carried over.
- The 7 `membership-unresolved` rows are explained by this machine having no
  `gateway.auth.trustedProxy`, so the membership store is empty here. They are not a
  data defect by themselves.

New finding that does need a decision before `--apply` on a configured host: v1
`employee.subjectId` is not a single identifier kind. Of 23 active employee rows, 20 are
user UUIDs and 3 are email addresses (8 of the 23 target `agent` resources). The
migration resolver binds by **user id**, so an email-keyed row can never resolve even
with platform auth configured. Options are to normalize those 3 rows at the source, or
to teach the resolver to accept an email and resolve it through `findUserByEmail` first;
the second is only safe if the email is matched against the platform store rather than
trusted as an id. Not implemented, because either choice changes who a grant binds to.

Unchanged: `unmappable-action` is still `0`, so the 11 v1 `write` grants remain masked
behind other skip reasons; `OPENBOT_ACCESS_CONTROL_MODE=enforce` stays off; no V2 policy
has been persisted. — kiro-growth-pipeline

## Operator decisions applied to the v1 source data (2026-07-31)

Decisions: revoke the two `bot` grants; normalize the three email-keyed employee
subjects at the source.

| Commit                                     | Subject                                                      |
| ------------------------------------------ | ------------------------------------------------------------ |
| `d7ebc729ce14a1bdff8038a3d16b99f90b27a041` | Gateway: plan and apply source-side v1 access policy cleanup |
| `1899e8396e8ee0b37d97080d3788de5a988b645d` | Scripts: add the v1 access policy normalization entry point  |

Safety rules encoded in the normalizer: an email is rewritten only when it maps to
exactly one platform user that holds exactly one membership in that policy's tenant;
unknown, ambiguous, and out-of-tenant cases are skipped rather than rebound; revocation
takes precedence over rewriting a grant that is being revoked anyway.

```sh
# verified the mapping read-only first: all 3 email rows resolved to one user id
# with exactly one membership in tenant 001

cp ~/.openbot/openbot-enterprise-seat-assets.json \
   ~/.openbot/openbot-enterprise-seat-assets.json.pre-normalize.20260731T112549Z

node --import tsx scripts/access-policy-normalize.ts --tenant 001 --revoke-agent bot
# => Dry run: 5 planned change(s) — revoke 2, normalize-subject 3, skip 0

node --import tsx scripts/access-policy-normalize.ts --tenant 001 --revoke-agent bot --apply
# => Wrote: revoked=2 normalized=3

node --import tsx scripts/access-policy-normalize.ts --tenant 001 --revoke-agent bot
# => Dry run: 0 planned change(s)   (idempotent)
```

The seat-assets store was backed up before the write, and 5 governance audit lines were
appended to `~/.openbot/audit/access-control-governance.jsonl`.

Migration dry run after the cleanup:

| Bucket                  | Before backfill | After backfill | After cleanup |
| ----------------------- | --------------- | -------------- | ------------- |
| migrated                | 0               | 4              | 4             |
| revoked                 | 17              | 17             | 19            |
| unsupported-resource    | 50              | 50             | 50            |
| legacy-agent-unresolved | 13              | 2              | 0             |
| membership-unresolved   | 0               | 7              | 7             |

`legacy-agent-unresolved` is now zero. The remaining 7 rows were checked against the
platform store directly: every one resolves to exactly one membership in tenant `001`
(users `475156c1…`, `90fed19a…`, `3897a186…`). So the only thing still blocking them is
that this host has no `gateway.auth.trustedProxy`, which is why `--apply` for the
migration is refused here. On a host with platform auth configured, the expected result
is `migrated=11`, `membership-unresolved=0`.

`unmappable-action` is still `0`: the 11 v1 `write` rows sit under
`unsupported-resource` (non-agent resources), so the frozen permission set does not have
to absorb them. No V2 policy has been persisted, and
`OPENBOT_ACCESS_CONTROL_MODE=enforce` stays off. — kiro-growth-pipeline

## Local platform auth enabled, tenant 001 migrated to V2 (2026-07-31)

Operator asked to configure `trustedProxy` on this host and continue.

Minimal change, chosen after reading the resolution path rather than enabling the whole
trusted-proxy feature:

```json
gateway.auth.trustedProxy = { "userHeader": "x-forwarded-user", "platformAuth": { "enabled": true } }
```

Why this is the minimal safe form:

- `resolvePlatformAuthConfig` only inspects `trustedProxy.platformAuth`, so platform auth
  (cookie sessions, membership store) becomes available without turning on header trust.
- `userHeader` is required by the strict config schema, which has no `enabled` field on
  `trustedProxy` at all.
- Header identity trust runs only under `auth.mode === "trusted-proxy"`
  (`authorizeTrustedProxy` is called from that branch only). This host has
  `auth.mode: "token"` explicitly set, and it was left untouched, so gateway connection
  auth is unchanged. Verified after the write: `auth.mode` is still `token`.
- The config was backed up first
  (`~/.openbot/openbot.json.pre-platformauth.20260731T113629Z`), and `config set` wrote
  its own `openbot.json.bak`. Reverting is restoring either file.
- The running gateway does not pick this up until restarted; no restart was performed.
  The visible runtime change after a future restart is that Control UI platform-auth
  login becomes active.

Migration then ran as predicted:

```sh
node --import tsx scripts/access-policy-migrate.ts --tenant 001
# => migrated=11, revoked=19, unsupported-resource=50,
#    membership-unresolved=0, "no rows need a decision"

node --import tsx scripts/access-policy-migrate.ts --tenant 001 --apply   # wrote 11
node --import tsx scripts/access-policy-migrate.ts --tenant 001 --apply   # idempotent
```

Stored V2 set (`~/.openbot/openbot-access-policies.json`, mode 0600): 11 policies, all
active in tenant `001`, all `version: 2`, all `effect: "allow"`, all
`derivedFrom: "v1-migration"`, all `resourceType: "agent_asset"`, all carrying the
`requireAssetStatus` condition. Subjects: 7 `membership`, 4 `seat`. Permission:
`agent.execute` for all 11.

Enforcement is still blocked, by design and by the gate itself:

```text
assertSingleAuthoritativePolicySet({ enterpriseId: "001", activeV1Count: 61, v2Enabled: true })
=> BLOCKED: Enterprise "001" still has 61 active v1 policies
```

Of those 61 active v1 rows, 11 are `agent` (now mirrored in V2) and 50 are non-agent
resources (`memory`, `space`, `seat`, `capability`) that this phase deliberately leaves
in the v1 domain. So flipping `OPENBOT_ACCESS_CONTROL_MODE=enforce` would leave those 50
grants unrepresented. Two honest options for the operator, neither implemented:

1. extend V2 to the remaining resource types (requires adding resources beyond
   `agent_asset` to the frozen model, i.e. an ADR amendment), or
2. scope enforcement to agent resources only, which means the single-authoritative gate
   has to become resource-scoped rather than tenant-scoped.

`OPENBOT_ACCESS_CONTROL_MODE` stays `shadow`. — kiro-growth-pipeline

## V2 extended to non-agent resource types, tenant 001 fully mirrored (2026-07-31)

Operator chose option 1 from the previous round: extend V2 rather than scope enforcement
to agents.

| Commit                                     | Subject                                                           |
| ------------------------------------------ | ----------------------------------------------------------------- |
| `670a37f3939df8a6640558f21b1f893d4d2eb79f` | Gateway: extend V2 access control to the non-agent resource types |
| `70b17ccab23959f48b42c0e5e31c56c3a50b796d` | Docs: amend the ACL ADR with the non-agent resource types         |

The extension was driven by measurement, not by guessing which rights might be needed.
The active v1 set for tenant `001` contains exactly six (resource, action) pairs:

```text
agent.execute = 11   capability.execute = 6   memory.read = 11
memory.write = 11    seat.read = 11           space.read = 11
```

So V2 gained four resource types (`seat`, `space`, `memory`, `capability`) and five
permissions (`seat.read`, `space.read`, `memory.read`, `memory.write`,
`capability.execute`). `memory.write` is first class because v1 states it directly and
there is no broader memory permission to fold it into; `agent.write` remains absent for
the reason the original ADR gave.

Two invariants added with the extension:

- A permission belongs to exactly one resource type, so `memory.read` can never be
  matched against an `agent_asset` and vice versa. A mismatch is a distinct
  `permission-resource-mismatch` denial rather than a silent non-match.
- Registry lookup, `requireOwnerBinding`, `requireSeatBinding`, and
  `requireAssetStatus` stay agent-only. For a non-canonical resource those conditions
  evaluate to unsatisfied, so a policy carrying them fails closed instead of passing
  because the check was inapplicable.

```sh
OPENBOT_TEST_PROFILE=low OPENBOT_TEST_SERIAL_GATEWAY=1 pnpm test \
  "src/gateway/access-control" "src/gateway/agent-registry"
# => 10 files, 109 tests passed

pnpm exec oxlint --type-aware <files>   # 0/0
pnpm exec oxfmt --check <files>         # clean
pnpm tsgo                                # 67 errors / 23 files (unchanged baseline)
```

Migration re-run against the real store:

| Bucket               | Agent-only V2 | Extended V2 |
| -------------------- | ------------- | ----------- |
| migrated             | 11            | 61          |
| revoked              | 19            | 19          |
| unsupported-resource | 50            | 0           |
| needs decision       | 0             | 0           |

Applied: the stored V2 set is now 61 active policies for tenant `001`, matching the 61
active v1 rows one-for-one. Distribution by resource type is `agent_asset` 11, `seat` 11,
`space` 11, `memory` 22, `capability` 6. Agent policies keep the asset-status condition;
non-agent policies carry no conditions, as intended.

Enforcement is still gated, and this is the gate behaving correctly rather than a defect:

```text
assertSingleAuthoritativePolicySet({ enterpriseId: "001", activeV1Count: 61, v2Enabled: true })
=> BLOCKED
```

Migration **copies** grants; it does not retire the v1 rows. Both sets are now active and
equivalent (61 vs 61), so the "exactly one authoritative policy set per tenant" rule is
still violated. Retiring the v1 rows is a separate, operator-owned decision because it
removes the fallback that currently serves live traffic. `OPENBOT_ACCESS_CONTROL_MODE`
stays `shadow`, and no runtime consumer reads the V2 set yet outside the shadow check in
`agents.create`. — kiro-growth-pipeline

## v1/V2 parity verified for tenant 001, and what parity does not prove (2026-07-31)

Operator asked to reconcile the two policy sets with real decisions before retiring
anything. Batch parity was chosen over per-request inline auditing: it yields the same
evidence for every grant at once, and it keeps I/O out of the request path. It also
avoids changing synchronous pure predicates (`isAgentOwnedByEmployeeUser`,
`isAgentVisibleToEmployeeUser`, space visibility) into async functions purely to write
an audit line.

| Commit                                     | Subject                                                       |
| ------------------------------------------ | ------------------------------------------------------------- |
| `ab864920ca0ced0d358a496b56b460b12b35d336` | AccessControl: fix decision audit to name the real resource   |
| `67e9bfdcb1ba409b9284f1405b185f1a55b60865` | AccessControl: add v1/V2 parity check for enforcement cutover |

```sh
OPENBOT_TEST_PROFILE=low OPENBOT_TEST_SERIAL_GATEWAY=1 pnpm test \
  "src/gateway/access-control" "src/gateway/agent-registry"
# => 11 files, 120 tests passed

node --import tsx scripts/access-control-parity.ts
# => 001: PARITY checked=63 agreed=63 divergent=0 notComparable=3 (active=0 revoked=3)

node --import tsx scripts/access-control-parity.ts --audit   # same verdict, 63 shadow decisions recorded

pnpm exec oxlint --type-aware src/gateway/access-control scripts/access-control-parity.ts  # 0/0
pnpm exec oxfmt --check src/gateway/access-control scripts/access-control-parity.ts        # clean
pnpm tsgo   # 67 errors / 23 files (unchanged baseline); none in these files
pnpm build  # only the pre-existing MISSING_EXPORT and xiaohongshu dynamic-import warnings
```

All 80 v1 rows are accounted for, with nothing dropped silently:

| Bucket                                           | Rows | Parity treatment                 |
| ------------------------------------------------ | ---- | -------------------------------- |
| active                                           | 61   | expected allow — all 61 allowed  |
| revoked, identical active row exists             | 14   | collapsed into that active grant |
| revoked, no active twin, expressible in V2       | 2    | expected deny — both denied      |
| revoked, legacy agent id `bot` (not in Registry) | 3    | not comparable, and harmless     |

`checked=63` is therefore `61 + 2`, and `61 + 14 + 2 + 3 = 80`.

A first parity run reported `DIVERGENT divergent=14`. That was a defect in the parity
script's expectation model, not in the evaluator: it expected every revoked row to deny,
but v1 answers "is this allowed?" by looking for **any** active row, and each of those 14
revoked rows has an identical active row for the same `(subject, resource, action)`. So
v1 allows them today and V2 agreed. Expectations are now collapsed per distinct grant
(`resolveParityExpectations`, four unit tests including the ordering case where the
revoked row is read after the active one).

The `notComparable` bucket is now split by liveness, because the two halves have opposite
consequences: a revoked unrepresentable grant gives nothing away, while an **active** one
would be silently dropped the moment enforcement is switched on. The script exits
non-zero on a divergence or an active unrepresentable grant, so it can gate a cutover.

### Defect found by the parity run and fixed

The decision audit line hardcoded `resourceType: "agent_asset"` and carried only
`agentAssetId`. After V2 was extended to `seat`/`space`/`memory`/`capability`, every
non-agent decision was mislabelled as an agent asset **and lost its resource id
entirely** (`params.resource.agentAssetId` is undefined for those shapes). The first
`--audit` run made this visible as an impossible record: `permission: "seat.read"` on
`resourceType: "agent_asset"`, a combination the evaluator itself rejects as
`permission-resource-mismatch`. Since that stream is the evidence base for a cutover, it
had to be able to name what it decided. Fixed by widening the event to
`resourceType` + `resourceId` and normalizing through the evaluator's `toResourceRef`; a
regression pins that a `space` decision records its own type and id. Re-run distribution
is now `seat` 11, `agent_asset` 13, `space` 11, `memory` 22, `capability` 6, with zero
missing resource ids and all six permission/resource pairs consistent.

### What this parity run does not prove

Parity proves the V2 set mirrors the v1 `accessPolicies` **table**. It does not prove
that enforcement would preserve what live traffic experiences, because that table has no
authorization consumer. Verified by reading every reference:

- `listTenantAccessPolicies` — served by `access/snapshot`, called only from tests.
- `buildSeatAccessSnapshot` — seat detail display.
- soft-revoke writes on offboarding / seat revocation.
- a count at `src/gateway/enterprise-seat-assets-backend.ts:326`.
- `ui/src` contains no reference at all.

The gates that actually decide live requests are `seat.defaultSpaceIds`,
`seat.defaultAgentAssetIds`, seat bindings, and asset bindings
(`src/gateway/enterprise-seat-assets-governance.ts:65`,
`src/gateway/employee-workbench-scope.ts:431`). So the recommendation stands: do **not**
retire the 61 v1 rows merely to turn the `assertSingleAuthoritativePolicySet` gate green.
Retiring them would empty the seat access display and discard history while changing no
authorization outcome. The remaining work for a real cutover is wiring those runtime
gates to the evaluator, which is task 4.5's unfinished half.

`OPENBOT_ACCESS_CONTROL_MODE` stays `shadow`. No v1 row was retired, no enforcement was
enabled, and Growth / PostgreSQL stages stay `BLOCKED` pending Security, Data Governance,
and SRE sign off. — kiro-growth-pipeline

## Runtime granted-surface comparison for tenant 001 (2026-08-01)

Operator chose the recommended direction: wire the evaluator to the gates that actually
decide live requests, staying in shadow, instead of retiring the v1 rows to turn the
single-authoritative gate green.

| Commit                                     | Subject                                                               |
| ------------------------------------------ | --------------------------------------------------------------------- |
| `fec83ba10ac590c0fd21123f23c0dcb510b3af35` | AccessControl: diff the live granted surface against the V2 evaluator |

The whole employee-workbench authorization surface is materialized in one async function
(`resolveEmployeeWorkbenchActor` producing `seatAgentIds` / `seatSpaceIds`); every gate
below it is a synchronous pure filter over that set. So the comparison point is that
function, and no synchronous predicate had to become async.

A set diff was chosen over per-request boolean shadowing because a boolean only shows
agreement on resources the runtime already offered. The diff also reports what enforcement
would **add** (`onlyInV2`, a security risk) and what it would silently **remove**
(`onlyInRuntime`, an availability risk).

```sh
OPENBOT_TEST_PROFILE=low OPENBOT_TEST_SERIAL_GATEWAY=1 pnpm test \
  "src/gateway/access-control" "src/gateway/agent-registry"
# => 12 files, 141 tests passed

node --import tsx scripts/access-control-runtime-surface.ts --tenant 001
# => 001: WOULD CHANGE members=3 equivalent=1 changed=2   (exit 1)

pnpm exec oxlint --type-aware src/gateway/access-control scripts/access-control-runtime-surface.ts  # 0/0
pnpm exec oxfmt --check src/gateway/access-control scripts/access-control-runtime-surface.ts        # clean
pnpm build   # only the pre-existing MISSING_EXPORT and xiaohongshu dynamic-import warnings
```

### Two defects in this work, both found by running against real data

1. **Owner baselines were missing from the V2 surface.** The evaluator does not grant an
   owner implicitly; per the ADR ownership is expressed as `derivedFrom: "owner-baseline"`
   policies, and the one existing call site (`agents.create`) supplies them that way. The
   first run therefore reported asset `panda` as access enforcement would remove, when in
   fact its seat holds an open primary owner binding. Fixed by materializing baselines for
   every asset in the enterprise; two regressions pin it, including that an owned asset is
   not handed to a different subject.
2. **The universal builtin steward must not be excluded.** Its legacy id is `main`, which
   in tenant `001` is also a real backfilled asset. Excluding it would have discarded a
   true agreement and hidden a real loss. It is kept in the diff and flagged separately.

### Findings that are real, and are the actual cutover blockers

Of three members in tenant `001`, one is equivalent and two would change:

- `membership=e4c8478b…` (seat `1b25d120…`) holds a live grant for legacy agent `bot`
  that V2 cannot name at all. Traced to source: the seat's `defaultAgentAssetIds` contains
  `bot` and its asset binding is `status: active`, while the ownership record for `bot` is
  `revoked` and the Registry has no asset for it (the backfill only considers active
  ownership). Enforcement would drop this access.
- `membership=30cc1b8c…` (seat `94231477…`) would lose the universal steward asset
  `1515f244…`. V2 holds `agent.execute` on it for seat `1b25d120…` and memberships
  `e4c8478b…` and `26bb0d9d…`, but nothing for this member or its seat. The universal
  builtin grant has no representation in the V2 model.

This also **measures** the earlier conclusion rather than asserting it: revoking the two
v1 `bot` grants did not remove live access to `bot`, because the v1 table is not the gate.

### Request-path wiring is blocked, and a landed fix is being reverted in the shared tree

The wiring into `resolveEmployeeWorkbenchActor` was written and verified (16 files / 190
tests passed at that point), then **overwritten** by another agent's uncommitted rewrite of
`src/gateway/employee-workbench-scope.ts`. Per multi-agent rule 2 it was not re-applied on
top of their WIP, so the request-path shadow is not landed; the offline entry point carries
the evidence in the meantime.

That rewrite needs its owner's attention for a separate reason: it replaces
`resolveAuthoritativeEnterpriseScopeForClient` with `findMembershipByUserId(store, user.id)`,
which reverts landed commit `45532299376e29fba5712b3540124fdeeb42d2ae` and reintroduces
first-match membership resolution on a request authorization path — the exact P0 class the
review called out. It also imports three modules that do not exist yet
(`employee-session-visibility-policy.ts`, `tenant-context.ts`, `tenant-store-paths.ts`),
which is why `pnpm tsgo` currently reports 161 errors across 39 files instead of the 67/23
baseline. None of those errors is in this task's files.

Note on attribution: `bun scripts/agent-attribution.ts` maps that file to this task by path
claim, but the uncommitted content is another agent's authorship. Path attribution cannot
establish authorship, which is exactly the limitation the governance rules describe.

`OPENBOT_ACCESS_CONTROL_MODE` stays `shadow` and `OPENBOT_ACCESS_CONTROL_SHADOW_RUNTIME` is
off by default. No v1 row was retired, no enforcement was enabled, and Growth / PostgreSQL
stages stay `BLOCKED` pending Security, Data Governance, and SRE sign off. — kiro-growth-pipeline

## Both cutover blockers cleared for tenant 001 (2026-08-01)

Operator decisions: revoke the stale `bot` seat grant and clean up the code that lets it
recur; adopt option B for the steward, so a universal builtin is not an enterprise asset.

| Commit                                     | Subject                                                                |
| ------------------------------------------ | ---------------------------------------------------------------------- |
| `fc8a0c035b43dce2edf701cbc9e6ca393f6d6ca3` | AccessControl: exclude universal builtin agents from the asset model   |
| `d2aff6d11efdbb28b8b11939829fbff6b09a8755` | AccessControl: add a cutover cleanup entry point for retired artifacts |
| `ca2a79fefa1ca56b512f3422481ab63a87991508` | Docs: amend the ACL ADR so universal builtin agents are not assets     |

### Why `bot` was still granted, traced to source

Every authority already said `bot` was gone except one. It is absent from the runtime agent
list (`agents.list`, so `listAgentsForGateway` never produces a row for it), its ownership
record was revoked on 2026-06-24 by the CEO themselves, its v1 grants were revoked in the
previous round, and the Registry has no asset for it. Only seat `1b25d120` still carried it
in `defaultAgentAssetIds`, with an `active` asset binding whose `reboundAt` is 2026-06-25 —
one day _after_ the ownership revocation, written by
`reactivateSeatManagedAssetsAfterHandover` during a handover on that seat.

So the grant was inert (no agent row could ever match it) but permanent, because nothing
prunes a seat default when an agent is deleted. That is also the measured proof of the
earlier conclusion: revoking the v1 rows did not remove live access, because the v1 table
is not the gate.

Cleanup drives the seat subsystem's own reconciler rather than editing bindings:
`defaultAgentAssetIds` is the desired state `syncSeatManagedAssetBindings` reconciles
against, so removing the entry is what revokes the binding. The durable fix for the root
cause — pruning seat defaults when an agent is deleted — belongs to
`src/gateway/enterprise-seat-assets-governance.ts`, which is landing stream `H1K`. Seat
lifecycle semantics were not changed from here; that is a hand-off to its owner.

### Steward: the question was not how to grant it

The builtin steward is a per-employee private instance by construction
(`buildEmployeeBuiltinStewardSessionKey(platformUserId)`, with isolation helpers preventing
one employee from seeing another's session) and `withEmployeeUniversalStewardAgentIds`
injects it into every actor. It is actively used: 15 sessions, newest the same day.

But its legacy id is `main`, so the backfill created a canonical asset for it and bound the
CEO seat as owner, and migration copied three v1 grants onto that asset. v1 was itself
inconsistent here, granting `main` to the CEO seat, the CEO membership, and 市场总监, but
not to 客服专员 — who is exactly the member the comparison said would lose it.

Option A (one allow policy per membership) was rejected in the ADR: it re-encodes an
invariant as N records maintained on every membership change, so a new employee would have
no steward until a policy is written, and one seat would keep owning every employee's
assistant. If per-employee restriction ever becomes a requirement it is an explicit `deny`,
which the evaluator already prioritises.

### Applied to real data, backed up and idempotent

```sh
node --import tsx scripts/access-control-cutover-cleanup.ts --tenant 001 \
  --builtin-artifacts --stale-seat-defaults
# => builtin artifacts: assets=1 openOwnerBindings=1 activePolicies=3
#    stale seat defaults: remove=1 review=0

node --import tsx scripts/access-control-cutover-cleanup.ts --tenant 001 \
  --builtin-artifacts --stale-seat-defaults --apply
# => archivedAssets=1 closedBindings=1 revokedPolicies=3, changedSeatIds=[1b25d120…]

node --import tsx scripts/access-control-cutover-cleanup.ts --tenant 001 \
  --builtin-artifacts --stale-seat-defaults
# => assets=0 openOwnerBindings=0 activePolicies=0, remove=0 review=0   (idempotent)
```

Backups written beside each store: `openbot-agent-registry.json`,
`openbot-access-policies.json`, and `openbot-enterprise-seat-assets.json`, all suffixed
`.pre-cutover-cleanup.20260801T011319Z`. Reverting is a file move.

State after apply: the `main` asset is `archived` with its owner binding closed as
`asset_archived`; tenant `001` has 7 active and 1 archived asset; V2 active policies went
61 to 58 with none left on that asset; seat `1b25d120` defaults are
`["main", "bot--agent", "bot-2", "bot-skill"]` and the `bot` binding is `revoked`. `main`
stays in the seat default deliberately: it is redundant, not stale, and removing it would
imply the seat controls access to it.

Recurrence is closed off, verified by re-running the upstream steps:

```sh
node --import tsx scripts/agent-registry-backfill.ts --tenant 001
# => already-present: 7, skipped-builtin: 1   (does not recreate the asset)

node --import tsx scripts/access-policy-migrate.ts --tenant 001
# => migrated=58, skipped revoked=19, skipped builtin-not-an-asset=3,
#    "no rows need a decision"          (80 rows fully accounted for)
```

### Verification

```sh
OPENBOT_TEST_PROFILE=low OPENBOT_TEST_SERIAL_GATEWAY=1 pnpm test \
  "src/gateway/access-control" "src/gateway/agent-registry"
# => 13 files, 154 tests passed

node --import tsx scripts/access-control-parity.ts
# => 001: PARITY checked=60 agreed=60 divergent=0 notComparable=9 (blocking=0)

pnpm exec oxlint --type-aware src/gateway/access-control src/gateway/agent-registry <scripts>  # 0/0
pnpm exec oxfmt --check <same>                                                                 # clean
pnpm tsgo   # 176 errors / shared tree; 0 in this task's files
```

`checked` moved 63 to 60 because the three active `main` grants are now excluded by model
rather than compared, and the nine `notComparable` rows are all non-blocking: six `main`
rows excluded by model and three revoked `bot` rows.

Granted-surface result: **all 3 members of tenant `001` are now equivalent** (previously 1
of 3). Honest qualification on how that was measured: the committed gate
(`scripts/access-control-runtime-surface.ts`) still cannot load, because
`src/gateway/employee-workbench-scope.ts` carries another agent's uncommitted rewrite that
imports three modules which do not exist. The gate now fails with an actionable message
instead of a stack trace, and the result above was obtained from a throwaway diagnostic that
replicates the landed `resolveUserOwnedSubjectIds` rule; the committed gate still calls the
real helper and was not weakened to make this pass. Per-member: `e4c8478b…` 4 agents and 5
spaces agreed, `30cc1b8c…` 2 agents and 1 space agreed, `26bb0d9d…` equivalent with nothing
granted on either side.

`pnpm build` currently fails with 17 `UNRESOLVED_IMPORT` errors, all from two files carrying
other agents' uncommitted work (`src/gateway/employee-workbench-scope.ts` and
`src/auto-reply/reply/get-reply-run.ts`). None is in this task's files, and `pnpm tsgo`
reports no unresolved module in them.

`OPENBOT_ACCESS_CONTROL_MODE` stays `shadow` and `OPENBOT_ACCESS_CONTROL_SHADOW_RUNTIME` is
off. Enforcement is still gated by `assertSingleAuthoritativePolicySet`, since the v1 rows
remain the live fallback and retiring them is a separate operator decision. Growth and
PostgreSQL stages stay `BLOCKED` pending Security, Data Governance, and SRE sign off.
— kiro-growth-pipeline

## Review round 3: fail-open fixed, enforcement gated, wiring still blocked (2026-08-01)

Re-review rejected acceptance again and reported a reproducible fail-open. That finding was
correct. This round addresses the items inside this task's reach and states plainly which
re-submission conditions it does not.

| Commit                                     | Subject                                                                       |
| ------------------------------------------ | ----------------------------------------------------------------------------- |
| `a6eddf1078d5e31ae574d8deaadbdeb472eb40bd` | AccessControl: fail closed on an unknown condition in delegated membership    |
| `04a67ed4a75edbbde6b24684098fb9e6b0832903` | AgentRegistry: verify the owner seat and enforce the single owner invariant   |
| `3e25cac0df53296673898814964f8472e1c6fd4d` | AccessControl: gate enforcement per tenant and add fail-closed property tests |

### P0 fail-open, reproduced and fixed

The reported probe returned `{"allowed":true,"matchedPolicyId":"sp-allow"}` for a service
principal allow plus a membership allow plus a deny on that membership carrying an
unrecognized condition. Root cause in `policy-v2-evaluator.ts`: the principal's own policy
scan checked `unknownCondition`, the delegated `membershipScan` checked only `denied` and
`allowed`. The unenforceable deny was skipped and the principal's allow carried the
decision.

Fail-before: two new assertions failed, the first with `allowed: true`, the second with
`principal-intersection-empty`, which additionally masked why access was refused.
Pass-after: the probe now returns `{"allowed":false,"reason":"unknown-condition"}`.

### Why the tests were green, and what changed about testing

The reviewer's point that green tests were not security evidence is accepted. The example
tests covered the shapes someone thought of. `policy-v2-evaluator.property.test.ts` now
asserts the invariants over generated policy sets.

Getting that right took two iterations, both recorded in the file because the first is the
more instructive: a generator drawing random policy arrays **still passed with the fix
reverted**, since reaching the bug needs a satisfied membership allow _and_ a membership
policy with an unrecognized condition on the _same_ permission, which random draws almost
never line up. The delegated space is now enumerated, and with the fix reverted the property
fails with counterexample `["agent.read", true, "none", true, "unknown"]`. That was verified
by temporarily removing the fix, running, and restoring; the evaluator is byte-identical to
its committed state afterwards.

### Owner seat verification and the ownership invariant

`resolveAgentCreateOwnership` took `ownerPositionId` from the request body unverified. It now
requires an `isSeatInTenant` verifier and rejects `POSITION_NOT_IN_TENANT` for a seat that
does not exist or belongs to another enterprise. Required rather than optional so it cannot
be forgotten; the type checker flagged the existing call site immediately. Three regressions
cover a phantom seat, a real seat from another enterprise, and verification against the
session enterprise rather than the requested one.

For the single-owner invariant the reviewer asked for one of two rules to be chosen and
enforced. Chosen: **an active asset always has exactly one open primary owner.** Enforced in
two places — `releasePrimaryOwner` now takes the status the asset moves to and applies both
changes together, and `assertAgentOwnershipInvariant` runs inside
`saveAgentRegistryStore`. The write path is the transaction boundary for a JSON store, so
create-then-bind stays legal in memory while an unowned active asset can never reach disk.
The test that pinned "released, still active, now unowned" as expected was rewritten. Checked
against the real store before enabling: 7 active assets, each with exactly one open binding.

### Enforcement is now gated per tenant

`assertSingleAuthoritativePolicySet` had no runtime caller.
`resolveTenantEnforcementMode` now downgrades `enforce` to `shadow` with reason
`v1-still-authoritative` while a tenant still has active v1 rows, and reads the v1 count only
when enforcement was actually requested. For tenant `001` that means `enforce` cannot take
effect today, which is the intended outcome rather than a silent partial enforcement.

### Not done, and why

- **A blocking gate in a request handler.** `agents.create` cannot host a meaningful one: its
  check asks about the asset it is about to create, using owner-baseline policies derived from
  the ownership it just wrote, so it is circular and can never deny. A well-formed question
  exists for `agents.delete` (`agent.manage` on an existing asset, before any side effect),
  but V2 subjects are `membership` and `seat` while `EmployeeWorkbenchActor` exposes only
  `userId`, `tenantId`, and `currentSeatId` — no membership id, verified against committed
  `HEAD`. Authorizing on the seat alone would under-grant against a migrated policy set that
  carries both subject types, and re-resolving the membership inside the handler would
  duplicate the authoritative resolver, which is what caused the original P0. Extending the
  actor requires `employee-workbench-scope.ts`, which carries another agent's uncommitted
  rewrite. Blocked on the same file as re-submission condition 6.
- **A create permission.** The frozen set has no `agent.create`, and every `agent.*`
  permission is bound to the `agent_asset` resource type, so a pre-creation check has no
  resource to assert against. Introducing one is an ADR amendment and an operator decision,
  not something to invent here.
- **Conditions 6, 7, 8, 10** stay out of this task: the workbench file is another agent's WIP
  and its rewrite reverts landed commit `45532299376e29fba5712b3540124fdeeb42d2ae`; Growth
  Application Boundary and PostgreSQL/RLS are separate `BLOCKED` phases; repo-wide green
  depends on two files carrying other agents' unresolved imports.

```sh
OPENBOT_TEST_PROFILE=low OPENBOT_TEST_SERIAL_GATEWAY=1 pnpm test \
  "src/gateway/access-control" "src/gateway/agent-registry"
# => 14 files, 174 tests passed

pnpm exec oxlint --type-aware src/gateway/access-control src/gateway/agent-registry  # 0/0
pnpm exec oxfmt --check <same>                                                       # clean
pnpm tsgo   # 0 errors in this task's files; shared-tree total unchanged by this round
```

`OPENBOT_ACCESS_CONTROL_MODE` stays `shadow`, and it can no longer be flipped into effect for
tenant `001` while v1 is live. Growth and PostgreSQL stages stay `BLOCKED` pending Security,
Data Governance, and SRE sign off. — kiro-growth-pipeline

## Workbench WIP reverted, granted-surface gate now verifiable (2026-08-01)

Operator authorized handling the two files carrying unresolved imports, judging necessity
afterwards and reverting if they caused a regression. Investigation showed the condition was
already met for one of them, and that the two files are in different situations, so they were
treated differently rather than as one batch.

### What the unresolved imports actually were

Not missing modules. All five exist, in untracked full-tree copies under `.tmp/kiro-*` and in
`openbot-enterprise-channels-card-ui/`. The main tree's
`src/gateway/employee-workbench-scope.ts` is **byte-identical** (`sha256[:12] 84dc44a7b52c`) to
the copy in `openbot-enterprise-channels-card-ui/`, so the WIP is an incomplete port from that
snapshot: the edit came across, the new modules it imports did not.

Completing that port is not a small fix. Walking the import closure from the four modules the
main tree lacks yields **117 files and about 20,800 LOC** to bring over, spanning
enterprise-model, billing, operational-identity providers, pattern-detection,
skill-invocation, skill-execution-binding, and evolution-governance. That is several other
tasks' feature surface, and adopting it here would land their design unreviewed.

The snapshot also predates this task's landed work: it uses `findMembershipByUserId` twice and
`resolveAuthoritativeEnterpriseScopeForClient` zero times, while `HEAD` uses the authoritative
resolver twice. So the WIP **is** the regression of
`45532299376e29fba5712b3540124fdeeb42d2ae`; there was nothing to wait and see about.

### Action taken, and what was deliberately not touched

Archived first, because uncommitted work has no git history to fall back on:
`.tmp/governance-archive/unresolved-import-wip-20260801T021820Z/` holds the WIP files, their
`HEAD` counterparts, `wip.diff`, and a manifest (132K, under gitignored `.tmp/`).

Then reverted **only** `src/gateway/employee-workbench-scope.ts` to `HEAD`. Safe to do:

- its four WIP-only exports (`EmployeeSessionVisibilityContext`,
  `buildEmployeeSessionVisibilityContext`, `buildEmployeeSessionVisibilityContextForActor`,
  `isSessionVisibleToEmployeeActor`) have **no consumers** anywhere in `src` or `ui/src`. The
  same-named type in `actor-scope.ts` is that file's own declaration, and `actor-scope.ts` is
  clean;
- every consumer of the file and its tests (`employee-workbench-scope.test.ts`,
  `actor-scope.test.ts`, `actor-scope.ts`, `employee-steward-session.ts`) is clean too.

`src/auto-reply/reply/get-reply-run.ts` was **left alone**. It is actively in flight: 22 `.ts`
files changed in the 30 minutes before this check, including
`src/auto-reply/reply/learning-recall-context.ts`, which another agent added mid-session and
which reduced the unresolved count from 5 to 4 on its own. Its one remaining missing module
(`working-style-store.ts`) belongs to that work. Reverting a converging change would have
destroyed live work for no benefit.

### Result

```sh
pnpm build   # unresolved imports 4 -> 1, the remaining one being the in-flight get-reply-run.ts

node --import tsx scripts/access-control-runtime-surface.ts --tenant 001
# => 001: UNCHANGED members=3 equivalent=3 changed=0

OPENBOT_TEST_PROFILE=low OPENBOT_TEST_SERIAL_GATEWAY=1 pnpm test \
  "src/gateway/employee-workbench-scope.test.ts" "src/gateway/actor-scope.test.ts" \
  "src/gateway/access-control" "src/gateway/agent-registry"
# => 16 files, 191 tests passed

pnpm tsgo   # 174 errors / 46 files (shared tree); 0 in employee-workbench-scope.ts, 0 in this task's files
```

**This supersedes the measurement caveat recorded in the previous section.** The committed gate
now loads and calls the real `resolveUserOwnedSubjectIds`, and it reports the same result the
throwaway diagnostic did: all three members of tenant `001` are equivalent. The caveat stands as
a record of what was known at the time, not as a current limitation.

Re-submission condition 6 (restore the authoritative resolver, remove the first-match fallback)
is therefore satisfied in the working tree, by revert rather than by editing another agent's
in-progress design. `OPENBOT_ACCESS_CONTROL_MODE` stays `shadow`; Growth and PostgreSQL stages
stay `BLOCKED`. — kiro-growth-pipeline
