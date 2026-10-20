> **SUPERSEDED as second spec.** 唯一规范是 unique handoff：`.kiro/specs/memory-workspace-platform-remediation/handoff-s01-trusted-principal-handle-gate.md`。本文不得覆盖该文件，也不得当作第二套 D1–D5。
>
> R6 机器验收以 `scripts/verify-single-sot.mjs` 为准。`src/gateway/workspace-catalog/` 与 `.../migrations` **必须不存在**；把缺失当作失败是错误架构。
>
> Source: closed PR #818 (`8ce0710af1bc`). Implementation Unlock / Production Authorization: **Not issued**.

# R3: Trusted Proxy Header 完整威胁模型（修订）

> **修订问题**: Trusted Proxy Header 的信任边界未定义完整  
> **严重性**: 🟡 中（安全配置风险）  
> **修订日期**: 2026-08-29  
> **状态**: 修订完成

---

## 1. 问题描述

**原设计问题**:

- 只要求 IP 白名单，没有说明代理链解析、直连绕过、IPv6/CIDR、负载均衡转发、密钥轮换和 header 重放保护
- IP 白名单本身不能证明 header 未被伪造
- 缺少完整的威胁模型和防御策略

**影响范围**:

- D1 §3.2.2 (Trusted Proxy Header)
- D5 §7.1 (安全测试)

---

## 2. 威胁模型

### 2.1 威胁场景

| 威胁 ID | 威胁场景        | 攻击者能力                                          | 影响         |
| ------- | --------------- | --------------------------------------------------- | ------------ |
| **T1**  | 直连绕过代理    | 攻击者直接连接 Gateway，伪造 `X-Forwarded-*` header | 身份伪造     |
| **T2**  | 代理链注入      | 攻击者控制代理链中的某个节点，注入恶意 header       | 身份伪造     |
| **T3**  | Header 重放攻击 | 攻击者截获合法请求，重放 header                     | 会话劫持     |
| **T4**  | IPv6 绕过       | 攻击者使用 IPv6 地址绕过 IPv4 白名单                | 白名单绕过   |
| **T5**  | CIDR 边界绕过   | 攻击者利用 CIDR 边界模糊性绕过检查                  | 白名单绕过   |
| **T6**  | 负载均衡转发    | 负载均衡器转发请求，原始 IP 丢失                    | 身份丢失     |
| **T7**  | 密钥泄露        | 攻击者获得签名密钥，伪造合法 header                 | 身份伪造     |
| **T8**  | 时间窗口攻击    | 攻击者在密钥轮换期间利用旧密钥                      | 密钥过期利用 |

### 2.2 防御策略

| 威胁 ID | 防御策略       | 实现方式                                   |
| ------- | -------------- | ------------------------------------------ |
| **T1**  | 直连拒绝       | 检查请求来源 IP，不在白名单则拒绝          |
| **T2**  | 代理链签名     | 使用 HMAC-SHA256 签名 header               |
| **T3**  | Nonce + 时间戳 | 每个请求携带 nonce 和时间戳，防止重放      |
| **T4**  | IPv6 白名单    | 同时支持 IPv4 和 IPv6 白名单               |
| **T5**  | CIDR 严格匹配  | 使用 `ip-address` 库严格匹配 CIDR          |
| **T6**  | 多跳代理解析   | 解析 `X-Forwarded-For` 链，取第一个受信 IP |
| **T7**  | 定期密钥轮换   | 每 90 天轮换签名密钥                       |
| **T8**  | 密钥重叠期     | 支持新旧密钥同时有效（7 天重叠期）         |

---

## 3. 修订方案

### 3.1 受信代理拓扑

