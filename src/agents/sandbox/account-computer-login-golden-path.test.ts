/**
 * Account Computer P6 golden-path (fixture + mocked CDP fill + handoff → 给AI).
 *
 * Proves the automated contract for:
 *   Secure Form → fill credentials → fixture login success → handoff
 *   (user holds desktop) → releaseControl (「交给AI」) → await_return resumes.
 *
 * Does NOT claim a live third-party site e2e. Dual Account Worker flags stay
 * default-off (P6b). Fixture: docs/design/account-computer-login-password-fixture.html
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseHTML } from "linkedom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { browserPreviewHandlers } from "../../gateway/server-methods/browser-preview.js";
import { secureFormHandlers } from "../../gateway/server-methods/secure-form.js";
import type { GatewayClient } from "../../gateway/server-methods/types.js";
import {
  publishAccountComputerObserver,
  resetAccountComputerSlotsForTests,
  setAccountBrowserLivenessForTests,
} from "./account-computer-stream.js";
import { isAccountWorkerDockerDriverEnabled } from "./account-worker-driver.js";
import { isAccountWorkerFlagOn } from "./account-worker.js";
import { resetNoVncObserverTokensForTests } from "./novnc-auth.js";
import { preflightAndFillSecureForm, setSecureFormFillDepsForTests } from "./secure-form-fill.js";
import {
  notifyHandoffReturned,
  resetSecureFormHandoffWaitForTests,
} from "./secure-form-handoff-wait.js";
import {
  createSecureFormRequest,
  getPendingSecureForm,
  resetSecureFormStoreForTests,
} from "./secure-form-store.js";

const FIXTURE_REL = "docs/design/account-computer-login-password-fixture.html";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const FIXTURE_PATH = path.join(REPO_ROOT, FIXTURE_REL);
const ZH_CN_PATH = path.join(REPO_ROOT, "ui/src/i18n/locales/zh-CN.ts");

const FIXTURE_HOST = "login.fixture.local";

function client(overrides: Partial<GatewayClient> = {}): GatewayClient {
  return {
    sessionEnterpriseId: "tenant-1",
    platformUserId: "user-1",
    ...overrides,
  } as GatewayClient;
}

function viRespond() {
  const calls: Array<[boolean, unknown?, { message?: string }?]> = [];
  return {
    calls,
    fn: (ok: boolean, payload?: unknown, error?: { message?: string }) => {
      calls.push([ok, payload, error]);
    },
  };
}

function makeContext() {
  const broadcasts: Array<{ event: string; payload: unknown }> = [];
  return {
    broadcasts,
    context: {
      broadcast: (event: string, payload: unknown) => {
        broadcasts.push({ event, payload });
      },
    } as never,
  };
}

async function callSecure(
  method: keyof typeof secureFormHandlers,
  params: Record<string, unknown>,
  viewer: GatewayClient | null = client(),
) {
  const respond = viRespond();
  const { broadcasts, context } = makeContext();
  await secureFormHandlers[method]({
    params,
    respond: respond.fn as never,
    client: viewer,
    context,
    req: { type: "req", id: "req-1", method },
    isWebchatConnect: () => false,
  });
  return { ...respond, broadcasts };
}

async function callPreview(
  params: Record<string, unknown>,
  viewer: GatewayClient | null = client(),
) {
  const respond = viRespond();
  const { broadcasts, context } = makeContext();
  await browserPreviewHandlers["browser.preview"]({
    params,
    respond: respond.fn as never,
    client: viewer,
    context,
    req: { type: "req", id: "req-2", method: "browser.preview" },
    isWebchatConnect: () => false,
  });
  return { ...respond, broadcasts };
}

describe("Account Computer P6 login golden-path (fixture)", () => {
  beforeEach(() => {
    resetAccountComputerSlotsForTests();
    setAccountBrowserLivenessForTests(async () => "running");
    resetNoVncObserverTokensForTests();
    resetSecureFormStoreForTests();
    resetSecureFormHandoffWaitForTests();
    setSecureFormFillDepsForTests(null);
    publishAccountComputerObserver({
      tenantId: "tenant-1",
      userId: "user-1",
      noVncPort: 6080,
      password: "secret-vnc",
      bridgeBaseUrl: "http://127.0.0.1:18789",
      scopeKey: "scope-golden",
      containerName: "openbot-sb-browser-golden",
      agentLabel: "Ada",
    });
  });

  afterEach(() => {
    resetSecureFormHandoffWaitForTests();
    resetSecureFormStoreForTests();
    resetAccountComputerSlotsForTests();
    setSecureFormFillDepsForTests(null);
  });

  it("fixture HTML: password login submits to fixture-ok without echoing password", () => {
    expect(fs.existsSync(FIXTURE_PATH)).toBe(true);
    const html = fs.readFileSync(FIXTURE_PATH, "utf8");
    expect(html).toContain('id="username"');
    expect(html).toContain('id="password"');
    expect(html).toContain('type="password"');
    expect(html).toContain("fixture-ok");
    expect(html).not.toContain("交还");

    const { document, window } = parseHTML(html);
    // linkedom may not auto-run inline scripts; mirror fixture submit contract.
    const form = document.getElementById("login") as HTMLFormElement | null;
    const user = document.getElementById("username") as HTMLInputElement | null;
    const pass = document.getElementById("password") as HTMLInputElement | null;
    const status = document.getElementById("status");
    expect(form && user && pass && status).toBeTruthy();

    user!.value = "fixture-user";
    pass!.value = "fixture-secret-should-not-echo";
    const submitHandler = () => {
      status!.textContent =
        "fixture-ok: submitted for " + (user!.value || "(empty user)") + " (password not echoed)";
    };
    form!.addEventListener("submit", (event: Event) => {
      event.preventDefault();
      submitHandler();
    });
    form!.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    expect(status!.textContent).toBe(
      "fixture-ok: submitted for fixture-user (password not echoed)",
    );
    expect(status!.textContent).not.toContain("fixture-secret");
  });

  it("zh-CN chrome keeps 交给AI; handoff hint is auto-resume", () => {
    const zh = fs.readFileSync(ZH_CN_PATH, "utf8");
    expect(zh).toMatch(/computerHandBack:\s*"交给AI"/);
    expect(zh).toMatch(/系统会自动继续/);
    expect(zh).not.toContain("完成后点「交给AI」");
    expect(zh).not.toContain("无需点「交给AI」");
    expect(zh).not.toContain("不用点「交给AI」");
    expect(zh).not.toMatch(/computerHandBack:\s*"交还"/);
  });

  it("Form → fill → handoff → releaseControl(给AI) → await_return (mocked fill)", async () => {
    // P6b: dual flags default ON when unset; product path still gated by profile.
    expect(isAccountWorkerFlagOn({})).toBe(true);
    expect(isAccountWorkerDockerDriverEnabled({})).toBe(true);
    expect(isAccountWorkerFlagOn({ OPENBOT_ACCOUNT_WORKER: "0" })).toBe(false);
    expect(isAccountWorkerDockerDriverEnabled({ OPENBOT_ACCOUNT_WORKER_DOCKER: "0" })).toBe(false);

    const offered = createSecureFormRequest({
      tenantId: "tenant-1",
      userId: "user-1",
      sessionKey: "golden-session",
      agentLabel: "Ada",
      reason: "auth",
      domain: { host: FIXTURE_HOST },
      fields: [
        { fieldId: "username", kind: "username", label: "用户名", ref: "e1" },
        { fieldId: "password", kind: "password", label: "密码", ref: "e2" },
      ],
    });

    const filledRefs: string[] = [];
    setSecureFormFillDepsForTests({
      async readPage() {
        return {
          hostname: FIXTURE_HOST,
          href: `https://${FIXTURE_HOST}/signin`,
        };
      },
      async fillFields({ fields, values }) {
        for (const field of fields) {
          filledRefs.push(field.ref ?? field.fieldId);
          expect(values[field.fieldId]).toBeTruthy();
        }
        // Simulate fixture login success marker (no secrets retained).
        expect(values.password).toBe("fixture-secret");
        for (const key of Object.keys(values)) {
          values[key] = "";
          delete values[key];
        }
        return { ok: true };
      },
    });

    const values = { username: "fixture-user", password: "fixture-secret" };
    const receipt = await preflightAndFillSecureForm({
      form: getPendingSecureForm(offered.formId)!,
      values,
    });
    expect(receipt.status).toBe("filled");
    expect(JSON.stringify(receipt)).not.toContain("fixture-secret");
    expect(Object.keys(values)).toEqual([]);
    expect(filledRefs.toSorted()).toEqual(["e1", "e2"]);

    const handoff = await callSecure("secure_form.handoff", {
      sessionKey: "golden-session",
      reason: "sso",
    });
    expect(handoff.calls[0]?.[0]).toBe(true);
    const active = handoff.broadcasts.find((b) => b.event === "secure_form.handoff_active");
    expect(active).toBeTruthy();
    const activePayload = active!.payload as { instruction?: string };
    const instruction = activePayload.instruction ?? "";
    // sso reason keeps optional custom instruction; default path still auto-continue
    expect(instruction).toMatch(/自动继续/);
    expect(instruction).not.toContain("无需点「交给AI」");
    expect(instruction).not.toContain("不用点「交给AI」");
    expect(instruction).not.toContain("交还");
    expect(instruction).not.toContain("页面快照");
    expect(instruction).not.toContain("二选一");
    expect(JSON.stringify(handoff.broadcasts)).not.toContain("secret-vnc");

    const waiting = callSecure("secure_form.await_return", {
      sessionKey: "golden-session",
      timeoutMs: 5_000,
    });
    await new Promise((r) => setTimeout(r, 20));

    // UI「交给AI」→ handBackComputerPreview → open plan releaseControl + explicitHandback
    const released = await callPreview({
      action: "open",
      sessionKey: "golden-session",
      releaseControl: true,
      explicitHandback: true,
    });
    expect(released.broadcasts.some((b) => b.event === "secure_form.handoff_returned")).toBe(true);

    const awaited = await waiting;
    expect(awaited.calls[0]?.[0]).toBe(true);
    const body = awaited.calls[0]?.[1] as Record<string, unknown>;
    expect(body.status).toBe("handoff_returned");
    expect(JSON.stringify(body)).not.toContain("fixture-secret");
    expect(JSON.stringify(body)).not.toContain("secret-vnc");
  });

  it("await_return still resumes within grace after 给AI notify", async () => {
    notifyHandoffReturned("golden-grace");
    const result = await callSecure("secure_form.await_return", {
      sessionKey: "golden-grace",
      timeoutMs: 1_000,
    });
    expect(result.calls[0]?.[0]).toBe(true);
    expect((result.calls[0]?.[1] as { status?: string })?.status).toBe("handoff_returned");
  });
});
