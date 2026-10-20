import { describe, expect, it } from "vitest";
import {
  resolvePersonalEmailBrowserGuide,
  supportsPersonalEmailBrowserGuide,
} from "./personal-email-browser-guide.js";

describe("personal email browser guide", () => {
  it("resolves 126 webmail URL and auth hint", () => {
    const guide = resolvePersonalEmailBrowserGuide("user@126.com");
    expect(guide?.webmailLoginUrl).toBe("https://mail.126.com/");
    expect(guide?.authCodeHint).toContain("授权码");
    expect(guide?.browserSteps.length).toBeGreaterThan(0);
  });

  it("resolves Gmail app password settings URL", () => {
    const guide = resolvePersonalEmailBrowserGuide("user@gmail.com");
    expect(guide?.settingsUrl).toBe("https://myaccount.google.com/apppasswords");
  });

  it("supports known domestic providers", () => {
    expect(supportsPersonalEmailBrowserGuide("a@163.com")).toBe(true);
    expect(supportsPersonalEmailBrowserGuide("a@unknown.example")).toBe(false);
  });
});