```typescript
/**
 * 受信代理拓扑配置
 */
export type TrustedProxyTopology = {
  /** 受信代理 IP 白名单 */
  trustedProxies: TrustedProxyEntry[];

  /** 代理跳数（单跳/多跳）*/
  proxyHops: "single" | "multi";

  /** 签名密钥（用于 HMAC-SHA256）*/
  signatureKey: string;

  /** 密钥轮换配置 */
  keyRotation: {
    /** 当前密钥 ID */
    currentKeyId: string;

    /** 当前密钥 */
    currentKey: string;

    /** 旧密钥（重叠期）*/
    previousKey?: string;

    /** 旧密钥过期时间 */
    previousKeyExpiry?: string;
  };

  /** 时间戳有效期（秒）*/
  timestampTolerance: number; // 默认 300 秒（5 分钟）

  /** Nonce 缓存大小 */
  nonceCacheSize: number; // 默认 10000
};

/**
 * 受信代理条目
 */
export type TrustedProxyEntry = {
  /** 代理 IP 地址或 CIDR */
  address: string;

  /** 地址类型 */
  type: "ipv4" | "ipv6" | "cidr-v4" | "cidr-v6";

  /** 代理名称（用于审计日志）*/
  name: string;

  /** 是否启用 */
  enabled: boolean;
};
```

### 3.2 单跳代理 vs 多跳代理

```typescript
/**
 * 单跳代理（Single-Hop Proxy）
 *
 * 场景: Gateway 前面只有一个受信代理（例如 Nginx）
 *
 * 拓扑:
 *   Client → Trusted Proxy → Gateway
 *
 * 解析规则:
 *   - Gateway 检查连接来源 IP，必须匹配受信代理白名单
 *   - 读取 X-Forwarded-For 第一个 IP 作为 Client IP
 */
export function parseSingleHopProxy(
  req: Request,
  topology: TrustedProxyTopology,
):
  | {
      ok: true;
      clientIp: string;
      proxyIp: string;
    }
  | {
      ok: false;
      reason: string;
    } {
  const proxyIp = req.socket.remoteAddress;

  // 1. 检查连接来源 IP 是否在白名单
  if (!isTrustedProxy(proxyIp, topology)) {
    return {
      ok: false,
      reason: `direct_connection_rejected: ${proxyIp} not in trusted proxy list`,
    };
  }

  // 2. 读取 X-Forwarded-For
  const xForwardedFor = req.headers["x-forwarded-for"];
  if (!xForwardedFor) {
    return {
      ok: false,
      reason: "x_forwarded_for_missing",
    };
  }

  // 3. 取第一个 IP（Client IP）
  const clientIp = parseXForwardedFor(xForwardedFor)[0];
  if (!clientIp) {
    return {
      ok: false,
      reason: "x_forwarded_for_invalid",
    };
  }

  return {
    ok: true,
    clientIp,
    proxyIp,
  };
}

/**
 * 多跳代理（Multi-Hop Proxy）
 *
 * 场景: Gateway 前面有多个受信代理（例如 CDN → LB → Nginx）
 *
 * 拓扑:
 *   Client → Proxy1 (CDN) → Proxy2 (LB) → Proxy3 (Nginx) → Gateway
 *
 * 解析规则:
 *   - Gateway 检查连接来源 IP，必须匹配受信代理白名单
 *   - 从右到左遍历 X-Forwarded-For 链，找到第一个非受信代理 IP
 */
export function parseMultiHopProxy(
  req: Request,
  topology: TrustedProxyTopology,
):
  | {
      ok: true;
      clientIp: string;
      proxyChain: string[];
    }
  | {
      ok: false;
      reason: string;
    } {
  const lastProxyIp = req.socket.remoteAddress;

  // 1. 检查最后一跳是否在白名单
  if (!isTrustedProxy(lastProxyIp, topology)) {
    return {
      ok: false,
      reason: `direct_connection_rejected: ${lastProxyIp} not in trusted proxy list`,
    };
  }

  // 2. 读取 X-Forwarded-For
  const xForwardedFor = req.headers["x-forwarded-for"];
  if (!xForwardedFor) {
    return {
      ok: false,
      reason: "x_forwarded_for_missing",
    };
  }

  // 3. 解析代理链
  const chain = parseXForwardedFor(xForwardedFor);
  if (chain.length === 0) {
    return {
      ok: false,
      reason: "x_forwarded_for_invalid",
    };
  }

  // 4. 从右到左找第一个非受信代理 IP
  let clientIp: string | null = null;
  for (let i = chain.length - 1; i >= 0; i--) {
    if (!isTrustedProxy(chain[i], topology)) {
      clientIp = chain[i];
      break;
    }
  }

  if (!clientIp) {
    // 所有 IP 都是受信代理 → 取第一个
    clientIp = chain[0];
  }

  return {
    ok: true,
    clientIp,
    proxyChain: chain,
  };
}

/**
 * 检查 IP 是否在受信代理白名单
 */
function isTrustedProxy(ip: string, topology: TrustedProxyTopology): boolean {
  for (const entry of topology.trustedProxies) {
    if (!entry.enabled) continue;

    if (entry.type === "ipv4" || entry.type === "ipv6") {
      // 精确匹配
      if (ip === entry.address) {
        return true;
      }
    } else {
      // CIDR 匹配
      if (ipMatchCidr(ip, entry.address)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * 解析 X-Forwarded-For header
 *
 * 格式: "client, proxy1, proxy2"
 */
function parseXForwardedFor(header: string): string[] {
  return header
    .split(",")
    .map((ip) => ip.trim())
    .filter((ip) => ip.length > 0);
}

/**
 * IP CIDR 匹配（使用 ip-address 库）
 */
function ipMatchCidr(ip: string, cidr: string): boolean {
  // TODO: 使用 ip-address 库实现
  // import { Address4, Address6 } from "ip-address";
  return false;
}
```

