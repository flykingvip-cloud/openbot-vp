/**
 * Common personal-mailbox IMAP/SMTP presets (inspired by mail-skill email_providers).
 * Used to auto-fill bind forms when the user enters a known email domain.
 */

export type PersonalEmailProviderPreset = {
  name: string;
  domains: string[];
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  useSsl: boolean;
  note?: string;
};

const PRESETS: PersonalEmailProviderPreset[] = [
  {
    name: "QQ邮箱",
    domains: ["qq.com", "vip.qq.com", "foxmail.com"],
    imapHost: "imap.qq.com",
    imapPort: 993,
    smtpHost: "smtp.qq.com",
    smtpPort: 465,
    useSsl: true,
    note: "需开启 IMAP/SMTP 并使用授权码（非 QQ 密码）。",
  },
  {
    name: "网易163邮箱",
    domains: ["163.com"],
    imapHost: "imap.163.com",
    imapPort: 993,
    smtpHost: "smtp.163.com",
    smtpPort: 465,
    useSsl: true,
    note: "需开启 IMAP/SMTP 并使用客户端授权密码。",
  },
  {
    name: "网易126邮箱",
    domains: ["126.com"],
    imapHost: "imap.126.com",
    imapPort: 993,
    smtpHost: "smtp.126.com",
    smtpPort: 465,
    useSsl: true,
    note: "需开启 IMAP/SMTP 并使用客户端授权码（非登录密码）。",
  },
  {
    name: "网易Yeah邮箱",
    domains: ["yeah.net"],
    imapHost: "imap.yeah.net",
    imapPort: 993,
    smtpHost: "smtp.yeah.net",
    smtpPort: 465,
    useSsl: true,
  },
  {
    name: "Gmail",
    domains: ["gmail.com", "googlemail.com"],
    imapHost: "imap.gmail.com",
    imapPort: 993,
    smtpHost: "smtp.gmail.com",
    smtpPort: 465,
    useSsl: true,
    note: "需使用应用专用密码（App Password）。",
  },
  {
    name: "Outlook",
    domains: ["outlook.com", "hotmail.com", "live.com"],
    imapHost: "outlook.office365.com",
    imapPort: 993,
    smtpHost: "smtp.office365.com",
    smtpPort: 587,
    useSsl: true,
  },
  {
    name: "阿里企业邮箱",
    domains: ["aliyun.com"],
    imapHost: "imap.aliyun.com",
    imapPort: 993,
    smtpHost: "smtp.aliyun.com",
    smtpPort: 465,
    useSsl: true,
  },
  {
    name: "腾讯企业邮箱",
    domains: ["exmail.qq.com"],
    imapHost: "imap.exmail.qq.com",
    imapPort: 993,
    smtpHost: "smtp.exmail.qq.com",
    smtpPort: 465,
    useSsl: true,
  },
];

const DOMAIN_MAP = new Map<string, PersonalEmailProviderPreset>();
for (const preset of PRESETS) {
  for (const domain of preset.domains) {
    DOMAIN_MAP.set(domain.toLowerCase(), preset);
  }
}

export function extractEmailDomain(email: string): string {
  const match = email
    .trim()
    .toLowerCase()
    .match(/@([^>\s]+)/);
  return match?.[1]?.replace(/[>]$/, "") ?? "";
}

export function findPersonalEmailProviderPreset(email: string): PersonalEmailProviderPreset | null {
  const domain = extractEmailDomain(email);
  if (!domain) {
    return null;
  }
  const direct = DOMAIN_MAP.get(domain);
  if (direct) {
    return direct;
  }
  const parts = domain.split(".");
  for (let i = 1; i < parts.length; i += 1) {
    const parent = parts.slice(i).join(".");
    const match = DOMAIN_MAP.get(parent);
    if (match) {
      return match;
    }
  }
  return null;
}

export function listPersonalEmailProviderPresets(): PersonalEmailProviderPreset[] {
  return PRESETS.map((entry) => ({ ...entry, domains: [...entry.domains] }));
}

/** Domains where custom SMTP/IMAP is required (not platform relay). */
export function prefersCustomSmtpForPersonalEmail(email: string): boolean {
  const preset = findPersonalEmailProviderPreset(email);
  if (!preset) {
    return true;
  }
  return ["163.com", "126.com", "yeah.net", "qq.com", "vip.qq.com", "foxmail.com"].some((d) =>
    extractEmailDomain(email).endsWith(d),
  );
}
