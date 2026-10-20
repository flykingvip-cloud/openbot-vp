import type { PersonalEmailBrowserGuide } from "./personal-email-browser-guide.js";
import { resolvePersonalEmailBrowserGuide } from "./personal-email-browser-guide.js";

export const PERSONAL_EMAIL_PROVIDER = "personal-email";

/** Lazy-load target for Path B steward-guided binding (user-guidance-protocol). */
export const PERSONAL_EMAIL_GUIDANCE_PROTOCOL_YAML =
  "skills/user-guidance-protocol/references/personal-email.yaml";

/** Lazy-load target for Path C browser co-pilot (login + auth code). */
export const PERSONAL_EMAIL_BROWSER_GUIDANCE_PROTOCOL_YAML =
  "skills/user-guidance-protocol/references/personal-email-browser.yaml";

/** Guide the user to bind SMTP/IMAP credentials in Personal Settings, then retry. */
export const PERSONAL_EMAIL_BIND_GUIDANCE_ZH =
  "请先打开【个人设置 → 授权 / 运营身份】添加个人邮箱，或找「大白管家」在对话里带你完成 SMTP + IMAP 配置。绑定后凭证会同步到个人设置，你也可授权给其他机器人。不要用 exec/环境变量直连 SMTP。";

export const PERSONAL_EMAIL_PATH_B_GUIDANCE_ZH =
  "Path B：加载 personal-email.yaml，一步一带引导用户到【个人设置 → 授权 / 运营身份 → 添加个人邮箱】；若聊天区有「去绑定」可优先点击。绑定后默认授权大白，可继续原邮件任务。";

export const PERSONAL_EMAIL_PATH_C_GUIDANCE_ZH =
  "Path C：加载 personal-email-browser.yaml，用 browser 协驾用户在邮箱网页登录并生成授权码；SMTP/IMAP 主机自动填充，用户粘贴授权码后确认绑定。勿存登录密码。";

export const PERSONAL_EMAIL_GRANT_GUIDANCE_ZH =
  "邮箱已绑定，但当前助手尚未获得邮件授权。请在【个人设置 → 授权 / 运营身份】里为该助手确认授权，或找「大白管家」重新绑定/授权。";

export const PERSONAL_EMAIL_SESSION_GUIDANCE_ZH =
  "当前会话没有登录用户上下文，且该机器人没有可用的个人运营身份授权。请从员工工作台已登录后进入对话，或在个人设置里把身份授权给此机器人。";

export const PERSONAL_EMAIL_STEWARD_HINT_ZH =
  "绑定成功后已默认授权给「大白管家」。找大白说「帮我查/发/回邮件」即可；也可在个人设置把同一邮箱授权给其他机器人。";

export function formatPersonalEmailBindDenialMessage(params?: {
  code?: string;
  fallback?: string;
}): string {
  const code = params?.code?.trim();
  if (code === "USER_IDENTITY_GRANT_CONFIRMATION_REQUIRED") {
    return PERSONAL_EMAIL_GRANT_GUIDANCE_ZH;
  }
  if (
    code === "USER_IDENTITY_NOT_BOUND" ||
    code === "USER_IDENTITY_REAUTH_REQUIRED" ||
    code === "USER_IDENTITY_INACTIVE"
  ) {
    return PERSONAL_EMAIL_BIND_GUIDANCE_ZH;
  }
  return params?.fallback?.trim() || PERSONAL_EMAIL_BIND_GUIDANCE_ZH;
}

