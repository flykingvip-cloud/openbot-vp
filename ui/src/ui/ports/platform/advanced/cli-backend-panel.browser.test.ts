// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import "./cli-backend-panel.ts";
import type { CliBackendAdminSection } from "./cli-backend-panel.ts";

function mount(): CliBackendAdminSection {
  const el = document.createElement("cli-backend-admin-section") as CliBackendAdminSection;
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

async function flush(el: HTMLElement) {
  await (el as unknown as { updateComplete?: Promise<unknown> }).updateComplete;
  await new Promise((r) => setTimeout(r, 0));
  await (el as unknown as { updateComplete?: Promise<unknown> }).updateComplete;
}

const listResponse = {
  backends: [
    {
      id: "claude-cli",
      source: "builtin",
      effective: { command: "claude" },
      configured: false,
    },
    {
      id: "kiro-cli",
      source: "config",
      effective: {
        command: "kiro",
        args: ["exec", "--json"],
        modelCatalog: [{ id: "kiro-default", displayName: "Kiro" }],
      },
      configured: true,
    },
  ],
  presets: [
    {
      id: "kiro-cli",
      label: "Kiro CLI",
      description: "模板",
      config: { command: "kiro", modelCatalog: [{ id: "kiro-default" }] },
    },
  ],
  builtinIds: ["claude-cli", "codex-cli"],
};

describe("<cli-backend-admin-section>", () => {
  it("shows the security warning and lists backends", async () => {
    const request = vi.fn(async () => listResponse);
    const el = mount();
    (el as unknown as { client: unknown }).client = { request };
    await flush(el);
    expect(request).toHaveBeenCalledWith("cliBackend.list", {});
    expect(el.textContent).toContain("安全提示");
    expect(el.textContent).toContain("Devin CLI");
    expect(el.textContent).toContain("claude-cli");
    expect(el.textContent).toContain("kiro-cli");
    // exposed model catalog shows in the list
    expect(el.textContent).toContain("kiro-default");
  });

  it("runs a connectivity test and shows the result", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "cliBackend.list") {
        return listResponse;
      }
      if (method === "cliBackend.test") {
        return { ok: true, resolved: true, exitCode: 0, stdout: "kiro 1.2.3" };
      }
      return {};
    });
    const el = mount();
    (el as unknown as { client: unknown }).client = { request };
    await flush(el);
    const testBtn = Array.from(el.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "测试",
    );
    testBtn?.click();
    await flush(el);
    expect(request).toHaveBeenCalledWith("cliBackend.test", { id: "claude-cli" });
    expect(el.textContent).toContain("连通正常");
  });

  it("shows friendly error when save is attempted without id", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "cliBackend.list") {
        return listResponse;
      }
      return {};
    });
    const el = mount();
    (el as unknown as { client: unknown }).client = { request };
    await flush(el);
    const addBtn = Array.from(el.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "新增",
    );
    addBtn?.click();
    await flush(el);
    const saveBtn = Array.from(el.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "保存",
    );
    saveBtn?.click();
    await flush(el);
    expect(el.textContent).toContain("请填写后端 ID");
    expect(request.mock.calls.some((c) => c[0] === "cliBackend.upsert")).toBe(false);
  });

  it("upserts a backend from the editor", async () => {
    const request = vi.fn(async (method: string, _params?: unknown) => {
      if (method === "cliBackend.list") {
        return listResponse;
      }
      return { id: "kiro-cli" };
    });
    const el = mount();
    (el as unknown as { client: unknown }).client = { request };
    await flush(el);
    // open editor for the configured kiro-cli row
    const editBtn = Array.from(el.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "编辑",
    );
    editBtn?.click();
    await flush(el);
    const saveBtn = Array.from(el.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "保存",
    );
    saveBtn?.click();
    await flush(el);
    const upsertCall = request.mock.calls.find((c) => c[0] === "cliBackend.upsert");
    expect(upsertCall).toBeTruthy();
    const arg = upsertCall?.[1] as { id: string; config: { command: string } };
    expect(arg.id).toBe("claude-cli");
    expect(arg.config.command).toBe("claude");
  });

  it("discovers and renders backend capabilities (Task 8)", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "cliBackend.list") {
        return listResponse;
      }
      if (method === "cliBackend.capabilities") {
        return {
          backendId: "kiro-cli",
          models: [{ id: "kiro-default", displayName: "Kiro", capabilities: { tools: true } }],
          features: { streaming: false, tools: true, vision: false },
          source: "declared",
        };
      }
      return {};
    });
    const el = mount();
    (el as unknown as { client: unknown }).client = { request };
    await flush(el);
    const capBtn = Array.from(el.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "能力",
    );
    capBtn?.click();
    await flush(el);
    expect(request).toHaveBeenCalledWith("cliBackend.capabilities", { id: "claude-cli" });
    expect(el.textContent).toContain("能力摘要");
    expect(el.textContent).toContain("kiro-default");
  });

  it("loads, sets (SecretRef-First), and verifies a credential (Task 8/9)", async () => {
    let setReq: Record<string, unknown> | undefined;
    const request = vi.fn(async (method: string, params?: unknown) => {
      if (method === "cliBackend.list") {
        return listResponse;
      }
      if (method === "cliBackend.credential.set") {
        setReq = params as Record<string, unknown>;
        return { credentialId: "corp-anthropic" };
      }
      if (method === "cliBackend.credential.list") {
        return {
          credentials: [
            {
              credentialId: "corp-anthropic",
              tenantId: "t1",
              scope: "enterprise",
              backendId: "claude-cli",
              envVars: { ANTHROPIC_API_KEY: { source: "exec", provider: "vault", id: "a/k" } },
              updatedAt: "now",
            },
          ],
          bindings: {},
        };
      }
      if (method === "cliBackend.verifyCredential") {
        return { valid: true, resolvedKeys: ["ANTHROPIC_API_KEY"], failedKeys: [] };
      }
      return {};
    });
    const el = mount();
    (el as unknown as { client: unknown }).client = { request };
    await flush(el);
    // fill tenant + credential form, save
    const tenantInput = Array.from(el.querySelectorAll("input")).find((i) =>
      i.placeholder?.includes("租户 ID"),
    ) as HTMLInputElement;
    tenantInput.value = "t1";
    tenantInput.dispatchEvent(new Event("input"));
    await flush(el);
    const addCredBtn = Array.from(el.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "添加凭证",
    );
    addCredBtn?.click();
    await flush(el);
    (el as unknown as { credForm: unknown }).credForm = {
      credentialId: "corp-anthropic",
      backendId: "claude-cli",
      scope: "enterprise",
      subjectId: "",
      envVars: "ANTHROPIC_API_KEY = exec:vault:a/k",
    };
    await flush(el);
    const saveCredBtn = Array.from(el.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "保存凭证",
    );
    saveCredBtn?.click();
    await flush(el);
    // credential.set carries SecretRef (no plaintext) + reloads list
    expect(setReq?.envVars).toEqual({
      ANTHROPIC_API_KEY: { source: "exec", provider: "vault", id: "a/k" },
    });
    expect(el.textContent).toContain("corp-anthropic");
    // verify
    const verifyBtn = Array.from(el.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "校验",
    );
    verifyBtn?.click();
    await flush(el);
    expect(request).toHaveBeenCalledWith("cliBackend.verifyCredential", {
      tenantId: "t1",
      credentialId: "corp-anthropic",
    });
    expect(el.textContent).toContain("有效");
  });
});
