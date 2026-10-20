/**
 * Stage 3 six-column **WS 请求/响应 authz** slice (narrow E1/E2).
 *
 * Proposition (§5.2 WS 请求 authz): connect handshake gates on shared-secret
 * token (or password), role, operator scopes, and device signature (when
 * device identity is required). Failures are explicit reject reasons — not
 * silent success.
 *
 * Not Stage 3 overall PASS. stage8_eligible stays false.
 * Not a live multi-device / Control UI browser suite; not Plugin authz;
 * not AUTH-01 rewrite; not Swift client-side auth field review.
 *
 * Anchors: `authorizeGatewayConnect` (token), `role-policy` +
 * `authorizeOperatorScopesForMethod` + `server-methods` role/scope gate,
 * `buildDeviceAuthPayload(V3)` + `verifyDeviceSignature` + message-handler
 * `resolveDeviceSignaturePayloadVersion` / device-signature reject,
 * `evaluateMissingDeviceIdentity` / `resolveConnectAuthState`.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { authorizeGatewayConnect } from "../../src/gateway/auth.js";
import { buildDeviceAuthPayload, buildDeviceAuthPayloadV3 } from "../../src/gateway/device-auth.js";
import {
  ADMIN_SCOPE,
  READ_SCOPE,
  WRITE_SCOPE,
  authorizeOperatorScopesForMethod,
} from "../../src/gateway/method-scopes.js";
import {
  isRoleAuthorizedForMethod,
  parseGatewayRole,
  roleCanSkipDeviceIdentity,
} from "../../src/gateway/role-policy.js";
import { evaluateMissingDeviceIdentity } from "../../src/gateway/server/ws-connection/connect-policy.js";
import {
  publicKeyRawBase64UrlFromPem,
  signDevicePayload,
  verifyDeviceSignature,
} from "../../src/infra/device-identity.js";

function freshEd25519Identity() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  return { publicKeyPem, privateKeyPem };
}

describe("Stage 3 WS 请求 authz (E1/E2 narrow)", () => {
  it("connect token mode rejects missing/mismatch and accepts matching token", async () => {
    const auth = {
      mode: "token" as const,
      token: "inventory-ws-authz-token",
      allowTailscale: false,
    };

    const missing = await authorizeGatewayConnect({
      auth,
      connectAuth: null,
      authSurface: "http",
    });
    expect(missing).toEqual({ ok: false, reason: "token_missing" });

    const mismatch = await authorizeGatewayConnect({
      auth,
      connectAuth: { token: "wrong-token" },
      authSurface: "http",
    });
    expect(mismatch).toEqual({ ok: false, reason: "token_mismatch" });

    const ok = await authorizeGatewayConnect({
      auth,
      connectAuth: { token: "inventory-ws-authz-token" },
      authSurface: "http",
    });
    expect(ok).toEqual({ ok: true, method: "token" });
  });

  it("role parse + method authorization fail closed for wrong role", () => {
    expect(parseGatewayRole("operator")).toBe("operator");
    expect(parseGatewayRole("node")).toBe("node");
    expect(parseGatewayRole("admin")).toBeNull();
    expect(parseGatewayRole(undefined)).toBeNull();

    expect(isRoleAuthorizedForMethod("operator", "status")).toBe(true);
    expect(isRoleAuthorizedForMethod("operator", "node.event")).toBe(false);
    expect(isRoleAuthorizedForMethod("node", "node.event")).toBe(true);
    expect(isRoleAuthorizedForMethod("node", "status")).toBe(false);

    // Shared-auth device-identity skip is operator-only.
    expect(roleCanSkipDeviceIdentity("operator", true)).toBe(true);
    expect(roleCanSkipDeviceIdentity("operator", false)).toBe(false);
    expect(roleCanSkipDeviceIdentity("node", true)).toBe(false);
  });

  it("operator scopes gate methods; missing scope is explicit", () => {
    expect(authorizeOperatorScopesForMethod("status", [READ_SCOPE])).toEqual({ allowed: true });
    expect(authorizeOperatorScopesForMethod("status", [WRITE_SCOPE])).toEqual({ allowed: true });
    expect(authorizeOperatorScopesForMethod("status", [])).toEqual({
      allowed: false,
      missingScope: READ_SCOPE,
    });
    // Admin scope short-circuits any method classification.
    expect(authorizeOperatorScopesForMethod("config.set", [ADMIN_SCOPE])).toEqual({
      allowed: true,
    });
    const denied = authorizeOperatorScopesForMethod("config.set", [READ_SCOPE]);
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) {
      expect(denied.missingScope).toBeTruthy();
    }
  });

  it("device signature: v2/v3 payload + verifyDeviceSignature accept good / reject bad", () => {
    const identity = freshEd25519Identity();
    const publicKey = publicKeyRawBase64UrlFromPem(identity.publicKeyPem);
    const base = {
      deviceId: "dev-inventory-authz",
      clientId: "openbot-macos",
      clientMode: "ui",
      role: "operator",
      scopes: ["operator.read"],
      signedAtMs: 1_700_000_000_000,
      token: "tok",
      nonce: "nonce-1",
    };

    const payloadV3 = buildDeviceAuthPayloadV3({
      ...base,
      platform: "macOS",
      deviceFamily: "Mac",
    });
    const payloadV2 = buildDeviceAuthPayload(base);
    expect(payloadV3.startsWith("v3|")).toBe(true);
    expect(payloadV2.startsWith("v2|")).toBe(true);

    const sigV3 = signDevicePayload(identity.privateKeyPem, payloadV3);
    expect(verifyDeviceSignature(publicKey, payloadV3, sigV3)).toBe(true);
    expect(verifyDeviceSignature(publicKey, payloadV2, sigV3)).toBe(false);
    expect(verifyDeviceSignature(publicKey, payloadV3, "not-a-real-signature")).toBe(false);

    const sigV2 = signDevicePayload(identity.privateKeyPem, payloadV2);
    expect(verifyDeviceSignature(publicKey, payloadV2, sigV2)).toBe(true);
  });

  it("missing device identity rejects when shared auth is absent; allow when operator+sharedAuthOk", () => {
    const base = {
      hasDeviceIdentity: false,
      role: "operator" as const,
      isControlUi: false,
      controlUiAuthPolicy: {
        allowInsecureAuthConfigured: false,
        dangerouslyDisableDeviceAuth: false,
        allowBypass: false,
        device: null,
      },
      sharedAuthOk: false,
      authOk: false,
      hasSharedAuth: false,
      isLocalClient: true,
    };

    expect(evaluateMissingDeviceIdentity(base)).toEqual({ kind: "reject-device-required" });
    expect(
      evaluateMissingDeviceIdentity({
        ...base,
        sharedAuthOk: true,
        authOk: true,
        hasSharedAuth: true,
      }),
    ).toEqual({ kind: "allow" });
    expect(
      evaluateMissingDeviceIdentity({
        ...base,
        role: "node",
        sharedAuthOk: true,
        authOk: true,
        hasSharedAuth: true,
      }),
    ).toEqual({ kind: "reject-device-required" });
  });

  it("handshake + method path wires token/role/scopes/device signature gates", () => {
    const handler = fs.readFileSync(
      new URL("../../src/gateway/server/ws-connection/message-handler.ts", import.meta.url),
      "utf8",
    );
    expect(handler).toMatch(/resolveConnectAuthState/);
    expect(handler).toMatch(/resolveConnectAuthDecision/);
    expect(handler).toMatch(/evaluateMissingDeviceIdentity/);
    expect(handler).toMatch(/resolveDeviceSignaturePayloadVersion/);
    expect(handler).toMatch(/verifyDeviceSignature/);
    expect(handler).toMatch(/buildDeviceAuthPayloadV3/);
    expect(handler).toMatch(/rejectDeviceAuthInvalid\("device-signature"/);
    expect(handler).toMatch(
      /authorizeOperatorScopesForMethod|authorizeGatewayMethod|parseGatewayRole/,
    );

    const authContext = fs.readFileSync(
      new URL("../../src/gateway/server/ws-connection/auth-context.ts", import.meta.url),
      "utf8",
    );
    expect(authContext).toMatch(/authorizeWsControlUiGatewayConnect/);
    expect(authContext).toMatch(/sharedAuthOk/);
    expect(authContext).toMatch(/verifyDeviceToken/);

    const methods = fs.readFileSync(
      new URL("../../src/gateway/server-methods.ts", import.meta.url),
      "utf8",
    );
    expect(methods).toMatch(/parseGatewayRole/);
    expect(methods).toMatch(/isRoleAuthorizedForMethod/);
    expect(methods).toMatch(/authorizeOperatorScopesForMethod/);
    expect(methods).toMatch(/unauthorized role/);
    expect(methods).toMatch(/missing scope:/);
  });
});
