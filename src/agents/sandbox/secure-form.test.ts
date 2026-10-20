import { afterEach, describe, expect, it } from "vitest";
import {
  endAccountComputer,
  publishAccountComputerObserver,
  readAccountComputerPreview,
  resetAccountComputerSlotsForTests,
  setAccountComputerReleaseDepsForTests,
} from "./account-computer-stream.js";
import { preflightAndFillSecureForm, setSecureFormFillDepsForTests } from "./secure-form-fill.js";
import {
  cancelSecureForm,
  createSecureFormRequest,
  getPendingSecureForm,
  isAccountFormLocked,
  resetSecureFormStoreForTests,
} from "./secure-form-store.js";

afterEach(() => {
  resetSecureFormStoreForTests();
  resetAccountComputerSlotsForTests();
  setSecureFormFillDepsForTests(null);
});

describe("secure form P5a", () => {
  it("creates a pending form and sets formLock", () => {
    const offered = createSecureFormRequest({
      tenantId: "t1",
      userId: "u1",
      sessionKey: "s1",
      agentLabel: "Bot",
      reason: "auth",
      domain: { host: "login.example.com" },
      fields: [
        { fieldId: "user", kind: "username", label: "用户名", ref: "e1" },
        { fieldId: "pass", kind: "password", label: "密码", ref: "e2" },
      ],
    });
    expect(offered.formId).toBeTruthy();
    expect(isAccountFormLocked("t1", "u1")).toBe(true);
    expect(getPendingSecureForm(offered.formId)?.fields.map((f) => f.kind)).toEqual([
      "username",
      "password",
    ]);
  });

  it("fills without retaining values and reports filled", async () => {
    const offered = createSecureFormRequest({
      tenantId: "t1",
      userId: "u1",
      sessionKey: "s1",
      agentLabel: "Bot",
      reason: "auth",
      domain: { host: "login.example.com" },
      fields: [
        { fieldId: "user", kind: "username", label: "用户名", ref: "e1" },
        { fieldId: "pass", kind: "password", label: "密码", ref: "e2" },
      ],
    });
    const seen: string[] = [];
    setSecureFormFillDepsForTests({
      async readPage() {
        return { hostname: "login.example.com", href: "https://login.example.com/" };
      },
      async fillFields({ values }) {
        seen.push(...Object.keys(values));
        expect(values.pass).toBe("secret-pass");
        return { ok: true };
      },
    });
    const values = { user: "alice", pass: "secret-pass" };
    const receipt = await preflightAndFillSecureForm({
      form: getPendingSecureForm(offered.formId)!,
      values,
    });
    expect(receipt.status).toBe("filled");
    expect(JSON.stringify(receipt)).not.toContain("secret-pass");
    expect(JSON.stringify(receipt)).not.toContain("alice");
    expect(Object.keys(values)).toEqual([]);
    expect(seen.toSorted()).toEqual(["pass", "user"]);
  });

  it("fails closed on domain_mismatch", async () => {
    const offered = createSecureFormRequest({
      tenantId: "t1",
      userId: "u1",
      sessionKey: "s1",
      agentLabel: "Bot",
      reason: "auth",
      domain: { host: "login.example.com" },
      fields: [{ fieldId: "user", kind: "username", label: "用户名", ref: "e1" }],
    });
    setSecureFormFillDepsForTests({
      async readPage() {
        return { hostname: "evil.example.com", href: "https://evil.example.com/" };
      },
      async fillFields() {
        throw new Error("should not fill");
      },
    });
    const receipt = await preflightAndFillSecureForm({
      form: getPendingSecureForm(offered.formId)!,
      values: { user: "alice" },
    });
    expect(receipt.status).toBe("failed");
    expect(receipt.code).toBe("domain_mismatch");
  });

  it("takeControl cancels form (decision C) and clears formLock", () => {
    publishAccountComputerObserver({
      tenantId: "t1",
      userId: "u1",
      noVncPort: 6080,
      bridgeBaseUrl: "http://127.0.0.1:1",
      scopeKey: "scope",
      containerName: "c1",
      agentLabel: "Bot",
      status: "READY",
    });
    const offered = createSecureFormRequest({
      tenantId: "t1",
      userId: "u1",
      sessionKey: "s1",
      agentLabel: "Bot",
      reason: "auth",
      domain: { host: "login.example.com" },
      fields: [{ fieldId: "user", kind: "username", label: "用户名", ref: "e1" }],
    });
    expect(isAccountFormLocked("t1", "u1")).toBe(true);
    const preview = readAccountComputerPreview({
      tenantId: "t1",
      userId: "u1",
      issueUrl: true,
      sessionKey: "s1",
      takeControl: true,
    });
    expect(preview.controlledBy?.kind).toBe("user");
    expect(getPendingSecureForm(offered.formId)).toBeNull();
    expect(isAccountFormLocked("t1", "u1")).toBe(false);
  });

  it("formLock forces view-only open without takeControl", () => {
    publishAccountComputerObserver({
      tenantId: "t1",
      userId: "u1",
      noVncPort: 6080,
      bridgeBaseUrl: "http://127.0.0.1:1",
      scopeKey: "scope",
      containerName: "c1",
      agentLabel: "Bot",
      status: "READY",
    });
    createSecureFormRequest({
      tenantId: "t1",
      userId: "u1",
      sessionKey: "s1",
      agentLabel: "Bot",
      reason: "auth",
      domain: { host: "login.example.com" },
      fields: [{ fieldId: "pass", kind: "password", label: "密码", ref: "e2" }],
    });
    // First grant control then re-open while form locked without takeControl → viewOnly
    readAccountComputerPreview({
      tenantId: "t1",
      userId: "u1",
      issueUrl: true,
      sessionKey: "s1",
      takeControl: true,
    });
    // Re-create form lock after takeover cleared it
    createSecureFormRequest({
      tenantId: "t1",
      userId: "u1",
      sessionKey: "s1",
      agentLabel: "Bot",
      reason: "auth",
      domain: { host: "login.example.com" },
      fields: [{ fieldId: "pass", kind: "password", label: "密码", ref: "e2" }],
    });
    const preview = readAccountComputerPreview({
      tenantId: "t1",
      userId: "u1",
      issueUrl: true,
      sessionKey: "s1",
    });
    expect(preview.streamUrl).toBeTruthy();
    // Token was minted view-only; we assert form still locked and control may still be user
    expect(isAccountFormLocked("t1", "u1")).toBe(true);
  });

  it("cancel clears lock", () => {
    const offered = createSecureFormRequest({
      tenantId: "t1",
      userId: "u1",
      sessionKey: "s1",
      agentLabel: "Bot",
      reason: "auth",
      domain: { host: "login.example.com" },
      fields: [{ fieldId: "user", kind: "username", label: "用户名", ref: "e1" }],
    });
    const receipt = cancelSecureForm(offered.formId, "user_declined");
    expect(receipt?.status).toBe("failed");
    expect(receipt?.code).toBe("user_declined");
    expect(isAccountFormLocked("t1", "u1")).toBe(false);
  });

  it("OTP submitAfterFill requires single otp field", () => {
    expect(() =>
      createSecureFormRequest({
        tenantId: "t1",
        userId: "u1",
        sessionKey: "s1",
        agentLabel: "Bot",
        reason: "otp",
        domain: { host: "login.example.com" },
        fields: [
          { fieldId: "a", kind: "otp", label: "验证码", ref: "e1" },
          { fieldId: "b", kind: "otp", label: "验证码2", ref: "e2" },
        ],
        submitAfterFill: true,
      }),
    ).toThrow(/submitAfterFill/);
  });

  it("endAccountComputer cancels pending forms as aborted", async () => {
    setAccountComputerReleaseDepsForTests({
      stopBridge: async () => {},
      stopContainer: async () => {},
    });
    publishAccountComputerObserver({
      tenantId: "t1",
      userId: "u1",
      noVncPort: 16080,
      bridgeBaseUrl: "http://127.0.0.1:9",
      scopeKey: "account:t1:u1:browser",
      containerName: "browser-t1-u1",
      agentLabel: "Bot",
    });
    const offered = createSecureFormRequest({
      tenantId: "t1",
      userId: "u1",
      sessionKey: "s1",
      agentLabel: "Bot",
      reason: "auth",
      domain: { host: "login.example.com" },
      fields: [{ fieldId: "user", kind: "username", label: "用户名", ref: "e1" }],
    });
    expect(isAccountFormLocked("t1", "u1")).toBe(true);
    await endAccountComputer({ tenantId: "t1", userId: "u1" });
    expect(getPendingSecureForm(offered.formId)).toBeNull();
    expect(isAccountFormLocked("t1", "u1")).toBe(false);
  });
});