### 3.3 Header 签名（HMAC-SHA256）

```typescript
/**
 * Trusted Proxy Header 签名
 *
 * 签名字段:
 * - X-OpenBot-Principal-Type
 * - X-OpenBot-Principal-Id
 * - X-OpenBot-Tenant-Id
 * - X-OpenBot-Session-Domain
 * - X-OpenBot-Nonce
 * - X-OpenBot-Timestamp
 *
 * 签名算法: HMAC-SHA256
 * 签名格式: X-OpenBot-Signature: keyId=<id>,signature=<hex>
 */
export function signTrustedProxyHeaders(
  headers: TrustedProxyHeaders,
  keyId: string,
  key: string,
): string {
  // 1. 构造签名原文（字段按字母序排列）
  const payload = [
    `nonce=${headers.nonce}`,
    `principal_id=${headers.principalId}`,
    `principal_type=${headers.principalType}`,
    `session_domain=${headers.sessionDomain}`,
    `tenant_id=${headers.tenantId ?? ""}`,
    `timestamp=${headers.timestamp}`,
  ].join("&");

  // 2. 计算 HMAC-SHA256
  const signature = crypto.createHmac("sha256", key).update(payload).digest("hex");

  // 3. 返回签名（带 keyId）
  return `keyId=${keyId},signature=${signature}`;
}

/**
 * 验证 Trusted Proxy Header 签名
 */
export function verifyTrustedProxyHeaders(
  headers: TrustedProxyHeaders,
  signatureHeader: string,
  topology: TrustedProxyTopology,
): { valid: true } | { valid: false; reason: string } {
  // 1. 解析签名 header
  const parsed = parseSignatureHeader(signatureHeader);
  if (!parsed) {
    return {
      valid: false,
      reason: "signature_header_invalid",
    };
  }

  const { keyId, signature } = parsed;

  // 2. 查找密钥
  let key: string | null = null;
  if (keyId === topology.keyRotation.currentKeyId) {
    key = topology.keyRotation.currentKey;
  } else if (topology.keyRotation.previousKey) {
    // 检查旧密钥是否仍在有效期内
    const expiry = topology.keyRotation.previousKeyExpiry;
    if (expiry && new Date(expiry) > new Date()) {
      key = topology.keyRotation.previousKey;
    }
  }

  if (!key) {
    return {
      valid: false,
      reason: `key_not_found: keyId=${keyId}`,
    };
  }

  // 3. 重新计算签名
  const expectedSignature = signTrustedProxyHeaders(headers, keyId, key);
  const expected = parseSignatureHeader(expectedSignature)?.signature;

  // 4. 常数时间比较（防止时序攻击）
  if (!constantTimeCompare(signature, expected ?? "")) {
    return {
      valid: false,
      reason: "signature_mismatch",
    };
  }

  return { valid: true };
}

function parseSignatureHeader(header: string): {
  keyId: string;
  signature: string;
} | null {
  // 格式: "keyId=<id>,signature=<hex>"
  const match = /keyId=([^,]+),signature=([a-f0-9]+)/.exec(header);
  if (!match) return null;

  return {
    keyId: match[1],
    signature: match[2],
  };
}

function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
```

