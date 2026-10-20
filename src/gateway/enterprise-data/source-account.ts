import { findDataConnectorDefinition } from "./connector-catalog.js";
import { findDataConnectorCredential } from "./connector-credential-store.js";
import { findDataSource, listDataSources } from "./data-source-store.js";
import type {
  DataConnectorAccessMethod,
  DataConnectorCredential,
  DataSource,
  EnterpriseDataStore,
  InvocationDenialReason,
} from "./types.js";

export type SourceCredentialSelection =
  | { kind: "none" }
  | { kind: "credential"; credential: DataConnectorCredential }
  | { kind: "deny"; code: InvocationDenialReason; message: string };

export function resolveConnectorAccessMethod(connectorId: string): DataConnectorAccessMethod {
  return findDataConnectorDefinition(connectorId)?.accessMethod ?? "credential";
}

function sourcesForConnector(
  store: EnterpriseDataStore,
  tenantId: string,
  connectorId: string,
): DataSource[] {
  const normalized = connectorId.trim().toLowerCase();
  return listDataSources({ store, tenantId }).filter(
    (source) => source.connectorId.trim().toLowerCase() === normalized,
  );
}

/**
 * Pick the credential for one DataSource. Never uses "first active credential
 * for this connectorId" when that would cross accounts.
 */
export function selectSourceCredential(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  connectorId: string;
  sourceId?: string;
}): SourceCredentialSelection {
  const sources = sourcesForConnector(params.store, params.tenantId, params.connectorId);
  let source: DataSource | null = null;
  if (params.sourceId) {
    source = findDataSource(params.store, params.tenantId, params.sourceId);
    if (
      !source ||
      source.connectorId.trim().toLowerCase() !== params.connectorId.trim().toLowerCase()
    ) {
      return {
        kind: "deny",
        code: "SOURCE_NOT_FOUND",
        message: `DataSource ${params.sourceId} is not an instance of ${params.connectorId}.`,
      };
    }
  } else if (sources.length > 1) {
    return {
      kind: "deny",
      code: "SOURCE_ACCOUNT_AMBIGUOUS",
      message: `Connector ${params.connectorId} has multiple data sources. Pass sourceId.`,
    };
  } else if (sources.length === 1) {
    source = sources[0] ?? null;
  }

  if (source?.credentialId) {
    const sharers = sources.filter((item) => item.credentialId === source.credentialId);
    if (sharers.length > 1) {
      return {
        kind: "deny",
        code: "SOURCE_ACCOUNT_AMBIGUOUS",
        message: `Credential ${source.credentialId} is shared by multiple ${params.connectorId} sources.`,
      };
    }
    const credential = findDataConnectorCredential(
      params.store,
      params.tenantId,
      source.credentialId,
    );
    if (
      !credential ||
      credential.connectorId.trim().toLowerCase() !== params.connectorId.trim().toLowerCase()
    ) {
      return {
        kind: "deny",
        code: "SOURCE_CREDENTIAL_MISSING",
        message: `DataSource ${source.sourceId} credential is missing or belongs to another connector.`,
      };
    }
    if (credential.status === "reauth_required") {
      return {
        kind: "deny",
        code: "CREDENTIAL_REAUTH_REQUIRED",
        message: "Connector credential requires re-authentication.",
      };
    }
    if (credential.status !== "active") {
      return {
        kind: "deny",
        code: "SOURCE_CREDENTIAL_MISSING",
        message: `Credential ${credential.credentialId} is not active.`,
      };
    }
    return { kind: "credential", credential };
  }

  if (source) {
    // A source without its own credential must not inherit another account.
    return { kind: "none" };
  }

  const active = Object.values(params.store.dataConnectorCredentials).filter(
    (credential) =>
      credential.tenantId === params.tenantId &&
      credential.connectorId.trim().toLowerCase() === params.connectorId.trim().toLowerCase() &&
      credential.status === "active",
  );
  if (active.length > 1) {
    return {
      kind: "deny",
      code: "SOURCE_ACCOUNT_AMBIGUOUS",
      message: `Multiple active credentials exist for ${params.connectorId}. Bind each sourceId explicitly.`,
    };
  }
  if (active.length === 1 && active[0]) {
    return { kind: "credential", credential: active[0] };
  }
  return { kind: "none" };
}
