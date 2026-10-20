import { beforeAll, describe, expect, it } from "vitest";
import { i18n } from "../../i18n/index.ts";
import { zh_CN } from "../../i18n/locales/zh-CN.ts";
import {
  runtimeNoticeGovernanceClaimConflictDismissed,
  runtimeNoticeGovernanceClaimTruthAccepted,
  runtimeNoticeGovernanceTaskDismissed,
  runtimeNoticeGovernanceTaskResolved,
} from "./knowledge-universe-runtime-messages.ts";

describe("knowledge-universe governance notices", () => {
  beforeAll(async () => {
    i18n.registerTranslation("zh-CN", zh_CN);
    await i18n.setLocale("zh-CN");
  });

  it("formats claim truth accepted notice", () => {
    expect(
      runtimeNoticeGovernanceClaimTruthAccepted({
        subject: "会议链接",
        value: "https://meet.example.com",
      }),
    ).toBe("已采用「会议链接」的说法：https://meet.example.com");
  });

  it("formats fallback and dismiss notices", () => {
    expect(runtimeNoticeGovernanceClaimTruthAccepted({ value: "无" })).toContain("该事实");
    expect(runtimeNoticeGovernanceClaimConflictDismissed()).toBe("已忽略该事实说法冲突");
    expect(runtimeNoticeGovernanceTaskResolved()).toBe("已处理该治理任务");
    expect(runtimeNoticeGovernanceTaskDismissed()).toBe("已忽略该治理任务");
  });
});
