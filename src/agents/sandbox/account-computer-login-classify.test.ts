import { describe, expect, it } from "vitest";
import {
  classifyAccountComputerLogin,
  normalizeLoginHost,
} from "./account-computer-login-classify.js";

describe("account computer login classifier", () => {
  it("continues when the site is already signed in or has no login", () => {
    expect(
      classifyAccountComputerLogin({ signals: { signedIn: true, password: true, qr: true } }),
    ).toEqual({
      decision: "continue",
    });
    expect(classifyAccountComputerLogin({ signals: {} })).toEqual({ decision: "continue" });
  });

  it("asks once when the first visit shows password and QR", () => {
    expect(
      classifyAccountComputerLogin({ signals: { password: true, qr: true, captcha: true } }),
    ).toEqual({ decision: "choose", methods: ["password", "qr"] });
  });

  it("defaults to the recorded choice on the next visit", () => {
    expect(
      classifyAccountComputerLogin({
        signals: { password: true, qr: true },
        policy: { preferredMethod: "password", firstChoiceRecorded: true },
      }),
    ).toEqual({ decision: "secure_form" });
    expect(
      classifyAccountComputerLogin({
        signals: { password: true, qr: true },
        policy: { preferredMethod: "qr", firstChoiceRecorded: true },
      }),
    ).toEqual({ decision: "handoff", reason: "qr" });
  });

  it("uses a saved credential only for autofill", () => {
    expect(
      classifyAccountComputerLogin({
        signals: { password: true, qr: true },
        policy: {
          preferredMethod: "auto",
          rememberedCredentialId: "cred-1",
          firstChoiceRecorded: true,
        },
      }),
    ).toEqual({ decision: "autofill" });
    expect(
      classifyAccountComputerLogin({
        signals: { password: true },
        policy: { preferredMethod: "auto", firstChoiceRecorded: true },
      }),
    ).toEqual({ decision: "secure_form" });
  });

  it("prefers a password form over captcha, and hands off QR, SMS, captcha, or passkey alone", () => {
    expect(classifyAccountComputerLogin({ signals: { password: true, captcha: true } })).toEqual({
      decision: "secure_form",
    });
    expect(classifyAccountComputerLogin({ signals: { qr: true } })).toEqual({
      decision: "handoff",
      reason: "qr",
    });
    expect(classifyAccountComputerLogin({ signals: { sms: true } })).toEqual({
      decision: "handoff",
      reason: "sms",
    });
    expect(classifyAccountComputerLogin({ signals: { password: true, sms: true } })).toEqual({
      decision: "secure_form",
    });
    expect(classifyAccountComputerLogin({ signals: { captcha: true } })).toEqual({
      decision: "handoff",
      reason: "captcha",
    });
    expect(classifyAccountComputerLogin({ signals: { passkey: true } })).toEqual({
      decision: "handoff",
      reason: "passkey",
    });
  });

  it("normalizes a site host", () => {
    expect(normalizeLoginHost("https://www.JD.com/login")).toBe("jd.com");
    expect(normalizeLoginHost("passport.jd.com:443")).toBe("passport.jd.com");
    expect(normalizeLoginHost("not a host")).toBe("");
  });
});
