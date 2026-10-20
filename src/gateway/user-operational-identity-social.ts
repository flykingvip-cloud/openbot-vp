import { randomUUID } from "node:crypto";
import type {
  UserOperationalIdentityCredentialSecret,
  UserOperationalIdentityProvider,
} from "./user-operational-identity-types.js";
import {
  isXiaohongshuExecutionConfigured,
  publishXiaohongshuMcpNote,
  publishXiaohongshuOpenbotNote,
  replyXiaohongshuMcpComment,
  resolveXiaohongshuApiBase,
  resolveXiaohongshuConnectorKind,
  syncXiaohongshuMcpCookies,
  syncXiaohongshuMcpProfile,
} from "./user-operational-identity-xiaohongshu-connector.js";

export type SocialExecutionPayload = {
  body?: string;
  message?: string;
  title?: string;
  commentId?: string;
  /** Xiaohongshu feed/note id (mcp reply). */
  feedId?: string;
  images?: string[];
  tags?: string[];
  location?: string;
};

export {
  isXiaohongshuExecutionConfigured,
  resolveXiaohongshuApiBase,
  resolveXiaohongshuConnectorKind,
};

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function unknownToDisplayString(value: unknown, fallback = ""): string {
  if (typeof value === "string") {
    return value.trim() || fallback;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return fallback;
}

function readAccountHandle(secret: UserOperationalIdentityCredentialSecret): string {
  return secret.metadata?.accountHandle?.trim() || secret.accountLabel?.trim() || "";
}

function shouldSimulateSocialExecution(secret: UserOperationalIdentityCredentialSecret): boolean {
  const raw =
    process.env.OPENBOT_USER_OPERATIONAL_IDENTITY_SOCIAL_SIMULATE?.trim() ||
    process.env.OPENCLAW_USER_OPERATIONAL_IDENTITY_SOCIAL_SIMULATE?.trim();
  if (raw === "1" || raw?.toLowerCase() === "true") {
    return true;
  }
  const token = secret.accessToken?.trim() ?? "";
  return token.startsWith("simulated:") || secret.kind === "simulated";
}

function weiboApiBase(): string {
  return (
    process.env.OPENBOT_WEIBO_API_BASE?.trim() ||
    process.env.OPENCLAW_WEIBO_API_BASE?.trim() ||
    "https://api.weibo.com"
  ).replace(/\/$/, "");
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

async function weiboFormRequest(params: {
  token: string;
  path: string;
  method?: "GET" | "POST";
  fields?: Record<string, string>;
  fetchImpl?: typeof fetch;
}): Promise<Record<string, unknown>> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const url = new URL(`${weiboApiBase()}${params.path}`);
  url.searchParams.set("access_token", params.token);
  const method = params.method ?? "POST";
  let body: string | undefined;
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "openbot-user-operational-identity",
  };
  if (method === "GET") {
    for (const [key, value] of Object.entries(params.fields ?? {})) {
      if (value) {
        url.searchParams.set(key, value);
      }
    }
  } else {
    const form = new URLSearchParams();
    for (const [key, value] of Object.entries(params.fields ?? {})) {
      if (value) {
        form.set(key, value);
      }
    }
    body = form.toString();
    headers["Content-Type"] = "application/x-www-form-urlencoded";
  }
  const response = await fetchImpl(url.toString(), { method, headers, body });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || typeof payload.error === "string" || typeof payload.error_code === "number") {
    const message =
      typeof payload.error === "string"
        ? payload.error
        : typeof payload.error_description === "string"
          ? payload.error_description
          : `Weibo API failed: HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

async function executeWeiboAction(params: {
  action: string;
  payload: SocialExecutionPayload;
  secret: UserOperationalIdentityCredentialSecret;
  fetchImpl?: typeof fetch;
}): Promise<Record<string, unknown>> {
  const token = params.secret.accessToken?.trim() ?? "";
  if (!token) {
    throw new Error("Weibo access token is missing.");
  }
  const handle = readAccountHandle(params.secret);
  const content =
    stringValue(params.payload.body) ||
    stringValue(params.payload.message) ||
    stringValue(params.payload.title);
  if (params.action === "publish_post") {
    if (!content) {
      throw new Error("body/message is required for weibo publish_post.");
    }
    const created = await weiboFormRequest({
      token,
      path: "/2/statuses/update.json",
      fields: { status: content },
      fetchImpl: params.fetchImpl,
    });
    return {
      simulated: false,
      provider: "weibo",
      action: params.action,
      handle,
      postId: created.idstr ?? created.id ?? null,
      text: created.text ?? content,
      raw: { id: created.id ?? null, mid: created.mid ?? null },
    };
  }
  if (params.action === "reply_comment") {
    // Pilot: treat commentId as the Weibo status id to comment under.
    const statusId = stringValue(params.payload.commentId);
    if (!statusId || !content) {
      throw new Error(
        "commentId (status id) and body/message are required for weibo reply_comment.",
      );
    }
    const created = await weiboFormRequest({
      token,
      path: "/2/comments/create.json",
      fields: {
        id: statusId,
        comment: content,
      },
      fetchImpl: params.fetchImpl,
    });
    return {
      simulated: false,
      provider: "weibo",
      action: params.action,
      handle,
      commentId: created.idstr ?? created.id ?? null,
      statusId,
      text: created.text ?? content,
    };
  }
  if (params.action === "sync_profile_metrics") {
    const fields: Record<string, string> = {};
    if (/^\d+$/.test(handle)) {
      fields.uid = handle;
    } else if (handle) {
      fields.screen_name = handle.replace(/^@/, "");
    }
    const profile = await weiboFormRequest({
      token,
      path: "/2/users/show.json",
      method: "GET",
      fields,
      fetchImpl: params.fetchImpl,
    });
    return {
      simulated: false,
      provider: "weibo",
      action: params.action,
      handle: unknownToDisplayString(profile.screen_name, handle),
      metrics: {
        followers: profile.followers_count ?? null,
        friends: profile.friends_count ?? null,
        statuses: profile.statuses_count ?? null,
      },
    };
  }
  throw new Error(`Unsupported weibo action: ${params.action}`);
}

async function executeXiaohongshuAction(params: {
  action: string;
  payload: SocialExecutionPayload;
  secret: UserOperationalIdentityCredentialSecret;
  fetchImpl?: typeof fetch;
}): Promise<Record<string, unknown>> {
  const token = params.secret.accessToken?.trim() ?? "";
  if (!token) {
    throw new Error("Xiaohongshu access token / cookie is missing.");
  }
  const base = resolveXiaohongshuApiBase();
  if (!base) {
    throw new Error(
      "Xiaohongshu execution requires OPENBOT_XIAOHONGSHU_API_BASE (Open Platform / connector endpoint).",
    );
  }
  const connector = resolveXiaohongshuConnectorKind(base);
  if (connector === "builtin:simulate") {
    return {
      ...simulateSocialAction({
        provider: "xiaohongshu",
        action: params.action,
        payload: params.payload,
        secret: params.secret,
      }),
      connector,
    };
  }

  const handle = readAccountHandle(params.secret);
  const content =
    stringValue(params.payload.body) ||
    stringValue(params.payload.message) ||
    stringValue(params.payload.title);
  const title = stringValue(params.payload.title) || (content ? content.slice(0, 40) : "");
  const images = stringList(params.payload.images);
  const tags = stringList(params.payload.tags);
  const location = stringValue(params.payload.location) || undefined;

  if (connector === "xiaohongshu-mcp") {
    // Cookies live on the MCP sidecar; sync before each mutating action so
    // re-binds / rotated secrets take effect without a separate login step.
    if (params.action === "publish_post" || params.action === "reply_comment") {
      const synced = await syncXiaohongshuMcpCookies({
        base,
        cookieOrToken: token,
        fetchImpl: params.fetchImpl,
      });
      if (!synced.ok) {
        throw new Error(synced.error);
      }
    }
    if (params.action === "publish_post") {
      if (!content) {
        throw new Error("body/message is required for xiaohongshu publish_post.");
      }
      const created = await publishXiaohongshuMcpNote({
        base,
        input: { title, content, images, tags, location },
        fetchImpl: params.fetchImpl,
      });
      return {
        simulated: false,
        provider: "xiaohongshu",
        action: params.action,
        connector,
        handle,
        noteId: created.id ?? created.note_id ?? created.noteId ?? null,
        text: content,
        raw: created,
      };
    }
    if (params.action === "reply_comment") {
      const feedId = stringValue(params.payload.feedId) || stringValue(params.payload.commentId);
      if (!feedId || !content) {
        throw new Error(
          "feedId (or commentId as feed id) and body/message are required for xiaohongshu reply_comment.",
        );
      }
      const created = await replyXiaohongshuMcpComment({
        base,
        feedId,
        commentId: stringValue(params.payload.commentId) || undefined,
        content,
        fetchImpl: params.fetchImpl,
      });
      return {
        simulated: false,
        provider: "xiaohongshu",
        action: params.action,
        connector,
        handle,
        feedId,
        text: content,
        raw: created,
      };
    }
    if (params.action === "sync_profile_metrics") {
      const profile = await syncXiaohongshuMcpProfile({
        base,
        fetchImpl: params.fetchImpl,
      });
      const me = (profile.me ?? {}) as Record<string, unknown>;
      const fans = (profile.fans ?? {}) as Record<string, unknown>;
      return {
        simulated: false,
        provider: "xiaohongshu",
        action: params.action,
        connector,
        handle: unknownToDisplayString(me.nickname ?? me.name, handle),
        metrics: {
          followers: me.followers ?? me.fans ?? fans.total ?? fans.followers ?? null,
          likes: me.likes ?? me.liked ?? null,
          notes: me.notes ?? me.note_count ?? null,
        },
        raw: profile,
      };
    }
    throw new Error(`Unsupported xiaohongshu action: ${params.action}`);
  }

  // Generic OpenBot connector dialect.
  if (params.action === "publish_post") {
    if (!content) {
      throw new Error("body/message is required for xiaohongshu publish_post.");
    }
    const created = await publishXiaohongshuOpenbotNote({
      base,
      token,
      handle,
      input: { title, content, images, tags, location },
      fetchImpl: params.fetchImpl,
    });
    return {
      simulated: false,
      provider: "xiaohongshu",
      action: params.action,
      connector,
      handle,
      noteId: created.id ?? created.noteId ?? null,
      text: content,
    };
  }
  if (params.action === "reply_comment") {
    const commentId = stringValue(params.payload.commentId);
    if (!commentId || !content) {
      throw new Error("commentId and body/message are required for xiaohongshu reply_comment.");
    }
    const fetchImpl = params.fetchImpl ?? fetch;
    const response = await fetchImpl(
      `${base}/v1/comments/${encodeURIComponent(commentId)}/replies`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "User-Agent": "openbot-user-operational-identity",
        },
        body: JSON.stringify({ content, accountHandle: handle }),
      },
    );
    const created = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      throw new Error(
        typeof created.message === "string"
          ? created.message
          : `Xiaohongshu API failed: HTTP ${response.status}`,
      );
    }
    return {
      simulated: false,
      provider: "xiaohongshu",
      action: params.action,
      connector,
      handle,
      commentId: created.id ?? commentId,
      text: content,
    };
  }
  if (params.action === "sync_profile_metrics") {
    const fetchImpl = params.fetchImpl ?? fetch;
    const response = await fetchImpl(`${base}/v1/users/${encodeURIComponent(handle || "me")}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "openbot-user-operational-identity",
      },
    });
    const profile = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      throw new Error(
        typeof profile.message === "string"
          ? profile.message
          : `Xiaohongshu API failed: HTTP ${response.status}`,
      );
    }
    return {
      simulated: false,
      provider: "xiaohongshu",
      action: params.action,
      connector,
      handle: unknownToDisplayString(profile.handle, handle),
      metrics: {
        followers: profile.followers ?? profile.followerCount ?? null,
        likes: profile.likes ?? profile.likedCount ?? null,
        notes: profile.notes ?? profile.noteCount ?? null,
      },
    };
  }
  throw new Error(`Unsupported xiaohongshu action: ${params.action}`);
}

