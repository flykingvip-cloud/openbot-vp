import type {
  EnterpriseIdentityStatus,
  EnterpriseOperationalIdentityProvider,
} from "../enterprise-operational-identity-types.js";

/** 运营动作 vs 数据同步动作：后者仅用于 DataSource 绑定语义，不得进入 IdentityUsagePolicy。 */
export type OperationalIdentityActionKind = "operational" | "data_sync";

export type OperationalIdentityActionSpec = {
  action: string;
  label: string;
  kind: OperationalIdentityActionKind;
};

export type OperationalIdentityProviderRolloutTier = "p0" | "p2";

export type OperationalIdentityRegistrationMethod = "oauth" | "manual";

export type OperationalIdentityCredentialFieldKind =
  | "text"
  | "password"
  | "email"
  | "url"
  | "number";

export type OperationalIdentityCredentialFieldSpec = {
  key: string;
  label: string;
  kind: OperationalIdentityCredentialFieldKind;
  required: boolean;
  /** metadata 写入 secret.metadata；secret 写入 accessToken（唯一密钥字段）。 */
  storage: "metadata" | "secret";
  hint?: string;
};

export type OperationalIdentityRegistrationProfile = {
  /** 面向管理员的配置说明：AI 调用此身份需要什么。 */
  summary: string;
  methods: OperationalIdentityRegistrationMethod[];
  manualFields?: OperationalIdentityCredentialFieldSpec[];
  oauthHint?: string;
  verifyChecks: Array<{ key: string; label: string }>;
  /** 各运营动作依赖的凭证字段（从 AI 执行路径反推）。 */
  actionRequirements: Array<{ action: string; requiredFieldKeys: string[] }>;
};

export type OperationalIdentityCredentialReadinessItem = {
  key: string;
  label: string;
  satisfied: boolean;
  scope: "field" | "verify" | "identity";
  detail?: string;
};

export type OperationalIdentityProviderAdapter = {
  provider: EnterpriseOperationalIdentityProvider;
  label: string;
  category: "official" | "communication" | "business";
  connectorIds: string[];
  rolloutTier: OperationalIdentityProviderRolloutTier;
  /** 是否已有可注册凭证通道（false 时 UI/API 应明确降级提示）。 */
  registrationReady: boolean;
  actions: OperationalIdentityActionSpec[];
  reauthHint: string;
  degradedHint?: string;
};

export type OperationalIdentityProviderCatalogEntry = {
  provider: EnterpriseOperationalIdentityProvider;
  label: string;
  category: "official" | "communication" | "business";
  connectorIds: string[];
  rolloutTier: OperationalIdentityProviderRolloutTier;
  registrationReady: boolean;
  operationalActions: Array<{ action: string; label: string }>;
  dataSyncActions: Array<{ action: string; label: string }>;
  reauthHint: string;
  degradedHint: string | null;
  registrationProfile: OperationalIdentityRegistrationProfile;
  /** 第三方平台 OAuth 是否已在 Gateway 环境就绪（如微信 component app）。 */
  oauthConfigured?: boolean;
  /** 微信 component_verify_ticket 是否已就绪（推送或 env 兜底）。 */
  oauthTicketReady?: boolean;
};

export type OperationalIdentityStatusHint = {
  status: EnterpriseIdentityStatus;
  label: string;
  tone: "ok" | "warn" | "danger";
  detail: string;
};
