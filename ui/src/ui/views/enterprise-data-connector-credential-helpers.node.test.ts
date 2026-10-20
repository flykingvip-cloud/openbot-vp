// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  buildConnectorConnectionOptions,
  createEmptyConnectorCredentialDraft,
  resolveConnectorInstanceUrl,
  shouldCreateConnectorCredential,
} from "./enterprise-data-connector-credential-helpers.ts";

describe("enterprise-data-connector-credential-helpers", () => {
  it("builds postgres instance url from structured fields", () => {
    const draft = createEmptyConnectorCredentialDraft();
    draft.connectorId = "db-postgres";
    draft.dbHost = "db.example.com";
    draft.dbPort = "5433";
    draft.dbName = "analytics";
    expect(resolveConnectorInstanceUrl(draft)).toBe("postgres://db.example.com:5433/analytics");
  });

  it("allows http-rest none auth credential without api key", () => {
    const draft = createEmptyConnectorCredentialDraft();
    draft.connectorId = "http-rest";
    draft.saveNewCredential = true;
    draft.credentialLabel = "Public API";
    draft.instanceUrl = "https://api.example.com";
    draft.authScheme = "none";
    expect(shouldCreateConnectorCredential(draft)).toBe(true);
  });

  it("includes http-rest secret options in connection options", () => {
    const draft = createEmptyConnectorCredentialDraft();
    draft.connectorId = "http-rest";
    draft.instanceUrl = "https://api.example.com";
    draft.authScheme = "header";
    draft.authHeaderName = "X-API-Key";
    draft.apiKey = "secret";
    expect(buildConnectorConnectionOptions(draft)).toMatchObject({
      instanceUrl: "https://api.example.com",
      authScheme: "header",
      authHeaderName: "X-API-Key",
      apiKey: "secret",
    });
  });
});