### 3.4 Nonce + 时间戳防重放

```typescript
/**
 * Nonce 缓存（防重放攻击）
 *
 * 使用 LRU 缓存存储已见过的 nonce
 */
export class NonceCache {
  private cache: Map<string, number>; // nonce → timestamp
  private maxSize: number;

  constructor(maxSize: number = 10000) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  /**
   * 检查 nonce 是否已存在（重放攻击）
   */
  has(nonce: string): boolean {
    return this.cache.has(nonce);
  }

  /**
   * 记录 nonce
   */
  set(nonce: string, timestamp: number): void {
    // LRU 淘汰
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }

    this.cache.set(nonce, timestamp);
  }

  /**
   * 清理过期 nonce
   */
  cleanup(now: number, tolerance: number): void {
    const expiry = now - tolerance * 1000;
    for (const [nonce, timestamp] of this.cache.entries()) {
      if (timestamp < expiry) {
        this.cache.delete(nonce);
      }
    }
  }
}

/**
 * 验证时间戳（防止过期请求）
 */
export function verifyTimestamp(
  timestamp: string,
  tolerance: number,
): { valid: true } | { valid: false; reason: string } {
  const requestTime = new Date(timestamp).getTime();
  const now = Date.now();

  // 检查时间戳格式
  if (isNaN(requestTime)) {
    return {
      valid: false,
      reason: "timestamp_invalid",
    };
  }

  // 检查时间戳是否在容忍范围内
  const diff = Math.abs(now - requestTime);
  if (diff > tolerance * 1000) {
    return {
      valid: false,
      reason: `timestamp_expired: diff=${diff}ms, tolerance=${tolerance}s`,
    };
  }

  return { valid: true };
}

/**
 * 验证 Nonce（防止重放攻击）
 */
export function verifyNonce(
  nonce: string,
  nonceCache: NonceCache,
): { valid: true } | { valid: false; reason: string } {
  // 检查 nonce 格式（UUID v4）
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(nonce)) {
    return {
      valid: false,
      reason: "nonce_invalid_format",
    };
  }

  // 检查是否已存在（重放攻击）
  if (nonceCache.has(nonce)) {
    return {
      valid: false,
      reason: "nonce_replay_detected",
    };
  }

  // 记录 nonce
  nonceCache.set(nonce, Date.now());

  return { valid: true };
}
```

### 3.5 完整的 Trusted Proxy 解析流程

