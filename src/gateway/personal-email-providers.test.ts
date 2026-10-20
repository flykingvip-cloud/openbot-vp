import { describe, expect, it } from "vitest";
import {
  extractEmailDomain,
  findPersonalEmailProviderPreset,
  prefersCustomSmtpForPersonalEmail,
} from "./personal-email-providers.js";

describe("personal email providers", () => {
  it("finds 126 preset", () => {
    const preset = findPersonalEmailProviderPreset("user@126.com");
    expect(preset?.name).toBe("网易126邮箱");
    expect(preset?.imapHost).toBe("imap.126.com");
    expect(preset?.smtpHost).toBe("smtp.126.com");
  });

  it("extracts domain", () => {
    expect(extractEmailDomain("Name <foo@163.com>")).toBe("163.com");
  });

  it("prefers custom SMTP for 163/126", () => {
    expect(prefersCustomSmtpForPersonalEmail("a@163.com")).toBe(true);
    expect(prefersCustomSmtpForPersonalEmail("a@gmail.com")).toBe(false);
  });
});
