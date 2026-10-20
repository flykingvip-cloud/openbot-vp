import { describe, expect, it } from "vitest";
import { buildEmbeddedSandboxInfo } from "./pi-embedded-runner.js";
import type { SandboxContext } from "./sandbox.js";

function createSandboxContext(overrides?: Partial<SandboxContext>): SandboxContext {
  const base = {
    enabled: true,
    sessionKey: "session:test",
    workspaceDir: "/tmp/openclaw-sandbox",
    agentWorkspaceDir: "/tmp/openclaw-workspace",
    workspaceAccess: "none",
    containerName: "openclaw-sbx-test",
    containerWorkdir: "/workspace",
    docker: {
      image: "openclaw-sandbox:bookworm-slim",
      containerPrefix: "openclaw-sbx-",
      workdir: "/workspace",
      readOnlyRoot: true,
      tmpfs: ["/tmp"],
      network: "none",
      user: "1000:1000",
      capDrop: ["ALL"],
      env: { LANG: "C.UTF-8" },
    },
    tools: {
      allow: ["exec"],
      deny: ["browser"],
    },
    browserAllowHostControl: true,
    browser: {
      bridgeUrl: "http://localhost:9222",
      noVncUrl: "http://localhost:6080",
      containerName: "openclaw-sbx-browser-test",
    },
  } satisfies SandboxContext;
  return { ...base, ...overrides };
}

describe("buildEmbeddedSandboxInfo", () => {
  it("returns undefined when sandbox is missing", () => {
    expect(buildEmbeddedSandboxInfo()).toBeUndefined();
  });

  it("maps sandbox context into prompt info", () => {
    const sandbox = createSandboxContext();

    expect(buildEmbeddedSandboxInfo(sandbox)).toEqual({
      enabled: true,
      workspaceDir: "/tmp/openclaw-sandbox",
      containerWorkspaceDir: "/workspace",
      workspaceAccess: "none",
      agentWorkspaceMount: undefined,
      browserBridgeUrl: "http://localhost:9222",
      browserNoVncUrl: "http://localhost:6080",
      hostBrowserAllowed: true,
    });
  });

  it("marks Account Computer browser control without turning host control on", () => {
    const sandbox = createSandboxContext({
      browserAllowHostControl: false,
      accountComputerBrowser: true,
    });
    expect(buildEmbeddedSandboxInfo(sandbox)).toMatchObject({
      hostBrowserAllowed: false,
      accountComputerBrowser: true,
      browserBridgeUrl: "http://localhost:9222",
    });
  });

  it("surfaces attach-only Account Computer when sandbox.mode is off", () => {
    const sandbox = createSandboxContext({
      enabled: false,
      browserAllowHostControl: false,
      accountComputerBrowser: true,
      browser: {
        bridgeUrl: "http://127.0.0.1:18792",
        noVncUrl: "http://127.0.0.1:18792/novnc/",
        containerName: "openbot-sb-browser-attach",
      },
    });
    expect(buildEmbeddedSandboxInfo(sandbox)).toEqual({
      enabled: false,
      browserBridgeUrl: "http://127.0.0.1:18792",
      browserNoVncUrl: "http://127.0.0.1:18792/novnc/",
      hostBrowserAllowed: false,
      accountComputerBrowser: true,
    });
  });

  it("keeps a leased desktop that failed to attach visible to the prompt", () => {
    const sandbox = createSandboxContext({
      browserAllowHostControl: false,
      browser: undefined,
      accountComputerAttachFailure: "CDP port not published",
    });
    expect(buildEmbeddedSandboxInfo(sandbox)).toMatchObject({
      hostBrowserAllowed: false,
      accountComputerAttachFailure: "CDP port not published",
    });
    expect(buildEmbeddedSandboxInfo(sandbox)?.accountComputerBrowser).toBeUndefined();
  });

  it("includes elevated info when allowed", () => {
    const sandbox = createSandboxContext({
      browserAllowHostControl: false,
      browser: undefined,
    });

    expect(
      buildEmbeddedSandboxInfo(sandbox, {
        enabled: true,
        allowed: true,
        defaultLevel: "on",
      }),
    ).toEqual({
      enabled: true,
      workspaceDir: "/tmp/openclaw-sandbox",
      containerWorkspaceDir: "/workspace",
      workspaceAccess: "none",
      agentWorkspaceMount: undefined,
      hostBrowserAllowed: false,
      elevated: { allowed: true, defaultLevel: "on" },
    });
  });
});
