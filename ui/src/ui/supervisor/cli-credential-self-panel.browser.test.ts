// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CliCredentialSelfPanel } from "./cli-credential-self-panel.ts";
import "./cli-credential-self-panel.ts";

function mount(variant: "employee" | "enterprise" = "employee"): CliCredentialSelfPanel {
  const el = document.createElement("cli-credential-self-panel");
  el.variant = variant;
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

async function flush(el: HTMLElement) {
  await (el as unknown as { updateComplete?: Promise<unknown> }).updateComplete;
  await Promise.resolve();
}

async function settle(el: HTMLElement) {
  await flush(el);
  await new Promise((r) => setTimeout(r, 0));
  await flush(el);
}

function credRow() {
  return {
    credentialId: "usr:t1:emp-1:codex-cli",
    backendId: "codex-cli",
    scope: "personal",
    envVarNames: ["OPENAI_API_KEY"],
    updatedAt: new Date().toISOString(),
  };
}

describe("<cli-credential-self-panel>", () => {
  it("lists scoped credentials on connect", async () => {
    const request = vi.fn(async (method: string, _params?: unknown) => {
      if (method === "cliBackend.credential.scopedList") {
        return { scope: "personal", credentials: [credRow()] };
      }
      return {};
    });
    const el = mount("employee");
    el.client = { request, connected: true } as never;
    await settle(el);
    expect(request).toHaveBeenCalledWith("cliBackend.credential.scopedList", {});
    expect(el.textContent).not.toContain("Grok CLI · XAI_API_KEY");
    expect(el.textContent).toContain("Codex CLI · OPENAI_API_KEY");
  });

  it("saves a personal key via scopedSet with the selected backend + env name", async () => {
    const request = vi.fn(async (method: string, _params?: unknown) => {
      if (method === "cliBackend.credential.scopedList") {
        return { scope: "personal", credentials: [] };
      }
      if (method === "cliBackend.credential.scopedSet") {
        return { credentialId: "usr:t1:emp-1:codex-cli" };
      }
      return {};
    });
    const el = mount("employee");
    el.client = { request, connected: true } as never;
    await settle(el);

    const pwd = el.querySelector('input[type="password"]') as HTMLInputElement;
    pwd.value = "sk-mine";
    pwd.dispatchEvent(new Event("input"));
    await flush(el);

    const saveBtn = Array.from(el.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("添加 KEY"),
    );
    saveBtn?.click();
    await settle(el);

    const setCall = request.mock.calls.find((c) => c[0] === "cliBackend.credential.scopedSet");
    expect(setCall?.[1]).toEqual({
      backendId: "codex-cli",
      envVars: { OPENAI_API_KEY: "sk-mine" },
    });
  });

  it("never sends a tenantId/subjectId/scope from the client (server-derived)", async () => {
    const request = vi.fn(async (method: string, _params?: unknown) => {
      if (method === "cliBackend.credential.scopedList") {
        return { scope: "personal", credentials: [] };
      }
      if (method === "cliBackend.credential.scopedSet") {
        return { credentialId: "x" };
      }
      return {};
    });
    const el = mount("employee");
    el.client = { request, connected: true } as never;
    await settle(el);
    const pwd = el.querySelector('input[type="password"]') as HTMLInputElement;
    pwd.value = "sk-mine";
    pwd.dispatchEvent(new Event("input"));
    await flush(el);
    Array.from(el.querySelectorAll("button"))
      .find((b) => b.textContent?.includes("添加 KEY"))
      ?.click();
    await settle(el);
    const setCall = request.mock.calls.find((c) => c[0] === "cliBackend.credential.scopedSet");
    const params = setCall?.[1] as Record<string, unknown>;
    expect(params).not.toHaveProperty("tenantId");
    expect(params).not.toHaveProperty("subjectId");
    expect(params).not.toHaveProperty("scope");
  });

  it("removes a credential via scopedRemove after confirm", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const request = vi.fn(async (method: string, _params?: unknown) => {
      if (method === "cliBackend.credential.scopedList") {
        return { scope: "personal", credentials: [credRow()] };
      }
      if (method === "cliBackend.credential.scopedRemove") {
        return { removed: true };
      }
      return {};
    });
    const el = mount("employee");
    el.client = { request, connected: true } as never;
    await settle(el);

    const rmBtn = Array.from(el.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "删除",
    );
    rmBtn?.click();
    await settle(el);

    expect(confirmSpy).toHaveBeenCalled();
    const rmCall = request.mock.calls.find((c) => c[0] === "cliBackend.credential.scopedRemove");
    expect(rmCall?.[1]).toEqual({ backendId: "codex-cli" });
  });

  it("enterprise variant shows shared-key copy", async () => {
    const request = vi.fn(async () => ({ scope: "enterprise", credentials: [] }));
    const el = mount("enterprise");
    el.client = { request, connected: true } as never;
    await settle(el);
    expect(el.textContent).toContain("协作工具共享凭证");
  });
});
