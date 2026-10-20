> **SUPERSEDED as second spec.** 唯一规范是 unique handoff：`.kiro/specs/memory-workspace-platform-remediation/handoff-s01-trusted-principal-handle-gate.md`。本文不得覆盖该文件，也不得当作第二套 D1–D5。
>
> R6 机器验收以 `scripts/verify-single-sot.mjs` 为准。`src/gateway/workspace-catalog/` 与 `.../migrations` **必须不存在**；把缺失当作失败是错误架构。
>
> Source: closed PR #818 (`8ce0710af1bc`). Implementation Unlock / Production Authorization: **Not issued**.

# D1 规范收敛补丁

> **目标文档**: `handoff-s01-d1-trusted-principal-contract.md`  
> **修订来源**: R1 (Anonymous Local), R3 (Trusted Proxy)  
> **补丁日期**: 2026-08-29  
> **状态**: 规范性修订（Normative）

---

## 修订声明

**本补丁对 D1 执行规范性修订**:

- §3.2.2 "Trusted Proxy Header" 被 R3 完整威胁模型取代
- §9 "向后兼容" 中的 allowAnonymousLocal 被 R1 Fail-Closed 策略取代
- 旧的简化实现已标记为 `[SUPERSEDED]`

---

## 补丁 1: §3.2.2 Trusted Proxy Header → R3 完整威胁模型

### 修订位置

文件: `handoff-s01-d1-trusted-principal-contract.md`  
章节: `#### 3.2.2 Trusted Proxy Header (优先级 2)`  
行号: ~228-290

### 修订类型

🔴 **[SUPERSEDED]** - 完全取代

### 原始内容（已取代）

```typescript
// [SUPERSEDED BY R3]
// 旧实现：仅 IP 白名单校验
async function resolvePrincipalFromTrustedProxyHeader(
  client: GatewayClient | null,
): Promise<TrustedPrincipal | null> {
  // 1. 检查 auth mode
  const authMode = client?.authMode;
  if (authMode !== "trusted-proxy") {
    return null;
  }

  // 2. 读取 x-openclaw-trusted-user header
  const trustedUserHeader = client?.req?.headers?.["x-openclaw-trusted-user"];
  if (!trustedUserHeader || typeof trustedUserHeader !== "string") {
    return null;
  }

  // 3. 校验代理 IP 白名单（安全门禁）
  const clientIp = client?.req?.ip;
  if (!isTrustedProxyIp(clientIp)) {
    auditLog({
      event: "principal_resolution_failed",
      reason: "untrusted_proxy_ip",
      clientIp,
    });
    return null;
  }

  // 4. 解析 header 内容（格式: userId:tenantId:sessionDomain）
  const parts = trustedUserHeader.split(":");
  // ...
}
```

**问题**:

- ❌ 只有 IP 白名单，header 可被伪造
- ❌ 无签名验证
- ❌ 无重放攻击防护
- ❌ 无密钥轮换机制
- ❌ 无代理链解析

### 新规范（R3）