export function formatUserOperationalIdentityDenialGuidance(params: {
  provider: string;
  code?: string;
  message?: string;
  needsBinding?: boolean;
  needsGrantConfirmation?: boolean;
}): string {
  const provider = params.provider.trim().toLowerCase();
  if (provider === PERSONAL_EMAIL_PROVIDER) {
    if (
      params.needsGrantConfirmation ||
      params.code === "USER_IDENTITY_GRANT_CONFIRMATION_REQUIRED"
    ) {
      return PERSONAL_EMAIL_GRANT_GUIDANCE_ZH;
    }
    if (params.needsBinding || params.code === "USER_IDENTITY_NOT_BOUND") {
      return `${PERSONAL_EMAIL_BIND_GUIDANCE_ZH} ${PERSONAL_EMAIL_PATH_C_GUIDANCE_ZH}`;
    }
    return formatPersonalEmailBindDenialMessage({
      code: params.code,
      fallback: params.message,
    });
  }
  if (params.needsBinding) {
    return (
      params.message?.trim() ||
      "请先在【个人设置 → 授权 / 运营身份】绑定该服务的凭证，完成后再让我重试。"
    );
  }
  if (params.needsGrantConfirmation) {
    return (
      params.message?.trim() ||
      "请在【个人设置 → 授权 / 运营身份】为当前助手确认该运营身份的授权后再重试。"
    );
  }
  return params.message?.trim() || "运营身份访问被拒绝，请在个人设置中检查绑定与授权。";
}

export function derivePersonalEmailResumeMessage(operationalAction?: string): string {
  const action = operationalAction?.trim().toLowerCase() ?? "";
  if (action === "sync_inbox") {
    return "帮我查最近邮件";
  }
  if (action === "send_email") {
    return "帮我发邮件";
  }
  if (action === "reply_email") {
    return "帮我回复邮件";
  }
  if (action === "read_email") {
    return "帮我读这封邮件";
  }
  if (action === "search_email") {
    return "帮我搜邮件";
  }
  return "继续刚才的邮件任务";
}

/** Structured Path B hints for resolve/execute denial JSON (agents + UI). */
export function buildPersonalEmailPathBResolveHints(params: {
  needsBinding: boolean;
  needsGrantConfirmation?: boolean;
  bindingRequestId?: string | null;
  continuationToken?: string | null;
  operationalAction?: string;
}): Record<string, unknown> {
  if (!params.needsBinding || params.needsGrantConfirmation) {
    return {};
  }
  return {
    guidanceProtocol: PERSONAL_EMAIL_GUIDANCE_PROTOCOL_YAML,
    pathB: true,
    stewardBindingPath: true,
    resumeMessageHint: derivePersonalEmailResumeMessage(params.operationalAction),
    nextSteps: [
      "Load skills/user-guidance-protocol/references/personal-email.yaml and guide step-by-step.",
      "Offer Personal Settings → 授权 / 运营身份 → 添加个人邮箱, or chat banner 「去绑定」.",
      "After bind + grant to 大白, call action=resolve then action=execute to continue.",
    ],
    bindingRequestId: params.bindingRequestId ?? null,
    continuationToken: params.continuationToken ?? null,
  };
}

function serializePersonalEmailBrowserGuide(
  guide: PersonalEmailBrowserGuide,
): Record<string, unknown> {
  return {
    providerName: guide.providerName,
    domain: guide.domain,
    webmailLoginUrl: guide.webmailLoginUrl,
    settingsUrl: guide.settingsUrl ?? null,
    authCodeHint: guide.authCodeHint,
    browserSteps: guide.browserSteps,
    securityNote: guide.securityNote,
  };
}

/** Path C browser co-pilot hints when user email domain is known. */
export function buildPersonalEmailPathCResolveHints(params: {
  needsBinding: boolean;
  needsGrantConfirmation?: boolean;
  email?: string | null;
  preferBrowser?: boolean;
}): Record<string, unknown> {
  if (!params.needsBinding || params.needsGrantConfirmation) {
    return {};
  }
  const email = params.email?.trim() ?? "";
  const browserGuide = email ? resolvePersonalEmailBrowserGuide(email) : null;
  if (!browserGuide) {
    return {
      pathC: true,
      pathCGuidance: PERSONAL_EMAIL_PATH_C_GUIDANCE_ZH,
      browserGuidanceProtocol: PERSONAL_EMAIL_BROWSER_GUIDANCE_PROTOCOL_YAML,
      browserGuideAvailable: false,
    };
  }
  return {
    pathC: true,
    preferredPath: params.preferBrowser ? "C" : undefined,
    pathCGuidance: PERSONAL_EMAIL_PATH_C_GUIDANCE_ZH,
    browserGuidanceProtocol: PERSONAL_EMAIL_BROWSER_GUIDANCE_PROTOCOL_YAML,
    browserGuideAvailable: true,
    browserGuide: serializePersonalEmailBrowserGuide(browserGuide),
    nextStepsBrowser: [
      "Load personal-email-browser.yaml; use browser tool with profile=chrome when available.",
      `Open ${browserGuide.webmailLoginUrl} — user logs in (captcha manual).`,
      browserGuide.authCodeHint,
      "User pastes auth code into OpenBot SMTP field → 添加并认证 (never store login password).",
    ],
  };
}

