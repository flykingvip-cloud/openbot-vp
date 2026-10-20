/** Client-side mirror of gateway personal-email-browser-guide (keep URLs in sync). */

export type PersonalEmailBrowserGuide = {
  providerName: string;
  domain: string;
  webmailLoginUrl: string;
  settingsUrl?: string;
  authCodeHint: string;
};

const DOMAIN_GUIDES: Record<string, Omit<PersonalEmailBrowserGuide, "providerName" | "domain">> = {
  "126.com": {
    webmailLoginUrl: "https://mail.126.com/",
    authCodeHint: "设置 → POP3/SMTP/IMAP → 开启 → 生成客户端授权码",
  },
  "163.com": {
    webmailLoginUrl: "https://mail.163.com/",
    authCodeHint: "设置 → POP3/SMTP/IMAP → 开启 → 生成客户端授权密码",
  },
  "yeah.net": {
    webmailLoginUrl: "https://mail.yeah.net/",
    authCodeHint: "设置 → POP3/SMTP/IMAP → 生成授权码",
  },
  "qq.com": {
    webmailLoginUrl: "https://mail.qq.com/",
    authCodeHint: "设置 → 账户 → POP3/IMAP/SMTP → 生成授权码",
  },
  "vip.qq.com": {
    webmailLoginUrl: "https://mail.qq.com/",
    authCodeHint: "设置 → 账户 → 生成 IMAP/SMTP 授权码",
  },
  "foxmail.com": {
    webmailLoginUrl: "https://mail.qq.com/",
    authCodeHint: "QQ 邮箱设置 → 账户 → 生成授权码",
  },
  "gmail.com": {
    webmailLoginUrl: "https://mail.google.com/",
    settingsUrl: "https://myaccount.google.com/apppasswords",
    authCodeHint: "Google 账户 → 应用专用密码",
  },
  "googlemail.com": {
    webmailLoginUrl: "https://mail.google.com/",
    settingsUrl: "https://myaccount.google.com/apppasswords",
    authCodeHint: "Google 账户 → 应用专用密码",
  },
};

function extractDomain(email: string): string {
  const match = email
    .trim()
    .toLowerCase()
    .match(/@([^>\s]+)/);
  return match?.[1]?.replace(/[>]$/, "") ?? "";
}

export function resolvePersonalEmailBrowserGuide(email: string): PersonalEmailBrowserGuide | null {
  const domain = extractDomain(email);
  if (!domain) {
    return null;
  }
  const direct = DOMAIN_GUIDES[domain];
  if (direct) {
    return { providerName: domain, domain, ...direct };
  }
  const parts = domain.split(".");
  for (let i = 1; i < parts.length; i += 1) {
    const parent = parts.slice(i).join(".");
    const match = DOMAIN_GUIDES[parent];
    if (match) {
      return { providerName: parent, domain, ...match };
    }
  }
  return null;
}
