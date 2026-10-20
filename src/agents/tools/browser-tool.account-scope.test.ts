import { afterEach, describe, expect, it, vi } from "vitest";

const browserActionsMocks = vi.hoisted(() => ({
  browserAct: vi.fn(async () => ({ ok: true, targetId: "t1" })),
  browserArmDialog: vi.fn(async () => ({ ok: true })),
  browserArmFileChooser: vi.fn(async () => ({ ok: true })),
  browserNavigate: vi.fn(async () => ({ ok: true })),
  browserPdfSave: vi.fn(async () => ({ ok: true, path: "/tmp/test.pdf" })),
  browserScreenshotAction: vi.fn(async () => ({ ok: true, path: "/tmp/test.png" })),
}));
vi.mock("../../browser/client-actions.js", () => browserActionsMocks);

const browserClientMocks = vi.hoisted(() => ({
  browserCloseTab: vi.fn(async () => ({})),
  browserFocusTab: vi.fn(async () => ({})),
  browserOpenTab: vi.fn(async () => ({})),
  browserProfiles: vi.fn(async () => []),
  browserSnapshot: vi.fn(async () => ({
    ok: true,
    format: "aria",
    targetId: "t1",
    url: "https://fixture.sar.test/public",
    nodes: [{ ref: "e1", role: "link", name: "Widget", depth: 0 }],
  })),
  browserStart: vi.fn(async () => ({})),
  browserStatus: vi.fn(async () => ({ running: true, enabled: true })),
  browserStop: vi.fn(async () => ({})),
  browserTabs: vi.fn(async () => []),
}));
vi.mock("../../browser/client.js", () => browserClientMocks);

vi.mock("./nodes-utils.js", async () => {
  const actual = await vi.importActual<typeof import("./nodes-utils.js")>("./nodes-utils.js");
  return { ...actual, listNodes: vi.fn(async () => []) };
});
vi.mock("./gateway.js", () => ({ callGatewayTool: vi.fn() }));

import { resetPlanOnceRunsForTests } from "../../account-computer/browser-plan-once-wire.js";
import { createExecutionIdentityContext } from "../../gateway/execution-identity-context.js";
import { resetAccountBrowserCoordinatorForTests } from "../../site-capability/coordinator.js";
import {
  SarExecutionAuthority,
  memoryEpochStore,
} from "../../site-capability/execution-authority.js";
import { resetDefaultSiteCapabilityRuntimeForTests } from "../../site-capability/runtime.js";
import { SAR_FIXTURE_CAPABILITY } from "../../site-capability/test-site.js";
import { createOpenClawTools } from "../openclaw-tools.js";
import { resolveDefaultAccountBrowserScopeKey } from "./account-browser-scope.js";
import { createBrowserTool } from "./browser-tool.js";

const PLAN = {
  action: "plan_once",
  steps: [{ action: "wait" }],
  sessionPhase: "INTERACTIVE",
  ownershipPhase: "BACKGROUND_AGENT",
};

afterEach(() => {
  browserClientMocks.browserSnapshot.mockClear();
  browserActionsMocks.browserAct.mockClear();
  resetPlanOnceRunsForTests();
  resetDefaultSiteCapabilityRuntimeForTests();
  resetAccountBrowserCoordinatorForTests();
});

function holdAccount(tenantId: string, userId: string): void {
  const authority = new SarExecutionAuthority(memoryEpochStore());
  authority.boot();
  authority.registerBinding({ bindingId: "bind-hold", tenantId, userId });
  authority.registerCapability(SAR_FIXTURE_CAPABILITY);
  const handle = authority.resolveSessionHandle({
    principal: { tenantId, userId },
    bindingId: "bind-hold",
    pageTargetId: "tab-1",
  });
  if (!handle.ok) {
    throw new Error(handle.message);
  }
  const bound = authority.bindRun({
    handleToken: handle.handle.token,
    runId: "run-hold",
    capabilityId: SAR_FIXTURE_CAPABILITY.id,
  });
  if (!bound.ok) {
    throw new Error(bound.message);
  }
}

async function plan(tool: ReturnType<typeof createBrowserTool>, extra?: Record<string, unknown>) {
  const result = await tool.execute("scope", { ...PLAN, ...extra });
  return result.details as { status?: string; reason?: string };
}

