import { describe, expect, it } from "vitest";
import {
  computeHookHmacSignature,
  DEFAULT_HOOK_HMAC_HEADER,
  parseHookJsonPayload,
  resolveHookMappingAuth,
  verifyHookMappingHmac,
  verifyHookMappingToken,
} from "./hooks-auth.js";
import type { HookMappingResolved } from "./hooks-mapping.js";

function mapping(overrides: Partial<HookMappingResolved>): HookMappingResolved {
  return {
    id: "m1",
    action: "agent",
    ...overrides,
  };
}

describe("resolveHookMappingAuth", () => {
  it("returns null when no mapping declares credentials", () => {
    const mappings = [mapping({ matchPath: "github" })];
    expect(resolveHookMappingAuth(mappings, "github")).toBeNull();
  });

  it("resolves the first credentialed mapping for the path", () => {
    const mappings = [
      mapping({ id: "plain", matchPath: "github" }),
      mapping({ id: "secure", matchPath: "github", token: "map-token" }),
    ];
    const auth = resolveHookMappingAuth(mappings, "github");
    expect(auth?.mappingId).toBe("secure");
    expect(auth?.token).toBe("map-token");
    expect(auth?.hmacHeader).toBe(DEFAULT_HOOK_HMAC_HEADER);
  });

  it("does not resolve credentials for other paths", () => {
    const mappings = [mapping({ matchPath: "github", token: "map-token" })];
    expect(resolveHookMappingAuth(mappings, "gitlab")).toBeNull();
    expect(resolveHookMappingAuth(mappings, "")).toBeNull();
  });

  it("normalizes leading/trailing slashes in the sub-path", () => {
    const mappings = [mapping({ matchPath: "github", token: "map-token" })];
    expect(resolveHookMappingAuth(mappings, "/github/")?.token).toBe("map-token");
  });
});

describe("verifyHookMappingToken", () => {
  const auth = {
    mappingId: "m1",
    token: "map-token",
    hmacHeader: DEFAULT_HOOK_HMAC_HEADER,
  };

  it("accepts the mapping token via bearer header", () => {
    const req = { headers: { authorization: "Bearer map-token" } };
    expect(verifyHookMappingToken(auth, req).ok).toBe(true);
  });

  it("rejects the global token when the mapping declares its own", () => {
    const req = { headers: { authorization: "Bearer global-token" } };
    expect(verifyHookMappingToken(auth, req).ok).toBe(false);
  });

  it("rejects missing tokens", () => {
    expect(verifyHookMappingToken(auth, { headers: {} }).ok).toBe(false);
  });

  it("passes when no token is declared", () => {
    const hmacOnly = { mappingId: "m1", hmacSecret: "s", hmacHeader: DEFAULT_HOOK_HMAC_HEADER };
    expect(verifyHookMappingToken(hmacOnly, { headers: {} }).ok).toBe(true);
  });
});

describe("verifyHookMappingHmac", () => {
  const auth = {
    mappingId: "m1",
    hmacSecret: "signing-secret",
    hmacHeader: DEFAULT_HOOK_HMAC_HEADER,
  };
  const rawBody = JSON.stringify({ hello: "world" });

  it("accepts a valid sha256 signature", () => {
    const signature = computeHookHmacSignature("signing-secret", rawBody);
    const req = { headers: { [DEFAULT_HOOK_HMAC_HEADER]: signature } };
    expect(verifyHookMappingHmac(auth, req, rawBody).ok).toBe(true);
  });

  it("rejects a signature computed with the wrong secret", () => {
    const signature = computeHookHmacSignature("wrong-secret", rawBody);
    const req = { headers: { [DEFAULT_HOOK_HMAC_HEADER]: signature } };
    expect(verifyHookMappingHmac(auth, req, rawBody).ok).toBe(false);
  });

  it("rejects a signature over a different body", () => {
    const signature = computeHookHmacSignature("signing-secret", "tampered");
    const req = { headers: { [DEFAULT_HOOK_HMAC_HEADER]: signature } };
    expect(verifyHookMappingHmac(auth, req, rawBody).ok).toBe(false);
  });

  it("rejects missing or malformed signature headers", () => {
    expect(verifyHookMappingHmac(auth, { headers: {} }, rawBody).ok).toBe(false);
    const malformed = { headers: { [DEFAULT_HOOK_HMAC_HEADER]: "deadbeef" } };
    expect(verifyHookMappingHmac(auth, malformed, rawBody).ok).toBe(false);
  });

  it("supports a custom header name", () => {
    const custom = { ...auth, hmacHeader: "x-hub-signature-256" };
    const signature = computeHookHmacSignature("signing-secret", rawBody);
    const req = { headers: { "x-hub-signature-256": signature } };
    expect(verifyHookMappingHmac(custom, req, rawBody).ok).toBe(true);
  });

  it("passes when no hmacSecret is declared", () => {
    const tokenOnly = { mappingId: "m1", token: "t", hmacHeader: DEFAULT_HOOK_HMAC_HEADER };
    expect(verifyHookMappingHmac(tokenOnly, { headers: {} }, rawBody).ok).toBe(true);
  });
});

describe("parseHookJsonPayload", () => {
  it("parses JSON objects", () => {
    expect(parseHookJsonPayload('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
  });

  it("returns empty object for blank bodies", () => {
    expect(parseHookJsonPayload("  ")).toEqual({ ok: true, value: {} });
  });

  it("reports parse errors", () => {
    const result = parseHookJsonPayload("{");
    expect(result.ok).toBe(false);
  });
});
