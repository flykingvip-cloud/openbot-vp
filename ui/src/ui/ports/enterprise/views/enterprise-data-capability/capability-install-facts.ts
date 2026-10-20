import { html, nothing, type TemplateResult } from "lit";

export type CapabilityInstallFactsView = {
  skillId: string;
  websites: Array<{ sourceId: string; displayName: string; capabilityId: string; version: string }>;
  accountRequirement: "待配置" | "已绑定";
  bindingId: string | null;
  executionVersion: string | null;
  executionDigest: string | null;
  catalogVersion: string | null;
  reviewedAt: string | null;
  verification: "unverified" | "passed" | "failed" | "stale" | "unknown";
  bridgeVerification: "unverified" | "passed" | "failed" | "stale" | "unknown";
  maturityLabel: string | null;
  effects: string[];
  dependencies: string[];
  executable: boolean;
  denialMessage: string | null;
  inFlightSideEffectsWithdrawn: false;
  entersKnowledgeProjection: false;
};

const VERIFICATION = new Set(["unverified", "passed", "failed", "stale", "unknown"]);

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function verificationLabel(value: CapabilityInstallFactsView["verification"]): string {
  switch (value) {
    case "passed":
      return "已验证";
    case "failed":
      return "验证失败";
    case "stale":
      return "验证过期";
    case "unverified":
      return "未验证";
    default:
      return "验证未记录";
  }
}

export function normalizeCapabilityInstallFacts(
  raw: unknown,
  maturityLabel: string | null = null,
): CapabilityInstallFactsView | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const skillId = text(record.skillId);
  if (!skillId) {
    return null;
  }
  const verification = text(record.verification);
  const bridgeVerification = text(record.bridgeVerification);
  const websites = Array.isArray(record.websites)
    ? record.websites.flatMap((entry) => {
        if (!entry || typeof entry !== "object") {
          return [];
        }
        const site = entry as Record<string, unknown>;
        const sourceId = text(site.sourceId);
        const capabilityId = text(site.capabilityId);
        if (!sourceId || !capabilityId) {
          return [];
        }
        return [
          {
            sourceId,
            displayName: text(site.displayName) || sourceId,
            capabilityId,
            version: text(site.version),
          },
        ];
      })
    : [];
  const accountRequirement = record.accountRequirement === "已绑定" ? "已绑定" : "待配置";
  return {
    skillId,
    websites,
    accountRequirement,
    bindingId: accountRequirement === "已绑定" ? text(record.bindingId) || null : null,
    executionVersion: text(record.executionVersion) || null,
    executionDigest: text(record.executionDigest) || null,
    catalogVersion: text(record.catalogVersion) || null,
    reviewedAt: text(record.reviewedAt) || null,
    verification: VERIFICATION.has(verification)
      ? (verification as CapabilityInstallFactsView["verification"])
      : "unknown",
    bridgeVerification: VERIFICATION.has(bridgeVerification)
      ? (bridgeVerification as CapabilityInstallFactsView["bridgeVerification"])
      : "unknown",
    maturityLabel: text(maturityLabel) || text(record.maturityLabel) || null,
    effects: Array.isArray(record.effects) ? record.effects.map(text).filter(Boolean) : [],
    dependencies: Array.isArray(record.dependencies)
      ? record.dependencies.map(text).filter(Boolean)
      : [],
    executable: record.executable === true,
    denialMessage: text(record.denialMessage) || null,
    inFlightSideEffectsWithdrawn: false,
    entersKnowledgeProjection: false,
  };
}

function effectLabel(effect: string): string {
  if (effect === "read") {
    return "读取";
  }
  if (effect === "create") {
    return "写入 · 创建";
  }
  if (effect === "update") {
    return "写入 · 更新";
  }
  return effect;
}

export function renderCapabilityInstallFacts(params: {
  facts: CapabilityInstallFactsView | null;
  loading: boolean;
}): TemplateResult | typeof nothing {
  if (params.loading) {
    return html`
      <div class="enterprise-data-capability__hint">正在读取安装与验证…</div>
    `;
  }
  if (!params.facts) {
    return nothing;
  }
  const facts = params.facts;
  const versionDrift =
    facts.executionVersion &&
    facts.catalogVersion &&
    facts.executionVersion !== facts.catalogVersion;
  return html`
    <section class="enterprise-capability-center-page__asset-links" aria-label="安装与验证">
      <strong>安装与验证</strong>
      <dl>
        <div>
          <dt>关联网站</dt>
          <dd>
            ${
              facts.websites.length === 0
                ? "无"
                : facts.websites.map(
                    (site) =>
                      html`${site.displayName} · ${site.capabilityId}${
                        site.version ? `@${site.version}` : ""
                      }`,
                  )
            }
          </dd>
        </div>
        <div>
          <dt>账户</dt>
          <dd>${facts.accountRequirement}${facts.bindingId ? ` · ${facts.bindingId}` : ""}</dd>
        </div>
        <div>
          <dt>执行版本</dt>
          <dd>${facts.executionVersion ?? "未钉死"}${
            facts.executionDigest ? ` · ${facts.executionDigest}` : ""
          }</dd>
        </div>
        <div>
          <dt>目录版本</dt>
          <dd>
            ${facts.catalogVersion ?? "无"}${versionDrift ? " · 不替换执行版本" : ""}
          </dd>
        </div>
        <div>
          <dt>验证</dt>
          <dd>
            ${verificationLabel(facts.verification)}${
              facts.reviewedAt ? ` · ${facts.reviewedAt}` : " · 验证时间未记录"
            }
          </dd>
        </div>
        <div>
          <dt>成熟度</dt>
          <dd>${facts.maturityLabel ?? "无"} · 不作为执行条件</dd>
        </div>
        <div>
          <dt>副作用</dt>
          <dd>
            ${
              facts.effects.length === 0
                ? "无"
                : facts.effects.map((effect) => effectLabel(effect)).join("、")
            }
            · 写入不进入投影，停用或撤销不撤回在途副作用
          </dd>
        </div>
        <div>
          <dt>依赖</dt>
          <dd>${facts.dependencies.length === 0 ? "无" : facts.dependencies.join("、")}</dd>
        </div>
        <div>
          <dt>执行</dt>
          <dd>${facts.executable ? "可以执行" : facts.denialMessage || "不可执行"}</dd>
        </div>
      </dl>
    </section>
  `;
}