function simulateSocialAction(params: {
  provider: UserOperationalIdentityProvider;
  action: string;
  payload: SocialExecutionPayload;
  secret: UserOperationalIdentityCredentialSecret;
}): Record<string, unknown> {
  const handle = readAccountHandle(params.secret);
  const content =
    stringValue(params.payload.body) ||
    stringValue(params.payload.message) ||
    stringValue(params.payload.title);
  if (params.action === "publish_post") {
    if (!content) {
      throw new Error("body/message is required for publish_post.");
    }
    return {
      simulated: true,
      provider: params.provider,
      action: params.action,
      handle,
      postId: `sim-${randomUUID()}`,
      text: content,
      status: "simulated_published",
    };
  }
  if (params.action === "reply_comment") {
    const commentId = stringValue(params.payload.commentId);
    if (!commentId || !content) {
      throw new Error("commentId and body/message are required for reply_comment.");
    }
    return {
      simulated: true,
      provider: params.provider,
      action: params.action,
      handle,
      commentId,
      replyId: `sim-${randomUUID()}`,
      text: content,
      status: "simulated_replied",
    };
  }
  if (params.action === "sync_profile_metrics") {
    return {
      simulated: true,
      provider: params.provider,
      action: params.action,
      handle,
      metrics: { followers: 0, friends: 0, posts: 0 },
      status: "simulated_synced",
    };
  }
  throw new Error(`Unsupported ${params.provider} action: ${params.action}`);
}

/** Execute pilot social providers (weibo / xiaohongshu). */
export async function executeSocialManualIdentityAction(params: {
  provider: UserOperationalIdentityProvider;
  action: string;
  payload: SocialExecutionPayload;
  secret: UserOperationalIdentityCredentialSecret;
  fetchImpl?: typeof fetch;
}): Promise<Record<string, unknown>> {
  if (params.provider !== "weibo" && params.provider !== "xiaohongshu") {
    throw new Error(`Provider ${params.provider} does not support social execution yet.`);
  }
  if (shouldSimulateSocialExecution(params.secret)) {
    return simulateSocialAction(params);
  }
  if (params.provider === "weibo") {
    return executeWeiboAction(params);
  }
  return executeXiaohongshuAction(params);
}
