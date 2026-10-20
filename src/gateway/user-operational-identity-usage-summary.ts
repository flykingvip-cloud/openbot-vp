import { recordOrEmpty } from "./records.js";
import type {
  UserOperationalIdentityUsageMetrics,
  UserOperationalIdentityUsageSummary,
} from "./user-operational-identity-types.js";

const HEADLINE_MAX = 80;
const EXCERPT_MAX = 160;
const RECIPIENT_MAX = 5;

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function stringList(value: unknown): string[] {
  if (typeof value === "string") {
    return value
      .split(/[,;]/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => (typeof entry === "string" ? entry.trim() : "")).filter(Boolean);
}

function clip(value: string, max: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  return normalized.length <= max ? normalized : `${normalized.slice(0, max)}…`;
}

export function plainTextFromHtml(value: string): string {
  return value
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function countUsageWords(value: string): number {
  const text = plainTextFromHtml(value);
  if (!text) {
    return 0;
  }
  return /[\u4e00-\u9fff]/.test(text)
    ? text.replace(/\s+/g, "").length
    : text.split(/\s+/).filter(Boolean).length;
}

function publishKindForAction(action: string): UserOperationalIdentityUsageSummary["publishKind"] {
  if (action === "publish_draft") {
    return "draft";
  }
  if (action === "broadcast_article") {
    return "broadcast";
  }
  if (action === "publish_article") {
    return "publish";
  }
  return undefined;
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const text = stringValue(value);
    if (text) {
      return text;
    }
  }
  return "";
}

export function buildUserOperationalIdentityUsageSummary(params: {
  provider: string;
  action: string;
  payload?: unknown;
  output?: unknown;
}): UserOperationalIdentityUsageSummary | undefined {
  const payload = recordOrEmpty(params.payload);
  const output = recordOrEmpty(params.output);
  const provider = params.provider.trim();
  const action = params.action.trim();

  if (provider === "personal-email") {
    const recipients = stringList(output.to || payload.to).slice(0, RECIPIENT_MAX);
    const subject = firstText(output.subject, payload.subject);
    const body = firstText(output.message, payload.message, payload.body);
    const headline = clip([recipients[0], subject].filter(Boolean).join(" · "), HEADLINE_MAX);
    const attachmentCount =
      numberValue(output.attachmentCount) ??
      (stringList(payload.filename).length > 0 ? stringList(payload.filename).length : undefined);
    if (!headline && !body) {
      return undefined;
    }
    return {
      headline: headline || clip(body, HEADLINE_MAX),
      excerpt: clip(body, EXCERPT_MAX) || undefined,
      recipients: recipients.length > 0 ? recipients : undefined,
      subject: subject || undefined,
      wordCount: body ? countUsageWords(body) : undefined,
      attachmentCount: attachmentCount || undefined,
      externalId: firstText(output.messageId) || undefined,
    };
  }

  if (provider === "wechat-official") {
    const title = firstText(output.title, payload.title);
    const content = firstText(output.content, payload.content, payload.body);
    const digest = firstText(output.digest, payload.digest);
    const excerpt = clip(digest || content, EXCERPT_MAX);
    const headline = clip(title || excerpt, HEADLINE_MAX);
    if (!headline) {
      return undefined;
    }
    return {
      headline,
      excerpt: excerpt || undefined,
      wordCount: content ? countUsageWords(content) : undefined,
      publishKind: publishKindForAction(action),
      externalId: firstText(output.mediaId, payload.mediaId, output.publishId, payload.publishId),
    };
  }

  if (provider === "github-personal") {
    const repository =
      firstText(output.repository) ||
      firstText(payload.repository) ||
      [firstText(payload.owner), firstText(payload.repo)].filter(Boolean).join("/") ||
      "";
    const title = firstText(output.title, payload.title, payload.body);
    const issueNumber = numberValue(output.issueNumber ?? output.pullNumber ?? payload.issueNumber);
    const headline = clip([repository, title].filter(Boolean).join(" · "), HEADLINE_MAX);
    if (!headline) {
      return undefined;
    }
    return {
      headline,
      excerpt: clip(firstText(payload.body, output.body), EXCERPT_MAX) || undefined,
      repository: repository || undefined,
      issueNumber,
      externalId: firstText(output.htmlUrl, output.html_url),
    };
  }

  if (
    provider === "weibo" ||
    provider === "zhihu" ||
    provider === "douyin" ||
    provider === "xiaohongshu" ||
    provider === "kuaishou" ||
    provider === "bilibili" ||
    provider === "x-twitter"
  ) {
    const body = firstText(output.text, output.body, payload.body, payload.message, payload.title);
    const tags = stringList(payload.tags);
    const headline = clip(body, HEADLINE_MAX);
    if (!headline) {
      return undefined;
    }
    return {
      headline,
      excerpt: clip(body, EXCERPT_MAX) || undefined,
      wordCount: countUsageWords(body) || undefined,
      tags: tags.length > 0 ? tags.slice(0, 8) : undefined,
      externalId: firstText(output.feedId, output.statusId, payload.feedId),
    };
  }

  if (provider === "wechat-personal") {
    const headline = clip(
      firstText(output.message, output.status, payload.message, action),
      HEADLINE_MAX,
    );
    return headline ? { headline } : undefined;
  }

  const fallback = clip(
    firstText(output.title, payload.title, output.subject, payload.subject, action),
    HEADLINE_MAX,
  );
  return fallback ? { headline: fallback } : undefined;
}

export function extractUserOperationalIdentityUsageMetrics(
  output: unknown,
  nowIso: string,
): UserOperationalIdentityUsageMetrics | undefined {
  const record = recordOrEmpty(output);
  const nested = recordOrEmpty(record.metrics);
  const readCount = numberValue(
    nested.readCount ??
      nested.int_page_read_count ??
      record.readCount ??
      record.int_page_read_count,
  );
  const shareCount = numberValue(
    nested.shareCount ?? nested.share_count ?? record.shareCount ?? record.share_count,
  );
  const commentCount = numberValue(
    nested.commentCount ?? nested.comment_count ?? record.commentCount ?? record.comment_count,
  );
  const likeCount = numberValue(
    nested.likeCount ?? nested.like_count ?? nested.attitudes ?? record.likeCount,
  );
  const followerCount = numberValue(
    nested.followerCount ?? nested.followers ?? record.followerCount ?? record.followers,
  );
  if (
    readCount === undefined &&
    shareCount === undefined &&
    commentCount === undefined &&
    likeCount === undefined &&
    followerCount === undefined
  ) {
    return undefined;
  }
  return {
    readCount,
    shareCount,
    commentCount,
    likeCount,
    followerCount,
    refreshedAt: nowIso,
  };
}

export function matchingActionsForUsageMetrics(action: string): string[] {
  if (action === "sync_article_metrics") {
    return ["publish_article", "broadcast_article", "publish_draft"];
  }
  if (action === "sync_profile_metrics") {
    return ["publish_post"];
  }
  return [];
}
