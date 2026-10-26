import { createHash, randomUUID } from "node:crypto";
import { fetchWechatOfficialClientCredentialToken } from "./enterprise-operational-identity-wechat-official-api.js";
import {
  probeWechatOfficialCredentials,
  resolveWechatOfficialAppSecretForIdentity,
} from "./user-operational-identity-credentials.js";
import { resolveUserOperationalIdentityEmailAttachments } from "./user-operational-identity-email-attachments.js";
import {
  parsePersonalEmailImapPayload,
  readPersonalEmailMessages,
  replyPersonalEmailMessage,
  searchPersonalEmailMessages,
  syncPersonalEmailInbox,
} from "./user-operational-identity-imap-actions.js";
import {
  isSimulatedUserOperationalIdentityCredentialSecret,
  loadUserOperationalIdentityCredentialSecretForHandle,
  summarizeUserOperationalIdentityCredentialSecret,
} from "./user-operational-identity-secrets.js";
import {
  probeUserOperationalIdentityImapCredentials,
  probeUserOperationalIdentitySmtpCredentials,
  resolveUserOperationalIdentitySmtpConfig,
  sendUserOperationalIdentityEmail,
} from "./user-operational-identity-smtp.js";
import { executeUserOperationalIdentitySocialAction } from "./user-operational-identity-social-execution.js";
import { executeSocialManualIdentityAction } from "./user-operational-identity-social.js";
import {
  attachUsageMetricsToLatestMatchingEvent,
  recordUserOperationalIdentityUsageEvent,
} from "./user-operational-identity-store.js";
import type {
  UserOperationalIdentity,
  UserOperationalIdentityCredentialSecret,
  UserOperationalIdentityProvider,
  UserOperationalIdentityStore,
} from "./user-operational-identity-types.js";
import {
  buildUserOperationalIdentityUsageSummary,
  extractUserOperationalIdentityUsageMetrics,
  matchingActionsForUsageMetrics,
} from "./user-operational-identity-usage-summary.js";
import { isXTwitterOperationalActionAllowedByScope } from "./user-operational-identity-x-twitter-scope.js";
import { executeWechatOfficialActionWithTicketRetry } from "./wechat-official/credentials.js";
import {
  executeWechatOfficialActionsWithAccessToken,
  parseWechatOfficialOperationalActionPayload,
  type WechatOfficialOperationalActionPayload,
} from "./wechat-official/execute-operational-actions.js";

export type UserOperationalIdentityExecutionPayload = {
  owner?: string;
  repo?: string;
  repository?: string;
  title?: string;
  body?: string;
  issueNumber?: number;
  head?: string;
  base?: string;
  to?: string;
  subject?: string;
  message?: string;
  filePath?: string;
  filename?: string;
  attachmentBase64?: string;
  contentType?: string;
  buffer?: string;
  attachmentsJson?: string;
  commentId?: string;
  feedId?: string;
  images?: string[];
  tags?: string[];
  location?: string;
} & WechatOfficialOperationalActionPayload;

export type UserOperationalIdentityExecutionResult =
  | {
      ok: true;
      provider: UserOperationalIdentityProvider;
      action: string;
      simulated: boolean;
      credential: ReturnType<typeof summarizeUserOperationalIdentityCredentialSecret>;
      output: Record<string, unknown>;
    }
  | { ok: false; code: string; message: string };

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseGithubRepository(payload: UserOperationalIdentityExecutionPayload): {
  owner: string;
  repo: string;
} | null {
  const combined = stringValue(payload.repo) || stringValue(payload.repository);
  if (combined.includes("/")) {
    const [owner, repo] = combined.split("/", 2);
    if (owner && repo) {
      return { owner, repo };
    }
  }
  const owner = stringValue(payload.owner);
  const repo = stringValue(payload.repo) || stringValue(payload.repository);
  if (!owner || !repo) {
    return null;
  }
  return { owner, repo };
}

function simulatedGithubIssueNumber(params: {
  owner: string;
  repo: string;
  title: string;
}): number {
  const digest = createHash("sha256")
    .update(`${params.owner}/${params.repo}:${params.title}`)
    .digest();
  return 1000 + (digest[0] % 9000);
}

