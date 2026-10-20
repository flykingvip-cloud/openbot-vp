// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GatewayBrowserClient } from "../../../gateway.ts";
import "./management-governance-panel.ts";

async function flushElement(element: HTMLElement & { updateComplete: Promise<boolean> }) {
  await element.updateComplete;
  await Promise.resolve();
  await element.updateComplete;
}

function mockGatewayClient(request: GatewayBrowserClient["request"]): GatewayBrowserClient {
  return { request } as GatewayBrowserClient;
}

function requireElement<T extends Element>(element: T | null | undefined, label: string): T {
  expect(element).toBeTruthy();
  if (!element) {
    throw new Error(`missing ${label}`);
  }
  return element;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("management-governance-section", () => {
  it("queries scoped audit records and renders the decision", async () => {
    const request = vi.fn().mockResolvedValue({
      scope: { kind: "platform" },
      events: [
        {
          ts: "2026-08-04T03:04:05.000Z",
          actor: { role: "platform-admin", subjectId: "admin@example.com", scope: "platform" },
          action: "invoke",
          target: { kind: "worker-agent", resourceId: "agent-worker-1", tenantId: "tenant-a" },
          effect: "allowed",
        },
      ],
    });
    const element = document.createElement("management-governance-section");
    element.client = mockGatewayClient(request);
    element.enterprises = [{ tenantId: "tenant-a", label: "甲企业" }];
    document.body.appendChild(element);
    await flushElement(element);

    expect(request).toHaveBeenCalledWith("management-governance.audit.list", { limit: 100 });
    expect(element.textContent).toContain("1 个企业租户");
    expect(element.textContent).toContain("admin@example.com");
    expect(element.textContent).toContain("agent-worker-1");
    expect(element.textContent).toContain("允许");
  });

  it("sends action, effect, actor, and resource filters", async () => {
    const request = vi.fn().mockResolvedValue({ scope: { kind: "platform" }, events: [] });
    const element = document.createElement("management-governance-section");
    element.client = mockGatewayClient(request);
    document.body.appendChild(element);
    await flushElement(element);
    request.mockClear();

    const selects = element.querySelectorAll("select");
    const inputs = element.querySelectorAll("input");
    const actionSelect = requireElement(selects.item(0), "action filter");
    const effectSelect = requireElement(selects.item(1), "effect filter");
    const actorInput = requireElement(inputs.item(0), "actor filter");
    const resourceInput = requireElement(inputs.item(1), "resource filter");
    actionSelect.value = "write";
    actionSelect.dispatchEvent(new Event("change"));
    effectSelect.value = "denied";
    effectSelect.dispatchEvent(new Event("change"));
    actorInput.value = "admin@example.com";
    actorInput.dispatchEvent(new Event("input"));
    resourceInput.value = "device-1";
    resourceInput.dispatchEvent(new Event("input"));
    await flushElement(element);
    requireElement(
      element.querySelector<HTMLButtonElement>("button.btn--primary"),
      "query button",
    ).click();
    await flushElement(element);

    expect(request).toHaveBeenCalledWith("management-governance.audit.list", {
      limit: 100,
      action: "write",
      effect: "denied",
      actorId: "admin@example.com",
      resourceId: "device-1",
    });
  });

  it("exposes platform administrator grants only to super administrators", async () => {
    const request = vi.fn().mockResolvedValue({ scope: { kind: "platform" }, events: [] });
    const createAdmin = vi.fn();
    const changeScopes = vi.fn();
    const element = document.createElement("management-governance-section");
    element.client = mockGatewayClient(request);
    element.authPanelProps = {
      state: {
        enabled: true,
        hasUsers: true,
        canManagePlatformAdmins: true,
        platformAdmins: [
          {
            user: "root@example.com",
            displayName: "Root",
            platformRole: "super-admin",
            scopes: ["operator.admin"],
            isCurrentUser: true,
          },
        ],
      },
      busy: false,
      error: null,
      notice: null,
      platformAdminDisplayName: "Operations",
      platformAdminEmail: "ops@example.com",
      platformAdminPassword: "StrongPassword123!",
      platformAdminScopes: ["operator.read"],
      onPlatformAdminDisplayNameChange: vi.fn(),
      onPlatformAdminEmailChange: vi.fn(),
      onPlatformAdminPasswordChange: vi.fn(),
      onPlatformAdminScopesChange: changeScopes,
      onCreatePlatformAdmin: createAdmin,
    } as unknown as NonNullable<typeof element.authPanelProps>;
    document.body.appendChild(element);
    await flushElement(element);

    expect(element.textContent).toContain("平台管理员授权");
    expect(element.textContent).toContain("root@example.com");
    const pairingScope = Array.from(element.querySelectorAll("label")).find((label) =>
      label.textContent?.includes("终端配对"),
    );
    pairingScope?.querySelector("input")?.click();
    expect(changeScopes).toHaveBeenCalledWith(["operator.read", "operator.pairing"]);
    requireElement(
      element.querySelector<HTMLButtonElement>("button.btn--primary"),
      "create admin button",
    ).click();
    expect(createAdmin).toHaveBeenCalledOnce();
  });

  it("assigns a terminal to a tenant and employee", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ scope: { kind: "platform" }, events: [] })
      .mockResolvedValueOnce({ nodeId: "node-a", tenantId: "tenant-a", ownerUserId: "user-a" })
      .mockResolvedValue({ scope: { kind: "platform" }, events: [] });
    const element = document.createElement("management-governance-section");
    element.client = mockGatewayClient(request);
    element.enterprises = [{ tenantId: "tenant-a", label: "甲企业" }];
    element.authPanelProps = {
      state: { enabled: true, hasUsers: true, canManagePlatform: true },
    } as unknown as NonNullable<typeof element.authPanelProps>;
    document.body.appendChild(element);
    await flushElement(element);

    const assignment = requireElement(
      Array.from(element.querySelectorAll("section.card")).find((section) =>
        section.textContent?.includes("终端归属分配"),
      ),
      "assignment section",
    );
    const inputs = assignment.querySelectorAll("input");
    const nodeInput = requireElement(inputs.item(0), "node id input");
    const ownerInput = requireElement(inputs.item(1), "owner id input");
    const tenantSelect = requireElement(assignment.querySelector("select"), "tenant select");
    nodeInput.value = "node-a";
    nodeInput.dispatchEvent(new Event("input"));
    tenantSelect.value = "tenant-a";
    tenantSelect.dispatchEvent(new Event("change"));
    ownerInput.value = "user-a";
    ownerInput.dispatchEvent(new Event("input"));
    await flushElement(element);
    requireElement(assignment.querySelector<HTMLButtonElement>("button"), "assign button").click();
    await flushElement(element);

    expect(request).toHaveBeenCalledWith("management-governance.node.assign", {
      nodeId: "node-a",
      tenantId: "tenant-a",
      ownerUserId: "user-a",
    });
    expect(element.textContent).toContain("已将终端 node-a 归属到 tenant-a");
  });
});