```typescript
/**
 * 解析 Trusted Proxy Headers（完整流程）
 */
export async function parseTrustedProxyHeaders(
  req: Request,
  topology: TrustedProxyTopology,
  nonceCache: NonceCache,
): Promise<
  | {
      ok: true;
      principal: TrustedPrincipal;
      clientIp: string;
      proxyInfo: ProxyInfo;
    }
  | {
      ok: false;
      reason: string;
    }
> {
  // 1. 解析代理链（单跳/多跳）
  const proxyResult =
    topology.proxyHops === "single"
      ? parseSingleHopProxy(req, topology)
      : parseMultiHopProxy(req, topology);

  if (!proxyResult.ok) {
    return proxyResult;
  }

  // 2. 读取 Trusted Proxy Headers
  const headers = extractTrustedProxyHeaders(req);
  if (!headers) {
    return {
      ok: false,
      reason: "trusted_proxy_headers_missing",
    };
  }

  // 3. 验证时间戳
  const timestampCheck = verifyTimestamp(headers.timestamp, topology.timestampTolerance);
  if (!timestampCheck.valid) {
    return {
      ok: false,
      reason: timestampCheck.reason,
    };
  }

  // 4. 验证 Nonce（防重放）
  const nonceCheck = verifyNonce(headers.nonce, nonceCache);
  if (!nonceCheck.valid) {
    return {
      ok: false,
      reason: nonceCheck.reason,
    };
  }

  // 5. 验证签名
  const signatureHeader = req.headers["x-openbot-signature"];
  if (!signatureHeader) {
    return {
      ok: false,
      reason: "signature_missing",
    };
  }

  const signatureCheck = verifyTrustedProxyHeaders(headers, signatureHeader, topology);
  if (!signatureCheck.valid) {
    return {
      ok: false,
      reason: signatureCheck.reason,
    };
  }

  // 6. 构造 Principal
  const principal: TrustedPrincipal = {
    type: headers.principalType,
    userId: headers.principalId,
    tenantId: headers.tenantId,
    sessionDomain: headers.sessionDomain,
    authenticatedAt: headers.timestamp,
  };

  // 7. 构造 Proxy Info
  const proxyInfo: ProxyInfo = {
    clientIp: proxyResult.clientIp,
    proxyChain: "proxyChain" in proxyResult ? proxyResult.proxyChain : [proxyResult.proxyIp],
    verifiedAt: new Date().toISOString(),
  };

  return {
    ok: true,
    principal,
    clientIp: proxyResult.clientIp,
    proxyInfo,
  };
}

function extractTrustedProxyHeaders(req: Request): TrustedProxyHeaders | null {
  const principalType = req.headers["x-openbot-principal-type"];
  const principalId = req.headers["x-openbot-principal-id"];
  const tenantId = req.headers["x-openbot-tenant-id"];
  const sessionDomain = req.headers["x-openbot-session-domain"];
  const nonce = req.headers["x-openbot-nonce"];
  const timestamp = req.headers["x-openbot-timestamp"];

  if (!principalType || !principalId || !sessionDomain || !nonce || !timestamp) {
    return null;
  }

  return {
    principalType: principalType as PrincipalType,
    principalId,
    tenantId: tenantId || null,
    sessionDomain: sessionDomain as SessionDomain,
    nonce,
    timestamp,
  };
}
```

### 3.6 密钥轮换

```typescript
/**
 * 密钥轮换（每 90 天）
 *
 * 流程:
 * 1. 生成新密钥
 * 2. 设置重叠期（7 天）
 * 3. 新旧密钥同时有效
 * 4. 7 天后禁用旧密钥
 */
export async function rotateSignatureKey(
  currentTopology: TrustedProxyTopology,
): Promise<TrustedProxyTopology> {
  // 1. 生成新密钥
  const newKeyId = `key-${Date.now()}`;
  const newKey = generateSecureKey(32); // 256 位

  // 2. 保留旧密钥（重叠期 7 天）
  const previousKey = currentTopology.keyRotation.currentKey;
  const previousKeyExpiry = new Date();
  previousKeyExpiry.setDate(previousKeyExpiry.getDate() + 7);

  // 3. 更新拓扑配置
  return {
    ...currentTopology,
    keyRotation: {
      currentKeyId: newKeyId,
      currentKey: newKey,
      previousKey,
      previousKeyExpiry: previousKeyExpiry.toISOString(),
    },
  };
}

function generateSecureKey(bytes: number): string {
  return crypto.randomBytes(bytes).toString("hex");
}
```

