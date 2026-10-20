import { beforeEach, describe, expect, it } from "vitest";
import { i18n, t } from "../../../i18n/index.ts";

describe("conversation lifecycle i18n (CL-P1-03)", () => {
  beforeEach(async () => {
    await i18n.setLocale("en");
  });

  it("resolves catalog + load-earlier keys in en and zh-CN", async () => {
    expect(t("frontstage.workbench.conversations.title")).toBe("Conversations");
    expect(t("frontstage.workbench.conversations.archiveConfirm")).toContain("Archive");
    expect(t("chat.loadEarlier")).toBe("Load earlier messages");
    expect(t("chat.loadingEarlier")).toContain("Loading");

    await i18n.setLocale("zh-CN");
    expect(t("frontstage.workbench.conversations.title")).toBe("会话");
    expect(t("frontstage.workbench.conversations.empty")).toContain("会话");
    expect(t("chat.loadEarlier")).toBe("加载更早的消息");
    expect(t("chat.loadingEarlier")).toContain("加载");
  });
});
