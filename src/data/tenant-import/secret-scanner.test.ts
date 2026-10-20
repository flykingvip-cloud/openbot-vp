import { describe, expect, it } from "vitest";
import {
  scanJsonForSecrets,
  scanPathForSecrets,
  scanTenantImportEntries,
} from "./secret-scanner.js";

describe("scanPathForSecrets", () => {
  it("flags forbidden directory segments", () => {
    expect(scanPathForSecrets("control-plane/credentials/openai.json")[0]?.rule).toBe(
      "path:credentials/",
    );
    expect(scanPathForSecrets("users/u1/OpenBot/identity/device.json")[0]?.rule).toBe(
      "path:identity/",
    );
    expect(scanPathForSecrets("control-plane/auth-profiles.json")[0]?.rule).toBe(
      "path:auth-profiles",
    );
  });

  it("flags secret store filenames and key/cert extensions", () => {
    expect(scanPathForSecrets("control-plane/openbot-encrypted-secrets.json").length).toBe(1);
    expect(
      scanPathForSecrets("users/u1/OpenBot/openbot-user-operational-identity-secrets.json").length,
    ).toBe(1);
    expect(scanPathForSecrets("tls/server.pem")[0]?.rule).toBe("path:*.pem");
    expect(scanPathForSecrets("keys/id_rsa.key")[0]?.rule).toBe("path:*.key");
  });

  it("passes clean L2/L1 paths", () => {
    expect(scanPathForSecrets("users/u1/OpenBot/agents/main/workspace/note.md")).toEqual([]);
    expect(scanPathForSecrets("control-plane/seat-assets.json")).toEqual([]);
  });
});

describe("scanJsonForSecrets", () => {
  it("flags non-empty plaintext secret fields, including nested", () => {
    const json = JSON.stringify({
      provider: "openai",
      apiKey: "sk-live-123",
      nested: { botToken: "abc", ok: "" },
      list: [{ accessToken: "at" }, { refreshToken: "" }],
    });
    const rules = scanJsonForSecrets("x.json", json)
      .map((f) => f.rule)
      .toSorted();
    expect(rules).toEqual(["content:accessToken", "content:apiKey", "content:botToken"].toSorted());
  });

  it("ignores empty/redacted secret fields", () => {
    const json = JSON.stringify({ apiKey: "", passwordHash: "   " });
    expect(scanJsonForSecrets("x.json", json)).toEqual([]);
  });

  it("falls back to regex when the text is not valid JSON", () => {
    const findings = scanJsonForSecrets("x.json", '{ broken, "botToken": "xyz" ');
    expect(findings.map((f) => f.rule)).toContain("content:botToken");
  });
});

describe("scanTenantImportEntries", () => {
  it("returns ok=true only when there are no findings", () => {
    const clean = scanTenantImportEntries([
      { path: "control-plane/seat-assets.json", json: '{"seats":[]}' },
      { path: "users/u1/OpenBot/agents/main/workspace/note.md" },
    ]);
    expect(clean.ok).toBe(true);
    expect(clean.findings).toEqual([]);

    const dirty = scanTenantImportEntries([
      { path: "control-plane/credentials/x.json", json: '{"apiKey":"sk-1"}' },
    ]);
    expect(dirty.ok).toBe(false);
    // one path finding + one content finding
    expect(dirty.findings.length).toBe(2);
  });

  it("only content-scans .json entries", () => {
    // A .txt entry carrying a secret-looking field is not content-scanned (path is clean).
    const result = scanTenantImportEntries([
      { path: "users/u1/OpenBot/agents/main/notes.txt", json: '{"apiKey":"sk-1"}' },
    ]);
    expect(result.ok).toBe(true);
  });
});