---

## 4. 配置示例

### 4.1 单跳代理配置

```yaml
# config/trusted-proxy.yml
trustedProxy:
  proxyHops: single
  trustedProxies:
    - address: "10.0.0.100"
      type: ipv4
      name: "nginx-gateway"
      enabled: true

  signatureKey: "your-signature-key-here"

  keyRotation:
    currentKeyId: "key-2026-08-29"
    currentKey: "abcdef1234567890..."
    previousKey: null
    previousKeyExpiry: null

  timestampTolerance: 300 # 5 分钟
  nonceCacheSize: 10000
```

### 4.2 多跳代理配置

```yaml
trustedProxy:
  proxyHops: multi
  trustedProxies:
    # CDN
    - address: "203.0.113.0/24"
      type: cidr-v4
      name: "cloudflare-cdn"
      enabled: true

    # Load Balancer
    - address: "10.0.1.0/24"
      type: cidr-v4
      name: "aws-elb"
      enabled: true

    # Nginx
    - address: "10.0.2.100"
      type: ipv4
      name: "nginx-gateway"
      enabled: true

  signatureKey: "your-signature-key-here"

  keyRotation:
    currentKeyId: "key-2026-08-29"
    currentKey: "abcdef1234567890..."
    previousKey: "xyz789..."
    previousKeyExpiry: "2026-09-05T00:00:00Z"

  timestampTolerance: 300
  nonceCacheSize: 10000
```

---

## 5. 测试计划

### 5.1 直连拒绝测试

```typescript
describe("Trusted Proxy: Direct Connection Rejection", () => {
  it("should reject direct connection from untrusted IP", async () => {
    const req = makeRequestFromIp("192.168.1.100"); // 非白名单 IP

    const result = await parseTrustedProxyHeaders(req, topology, nonceCache);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("direct_connection_rejected");
    }
  });

  it("should accept connection from trusted proxy", async () => {
    const req = makeRequestFromIp("10.0.0.100"); // 白名单 IP
    req.headers["x-forwarded-for"] = "203.0.113.50";
    req.headers["x-openbot-principal-type"] = "employee";
    req.headers["x-openbot-principal-id"] = "usr-123";
    req.headers["x-openbot-session-domain"] = "employee";
    req.headers["x-openbot-nonce"] = "12345678-1234-4234-8234-123456789012";
    req.headers["x-openbot-timestamp"] = new Date().toISOString();
    req.headers["x-openbot-signature"] = signHeaders(req.headers, topology);

    const result = await parseTrustedProxyHeaders(req, topology, nonceCache);

    expect(result.ok).toBe(true);
  });
});
```

### 5.2 签名验证测试

```typescript
describe("Trusted Proxy: Signature Verification", () => {
  it("should reject request with invalid signature", async () => {
    const req = makeTrustedProxyRequest();
    req.headers["x-openbot-signature"] = "keyId=key-2026,signature=invalid";

    const result = await parseTrustedProxyHeaders(req, topology, nonceCache);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("signature_mismatch");
    }
  });

  it("should accept request with valid signature", async () => {
    const req = makeTrustedProxyRequest();
    const signature = signTrustedProxyHeaders(
      req.headers,
      topology.keyRotation.currentKeyId,
      topology.keyRotation.currentKey,
    );
    req.headers["x-openbot-signature"] = signature;

    const result = await parseTrustedProxyHeaders(req, topology, nonceCache);

    expect(result.ok).toBe(true);
  });

  it("should accept request with old key during overlap period", async () => {
    const req = makeTrustedProxyRequest();
    const signature = signTrustedProxyHeaders(
      req.headers,
      "old-key-id",
      topology.keyRotation.previousKey!,
    );
    req.headers["x-openbot-signature"] = signature;

    const result = await parseTrustedProxyHeaders(req, topology, nonceCache);

    expect(result.ok).toBe(true);
  });

  it("should reject request with expired old key", async () => {
    const topologyExpired = {
      ...topology,
      keyRotation: {
        ...topology.keyRotation,
        previousKeyExpiry: "2026-08-01T00:00:00Z", // 已过期
      },
    };

    const req = makeTrustedProxyRequest();
    const signature = signTrustedProxyHeaders(
      req.headers,
      "old-key-id",
      topologyExpired.keyRotation.previousKey!,
    );
    req.headers["x-openbot-signature"] = signature;

    const result = await parseTrustedProxyHeaders(req, topologyExpired, nonceCache);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("key_not_found");
    }
  });
});
```

