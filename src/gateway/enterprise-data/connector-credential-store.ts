import { randomUUID } from "node:crypto";
import { EnterpriseDataStoreError } from "./connector-action-store.js";
import { assertKnownDataConnector } from "./connector-catalog.js";
import type { DataConnectorCredential, EnterpriseDataStore } from "./types.js";

export function listDataConnectorCredentials(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  connectorId?: string;
}): DataConnectorCredential[] {
  const connectorFilter = params.connectorId?.trim().toLowerCase();
  return Object.values(params.store.dataConnectorCredentials)
    .filter((credential) => {
      if (credential.tenantId !== params.tenantId) {
        return false;
      }
      if (connectorFilter && credential.connectorId.toLowerCase() !== connectorFilter) {
        return false;
      }
      return credential.status !== "revoked";
    })
    .toSorted((left, right) => left.label.localeCompare(right.label));
}

export function findDataConnectorCredential(
  store: EnterpriseDataStore,
  tenantId: string,
  credentialId: string,
): DataConnectorCredential | null {
  const credential = store.dataConnectorCredentials[credentialId];
  if (!credential || credential.tenantId !== tenantId) {
    return null;
  }
  return credential;
}

export function upsertDataConnectorCredential(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  connectorId: string;
  label: string;
  kind: DataConnectorCredential["kind"];
  instanceUrl?: string;
  secretHint?: string;
  credentialId?: string;
  nowIso: string;
}): DataConnectorCredential {
  const connectorId = params.connectorId.trim();
  const definition = assertKnownDataConnector(connectorId);
  if (definition.accessMethod === "website_session") {
    throw new EnterpriseDataStoreError(
      "CONNECTOR_CREDENTIAL_KIND",
      "Website session accounts use AccountBinding.bindingId and cannot be stored as api_key or oauth2.",
    );
  }
  const label = params.label.trim();
  if (!label) {
    throw new EnterpriseDataStoreError(
      "CONNECTOR_CREDENTIAL_LABEL_REQUIRED",
      "Credential label is required.",
    );
  }
  const existing =
    params.credentialId != null
      ? findDataConnectorCredential(params.store, params.tenantId, params.credentialId)
      : null;
  const record: DataConnectorCredential = {
    credentialId: existing?.credentialId ?? params.credentialId ?? randomUUID(),
    tenantId: params.tenantId,
    connectorId,
    kind: params.kind,
    status: "active",
    label,
    secretHint: params.secretHint ?? existing?.secretHint,
    instanceUrl: params.instanceUrl?.trim() || existing?.instanceUrl,
    createdAt: existing?.createdAt ?? params.nowIso,
    updatedAt: params.nowIso,
  };
  params.store.dataConnectorCredentials[record.credentialId] = record;
  return record;
}

export function revokeDataConnectorCredential(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  credentialId: string;
  nowIso: string;
}): DataConnectorCredential {
  const credential = findDataConnectorCredential(
    params.store,
    params.tenantId,
    params.credentialId,
  );
  if (!credential) {
    throw new EnterpriseDataStoreError(
      "CONNECTOR_CREDENTIAL_NOT_FOUND",
      "Data connector credential not found.",
    );
  }
  credential.status = "revoked";
  credential.updatedAt = params.nowIso;
  return credential;
}