```typescript
/**
 * Trusted Proxy Header 解析（R3 修订版本）
 *
 * 安全要求:
 * 1. HMAC-SHA256 签名验证（防伪造）
 * 2. Nonce + 时间戳（防重放）
 * 3. 代理链解析（单跳/多跳）
 * 4. IPv4/IPv6 + CIDR 白名单
 * 5. 密钥轮换（90 天 + 7 天重叠期）
 *
 * 参考: handoff-s01-revision-r3-trusted-proxy-threat-model.md
 */
async function resolvePrincipalFromTrustedProxyHeader(
  client: GatewayClient | null,
  topology: TrustedProxyTopology,
  nonceCache: NonceCache,
): Promise<TrustedPrincipal | null> {
  // 1. 检查 auth mode
  const authMode = client?.authMode;
  if (authMode !== "trusted-proxy") {
    return null;
  }

  // 2. 解析代理链（单跳/多跳）
  const proxyResult =
    topology.proxyHops === "single"
      ? parseSingleHopProxy(client.req, topology)
      : parseMultiHopProxy(client.req, topology);

  if (!proxyResult.ok) {
    auditLog({
      event: "principal_resolution_failed",
      reason: proxyResult.reason,
      clientIp: client.req.socket.remoteAddress,
    });
    return null;
  }

  // 3. 读取 Trusted Proxy Headers
  const headers = extractTrustedProxyHeaders(client.req);
  if (!headers) {
    auditLog({
      event: "principal_resolution_failed",
      reason: "trusted_proxy_headers_missing",
    });
    return null;
  }

  // 4. 验证时间戳（防过期请求）
  const timestampCheck = verifyTimestamp(headers.timestamp, topology.timestampTolerance);
  if (!timestampCheck.valid) {
    auditLog({
      event: "principal_resolution_failed",
      reason: timestampCheck.reason,
    });
    return null;
  }

  // 5. 验证 Nonce（防重放）
  const nonceCheck = verifyNonce(headers.nonce, nonceCache);
  if (!nonceCheck.valid) {
    auditLog({
      event: "principal_resolution_failed",
      reason: nonceCheck.reason,
    });
    return null;
  }

  // 6. 验证签名（HMAC-SHA256）
  const signatureHeader = client.req.headers["x-openbot-signature"];
  if (!signatureHeader) {
    auditLog({
      event: "principal_resolution_failed",
      reason: "signature_missing",
    });
    return null;
  }

  const signatureCheck = verifyTrustedProxyHeaders(headers, signatureHeader, topology);
  if (!signatureCheck.valid) {
    auditLog({
      event: "principal_resolution_failed",
      reason: signatureCheck.reason,
    });
    return null;
  }

  // 7. 构造 Principal
  return {
    userId: headers.principalId,
    tenantId: headers.tenantId,
    sessionDomain: headers.sessionDomain,
    source: "trusted-proxy-header",
    resolvedAt: Date.now(),
    metadata: {
      resolverVersion: "2.0-r3",
      proxyInfo: {
        clientIp: proxyResult.clientIp,
        proxyChain: "proxyChain" in proxyResult ? proxyResult.proxyChain : [proxyResult.proxyIp],
        verifiedAt: new Date().toISOString(),
      },
    },
  };
}

/**
 * 辅助函数（详见 R3）
 */

// 单跳代理解析
function parseSingleHopProxy(
  req: Request,
  topology: TrustedProxyTopology,
): { ok: true; clientIp: string; proxyIp: string } | { ok: false; reason: string } {
  // 实现见 R3 §3.2
  throw new Error("NOT_IMPLEMENTED");
}

// 多跳代理解析
function parseMultiHopProxy(
  req: Request,
  topology: TrustedProxyTopology,
): { ok: true; clientIp: string; proxyChain: string[] } | { ok: false; reason: string } {
  // 实现见 R3 §3.2
  throw new Error("NOT_IMPLEMENTED");
}

// 提取 headers
function extractTrustedProxyHeaders(req: Request): TrustedProxyHeaders | null {
  // 实现见 R3 §3.5
  throw new Error("NOT_IMPLEMENTED");
}

// 验证时间戳
function verifyTimestamp(
  timestamp: string,
  tolerance: number,
): { valid: true } | { valid: false; reason: string } {
  // 实现见 R3 §3.4
  throw new Error("NOT_IMPLEMENTED");
}

// 验证 Nonce
function verifyNonce(
  nonce: string,
  nonceCache: NonceCache,
): { valid: true } | { valid: false; reason: string } {
  // 实现见 R3 §3.4
  throw new Error("NOT_IMPLEMENTED");
}

// 验证签名
function verifyTrustedProxyHeaders(
  headers: TrustedProxyHeaders,
  signatureHeader: string,
  topology: TrustedProxyTopology,
): { valid: true } | { valid: false; reason: string } {
  // 实现见 R3 §3.3
  throw new Error("NOT_IMPLEMENTED");
}

/**
 * 数据结构（详见 R3 §3.1）
 */
type TrustedProxyTopology = {
  trustedProxies: TrustedProxyEntry[];
  proxyHops: "single" | "multi";
  signatureKey: string;
  keyRotation: {
    currentKeyId: string;
    currentKey: string;
    previousKey?: string;
    previousKeyExpiry?: string;
  };
  timestampTolerance: number;
  nonceCacheSize: number;
};

type TrustedProxyHeaders = {
  principalType: PrincipalType;
  principalId: string;
  tenantId: string | null;
  sessionDomain: SessionDomain;
  nonce: string;
  timestamp: string;
};

class NonceCache {
  // 实现见 R3 §3.4
}
```

