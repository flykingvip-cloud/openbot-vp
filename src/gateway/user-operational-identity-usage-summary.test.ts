import { describe, expect, it } from "vitest";
import { normalizeUserOperationalIdentityStore } from "./user-operational-identity-persistence.js";
import {
  attachUsageMetricsToLatestMatchingEvent,
  listUserOperationalIdentityUsageEvents,
  recordUserOperationalIdentityUsageEvent,
} from "./user-operational-identity-store.js";
import {
  buildUserOperationalIdentityUsageSummary,
  countUsageWords,
  extractUserOperationalIdentityUsageMetrics,
  matchingActionsForUsageMetrics,
} from "./user-operational-identity-usage-summary.js";

describe("user operational identity usage summary", () => {
  it("counts CJK characters and latin words separately", () => {
    expect(countUsageWords("你好，世界")).toBe(5);
    expect(countUsageWords("hello   open bot")).toBe(3);
  });

  it("builds mailbox and wechat headlines from payload", () => {
    expect(
      buildUserOperationalIdentityUsageSummary({
        provider: "personal-email",
        action: "send_email",
        payload: {
          to: "hedon@example.com",
          subject: "周报",
          message: "本周完成授权页使用记录。",
        },
        output: { messageId: "msg-1", attachmentCount: 1 },
      }),
    ).toEqual({
      headline: "hedon@example.com · 周报",
      excerpt: "本周完成授权页使用记录。",
      recipients: ["hedon@example.com"],
      subject: "周报",
      wordCount: countUsageWords("本周完成授权页使用记录。"),
      attachmentCount: 1,
      externalId: "msg-1",
    });

    expect(
      buildUserOperationalIdentityUsageSummary({
        provider: "wechat-official",
        action: "publish_article",
        payload: {
          title: "秋季发布",
          digest: "核心观点是把使用记录按身份对齐。",
          content: "<p>秋季发布正文约一百字。</p>",
        },
        output: { mediaId: "media-1" },
      }),
    ).toEqual({
      headline: "秋季发布",
      excerpt: "核心观点是把使用记录按身份对齐。",
      wordCount: countUsageWords("秋季发布正文约一百字。"),
      publishKind: "publish",
      externalId: "media-1",
    });
  });

  it("extracts metrics and attaches them to the latest matching publish", () => {
    const nowIso = "2026-09-18T00:00:00.000Z";
    const metrics = extractUserOperationalIdentityUsageMetrics(
      { metrics: { int_page_read_count: 120, share_count: 8, comment_count: 3 } },
      nowIso,
    );
    expect(metrics).toEqual({
      readCount: 120,
      shareCount: 8,
      commentCount: 3,
      likeCount: undefined,
      followerCount: undefined,
      refreshedAt: nowIso,
    });
    expect(matchingActionsForUsageMetrics("sync_article_metrics")).toEqual([
      "publish_article",
      "broadcast_article",
      "publish_draft",
    ]);

    const store = normalizeUserOperationalIdentityStore(null);
    recordUserOperationalIdentityUsageEvent({
      store,
      ownerId: "user-1",
      identityId: "id-wx",
      provider: "wechat-official",
      agentId: "main",
      action: "publish_article",
      result: "allowed",
      nowIso: "2026-09-17T00:00:00.000Z",
    });
    const attached = attachUsageMetricsToLatestMatchingEvent({
      store,
      ownerId: "user-1",
      identityId: "id-wx",
      actions: matchingActionsForUsageMetrics("sync_article_metrics"),
      metrics: metrics!,
    });
    expect(attached?.metrics).toMatchObject({ readCount: 120, shareCount: 8, commentCount: 3 });
    expect(
      listUserOperationalIdentityUsageEvents(store, "user-1", 10, {
        identityId: "id-wx",
        since: "2026-09-16T00:00:00.000Z",
      }),
    ).toHaveLength(1);
    expect(
      listUserOperationalIdentityUsageEvents(store, "user-1", 10, {
        identityId: "id-wx",
        since: "2026-09-18T00:00:00.000Z",
      }),
    ).toHaveLength(0);
  });
});