/** Combined Path B + Path C hints for personal-email binding denials. */
export function buildPersonalEmailBindingResolveHints(params: {
  needsBinding: boolean;
  needsGrantConfirmation?: boolean;
  bindingRequestId?: string | null;
  continuationToken?: string | null;
  operationalAction?: string;
  email?: string | null;
  preferBrowser?: boolean;
}): Record<string, unknown> {
  return {
    ...buildPersonalEmailPathBResolveHints(params),
    ...buildPersonalEmailPathCResolveHints(params),
  };
}

/** Shown when exec tries to send personal mail through the system MTA. */
export const PERSONAL_EMAIL_EXEC_TRANSPORT_DENIAL =
  "Personal email is not sent with mail, sendmail, mutt, or OPENBOT_SMTP_* in exec. Call user_operational_identity with provider personal-email: action=resolve, then action=execute (send_email or reply_email). If the tool says the grant is missing, tell the user that. If the tool shows an active grant, send with the tool. Do not claim authorization is missing without that tool result.";

const PERSONAL_MAIL_BIN = /(?:sendmail|mailx|mutt|msmtp|ssmtp|heirloom-mailx)\b/i;

/** Shell head only. A quoted heredoc body may mention mail without being a transport. */
function personalMailCommandHead(command: string): string {
  const normalized = command.replace(/\r\n/g, "\n");
  const heredoc = normalized.indexOf("<<");
  return (heredoc === -1 ? normalized : normalized.slice(0, heredoc)).trim();
}

/**
 * True when the command invokes a local mail transport.
 * Applies to every agent. Personal mail goes through user_operational_identity.
 */
export function isPersonalMailTransportCommand(command: string): boolean {
  const head = personalMailCommandHead(command);
  if (!head) {
    return false;
  }
  if (/OPENBOT_SMTP_/i.test(head)) {
    return true;
  }
  if (PERSONAL_MAIL_BIN.test(head)) {
    return true;
  }
  if (/(?:^|[;&|`(]|&&|\|\|)\s*(?:\/usr\/sbin\/|\/usr\/bin\/)?mail(?:\s|$)/m.test(head)) {
    return true;
  }
  if (/\b(?:which|type|command\s+-v)\b[^\n]*\bmail\b/i.test(head)) {
    return true;
  }
  return false;
}

/** Always-on prompt fragment for agents that may send email on the user's behalf. */
export function formatPersonalEmailSendGuidancePrompt(): string {
  return [
    "Personal email (user_operational_identity / personal-email):",
    "- Applies to every agent the owner has granted, not only the steward「大白管家」.",
    "- If this turn lists personal-email send_email or reply_email, the grant is active: call user_operational_identity. Do not say authorization is missing or unfinished.",
    "- If that list has no personal-email send/reply grant, say this agent has no personal-email grant and guide the user to Personal Settings → 授权 / 运营身份. Do not invent a different auth failure.",
    "- Never send or probe mail with exec (mail, sendmail, mutt, OPENBOT_SMTP_*).",
    "- Unbound: Path B — personal-email.yaml (Personal Settings); Path C — personal-email-browser.yaml (browser co-pilot for auth code).",
    "- Actions: sync_inbox / read_email (uid?) / search_email (query?) / send_email / reply_email.",
    "- send_email attachments: filePath (workspace file) or attachmentBase64/buffer + filename.",
    "- Call user_operational_identity with action=resolve then action=execute.",
    `- Chinese hint after bind: ${PERSONAL_EMAIL_STEWARD_HINT_ZH}`,
  ].join("\n");
}