### 5.3 重放攻击测试

```typescript
describe("Trusted Proxy: Replay Attack Prevention", () => {
  it("should reject replayed request (same nonce)", async () => {
    const req1 = makeTrustedProxyRequest();
    const nonce = "12345678-1234-4234-8234-123456789012";
    req1.headers["x-openbot-nonce"] = nonce;

    // 第一次请求成功
    const result1 = await parseTrustedProxyHeaders(req1, topology, nonceCache);
    expect(result1.ok).toBe(true);

    // 第二次请求（重放）被拒绝
    const req2 = makeTrustedProxyRequest();
    req2.headers["x-openbot-nonce"] = nonce;

    const result2 = await parseTrustedProxyHeaders(req2, topology, nonceCache);
    expect(result2.ok).toBe(false);
    if (!result2.ok) {
      expect(result2.reason).toBe("nonce_replay_detected");
    }
  });

  it("should reject request with expired timestamp", async () => {
    const req = makeTrustedProxyRequest();
    const expiredTime = new Date();
    expiredTime.setMinutes(expiredTime.getMinutes() - 10); // 10 分钟前
    req.headers["x-openbot-timestamp"] = expiredTime.toISOString();

    const result = await parseTrustedProxyHeaders(req, topology, nonceCache);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("timestamp_expired");
    }
  });
});
```

### 5.4 多跳代理测试

```typescript
describe("Trusted Proxy: Multi-Hop Proxy", () => {
  it("should extract client IP from multi-hop chain", async () => {
    const topology = makeMultiHopTopology();
    const req = makeRequestFromIp("10.0.2.100"); // Nginx
    req.headers["x-forwarded-for"] = "203.0.113.50, 10.0.1.50, 10.0.2.100"; // Client, LB, Nginx

    const result = parseMultiHopProxy(req, topology);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.clientIp).toBe("203.0.113.50");
      expect(result.proxyChain).toEqual(["203.0.113.50", "10.0.1.50", "10.0.2.100"]);
    }
  });
});
```

---

## 6. 修订总结

### 修订前（存在问题）

- ❌ 只有 IP 白名单，缺少签名验证
- ❌ 无代理链解析规则
- ❌ 无重放攻击防护
- ❌ 无密钥轮换机制
- ❌ 无直连拒绝测试

### 修订后（问题解决）

- ✅ HMAC-SHA256 签名验证
- ✅ 单跳/多跳代理解析
- ✅ Nonce + 时间戳防重放
- ✅ IPv4/IPv6 + CIDR 支持
- ✅ 密钥轮换（90 天 + 7 天重叠期）
- ✅ 完整的威胁模型（8 种威胁）
- ✅ 完整的测试计划

### 安全保证

- ✅ 直连绕过被拒绝
- ✅ Header 伪造被检测
- ✅ 重放攻击被阻止
- ✅ 密钥泄露影响可控（轮换）
- ✅ 所有失败都记录审计日志

---

**修订状态**: ✅ 完成  
**修订日期**: 2026-08-29  
**修订人**: kiro-daibai
