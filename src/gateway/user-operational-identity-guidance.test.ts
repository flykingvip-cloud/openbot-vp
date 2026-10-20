// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  buildPersonalEmailBindingResolveHints,
  buildPersonalEmailPathCResolveHints,
  formatPersonalEmailSendGuidancePrompt,
  formatUserOperationalIdentityDenialGuidance,
  isPersonalMailTransportCommand,
  PERSONAL_EMAIL_BIND_GUIDANCE_ZH,
  PERSONAL_EMAIL_BROWSER_GUIDANCE_PROTOCOL_YAML,
  PERSONAL_EMAIL_GRANT_GUIDANCE_ZH,
  PERSONAL_EMAIL_PATH_C_GUIDANCE_ZH,
  PERSONAL_EMAIL_STEWARD_HINT_ZH,
} from "./user-operational-identity-guidance.js";

describe("user operational identity email guidance", () => {
  it("guides unbound personal-email to Personal Settings SMTP bind", () => {
    const message = formatUserOperationalIdentityDenialGuidance({
      provider: "personal-email",
      code: "USER_IDENTITY_NOT_BOUND",
      needsBinding: true,
    });
    expect(message).toContain(PERSONAL_EMAIL_BIND_GUIDANCE_ZH);
    expect(message).toContain(PERSONAL_EMAIL_PATH_C_GUIDANCE_ZH);
    expect(message).toContain("个人设置");
    expect(message).toContain("SMTP");
    expect(message).not.toContain("OPENBOT_SMTP");
  });

  it("guides grant confirmation to Personal Settings authorization", () => {
    const message = formatUserOperationalIdentityDenialGuidance({
      provider: "personal-email",
      code: "USER_IDENTITY_GRANT_CONFIRMATION_REQUIRED",
      needsGrantConfirmation: true,
    });
    expect(message).toBe(PERSONAL_EMAIL_GRANT_GUIDANCE_ZH);
    expect(message).toContain("个人设置");
    expect(message).toContain("授权");
  });

  it("prompt documents Path B and resolve/execute flow", () => {
    const prompt = formatPersonalEmailSendGuidancePrompt();
    expect(prompt).toContain("Personal Settings");
    expect(prompt).toContain("personal-email-browser.yaml");
    expect(prompt).toContain("action=resolve");
    expect(prompt).toContain(PERSONAL_EMAIL_STEWARD_HINT_ZH);
    expect(prompt).toContain("every agent");
    expect(prompt).toContain("Do not say authorization is missing");
    expect(prompt).toContain("sendmail");
    expect(isPersonalMailTransportCommand("which mail sendmail mutt")).toBe(true);
  });

  it("builds Path B + C binding hints for 126 email", () => {
    const hints = buildPersonalEmailBindingResolveHints({
      needsBinding: true,
      bindingRequestId: "req-1",
      continuationToken: "tok-1",
      operationalAction: "sync_inbox",
      email: "user@126.com",
      preferBrowser: true,
    });
    expect(hints.pathB).toBe(true);
    expect(hints.pathC).toBe(true);
    expect(hints.browserGuidanceProtocol).toBe(PERSONAL_EMAIL_BROWSER_GUIDANCE_PROTOCOL_YAML);
    expect(hints.browserGuideAvailable).toBe(true);
    const browserGuide = hints.browserGuide as { webmailLoginUrl?: string };
    expect(browserGuide.webmailLoginUrl).toBe("https://mail.126.com/");
  });

  it("builds Path C stub when email unknown", () => {
    const hints = buildPersonalEmailPathCResolveHints({ needsBinding: true });
    expect(hints.pathC).toBe(true);
    expect(hints.browserGuideAvailable).toBe(false);
  });
});
