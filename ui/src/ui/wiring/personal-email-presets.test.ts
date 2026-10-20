import { describe, expect, it } from "vitest";
import {
  applyPersonalEmailPresetToEditor,
  findPersonalEmailPreset,
  prefersCustomSmtpForPersonalEmail,
  resolvePersonalEmailEditorFields,
} from "./personal-email-presets.ts";

function createEditor(email = "") {
  return {
    userOperationalIdentityEditorCredentialHandleId: email,
    userOperationalIdentityEditorSmtpHost: "",
    userOperationalIdentityEditorSmtpPort: "587",
    userOperationalIdentityEditorSmtpUser: "",
    userOperationalIdentityEditorImapHost: "",
    userOperationalIdentityEditorImapPort: "993",
    userOperationalIdentityEditorImapUser: "",
    userOperationalIdentityEditorUsePlatformSmtp: true,
    userOperationalIdentityEditorPersonalEmailPresetNote: null as string | null,
  };
}

describe("personal email presets", () => {
  it("recognizes Gmail and prefers custom SMTP/IMAP", () => {
    expect(findPersonalEmailPreset("daniel.hhd@gmail.com")?.smtpHost).toBe("smtp.gmail.com");
    expect(prefersCustomSmtpForPersonalEmail("daniel.hhd@gmail.com")).toBe(true);
  });

  it("fills hosts and usernames while leaving the caller to supply the auth code", () => {
    const host = createEditor("daniel.hhd@gmail.com");
    const note = applyPersonalEmailPresetToEditor(host);
    expect(host.userOperationalIdentityEditorUsePlatformSmtp).toBe(false);
    expect(host.userOperationalIdentityEditorSmtpHost).toBe("smtp.gmail.com");
    expect(host.userOperationalIdentityEditorSmtpPort).toBe("465");
    expect(host.userOperationalIdentityEditorSmtpUser).toBe("daniel.hhd@gmail.com");
    expect(host.userOperationalIdentityEditorImapHost).toBe("imap.gmail.com");
    expect(host.userOperationalIdentityEditorImapPort).toBe("993");
    expect(host.userOperationalIdentityEditorImapUser).toBe("daniel.hhd@gmail.com");
    expect(note).toContain("应用专用密码");
  });

  it("resolves Gmail hosts for display even when editor state is still blank", () => {
    const resolved = resolvePersonalEmailEditorFields({
      email: "daniel.hhd@gmail.com",
      usePlatformSmtp: false,
      smtpHost: "",
      smtpPort: "587",
      smtpUser: "",
      imapHost: "",
      imapPort: "993",
      imapUser: "",
    });
    expect(resolved.smtpHost).toBe("smtp.gmail.com");
    expect(resolved.smtpPort).toBe("465");
    expect(resolved.smtpUser).toBe("daniel.hhd@gmail.com");
    expect(resolved.imapHost).toBe("imap.gmail.com");
    expect(resolved.imapUser).toBe("daniel.hhd@gmail.com");
  });
});
