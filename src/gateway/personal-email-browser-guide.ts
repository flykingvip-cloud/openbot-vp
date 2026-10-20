import { extractEmailDomain, findPersonalEmailProviderPreset } from "./personal-email-providers.js";

/** Browser co-pilot metadata for Path C (login + generate client auth code). */
export type PersonalEmailBrowserGuide = {
  providerName: string;
  domain: string;
  webmailLoginUrl: string;
  /** Optional deep link when provider exposes a stable settings URL. */
  settingsUrl?: string;
  authCodeHint: string;
  browserSteps: string[];
  /** Never store login passwords; only client auth codes belong in OpenBot bind. */
  securityNote: string;
};

const DOMAIN_BROWSER_GUIDES: Record<
  string,
  Omit<PersonalEmailBrowserGuide, "providerName" | "domain">
> = {
  "126.com": {
    webmailLoginUrl: "https://mail.126.com/",
    authCodeHint:
      "登录后在「设置 → POP3/SMTP/IMAP」开启 IMAP/SMTP，生成「客户端授权码」（不是登录密码）。",
    browserSteps: [
      "browser(action=navigate, url=webmailLoginUrl) 或让用户在新标签页打开邮箱",
      "用户自行完成登录与验证码",
      "设置 → POP3/SMTP/IMAP → 开启 IMAP 与 SMTP → 生成授权码",
      "用户复制授权码 → 粘贴到 OpenBot「SMTP 授权码」并确认提交",
    ],
    securityNote: "勿读取或保存邮箱登录密码；只保存用户确认后的客户端授权码。",
  },
  "163.com": {
    webmailLoginUrl: "https://mail.163.com/",
    authCodeHint: "登录后在「设置 → POP3/SMTP/IMAP」开启服务，生成「客户端授权密码」。",
    browserSteps: [
      "打开 163 邮箱网页并登录",
      "设置 → POP3/SMTP/IMAP → 开启 → 生成授权密码",
      "复制授权密码到 OpenBot 表单 SMTP 授权码字段",
    ],
    securityNote: "勿读取或保存邮箱登录密码；只保存用户确认后的客户端授权码。",
  },
  "yeah.net": {
    webmailLoginUrl: "https://mail.yeah.net/",
    authCodeHint: "与 163 类似：设置里开启 IMAP/SMTP 并生成客户端授权密码。",
    browserSteps: ["打开 Yeah 邮箱 → 设置 → POP3/SMTP/IMAP → 生成授权码"],
    securityNote: "勿读取或保存邮箱登录密码；只保存用户确认后的客户端授权码。",
  },
  "qq.com": {
    webmailLoginUrl: "https://mail.qq.com/",
    authCodeHint: "登录 QQ 邮箱 → 设置 → 账户 → 开启 POP3/IMAP/SMTP → 生成授权码。",
    browserSteps: [
      "打开 QQ 邮箱网页并登录",
      "设置 → 账户 → POP3/IMAP/SMTP 服务 → 开启 → 生成授权码",
      "复制授权码到 OpenBot SMTP 授权码字段",
    ],
    securityNote: "勿读取或保存 QQ 密码；只保存用户确认后的授权码。",
  },
  "vip.qq.com": {
    webmailLoginUrl: "https://mail.qq.com/",
    authCodeHint: "与 QQ 邮箱相同：设置 → 账户 → 生成 IMAP/SMTP 授权码。",
    browserSteps: ["QQ 邮箱网页 → 设置 → 账户 → 生成授权码"],
    securityNote: "勿读取或保存 QQ 密码；只保存用户确认后的授权码。",
  },
  "foxmail.com": {
    webmailLoginUrl: "https://mail.qq.com/",
    authCodeHint: "Foxmail 使用 QQ 邮箱体系：在 QQ 邮箱设置里生成授权码。",
    browserSteps: ["打开 QQ/Foxmail 邮箱 → 设置 → 账户 → 生成授权码"],
    securityNote: "勿读取或保存登录密码；只保存用户确认后的授权码。",
  },
  "gmail.com": {
    webmailLoginUrl: "https://mail.google.com/",
    settingsUrl: "https://myaccount.google.com/apppasswords",
    authCodeHint: "需开启两步验证后，在 Google 账户创建「应用专用密码」作为 SMTP 授权码。",
    browserSteps: [
      "打开 Gmail / Google 账户 → 安全 → 应用专用密码",
      "创建邮件客户端专用密码",
      "粘贴到 OpenBot SMTP 授权码字段",
    ],
    securityNote: "使用 App Password，不是 Google 账户登录密码。",
  },
  "googlemail.com": {
    webmailLoginUrl: "https://mail.google.com/",
    settingsUrl: "https://myaccount.google.com/apppasswords",
    authCodeHint: "与 Gmail 相同：创建应用专用密码。",
    browserSteps: ["Google 账户 → 应用专用密码 → 粘贴到 OpenBot"],
    securityNote: "使用 App Password，不是 Google 账户登录密码。",
  },
};

function resolveDomainGuide(domain: string): PersonalEmailBrowserGuide | null {
  const normalized = domain.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  const direct = DOMAIN_BROWSER_GUIDES[normalized];
  if (direct) {
    const preset = findPersonalEmailProviderPreset(`user@${normalized}`);
    return {
      providerName: preset?.name ?? normalized,
      domain: normalized,
      ...direct,
    };
  }
  const parts = normalized.split(".");
  for (let i = 1; i < parts.length; i += 1) {
    const parent = parts.slice(i).join(".");
    const match = DOMAIN_BROWSER_GUIDES[parent];
    if (match) {
      const preset = findPersonalEmailProviderPreset(`user@${parent}`);
      return {
        providerName: preset?.name ?? parent,
        domain: normalized,
        ...match,
      };
    }
  }
  return null;
}

export function resolvePersonalEmailBrowserGuide(email: string): PersonalEmailBrowserGuide | null {
  const domain = extractEmailDomain(email);
  if (!domain) {
    return null;
  }
  return resolveDomainGuide(domain);
}

export function supportsPersonalEmailBrowserGuide(email: string): boolean {
  return resolvePersonalEmailBrowserGuide(email) != null;
}
