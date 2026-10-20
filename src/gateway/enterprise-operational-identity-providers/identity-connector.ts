import type { EnterpriseOperationalIdentityCredentialSecret } from "../enterprise-operational-identity-oauth/credential-secrets-persistence.js";
import type { EnterpriseOperationalIdentityProvider } from "../enterprise-operational-identity-types.js";
import type { OperationalIdentityCapabilityDiscovery } from "./capability-discovery.js";
import type { OperationalIdentityCredentialProbeResult } from "./credential-probe.js";

/**
 * Operational Identity Connector 规范（Provider 实现契约）。
 *
 * 生命周期：connect → verify → discoverCapabilities → active → agent binding
 * execute / refreshCredential 由后续 execution 层接入。
 */
export type IdentityConnectorConnectResult = {
  externalAccountId?: string;
  displayName?: string;
  expiresAt?: string;
};

export type IdentityConnectorVerifyResult = {
  probeResults: Record<string, OperationalIdentityCredentialProbeResult>;
  ready: boolean;
};

export type IdentityConnectorContext = {
  provider: EnterpriseOperationalIdentityProvider;
  secret: EnterpriseOperationalIdentityCredentialSecret | null;
  externalAccountId?: string;
  nowIso: string;
};

export interface IdentityConnector {
  readonly provider: EnterpriseOperationalIdentityProvider;

  /** OAuth 或手动凭证写入后的连接确认（可选；多数 Provider 在 upsert/OAuth 回调中已完成）。 */
  connect?(ctx: IdentityConnectorContext): Promise<IdentityConnectorConnectResult | null>;

  /** 探测凭证可用性（SMTP/IMAP/token 等）。 */
  verify(ctx: IdentityConnectorContext): Promise<IdentityConnectorVerifyResult>;

  /** 检测 Agent 实际可用的运营动作子集。 */
  discoverCapabilities(
    ctx: IdentityConnectorContext,
    verify: IdentityConnectorVerifyResult,
  ): Promise<OperationalIdentityCapabilityDiscovery>;

  /** 刷新 OAuth / authorizer token（长期运行）。 */
  refreshCredential?(
    ctx: IdentityConnectorContext,
  ): Promise<EnterpriseOperationalIdentityCredentialSecret | null>;

  /** 撤销凭证与身份绑定（与 revokeEnterpriseIdentity 对齐）。 */
  revoke?(ctx: IdentityConnectorContext): Promise<void>;
}
