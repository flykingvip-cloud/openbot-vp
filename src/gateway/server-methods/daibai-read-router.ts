/**
 * Daibai Read Router — 把 self_serve 意图映射为「推荐只读 RPC + 参数」。
 *
 * 边界（关键）：大白**不旁路鉴权**。这里只产出只读路由建议（domain + 推荐 method + 参数），
 * 实际只读调用仍由调用方（前端/会话）用**用户自己的会话**发起，使各 handler 的既有鉴权 +
 * 受信用户上下文（`resolveTrustedEnterpriseDataExecutionContext` 等）自然生效。
 *
 * 这避免了 E2 internal-dispatch（默认禁用）带来的「网关代用户调读 RPC、上下文/预算错配」风险，
 * 同时让大白成为「告诉你去哪查 + 帮你拼好参数」的解决者入口。
 */

export type DaibaiReadRecommendation = {
  domain: string;
  /** 推荐调用的只读 RPC method（均为 READ_SCOPE）。 */
  recommendedMethod: string;
  /** 建议参数（调用方按需补全用户/租户上下文）。 */
  params: Record<string, unknown>;
  /** 给用户的简短说明。 */
  description: string;
};

const READ_DOMAIN_MAP: Record<
  string,
  { method: string; description: string; buildParams: (message: string) => Record<string, unknown> }
> = {
  knowledge: {
    method: "knowledge.search",
    description: "我可以在你的知识范围内检索相关内容。",
    buildParams: (message) => ({ query: message.slice(0, 200) }),
  },
  capability: {
    method: "employee-capability.profile",
    description: "我可以列出你当前可用的能力与权限范围。",
    buildParams: () => ({}),
  },
  billing: {
    method: "billing.dashboard",
    description: "我可以帮你查看当前的用量与预算情况。",
    buildParams: () => ({}),
  },
  "model-access": {
    method: "employee-model-access.summary",
    description: "我可以帮你查看当前可用的模型。",
    buildParams: () => ({}),
  },
};

/** 按 domainHint 构造只读路由建议（未知 domain 回退知识检索）。 */
export function buildReadRecommendation(
  domainHint: string | undefined,
  message: string,
): DaibaiReadRecommendation {
  const key = domainHint && READ_DOMAIN_MAP[domainHint] ? domainHint : "knowledge";
  const entry = READ_DOMAIN_MAP[key];
  return {
    domain: key,
    recommendedMethod: entry.method,
    params: entry.buildParams(message),
    description: entry.description,
  };
}