async function githubRequest(params: {
  token: string;
  path: string;
  method: "GET" | "POST";
  body?: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const response = await fetch(`https://api.github.com${params.path}`, {
    method: params.method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${params.token}`,
      "Content-Type": "application/json",
      "User-Agent": "openbot-user-operational-identity",
    },
    body: params.body ? JSON.stringify(params.body) : undefined,
  });
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    const message =
      typeof payload.message === "string"
        ? payload.message
        : `GitHub API request failed: HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

async function executeGithubPersonalAction(params: {
  action: string;
  payload: UserOperationalIdentityExecutionPayload;
  secret: UserOperationalIdentityCredentialSecret;
}): Promise<Record<string, unknown>> {
  const repository = parseGithubRepository(params.payload);
  if (!repository) {
    throw new Error("owner and repo (or owner/repo) are required for GitHub actions.");
  }
  const title = stringValue(params.payload.title);
  const body = stringValue(params.payload.body);
  const simulated = isSimulatedUserOperationalIdentityCredentialSecret(params.secret);

  if (params.action === "create_issue") {
    if (!title) {
      throw new Error("title is required for create_issue.");
    }
    if (simulated) {
      const issueNumber = simulatedGithubIssueNumber({ ...repository, title });
      return {
        simulated: true,
        issueNumber,
        htmlUrl: `https://github.com/${repository.owner}/${repository.repo}/issues/${issueNumber}`,
        title,
        body: body || undefined,
      };
    }
    const created = await githubRequest({
      token: params.secret.accessToken!,
      path: `/repos/${repository.owner}/${repository.repo}/issues`,
      method: "POST",
      body: { title, body: body || undefined },
    });
    return {
      simulated: false,
      issueNumber: created.number,
      htmlUrl: created.html_url,
      id: created.id,
      title: created.title,
    };
  }

  if (params.action === "create_pull_request") {
    const head = stringValue(params.payload.head);
    const base = stringValue(params.payload.base) || "main";
    if (!title || !head) {
      throw new Error("title and head are required for create_pull_request.");
    }
    if (simulated) {
      const pullNumber = simulatedGithubIssueNumber({ ...repository, title: `${title}:${head}` });
      return {
        simulated: true,
        pullNumber,
        htmlUrl: `https://github.com/${repository.owner}/${repository.repo}/pull/${pullNumber}`,
        title,
        head,
        base,
      };
    }
    const created = await githubRequest({
      token: params.secret.accessToken!,
      path: `/repos/${repository.owner}/${repository.repo}/pulls`,
      method: "POST",
      body: { title, head, base, body: body || undefined },
    });
    return {
      simulated: false,
      pullNumber: created.number,
      htmlUrl: created.html_url,
      id: created.id,
      title: created.title,
    };
  }

  if (params.action === "comment") {
    const issueNumber = numberValue(params.payload.issueNumber);
    if (!issueNumber || !body) {
      throw new Error("issueNumber and body are required for comment.");
    }
    if (simulated) {
      return {
        simulated: true,
        issueNumber,
        commentId: randomUUID(),
        htmlUrl: `https://github.com/${repository.owner}/${repository.repo}/issues/${issueNumber}#simulated-comment`,
        body,
      };
    }
    const created = await githubRequest({
      token: params.secret.accessToken!,
      path: `/repos/${repository.owner}/${repository.repo}/issues/${issueNumber}/comments`,
      method: "POST",
      body: { body },
    });
    return {
      simulated: false,
      issueNumber,
      commentId: created.id,
      htmlUrl: created.html_url,
      body: created.body,
    };
  }

  throw new Error(`Unsupported GitHub action: ${params.action}`);
}

async function executePersonalEmailAction(params: {
  action: string;
  payload: UserOperationalIdentityExecutionPayload;
  secret: UserOperationalIdentityCredentialSecret;
  ownerId: string;
}): Promise<Record<string, unknown>> {
  const imapPayload = parsePersonalEmailImapPayload(params.payload);
  if (params.action === "verify_credentials") {
    const config = resolveUserOperationalIdentitySmtpConfig(params.secret);
    if (!config) {
      throw new Error("SMTP is not configured for this operational identity.");
    }
    const probe = await probeUserOperationalIdentitySmtpCredentials({ config });
    if (!probe.ok) {
      throw new Error(probe.error);
    }
    const imapProbe = await probeUserOperationalIdentityImapCredentials({ secret: params.secret });
    if (!imapProbe.ok) {
      throw new Error(imapProbe.error);
    }
    return {
      simulated: false,
      verified: true,
      from: config.from,
      host: config.host,
      imapConfigured: Boolean(params.secret.metadata?.imapHost),
      action: params.action,
      source: params.secret.metadata?.source ?? "custom",
    };
  }
  if (
    params.action === "sync_inbox" ||
    params.action === "read_email" ||
    params.action === "search_email"
  ) {
    const simulated = isSimulatedUserOperationalIdentityCredentialSecret(params.secret);
    if (simulated) {
      return {
        simulated: true,
        action: params.action,
        mailbox: imapPayload.mailbox?.trim() || "INBOX",
        count: 0,
        messages: [],
      };
    }
    const output =
      params.action === "sync_inbox"
        ? await syncPersonalEmailInbox({ secret: params.secret, payload: imapPayload })
        : params.action === "search_email"
          ? await searchPersonalEmailMessages({ secret: params.secret, payload: imapPayload })
          : await readPersonalEmailMessages({ secret: params.secret, payload: imapPayload });
    return { simulated: false, action: params.action, ...output };
  }
  if (params.action === "reply_email") {
    const simulated = isSimulatedUserOperationalIdentityCredentialSecret(params.secret);
    if (simulated) {
      return {
        simulated: true,
        action: params.action,
        uid: imapPayload.uid ?? null,
        status: "simulated_sent",
      };
    }
    const output = await replyPersonalEmailMessage({
      secret: params.secret,
      payload: imapPayload,
    });
    return { simulated: false, action: params.action, ...output };
  }
  if (params.action !== "send_email") {
    throw new Error(`Unsupported personal-email action: ${params.action}`);
  }
  const to = stringValue(params.payload.to);
  const subject = stringValue(params.payload.subject);
  const message = stringValue(params.payload.message) || stringValue(params.payload.body);
  if (!to || !subject || !message) {
    throw new Error("to, subject, and message are required for email actions.");
  }
  const simulated = isSimulatedUserOperationalIdentityCredentialSecret(params.secret);
  const attachments = await resolveUserOperationalIdentityEmailAttachments({
    payload: params.payload as Record<string, unknown>,
    ownerId: params.ownerId,
  });
  if (simulated) {
    return {
      simulated: true,
      messageId: randomUUID(),
      to,
      subject,
      from: params.secret.accountLabel ?? "personal-email",
      status: "simulated_sent",
      action: params.action,
      attachmentCount: attachments.length,
      attachments: attachments.map((entry) => ({
        filename: entry.filename,
        contentType: entry.contentType,
        bytes: entry.content.length,
      })),
    };
  }
  const sent = await sendUserOperationalIdentityEmail({
    secret: params.secret,
    to,
    subject,
    message,
    attachments,
  });
  return {
    simulated: false,
    messageId: sent.messageId,
    to,
    subject,
    from: sent.from,
    status: sent.status,
    action: params.action,
    attachmentCount: sent.attachmentCount,
    attachments: attachments.map((entry) => ({
      filename: entry.filename,
      contentType: entry.contentType,
      bytes: entry.content.length,
    })),
  };
}

async function executeWechatOfficialAction(params: {
  action: string;
  payload: UserOperationalIdentityExecutionPayload;
  secret: UserOperationalIdentityCredentialSecret;
  externalAccountId?: string;
}): Promise<Record<string, unknown>> {
  if (params.action.startsWith("sync_")) {
    throw new Error(
      `WeChat Official Account data sync action "${params.action}" is not implemented yet.`,
    );
  }

  const appId = params.secret.metadata?.appId?.trim() || params.externalAccountId?.trim() || "";
  const appSecret = resolveWechatOfficialAppSecretForIdentity({
    appId,
    secretAccessToken: params.secret.kind === "wechat_oa" ? params.secret.accessToken : undefined,
  });

  if (params.action === "verify_credentials") {
    if (!appId || !appSecret) {
      throw new Error(
        "AppID / AppSecret missing for WeChat Official Account identity (expected store or WECHAT_OFFICIAL_{APPID}_APPSECRET).",
      );
    }
    const probe = await probeWechatOfficialCredentials({ appId, appSecret });
    if (!probe.ok) {
      throw new Error(probe.error);
    }
    return {
      simulated: false,
      verified: true,
      appId,
      action: params.action,
      secretSource:
        params.secret.kind === "wechat_oa" ? "identity_store" : "enterprise_aligned_env",
    };
  }

  if (!appId || !appSecret) {
    throw new Error(
      "AppID / AppSecret missing for WeChat Official Account identity (expected store or WECHAT_OFFICIAL_{APPID}_APPSECRET).",
    );
  }

  const wechatPayload = parseWechatOfficialOperationalActionPayload(params.payload);
  return executeWechatOfficialActionWithTicketRetry({
    cachedTicket: null,
    missingTicketError: "暂时无法换取公众号票据，请稍后重试。",
    resolveTicket: async (forceRefresh) => {
      try {
        const token = await fetchWechatOfficialClientCredentialToken({
          appId,
          appSecret,
          forceRefresh,
        });
        return token.accessToken;
      } catch {
        return null;
      }
    },
    execute: (accessToken) =>
      executeWechatOfficialActionsWithAccessToken({
        action: params.action,
        payload: wechatPayload,
        accessToken,
        appId,
      }),
  });
}

export async function executeUserOperationalIdentityAction(params: {
  store: UserOperationalIdentityStore;
  identity: UserOperationalIdentity;
  provider: UserOperationalIdentityProvider;
  action: string;
  payload: UserOperationalIdentityExecutionPayload;
  ownerId: string;
  agentId: string;
  sessionKey?: string | null;
  nowIso: string;
  audit?: boolean;
}): Promise<UserOperationalIdentityExecutionResult> {
  const secret = await loadUserOperationalIdentityCredentialSecretForHandle({
    handleId: params.identity.credentialHandleId,
    ownerId: params.ownerId,
  });
  if (!secret) {
    if (params.audit !== false) {
      recordUserOperationalIdentityUsageEvent({
        store: params.store,
        ownerId: params.ownerId,
        identityId: params.identity.identityId,
        provider: params.identity.provider,
        agentId: params.agentId,
        action: params.action,
        result: "denied",
        denialCode: "USER_IDENTITY_CREDENTIAL_SECRET_MISSING",
        sessionKey: params.sessionKey,
        nowIso: params.nowIso,
      });
    }
    return {
      ok: false,
      code: "USER_IDENTITY_CREDENTIAL_SECRET_MISSING",
      message: "Credential secret is missing for this operational identity.",
    };
  }

  try {
    if (params.provider === "x-twitter") {
      const scope = secret.metadata?.scope;
      const simulated = isSimulatedUserOperationalIdentityCredentialSecret(secret);
      if (
        !isXTwitterOperationalActionAllowedByScope({
          action: params.action,
          scope,
          allowAllIfScopeMissing: simulated || !scope?.trim(),
        })
      ) {
        if (params.audit !== false) {
          recordUserOperationalIdentityUsageEvent({
            store: params.store,
            ownerId: params.ownerId,
            identityId: params.identity.identityId,
            provider: params.identity.provider,
            agentId: params.agentId,
            action: params.action,
            result: "denied",
            denialCode: "USER_IDENTITY_X_TWITTER_SCOPE_REQUIRED",
            sessionKey: params.sessionKey,
            nowIso: params.nowIso,
          });
        }
        return {
          ok: false,
          code: "USER_IDENTITY_X_TWITTER_SCOPE_REQUIRED",
          message:
            "X publish actions require tweet.write. Re-authorize with publish scope, or use sync_profile_metrics.",
        };
      }
    }

    let output: Record<string, unknown>;
    if (params.provider === "github-personal") {
      output = await executeGithubPersonalAction({
        action: params.action,
        payload: params.payload,
        secret,
      });
    } else if (params.provider === "personal-email") {
      output = await executePersonalEmailAction({
        action: params.action,
        payload: params.payload,
        secret,
        ownerId: params.ownerId,
      });
    } else if (params.provider === "wechat-official") {
      output = await executeWechatOfficialAction({
        action: params.action,
        payload: params.payload,
        secret,
        externalAccountId: params.identity.externalAccountId,
      });
    } else if (
      params.provider === "weibo" ||
      params.provider === "xiaohongshu" ||
      params.provider === "x-twitter"
    ) {
      if (params.provider === "x-twitter") {
        const mappedAction =
          params.action === "publish_post"
            ? "post_tweet"
            : params.action === "reply_comment"
              ? "reply_comment"
              : params.action === "sync_profile_metrics"
                ? "sync_profile_metrics"
                : params.action;
        output = await executeUserOperationalIdentitySocialAction({
          provider: params.provider,
          action: mappedAction,
          payload: params.payload,
          secret,
        });
      } else {
        output = await executeSocialManualIdentityAction({
          provider: params.provider,
          action: params.action,
          payload: params.payload,
          secret,
        });
      }
    } else {
      throw new Error(`Provider ${params.provider} does not support execution yet.`);
    }

    if (output.unsupported === true) {
      const message =
        typeof output.message === "string" && output.message.trim()
          ? output.message.trim()
          : `Action ${params.action} is not supported for ${params.provider}.`;
      if (params.audit !== false) {
        recordUserOperationalIdentityUsageEvent({
          store: params.store,
          ownerId: params.ownerId,
          identityId: params.identity.identityId,
          provider: params.identity.provider,
          agentId: params.agentId,
          action: params.action,
          result: "denied",
          denialCode: "USER_IDENTITY_ACTION_UNSUPPORTED",
          sessionKey: params.sessionKey,
          nowIso: params.nowIso,
          summary: buildUserOperationalIdentityUsageSummary({
            provider: params.provider,
            action: params.action,
            payload: params.payload,
            output,
          }),
        });
      }
      return {
        ok: false,
        code: "USER_IDENTITY_ACTION_UNSUPPORTED",
        message,
      };
    }

    if (params.audit !== false) {
      const summary = buildUserOperationalIdentityUsageSummary({
        provider: params.provider,
        action: params.action,
        payload: params.payload,
        output,
      });
      const metrics = extractUserOperationalIdentityUsageMetrics(output, params.nowIso);
      recordUserOperationalIdentityUsageEvent({
        store: params.store,
        ownerId: params.ownerId,
        identityId: params.identity.identityId,
        provider: params.identity.provider,
        agentId: params.agentId,
        action: params.action,
        result: "allowed",
        sessionKey: params.sessionKey,
        nowIso: params.nowIso,
        summary,
        metrics,
      });
      const matchingActions = matchingActionsForUsageMetrics(params.action);
      if (metrics && matchingActions.length > 0) {
        attachUsageMetricsToLatestMatchingEvent({
          store: params.store,
          ownerId: params.ownerId,
          identityId: params.identity.identityId,
          actions: matchingActions,
          metrics,
        });
      }
    }

    return {
      ok: true,
      provider: params.provider,
      action: params.action,
      simulated: Boolean(output.simulated),
      credential: summarizeUserOperationalIdentityCredentialSecret(secret),
      output,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Operational identity execution failed.";
    if (params.audit !== false) {
      recordUserOperationalIdentityUsageEvent({
        store: params.store,
        ownerId: params.ownerId,
        identityId: params.identity.identityId,
        provider: params.identity.provider,
        agentId: params.agentId,
        action: params.action,
        result: "denied",
        denialCode: "USER_IDENTITY_EXECUTION_FAILED",
        sessionKey: params.sessionKey,
        nowIso: params.nowIso,
        summary: buildUserOperationalIdentityUsageSummary({
          provider: params.provider,
          action: params.action,
          payload: params.payload,
        }),
      });
    }
    return {
      ok: false,
      code: "USER_IDENTITY_EXECUTION_FAILED",
      message,
    };
  }
}

export function parseUserOperationalIdentityExecutionPayload(
  value: unknown,
): UserOperationalIdentityExecutionPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const record = value as Record<string, unknown>;
  const wechat = parseWechatOfficialOperationalActionPayload(value);
  return {
    owner: stringValue(record.owner) || undefined,
    repo: stringValue(record.repo) || undefined,
    repository: stringValue(record.repository) || undefined,
    title: stringValue(record.title) || undefined,
    body: stringValue(record.body) || undefined,
    issueNumber: numberValue(record.issueNumber) ?? undefined,
    head: stringValue(record.head) || undefined,
    base: stringValue(record.base) || undefined,
    to: stringValue(record.to) || undefined,
    subject: stringValue(record.subject) || undefined,
    message: stringValue(record.message) || undefined,
    filePath: stringValue(record.filePath) || undefined,
    filename: stringValue(record.filename) || undefined,
    attachmentBase64:
      stringValue(record.attachmentBase64) ||
      stringValue(record.contentBase64) ||
      stringValue(record.buffer) ||
      undefined,
    contentType: stringValue(record.contentType) || undefined,
    buffer: stringValue(record.buffer) || undefined,
    attachmentsJson:
      stringValue(record.attachmentsJson) || stringValue(record.attachments) || undefined,
    commentId: stringValue(record.commentId) || undefined,
    feedId: stringValue(record.feedId) || undefined,
    images: Array.isArray(record.images)
      ? record.images
          .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
          .filter(Boolean)
      : undefined,
    tags: Array.isArray(record.tags)
      ? record.tags.map((entry) => (typeof entry === "string" ? entry.trim() : "")).filter(Boolean)
      : undefined,
    location: stringValue(record.location) || undefined,
    ...wechat,
  };
}
