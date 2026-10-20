import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setAccountComputerLoginPolicyPathForTests } from "../../agents/sandbox/account-computer-login-policy-store.js";
import {
  resetAccountComputerLoginVaultForTests,
  setAccountComputerLoginVaultPathForTests,
} from "../../agents/sandbox/account-computer-login-vault.js";
import { resetAccountComputerLoginWaitForTests } from "../../agents/sandbox/account-computer-login-wait.js";
import { setSecureFormFillDepsForTests } from "../../agents/sandbox/secure-form-fill.js";
import { resetSecureFormStoreForTests } from "../../agents/sandbox/secure-form-store.js";
import { accountComputerLoginHandlers } from "./account-computer-login.js";
import { secureFormHandlers } from "./secure-form.js";
import type { GatewayClient } from "./types.js";

const SECRET = "vault-secret-value";
const envKeys = [
  "OPENBOT_ENTERPRISE_DATA_VAULT_KEY",
  "OPENCLAW_ENTERPRISE_DATA_VAULT_KEY",
  "OPENBOT_ENTERPRISE_DATA_VAULT_KEY_REF",
  "OPENCLAW_ENTERPRISE_DATA_VAULT_KEY_REF",
  "OPENBOT_SECURITY_PROFILE",
  "OPENCLAW_SECURITY_PROFILE",
] as const;

