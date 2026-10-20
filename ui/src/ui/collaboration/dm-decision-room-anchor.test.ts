import { beforeAll, describe, expect, it } from "vitest";
import { i18n } from "../../i18n/index.ts";
import { zh_CN } from "../../i18n/locales/zh-CN.ts";
import { resolveClientDmDecisionRoomAnchor } from "./dm-decision-room-anchor.ts";

describe("client DM decision room anchor", () => {
  beforeAll(async () => {
    i18n.registerTranslation("zh-CN", zh_CN);
    await i18n.setLocale("zh-CN");
  });

  it("returns the shared room-only sentence and never dumps options", () => {
    const text = resolveClientDmDecisionRoomAnchor("zh-CN");
    expect(text).toBe("需要你确认的选项我发到私聊了；定下来我再把结果贴回这里。");
    expect(text).not.toMatch(/选项一|A\)|option 1/i);
  });
});