### 修订理由

评审问题 #3 指出：

> IP 白名单本身不能证明 header 未被伪造。必须补充受信代理拓扑、单跳/多跳规则、签名或 mTLS、时间戳/nonce、密钥轮换和直连拒绝测试。

R3 提供了完整的威胁模型（8 种威胁 + 8 种防御），包括：

- HMAC-SHA256 签名验证
- Nonce + 时间戳防重放
- 单跳/多跳代理链解析
- 密钥轮换机制

### 实现参考

完整实现见: `handoff-s01-revision-r3-trusted-proxy-threat-model.md` §3

---

## 补丁 2: §9.2 allowAnonymousLocal → R1 Fail-Closed 策略

### 修订位置

文件: `handoff-s01-d1-trusted-principal-contract.md`  
章节: `### 9.2 降级策略`  
行号: ~655-660

### 修订类型

🔴 **[SUPERSEDED]** - 完全取代

### 原始内容（已取代）

```markdown
### 9.2 降级策略

- 当 `resolveTrustedPrincipal` 返回 `null` 时，Tool CWD 解析可选择降级到 **local workspace only**（通过 `allowAnonymousLocal=true`）
- 既有 `workspace-resolver/` 代码路径（group/steward/local）不受影响
```

**问题**:

- ❌ 无限制条件（任何情况都可降级）
- ❌ 生产环境可能误开
- ❌ 远程请求可匿名访问
- ❌ 写入/执行操作无限制

### 新规范（R1）

````markdown
### 9.2 降级策略（R1 修订版本）

**allowAnonymousLocal 严格启用条件** (Fail-Closed by Default):

匿名本地模式**默认禁用**，仅在满足**所有**以下条件时才允许启用：

1. ✅ **部署 Profile 必须为 personal_local**
   - `OPENBOT_DEPLOYMENT_PROFILE=personal_local`
   - `managed/enterprise/production` profile 一律拒绝

2. ✅ **监听地址必须为 loopback**
   - `127.0.0.1` 或 `::1`
   - `0.0.0.0` 或 `::` （监听所有网络接口）拒绝

3. ✅ **认证模式必须为 none**
   - `auth.mode=none`
   - Platform Auth 启用时拒绝

4. ✅ **明确的环境变量启用标志**
   - `OPENBOT_ALLOW_ANONYMOUS_LOCAL=true`

5. ✅ **仅允许只读工具**
   - 允许: `read_file`, `read_code`, `list_directory`, `file_search`, `grep_search`
   - 禁止: `fs_write`, `str_replace`, `execute_bash`, `delete_file`

6. ✅ **仅允许只读/列举操作**
   - 允许: `operation="read"` 或 `operation="list"`
   - 禁止: `operation="write"` 或 `operation="execute"`

**启动时 Fail-Closed 校验**:

```typescript
/**
 * 启动时校验 Anonymous Local 模式配置
 *
 * 若配置不安全，启动失败（Fail-Closed）
 */
export function validateAnonymousLocalConfigOnStartup(config: GatewayConfig): void {
  const profile = resolveDeploymentProfile();
  const allowAnonymous = config.auth?.allowAnonymousLocal ?? false;
  const bindAddress = config.gateway?.bind ?? "127.0.0.1";

  // Rule 1: 生产 Profile 禁止匿名模式
  if (profile === "production" && allowAnonymous) {
    throw new Error(
      "SECURITY: allowAnonymousLocal=true is forbidden in production profile. " +
        "Set OPENBOT_DEPLOYMENT_PROFILE=personal_local or disable allowAnonymousLocal.",
    );
  }

  // Rule 2: managed/enterprise Profile 禁止匿名模式
  if ((profile === "managed" || profile === "enterprise") && allowAnonymous) {
    throw new Error(
      `SECURITY: allowAnonymousLocal=true is forbidden in ${profile} profile. ` +
        "Only personal_local profile allows anonymous local mode.",
    );
  }

  // Rule 3: 非 loopback 监听地址禁止匿名模式
  if (allowAnonymous && !isLoopbackAddress(bindAddress)) {
    throw new Error(
      `SECURITY: allowAnonymousLocal=true requires loopback bind address. ` +
        `Current bind address: ${bindAddress}. Change to 127.0.0.1 or ::1.`,
    );
  }

  // Rule 4: Platform Auth 启用时禁止匿名模式
  if (allowAnonymous && config.auth?.mode !== "none") {
    throw new Error(
      "SECURITY: allowAnonymousLocal=true requires auth.mode=none. " +
        `Current auth mode: ${config.auth?.mode}.`,
    );
  }
}
```
````

