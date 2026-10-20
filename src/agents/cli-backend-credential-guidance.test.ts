import { describe, expect, it } from "vitest";
import {
  buildCliBackendCredentialGuidance,
  isLikelyCredentialError,
} from "./cli-backend-credential-guidance.js";

describe("isLikelyCredentialError", () => {
  it("matches common CLI auth/key failure signatures", () => {
    for (const msg of [
      "Error: 401 Unauthorized",
      "authentication failed",
      "Invalid API key provided",
      "ANTHROPIC_API_KEY is not set",
      "missing api-key",
      "You are not logged in. Please login.",
      "credentials not found",
    ]) {
      expect(isLikelyCredentialError(msg)).toBe(true);
    }
  });

  it("does not match unrelated errors", () => {
    for (const msg of [
      "ECONNRESET socket hang up",
      "context length exceeded",
      "command timed out after 600s",
      undefined,
      "",
    ]) {
      expect(isLikelyCredentialError(msg)).toBe(false);
    }
  });
});

describe("buildCliBackendCredentialGuidance", () => {
  it("names the backend and points to the admin console (no local CLI ask)", () => {
    const text = buildCliBackendCredentialGuidance("claude-cli");
    expect(text).toContain("claude-cli");
    expect(text).toContain("协作工具");
    expect(text).toContain("API Key");
    // explicitly must not instruct local command-line login.
    expect(text).not.toMatch(/run .*login|命令行执行|terminal/i);
    expect(text).toContain("无需");
  });

  it("falls back to a generic noun when backendId is blank", () => {
    expect(buildCliBackendCredentialGuidance("  ")).toContain("该工具");
  });

  it("points local IDE workers to workstation login instead of platform keys", () => {
    for (const backendId of ["cursor-cli", "grok-cli"]) {
      const text = buildCliBackendCredentialGuidance(backendId);
      expect(text).toContain(backendId);
      expect(text).toContain("本机");
      expect(text).toContain("Node Agent");
      expect(text).not.toContain("协作工具 → 凭证");
    }
  });

  it("honours explicit credentialPolicy override", () => {
    const text = buildCliBackendCredentialGuidance("codex-cli", {
      credentialPolicy: "local_ide_login",
    });
    expect(text).toContain("本机");
  });
});
