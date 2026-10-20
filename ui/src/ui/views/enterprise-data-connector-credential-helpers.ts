import type { HttpRestAuthScheme } from "../capability/enterprise-data-capability/types.ts";

/** Connector credential fields shared by enterprise source editor and knowledge space import. */
export type ConnectorCredentialDraftFields = {
  connectorId: string;
  credentialId: string;
  credentialLabel: string;
  instanceUrl: string;
  apiKey: string;
  saveNewCredential: boolean;
  authScheme: HttpRestAuthScheme;
  authHeaderName: string;
  authQueryParam: string;
  basicUsername: string;
  probePath: string;
  dbHost: string;
  dbPort: string;
  dbName: string;
};

export function createEmptyConnectorCredentialDraft(): ConnectorCredentialDraftFields {
  return {
    connectorId: "",
    credentialId: "",
    credentialLabel: "",
    instanceUrl: "",
    apiKey: "",
    saveNewCredential: false,
    authScheme: "bearer",
    authHeaderName: "",
    authQueryParam: "",
    basicUsername: "",
    probePath: "",
    dbHost: "",
    dbPort: "",
    dbName: "",
  };
}

export function resetConnectorCredentialDraftForConnectorChange(
  draft: ConnectorCredentialDraftFields,
): void {
  draft.credentialId = "";
  draft.credentialLabel = "";
  draft.instanceUrl = "";
  draft.apiKey = "";
  draft.authScheme = "bearer";
  draft.authHeaderName = "";
  draft.authQueryParam = "";
  draft.basicUsername = "";
  draft.probePath = "";
  draft.dbHost = "";
  draft.dbPort = "";
  draft.dbName = "";
  draft.saveNewCredential = false;
}

export function buildConnectorSecretOptions(draft: ConnectorCredentialDraftFields): {
  authScheme?: HttpRestAuthScheme;
  authHeaderName?: string;
  authQueryParam?: string;
  basicUsername?: string;
  probePath?: string;
} {
  const connectorId = draft.connectorId.trim();
  if (connectorId === "http-rest") {
    return {
      authScheme: draft.authScheme,
      authHeaderName: draft.authHeaderName.trim() || undefined,
      authQueryParam: draft.authQueryParam.trim() || undefined,
      basicUsername: draft.basicUsername.trim() || undefined,
      probePath: draft.probePath.trim() || undefined,
    };
  }
  if (connectorId === "db-postgres") {
    return { basicUsername: draft.basicUsername.trim() || undefined };
  }
  return {};
}

export function resolveConnectorInstanceUrl(draft: ConnectorCredentialDraftFields): string {
  if (draft.connectorId.trim() === "db-postgres") {
    const host = draft.dbHost.trim();
    if (!host) {
      return "";
    }
    const port = draft.dbPort.trim() || "5432";
    const db = draft.dbName.trim();
    return `postgres://${host}:${port}${db ? `/${db}` : ""}`;
  }
  return draft.instanceUrl.trim();
}

export function shouldCreateConnectorCredential(draft: ConnectorCredentialDraftFields): boolean {
  const resolvedInstanceUrl = resolveConnectorInstanceUrl(draft);
  const isHttpRestNoneAuth =
    draft.connectorId.trim() === "http-rest" && draft.authScheme === "none";
  return (
    draft.saveNewCredential &&
    draft.credentialLabel.trim().length > 0 &&
    resolvedInstanceUrl.length > 0 &&
    (draft.apiKey.trim().length > 0 || isHttpRestNoneAuth)
  );
}

export function buildConnectorConnectionOptions(
  draft: ConnectorCredentialDraftFields,
  credentialId?: string,
) {
  return {
    credentialId: credentialId?.trim() || draft.credentialId.trim() || undefined,
    instanceUrl: resolveConnectorInstanceUrl(draft) || undefined,
    apiKey: draft.apiKey.trim() || undefined,
    ...buildConnectorSecretOptions(draft),
  };
}

export function showConnectorNewCredentialForm(draft: ConnectorCredentialDraftFields): boolean {
  return draft.saveNewCredential || draft.credentialId.trim() === "";
}