**运行时双重校验**:

```typescript
/**
 * 运行时检查 Anonymous Local 模式是否允许
 *
 * 双重校验：启动时校验 + 运行时校验
 */
export function checkAnonymousLocalRuntimeConditions(params: {
  config: GatewayConfig;
  client: GatewayClient;
  toolName: string;
  operation: "read" | "write" | "execute" | "list";
}): { ok: true } | { ok: false; reason: string } {
  const { config, client, toolName, operation } = params;

  // 1. 检查部署 Profile
  const profile = resolveDeploymentProfile();
  if (!isAnonymousLocalAllowedByProfile(profile)) {
    return {
      ok: false,
      reason: `anonymous_local_forbidden_in_profile_${profile}`,
    };
  }

  // 2. 检查请求来源（必须来自 loopback）
  if (!isRequestFromLoopback(client.req)) {
    return {
      ok: false,
      reason: "anonymous_local_requires_loopback_request",
    };
  }

  // 3. 检查工具是否允许（只读工具）
  if (!isToolAllowedInAnonymousLocal(toolName)) {
    return {
      ok: false,
      reason: `tool_${toolName}_denied_in_anonymous_local`,
    };
  }

  // 4. 检查操作类型（只允许 read/list）
  if (operation === "write" || operation === "execute") {
    return {
      ok: false,
      reason: `operation_${operation}_denied_in_anonymous_local`,
    };
  }

  return { ok: true };
}
```

**新增错误码**（5 个）:

- `ERR_ANONYMOUS_LOCAL_FORBIDDEN` - 匿名本地模式被禁止
- `ERR_ANONYMOUS_LOCAL_NON_LOCAL_PATH` - 非本地路径
- `ERR_ANONYMOUS_LOCAL_WRITE_DENIED` - 写入操作被禁止
- `ERR_ANONYMOUS_LOCAL_EXECUTE_DENIED` - 执行操作被禁止
- `ERR_ANONYMOUS_LOCAL_TOOL_DENIED` - 工具不允许

**既有代码路径保持不变**:

- 既有 `workspace-resolver/` 代码路径（group/steward/local）不受影响
- 只是 `allowAnonymousLocal=true` 的启用条件变得更严格

```

### 修订理由

评审问题 #1 指出：
> 匿名本地模式作为兼容路径，但没有限定调用方、部署 profile、监听地址、工具能力或生产禁用证明。若生产配置误开，Trusted Principal 缺失时仍可能获得本地 CWD。

R1 提供了完整的 Fail-Closed 策略：
- 仅 `personal_local` profile 允许
- 仅 loopback 地址允许
- 仅只读工具允许
- 启动时 Fail-Closed 校验
- 运行时双重校验

### 实现参考

完整实现见: `handoff-s01-revision-r1-anonymous-local-security.md` §2

---

## 验收标准

### D1 收敛完成标准

- ✅ §3.2.2 已标记 `[SUPERSEDED BY R3]`
- ✅ §3.2.2 新规范引用 R3 完整实现
- ✅ §9.2 已标记 `[SUPERSEDED BY R1]`
- ✅ §9.2 新规范引用 R1 Fail-Closed 策略
- ✅ D1 不再包含旧的宽松降级语义
- ✅ D1 明确指向 R1/R3 的详细实现

### 实现团队指南

**实现 Trusted Proxy Header 时**:
1. 不要使用 D1 原始的 IP 白名单实现
2. 必须使用 R3 的完整威胁模型
3. 实现签名验证、Nonce 防重放、密钥轮换

**实现 allowAnonymousLocal 时**:
1. 不要允许无限制的匿名降级
2. 必须使用 R1 的 Fail-Closed 策略
3. 实现启动时校验 + 运行时双重校验

---

**补丁状态**: 规范性修订（Normative）
**创建日期**: 2026-08-29
**负责人**: kiro-daibai
```