function client(): GatewayClient {
  return {
    sessionEnterpriseId: "tenant-1",
    platformUserId: "user-1",
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

async function waitForBroadcast(
  harness: { broadcasts: Array<{ event: string; payload: unknown }> },
  event: string,
) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (harness.broadcasts.some((row) => row.event === event)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`missing broadcast ${event}`);
}

async function callLogin(
  method: keyof typeof accountComputerLoginHandlers,
  params: Record<string, unknown>,
  harness = makeContext(),
) {
  const respond = viRespond();
  await accountComputerLoginHandlers[method]({
    params,
    respond: respond.fn as never,
    client: client(),
    context: harness.context,
    req: { type: "req", id: "req-1", method },
    isWebchatConnect: () => false,
  });
  return { ...respond, broadcasts: harness.broadcasts, harness };
}

describe("account computer login gateway", () => {
  const prior = new Map<string, string | undefined>();
  let dir = "";
  let filledPassword = "";

  beforeEach(async () => {
    for (const key of envKeys) {
      prior.set(key, process.env[key]);
      delete process.env[key];
    }
    process.env.OPENBOT_ENTERPRISE_DATA_VAULT_KEY = "test-vault-key";
    process.env.OPENBOT_SECURITY_PROFILE = "personal_local";
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "ac-login-gw-"));
    resetAccountComputerLoginWaitForTests();
    resetAccountComputerLoginVaultForTests();
    resetSecureFormStoreForTests();
    setAccountComputerLoginPolicyPathForTests(path.join(dir, "policy.json"));
    setAccountComputerLoginVaultPathForTests(path.join(dir, "vault.json"));
    filledPassword = "";
    setSecureFormFillDepsForTests({
      async readPage() {
        return { hostname: "login.example.com", href: "https://login.example.com/signin" };
      },
      async fillFields({ values }) {
        filledPassword = values.pass ?? values.password ?? "";
        return { ok: true };
      },
    });
  });

  afterEach(async () => {
    resetAccountComputerLoginWaitForTests();
    resetAccountComputerLoginVaultForTests();
    resetSecureFormStoreForTests();
    setAccountComputerLoginPolicyPathForTests(null);
    setSecureFormFillDepsForTests(null);
    for (const key of envKeys) {
      const value = prior.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("asks once, then defaults to password and can autofill a saved login", async () => {
    const harness = makeContext();
    const pending = callLogin(
      "account_computer_login.plan",
      {
        sessionKey: "session-1",
        host: "https://www.login.example.com/signin",
        signals: { password: true, qr: true },
      },
      harness,
    );
    await waitForBroadcast(harness, "account_computer_login.choice_offered");
    const offered = harness.broadcasts.find(
      (row) => row.event === "account_computer_login.choice_offered",
    );
    expect(offered?.payload).toMatchObject({
      host: "login.example.com",
      methods: ["password", "qr"],
      sessionKey: "session-1",
    });
    if (!offered) {
      throw new Error("missing login choice");
    }
    const choiceId = (offered.payload as { choiceId: string }).choiceId;
    const chosen = await callLogin(
      "account_computer_login.choose",
      { choiceId, method: "password" },
      harness,
    );
    expect(chosen.calls[0]?.[1]).toMatchObject({ ok: true, method: "password" });
    const first = await pending;
    expect(first.calls[0]?.[1]).toMatchObject({
      decision: "secure_form",
      host: "login.example.com",
      preferredMethod: "password",
      firstChoiceRecorded: true,
    });

    const second = await callLogin("account_computer_login.plan", {
      sessionKey: "session-1",
      host: "login.example.com",
      signals: { password: true, qr: true },
    });
    expect(second.calls[0]?.[1]).toMatchObject({ decision: "secure_form" });
    expect(
      second.broadcasts.some((row) => row.event === "account_computer_login.choice_offered"),
    ).toBe(false);

    const respond = viRespond();
    const formContext = makeContext();
    await secureFormHandlers["secure_form.request"]({
      params: {
        sessionKey: "session-1",
        reason: "auth",
        domain: { host: "login.example.com" },
        fields: [
          { fieldId: "user", kind: "username", label: "账号", ref: "e1" },
          { fieldId: "pass", kind: "password", label: "密码", ref: "e2" },
        ],
      },
      respond: respond.fn as never,
      client: client(),
      context: formContext.context,
      req: { type: "req", id: "req-form", method: "secure_form.request" },
      isWebchatConnect: () => false,
    });
    const formResult = respond.calls[0]?.[1];
    if (!formResult || typeof formResult !== "object" || !("formId" in formResult)) {
      throw new Error("missing secure form");
    }
    const formId = (formResult as { formId: string }).formId;
    await secureFormHandlers["secure_form.submit"]({
      params: {
        formId,
        sessionKey: "session-1",
        values: { user: "ada", pass: SECRET },
      },
      respond: viRespond().fn as never,
      client: client(),
      context: formContext.context,
      req: { type: "req", id: "req-submit", method: "secure_form.submit" },
      isWebchatConnect: () => false,
    });
    expect(filledPassword).toBe(SECRET);

    const saveHarness = makeContext();
    const savePending = callLogin(
      "account_computer_login.offer_save",
      { sessionKey: "session-1", host: "login.example.com" },
      saveHarness,
    );
    await waitForBroadcast(saveHarness, "account_computer_login.save_offered");
    const saveOffer = saveHarness.broadcasts.find(
      (row) => row.event === "account_computer_login.save_offered",
    );
    if (!saveOffer) {
      throw new Error("missing save offer");
    }
    const saveId = (saveOffer.payload as { saveId: string }).saveId;
    await callLogin("account_computer_login.save_decision", { saveId, save: true }, saveHarness);
    const saved = await savePending;
    expect(saved.calls[0]?.[1]).toEqual({
      decision: "saved",
      host: "login.example.com",
      preferredMethod: "auto",
    });
    expect(JSON.stringify(saved.calls[0]?.[1])).not.toContain(SECRET);
    expect(JSON.stringify(saveHarness.broadcasts)).not.toContain(SECRET);

    filledPassword = "";
    const autofill = await callLogin("account_computer_login.plan", {
      sessionKey: "session-1",
      host: "login.example.com",
      signals: { password: true, qr: true },
      fields: [
        { fieldId: "user", kind: "username", label: "账号", ref: "e1" },
        { fieldId: "pass", kind: "password", label: "密码", ref: "e2" },
      ],
    });
    expect(autofill.calls[0]?.[1]).toMatchObject({
      decision: "autofill",
      status: "filled",
      preferredMethod: "auto",
    });
    expect(filledPassword).toBe(SECRET);
    expect(JSON.stringify(autofill.calls[0]?.[1])).not.toContain(SECRET);
    expect(JSON.stringify(autofill.broadcasts)).not.toContain(SECRET);
    expect(JSON.stringify(autofill.calls[0]?.[1])).not.toContain("ada");
  });

  it("does not ask to save again after the user declines", async () => {
    const respond = viRespond();
    const formContext = makeContext();
    await secureFormHandlers["secure_form.request"]({
      params: {
        sessionKey: "session-1",
        reason: "auth",
        domain: { host: "shop.example.com" },
        fields: [{ fieldId: "pass", kind: "password", label: "密码", ref: "e2" }],
      },
      respond: respond.fn as never,
      client: client(),
      context: formContext.context,
      req: { type: "req", id: "req-form", method: "secure_form.request" },
      isWebchatConnect: () => false,
    });
    setSecureFormFillDepsForTests({
      async readPage() {
        return { hostname: "shop.example.com", href: "https://shop.example.com/login" };
      },
      async fillFields() {
        return { ok: true };
      },
    });
    const formResult = respond.calls[0]?.[1];
    if (!formResult || typeof formResult !== "object" || !("formId" in formResult)) {
      throw new Error("missing secure form");
    }
    const formId = (formResult as { formId: string }).formId;
    await secureFormHandlers["secure_form.submit"]({
      params: { formId, sessionKey: "session-1", values: { pass: SECRET } },
      respond: viRespond().fn as never,
      client: client(),
      context: formContext.context,
      req: { type: "req", id: "req-submit", method: "secure_form.submit" },
      isWebchatConnect: () => false,
    });
    const harness = makeContext();
    const pending = callLogin(
      "account_computer_login.offer_save",
      { sessionKey: "session-1", host: "shop.example.com" },
      harness,
    );
    await waitForBroadcast(harness, "account_computer_login.save_offered");
    const savePayload = harness.broadcasts[0]?.payload;
    if (!savePayload || typeof savePayload !== "object" || !("saveId" in savePayload)) {
      throw new Error("missing save offer");
    }
    const saveId = (savePayload as { saveId: string }).saveId;
    await callLogin("account_computer_login.save_decision", { saveId, save: false }, harness);
    expect((await pending).calls[0]?.[1]).toMatchObject({ decision: "save_declined" });
    const again = await callLogin("account_computer_login.offer_save", {
      sessionKey: "session-1",
      host: "shop.example.com",
    });
    expect(again.calls[0]?.[1]).toMatchObject({ decision: "skip_save" });
  });

  it("blocks saving on a managed profile that has no vault key", async () => {
    delete process.env.OPENBOT_ENTERPRISE_DATA_VAULT_KEY;
    process.env.OPENBOT_SECURITY_PROFILE = "managed_enterprise";
    const respond = viRespond();
    const formContext = makeContext();
    setSecureFormFillDepsForTests({
      async readPage() {
        return { hostname: "login.example.com", href: "https://login.example.com/signin" };
      },
      async fillFields() {
        return { ok: true };
      },
    });
    await secureFormHandlers["secure_form.request"]({
      params: {
        sessionKey: "session-1",
        reason: "auth",
        domain: { host: "login.example.com" },
        fields: [{ fieldId: "pass", kind: "password", label: "密码", ref: "e2" }],
      },
      respond: respond.fn as never,
      client: client(),
      context: formContext.context,
      req: { type: "req", id: "req-form", method: "secure_form.request" },
      isWebchatConnect: () => false,
    });
    const formResult = respond.calls[0]?.[1];
    if (!formResult || typeof formResult !== "object" || !("formId" in formResult)) {
      throw new Error("missing secure form");
    }
    const formId = (formResult as { formId: string }).formId;
    await secureFormHandlers["secure_form.submit"]({
      params: { formId, sessionKey: "session-1", values: { pass: SECRET } },
      respond: viRespond().fn as never,
      client: client(),
      context: formContext.context,
      req: { type: "req", id: "req-submit", method: "secure_form.submit" },
      isWebchatConnect: () => false,
    });
    const offered = await callLogin("account_computer_login.offer_save", {
      sessionKey: "session-1",
      host: "login.example.com",
    });
    expect(offered.calls[0]?.[1]).toMatchObject({
      decision: "save_blocked",
      code: "managed_vault_required",
    });
    await expect(fs.stat(path.join(dir, "vault.json.key"))).rejects.toThrow();
    expect(JSON.stringify(offered.broadcasts)).not.toContain(SECRET);
  });
});