describe("account browser scope default", () => {
  it("derives the scope from the server account and ignores an email user id", () => {
    expect(
      resolveDefaultAccountBrowserScopeKey({
        tenantId: "tenant-a",
        userId: "user-a",
      }),
    ).toBe("account:tenant-a:user-a:browser");
    expect(
      resolveDefaultAccountBrowserScopeKey({
        accountBrowserScopeKey: "account:explicit:user:browser",
        tenantId: "tenant-a",
        userId: "user-a",
      }),
    ).toBe("account:explicit:user:browser");
    expect(
      resolveDefaultAccountBrowserScopeKey({ tenantId: "tenant-a", userId: "user@example.com" }),
    ).toBeUndefined();
  });

  it("applies the server scope on plan_once and ignores a model-supplied scope key", async () => {
    const open = createBrowserTool({
      allowHostControl: true,
      serverAccount: { tenantId: "tenant-a", userId: "user-a" },
    });
    const ran = await plan(open, { accountBrowserScopeKey: "account:evil:user:browser" });
    expect(ran.reason ?? "").not.toMatch(/coordinator/);
    expect(browserClientMocks.browserSnapshot).toHaveBeenCalled();

    browserClientMocks.browserSnapshot.mockClear();
    resetAccountBrowserCoordinatorForTests();
    holdAccount("tenant-a", "user-a");
    const blocked = createBrowserTool({
      allowHostControl: true,
      serverAccount: { tenantId: "tenant-a", userId: "user-a" },
    });
    const held = await plan(blocked, { accountBrowserScopeKey: "account:evil:user:browser" });
    expect(held.status).toBe("BLOCKED");
    expect(held.reason).toMatch(/sar:run-hold/);
    expect(browserClientMocks.browserSnapshot).not.toHaveBeenCalled();

    browserClientMocks.browserSnapshot.mockClear();
    const other = createBrowserTool({
      allowHostControl: true,
      serverAccount: { tenantId: "tenant-b", userId: "user-b" },
    });
    const ignored = await plan(other, {
      accountBrowserScopeKey: "account:tenant-a:user-a:browser",
    });
    expect(ignored.reason ?? "").not.toMatch(/run-hold/);
    expect(browserClientMocks.browserSnapshot).toHaveBeenCalled();
  });

  it("does not take a scope key from tool arguments when the server account is absent", async () => {
    holdAccount("tenant-a", "user-a");
    const tool = createBrowserTool({ allowHostControl: true });
    const ran = await plan(tool, { accountBrowserScopeKey: "account:tenant-a:user-a:browser" });
    expect(ran.reason ?? "").not.toMatch(/run-hold/);
    expect(browserClientMocks.browserSnapshot).toHaveBeenCalled();
  });

  it("lets an explicit server scope win over the account fallback", async () => {
    holdAccount("tenant-a", "user-a");
    const tool = createBrowserTool({
      allowHostControl: true,
      accountBrowserScopeKey: "account:tenant-a:user-a:browser",
      serverAccount: { tenantId: "tenant-b", userId: "user-b" },
    });
    const held = await plan(tool);
    expect(held.status).toBe("BLOCKED");
    expect(held.reason).toMatch(/sar:run-hold/);
  });

  it("wires the production tool list to the server account and the site tools", async () => {
    holdAccount("tenant-a", "user-a");
    const tools = createOpenClawTools({
      tenantId: "tenant-a",
      gatewayClientPlatformUserId: "user-a",
      executionIdentity: createExecutionIdentityContext({
        enterpriseId: "tenant-a",
        platformUserId: "user-a",
      }),
    });
    const names = tools.map((tool) => tool.name);
    expect(names).toContain("site_list");
    expect(names).toContain("site_describe");
    expect(names).toContain("site_invoke");
    const browser = tools.find((tool) => tool.name === "browser");
    const result = await browser?.execute?.("prod", {
      ...PLAN,
      accountBrowserScopeKey: "account:evil:user:browser",
    });
    const details = result?.details as { status?: string; reason?: string };
    expect(details.status).toBe("BLOCKED");
    expect(details.reason).toMatch(/sar:run-hold/);
    expect(browserClientMocks.browserSnapshot).not.toHaveBeenCalled();
  });
});
