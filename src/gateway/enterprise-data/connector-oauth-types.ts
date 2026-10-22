export type DataConnectorOAuthMode =
  | "notion_authorization_code"
  | "salesforce_authorization_code"
  | "yonyou_tplus_authorization_code"
  | "simulated";

export type DataConnectorOAuthSessionStatus =
  | "pending"
  | "completed"
  | "expired"
  | "failed"
  | "cancelled";

export type DataConnectorOAuthSession = {
  sessionId: string;
  state: string;
  tenantId: string;
  connectorId: string;
  label: string;
  mode: DataConnectorOAuthMode;
  status: DataConnectorOAuthSessionStatus;
  /** Chanjet cloud enterprise id captured when the authorize URL is built. */
  orgId?: string;
  /** Chanjet appName captured when the authorize URL is built. */
  appName?: string;
  credentialId?: string;
  returnPath?: string;
  createdAt: string;
  expiresAt: string;
  completedAt?: string;
  errorMessage?: string;
};

export type DataConnectorOAuthSessionStore = {
  version: 1;
  sessions: Record<string, DataConnectorOAuthSession>;
};

export const DATA_CONNECTOR_OAUTH_SESSION_STORE_VERSION = 1 as const;
