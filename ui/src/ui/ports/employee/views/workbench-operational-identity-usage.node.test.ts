// @vitest-environment jsdom
import { render } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderOperationalIdentitySection } from "./workbench-operational-identity-section.ts";
import {
  filterUsageHistoryByRange,
  operationalIdentityActionLabel,
  scopeOperationalIdentityUsageHistory,
} from "./workbench-operational-identity-shared.ts";
import type { SettingsContract } from "./workbench-stage-contracts.ts";

afterEach(() => {
  document.body.innerHTML = "";
});

const catalog = [
  {
    provider: "wechat-official",
    label: "微信公众号",
    category: "official" as const,
    rolloutTier: "pilot" as const,
    registrationReady: true,
    authMode: "manual" as const,
    manualKind: "wechat_oa" as const,
    operationalActions: [{ action: "publish_article", label: "发布文章" }],
    reauthHint: "",
    degradedHint: null,
  },
  {
    provider: "personal-email",
    label: "个人邮箱",
    category: "communication" as const,
    rolloutTier: "pilot" as const,
    registrationReady: true,
    authMode: "manual" as const,
    manualKind: "smtp" as const,
    operationalActions: [{ action: "send_email", label: "发送邮件" }],
    reauthHint: "",
    degradedHint: null,
  },
];

function usageSettings(partial: Partial<SettingsContract>): SettingsContract {
  return {
    platformAuthEnabled: true,
    connected: true,
    userOperationalIdentitySnapshot: {
      identities: [
        {
          identityId: "id-wx",
          provider: "wechat-official",
          providerLabel: "微信公众号",
          displayName: "订阅号",
          status: "active",
          grantCount: 1,
          createdAt: "2026-08-01T00:00:00.000Z",
          updatedAt: "2026-08-01T00:00:00.000Z",
        },
        {
          identityId: "id-email",
          provider: "personal-email",
          providerLabel: "个人邮箱",
          displayName: "个人邮箱",
          status: "active",
          grantCount: 1,
          createdAt: "2026-08-01T00:00:00.000Z",
          updatedAt: "2026-08-01T00:00:00.000Z",
        },
      ],
      grants: [],
      usageHistory: [
        {
          eventId: "evt-email",
          agentId: "main",
          identityId: "id-email",
          provider: "personal-email",
          action: "send_email",
          result: "allowed",
          createdAt: "2026-09-17T12:00:00.000Z",
          summary: {
            headline: "hedon@example.com · 周报",
            recipients: ["hedon@example.com"],
            subject: "周报",
            excerpt: "本周完成授权页使用记录。",
            wordCount: 13,
          },
        },
        {
          eventId: "evt-wx",
          agentId: "main",
          identityId: "id-wx",
          provider: "wechat-official",
          action: "publish_article",
          result: "allowed",
          createdAt: "2026-09-16T12:00:00.000Z",
          summary: {
            headline: "秋季发布",
            excerpt: "核心观点是把使用记录按身份对齐。",
            wordCount: 1800,
            publishKind: "publish",
          },
          metrics: { readCount: 88, shareCount: 6, commentCount: 2 },
        },
      ],
      providerCatalog: catalog,
      pendingBindingRequests: [],
    },
    ...partial,
  } as SettingsContract;
}

function renderSection(settings: SettingsContract): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  render(renderOperationalIdentitySection(settings, { embedded: true }), container);
  return container;
}

describe("scopeOperationalIdentityUsageHistory", () => {
  const events = [
    { identityId: "id-wx", provider: "wechat-official" },
    { identityId: "id-email", provider: "personal-email" },
  ];

  it("returns all events when no identity is selected", () => {
    expect(scopeOperationalIdentityUsageHistory(events)).toEqual(events);
  });

  it("keeps only the selected identity", () => {
    expect(
      scopeOperationalIdentityUsageHistory(events, { identityId: "id-wx" }).map(
        (event) => event.identityId,
      ),
    ).toEqual(["id-wx"]);
  });
});

describe("operational identity usage records", () => {
  it("labels catalog actions instead of raw verbs", () => {
    expect(operationalIdentityActionLabel(catalog, "personal-email", "send_email")).toBe(
      "发送邮件",
    );
    expect(operationalIdentityActionLabel(catalog, "wechat-official", "unknown")).toBe("unknown");
  });

  it("hides records outside the selected time range", () => {
    const events = [
      { createdAt: "2026-09-17T00:00:00.000Z" },
      { createdAt: "2026-06-01T00:00:00.000Z" },
    ];
    const now = Date.parse("2026-09-18T00:00:00.000Z");
    expect(filterUsageHistoryByRange(events, "30d", now)).toHaveLength(1);
    expect(filterUsageHistoryByRange(events, "all", now)).toHaveLength(2);
  });

  it("does not leak mailbox records onto the wechat official hub", () => {
    const container = renderSection(
      usageSettings({ userOperationalIdentityNav: "add:wechat-official" }),
    );

    expect(container.textContent).toContain("使用记录");
    expect(
      container.querySelector(".employee-workbench__identity-usage-table")?.textContent,
    ).toContain("发布文章");
    expect(container.textContent).toContain("发布文章");
    expect(container.textContent).not.toContain("发送邮件");
    expect(container.textContent).not.toContain("send_email");
    expect(container.textContent).not.toContain("个人邮箱");
    expect(container.textContent).toContain("秋季发布");
    expect(container.textContent).toContain("7 天");
    expect(container.textContent).toContain("30 天");
  });

  it("opens an in-place task summary when a usage row is clicked", () => {
    const onSelect = vi.fn();
    const container = renderSection(
      usageSettings({
        userOperationalIdentityNav: "add:wechat-official",
        userOperationalIdentityUsageEventId: "evt-wx",
        onSelectUserOperationalIdentityUsageEvent: onSelect,
      }),
    );

    expect(
      container.querySelector(".employee-workbench__identity-usage-detail")?.textContent,
    ).toContain("秋季发布");
    expect(container.textContent).toContain("核心观点是把使用记录按身份对齐。");
    expect(container.textContent).toContain("阅读");
    expect(container.textContent).toContain("88");
    expect(container.textContent).toContain("转发");
    expect(container.textContent).toContain("评论");

    container.querySelector<HTMLTableRowElement>("tr[data-usage-event-id='evt-wx']")?.click();
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("shows an empty identity-scoped record when the hub has no matching events", () => {
    const container = renderSection(
      usageSettings({
        userOperationalIdentityNav: "add:wechat-official",
        userOperationalIdentitySnapshot: {
          identities: [
            {
              identityId: "id-wx",
              provider: "wechat-official",
              providerLabel: "微信公众号",
              displayName: "订阅号",
              status: "active",
              grantCount: 0,
              createdAt: "2026-08-01T00:00:00.000Z",
              updatedAt: "2026-08-01T00:00:00.000Z",
            },
          ],
          grants: [],
          usageHistory: [
            {
              eventId: "evt-email",
              agentId: "main",
              identityId: "id-email",
              provider: "personal-email",
              action: "send_email",
              result: "allowed",
              createdAt: "2026-09-17T12:00:00.000Z",
            },
          ],
          providerCatalog: catalog,
          pendingBindingRequests: [],
        },
      }),
    );

    expect(container.textContent).toContain("该身份还没有使用记录。");
    expect(container.textContent).not.toContain("发送邮件");
    expect(container.textContent).not.toContain("send_email");
  });
});
