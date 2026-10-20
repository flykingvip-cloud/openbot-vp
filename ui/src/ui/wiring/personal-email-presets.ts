/** Client-side mirror of common personal mailbox presets (keep in sync with gateway). */
const PRESETS: Array<{
  domains: string[];
  smtpHost: string;
  smtpPort: string;
  imapHost: string;
  imapPort: string;
  note?: string;
}> = [
  {
    domains: ["qq.com", "vip.qq.com", "foxmail.com"],
    smtpHost: "smtp.qq.com",
    smtpPort: "465",
    imapHost: "imap.qq.com",
    imapPort: "993",
    note: "需开启 IMAP/SMTP 并使用授权码。",
  },
  {
    domains: ["163.com"],
    smtpHost: "smtp.163.com",
    smtpPort: "465",
    imapHost: "imap.163.com",
    imapPort: "993",
    note: "需使用客户端授权密码。",
  },
  {
    domains: ["126.com"],
    smtpHost: "smtp.126.com",
    smtpPort: "465",
    imapHost: "imap.126.com",
    imapPort: "993",
    note: "需使用客户端授权码（非登录密码）。",
  },
  {
    domains: ["gmail.com", "googlemail.com"],
    smtpHost: "smtp.gmail.com",
    smtpPort: "465",
    imapHost: "imap.gmail.com",
    imapPort: "993",
    note: "需使用应用专用密码（App Password），不是 Google 登录密码。",
  },
];

function extractDomain(email: string): string {
  const match = email
    .trim()
    .toLowerCase()
    .match(/@([^>\s]+)/);
  return match?.[1]?.replace(/[>]$/, "") ?? "";
}

export function findPersonalEmailPreset(email: string) {
  const domain = extractDomain(email);
  if (!domain) {
    return null;
  }
  return (
    PRESETS.find((preset) =>
      preset.domains.some((d) => domain === d || domain.endsWith(`.${d}`)),
    ) ?? null
  );
}

export function prefersCustomSmtpForPersonalEmail(email: string): boolean {
  const domain = extractDomain(email);
  if (!domain) {
    return false;
  }
  return [
    "163.com",
    "126.com",
    "yeah.net",
    "qq.com",
    "vip.qq.com",
    "foxmail.com",
    "gmail.com",
    "googlemail.com",
  ].some((d) => domain === d || domain.endsWith(`.${d}`));
}

export function resolvePersonalEmailEditorFields(input: {
  email: string;
  usePlatformSmtp: boolean;
  smtpHost: string;
  smtpPort: string;
  smtpUser: string;
  imapHost: string;
  imapPort: string;
  imapUser: string;
}): {
  smtpHost: string;
  smtpPort: string;
  smtpUser: string;
  imapHost: string;
  imapPort: string;
  imapUser: string;
  note: string | null;
} {
  const email = input.email.trim();
  const preset = findPersonalEmailPreset(email);
  if (!preset || input.usePlatformSmtp) {
    return {
      smtpHost: input.smtpHost,
      smtpPort: input.smtpPort || "587",
      smtpUser: input.smtpUser,
      imapHost: input.imapHost,
      imapPort: input.imapPort || "993",
      imapUser: input.imapUser,
      note: null,
    };
  }
  return {
    smtpHost: input.smtpHost.trim() || preset.smtpHost,
    smtpPort: !input.smtpPort.trim() || input.smtpPort === "587" ? preset.smtpPort : input.smtpPort,
    smtpUser: input.smtpUser.trim() || email,
    imapHost: input.imapHost.trim() || preset.imapHost,
    imapPort: input.imapPort.trim() || preset.imapPort,
    imapUser: input.imapUser.trim() || email,
    note: preset.note ?? null,
  };
}

export function applyPersonalEmailPresetToEditor(host: {
  userOperationalIdentityEditorCredentialHandleId: string;
  userOperationalIdentityEditorSmtpHost: string;
  userOperationalIdentityEditorSmtpPort: string;
  userOperationalIdentityEditorSmtpUser: string;
  userOperationalIdentityEditorImapHost: string;
  userOperationalIdentityEditorImapPort: string;
  userOperationalIdentityEditorImapUser: string;
  userOperationalIdentityEditorUsePlatformSmtp: boolean;
  userOperationalIdentityEditorPersonalEmailPresetNote?: string | null;
}) {
  const email = host.userOperationalIdentityEditorCredentialHandleId.trim();
  if (prefersCustomSmtpForPersonalEmail(email)) {
    host.userOperationalIdentityEditorUsePlatformSmtp = false;
  }
  const resolved = resolvePersonalEmailEditorFields({
    email,
    usePlatformSmtp: host.userOperationalIdentityEditorUsePlatformSmtp,
    smtpHost: host.userOperationalIdentityEditorSmtpHost,
    smtpPort: host.userOperationalIdentityEditorSmtpPort,
    smtpUser: host.userOperationalIdentityEditorSmtpUser,
    imapHost: host.userOperationalIdentityEditorImapHost,
    imapPort: host.userOperationalIdentityEditorImapPort,
    imapUser: host.userOperationalIdentityEditorImapUser,
  });
  host.userOperationalIdentityEditorSmtpHost = resolved.smtpHost;
  host.userOperationalIdentityEditorSmtpPort = resolved.smtpPort;
  host.userOperationalIdentityEditorSmtpUser = resolved.smtpUser;
  host.userOperationalIdentityEditorImapHost = resolved.imapHost;
  host.userOperationalIdentityEditorImapPort = resolved.imapPort;
  host.userOperationalIdentityEditorImapUser = resolved.imapUser;
  host.userOperationalIdentityEditorPersonalEmailPresetNote = resolved.note;
  return resolved.note;
}
