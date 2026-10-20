import type { EnterpriseOperationalIdentityCredentialSecret } from "./enterprise-operational-identity-oauth/credential-secrets-persistence.js";
import { resolveEnterpriseOperationalIdentitySmtpConfig } from "./enterprise-operational-identity-smtp.js";
import { sendPlatformAuthSmtpMail } from "./platform-auth-email.js";

export async function sendEnterpriseOperationalIdentityEmail(params: {
  secret: EnterpriseOperationalIdentityCredentialSecret;
  to: string;
  subject: string;
  message: string;
  html?: string;
  inReplyTo?: string;
  references?: string;
}): Promise<{ messageId: string; from: string; status: "sent" }> {
  const config = resolveEnterpriseOperationalIdentitySmtpConfig(params.secret);
  if (!config) {
    throw new Error("SMTP 未配置或参数不完整。");
  }
  const messageId = await sendPlatformAuthSmtpMail(config, {
    to: params.to,
    subject: params.subject,
    text: params.message,
    html:
      params.html ?? `<pre>${params.message.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre>`,
    inReplyTo: params.inReplyTo,
    references: params.references,
  });
  return {
    messageId,
    from: config.from,
    status: "sent",
  };
}
