# Design Document: Shared Agent Identity and Access Control Plane

Status: **Active for local Phase -1**

Production and cloud rollout: **BLOCKED**

Related:

- `requirements.md`
- `tasks.md`
- `docs/design/agent-growth-cloud-multitenant-architecture-review-2026-07-30.md`
- `.kiro/specs/operational-identity-governance/`

## 1. Current state

当前 `PlatformAuthSessionRecord` 只绑定 user、domain 和 session kind。session 读取与 Billing 会通过 `findMembershipByUserId` 选择第一条 membership。`GatewayClient.sessionTenantId` 明确只是 hint，尚无权威 membership 字段。

这在单 membership 假设下可工作，但多企业用户可能因枚举顺序得到不同 enterprise。该缺口同时影响 Billing、Agent ownership、entitlement 和 Growth。

## 2. Locked decisions for the first slice

1. enterprise/employee session 的权威边界是服务端 session record 中的 `membershipId + enterpriseId`。
2. platform session 可以没有 membership binding。
3. 新请求不得用 first-match 推导企业。
4. legacy session 只有恰好一条 membership 时允许兼容升级；多条 membership fail closed。
5. requested tenant 只做 equality constraint，不产生权限。
6. 首个消费者是 Billing；Agent create、entitlement 和 Growth 后续迁移到同一 resolver。
7. 本切片不改变 `auth.mode=token` 或 device token 语义。
8. 本切片不创建数据库、云资源或多实例能力。

## 3. Target flow

```text
login / enterprise switch intent
  -> resolve exact membership
  -> create server session record
       membershipId + enterpriseId
  -> signed cookie references session
  -> read session
       validate user + membership + enterprise
  -> trusted platform session context
  -> GatewayClient authoritative session fields
  -> consumer resolver
       requested tenant must equal authoritative enterprise
```

## 4. Data model

### 4.1 PlatformAuthSessionRecord

```ts
type PlatformAuthSessionRecord = {
  id: string;
  userId: string;
  domain?: "platform" | "enterprise" | "employee";
  sessionKind?: SessionKind;
  membershipId?: string;
  enterpriseId?: string;
  // existing timestamps
};
```

Invariant:

- platform domain: both fields may be absent.
- enterprise/employee domain: both fields are present together for newly issued sessions.
- when present, membership.userId equals session.userId and membership.enterpriseId equals session.enterpriseId.

### 4.2 Trusted proxy and gateway client

```ts
type PlatformAuthTrustedProxySession = {
  // existing fields
  membershipId?: string;
  enterpriseId?: string;
};

type GatewayClient = {
  // existing fields
  sessionMembershipId?: string;
  sessionEnterpriseId?: string;
  sessionTenantId?: string; // compatibility hint only
};
```

Only validated session context may populate the authoritative fields.

### 4.3 Access context

```ts
type AgentAccessContext = {
  requestId: string;
  enterpriseId: string;
  actor:
    | {
        kind: "membership";
        platformUserId: string;
        membershipId: string;
      }
    | {
        kind: "service_principal";
        servicePrincipalId: string;
        onBehalfOfMembershipId?: string;
      };
  sessionId?: string;
  permissions: string[];
};
```

The first slice transports the membership actor facts. Permission expansion and service principals remain later Phase -1 tasks.

## 5. Membership resolution

Introduce strict helpers alongside the membership store:

```ts
listMembershipsByUserId(store, userId);
findMembershipByIdForUser(store, membershipId, userId);
resolveSessionMembership({ store, userId, membershipId, enterpriseId });
resolveUniqueLegacyMembership(store, userId);
```

Rules:

- Exact binding is validated by IDs, not object order.
- `resolveUniqueLegacyMembership` succeeds only for exactly one membership.
- No helper silently substitutes another membership.
- `findMembershipByUserId` remains temporarily for legacy administrative callers, is deprecated for request authorization, and receives no new consumers.

## 6. Session issuance and read

### 6.1 New issuance

- Login/switch code supplies selected membership intent for enterprise/employee sessions.
- The server resolves the membership and stores both IDs.
- A route enterprise ID can constrain selection but cannot create it.
- If multiple memberships exist and no exact selection is available, issuance returns a generic selection-required error.

### 6.2 Read and revalidation

- Load session record and user.
- If exact binding exists, validate membership ownership and enterprise equality.
- If legacy record lacks binding, allow only a unique membership compatibility result.
- Invalid or ambiguous binding produces no trusted enterprise context.
- Never fall through to another membership.

Enterprise freeze semantics depend on the authoritative enterprise status model and remain a later task; membership deletion/replacement is enforced immediately by lookup failure.

## 7. Billing integration

`resolveBillingScope` resolves in this order:

1. Authoritative `client.sessionMembershipId + client.sessionEnterpriseId`.
2. Temporary legacy compatibility only when the user has exactly one membership.
3. Existing no-platform-session local operator fallback.

When `requestedTenantId` is present with an authenticated scope, it must equal the authoritative enterprise. A mismatch returns empty scope. The requested value never selects another membership.

## 8. Error and privacy behavior

- `membership_selection_required`: generic failure for ambiguous legacy/new login.
- `invalid_session_binding`: generic failure for missing/revoked/mismatched binding.
- `tenant_context_mismatch`: generic authorization failure for route mismatch.
- External errors do not reveal membership IDs or whether a target enterprise exists.
- Internal structured logs include request/session correlation, not secrets.

## 9. Rollout

1. Add optional store fields and strict helpers without changing behavior.
2. Persist bindings on new enterprise/employee sessions.
3. Validate bindings on read and propagate authoritative client fields.
4. Move Billing to authoritative context with unique legacy fallback.
5. Add explicit enterprise switch/selection UI and API.
6. Migrate remaining consumers; remove first-match request authorization.
7. Add service principals, Agent Registry and unified ACL.

## 10. Validation strategy

Targeted validation must cover:

- exact binding success.
- binding for another user rejected.
- membership/enterprise mismatch rejected.
- revoked or missing membership rejected.
- legacy one-membership session accepted during compatibility window.
- legacy multi-membership session rejected.
- Billing requested tenant mismatch rejected.
- no-session local fallback unchanged.

No production rollout proceeds until Security approves the error, revocation and selection semantics.
