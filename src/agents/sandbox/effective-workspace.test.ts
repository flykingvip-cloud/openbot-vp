import path from "node:path";
import { describe, expect, it } from "vitest";
import { ACCOUNT_EXEC_WORKSPACE } from "./account-mounts.js";
import {
  isAccountExecWorkspaceMount,
  resolveEffectiveSandboxWorkspaceDir,
} from "./effective-workspace.js";

describe("resolveEffectiveSandboxWorkspaceDir", () => {
  const tenants = path.join(
    "/data",
    "tenants",
    "t1",
    "users",
    "u1",
    "OpenBot",
    "agents",
    "main",
    "workspace",
  );
  const operators = path.join("/data", "operators", "u1", "OpenBot", "agents", "main", "workspace");

  it("detects the account exec mount", () => {
    expect(isAccountExecWorkspaceMount(ACCOUNT_EXEC_WORKSPACE)).toBe(true);
    expect(isAccountExecWorkspaceMount("/workspace")).toBe(false);
  });

  it("uses the account mount host path even when session resolvedWorkspace is tenants", () => {
    const effective = resolveEffectiveSandboxWorkspaceDir({
      resolvedWorkspace: tenants,
      sandbox: {
        enabled: true,
        workspaceAccess: "rw",
        workspaceDir: operators,
        containerWorkdir: ACCOUNT_EXEC_WORKSPACE,
      },
    });
    expect(effective).toBe(operators);
    expect(effective).not.toBe(tenants);
  });

  it("keeps rw → resolvedWorkspace for ordinary gateway sandboxes", () => {
    const effective = resolveEffectiveSandboxWorkspaceDir({
      resolvedWorkspace: tenants,
      sandbox: {
        enabled: true,
        workspaceAccess: "rw",
        workspaceDir: "/tmp/sandbox-copy",
        containerWorkdir: "/workspace",
      },
    });
    expect(effective).toBe(tenants);
  });

  it("uses the sandbox copy when workspaceAccess is not rw", () => {
    const copy = "/tmp/sandbox-copy";
    const effective = resolveEffectiveSandboxWorkspaceDir({
      resolvedWorkspace: tenants,
      sandbox: {
        enabled: true,
        workspaceAccess: "ro",
        workspaceDir: copy,
        containerWorkdir: "/workspace",
      },
    });
    expect(effective).toBe(copy);
  });

  it("falls back to resolvedWorkspace when sandbox is off", () => {
    expect(
      resolveEffectiveSandboxWorkspaceDir({
        resolvedWorkspace: tenants,
        sandbox: null,
      }),
    ).toBe(tenants);
  });
});
