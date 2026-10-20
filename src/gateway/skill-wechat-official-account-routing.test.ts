import { describe, expect, it } from "vitest";
import {
  assessWechatOfficialAccountRoute,
  formatTurnPreferSkillHint,
  resolveTurnPreferSkillNames,
} from "./skill-wechat-official-account-routing.js";

describe("wechat-official-account routing", () => {
  it.each([
    ["帮我做公众号运营策划，要涨粉路径", true, "ops_planning"],
    ["做公众号运营涨粉", true, "ops_planning"],
    ["写一份公众号菜单和自动回复策略", true, "ops_planning"],
    ["配公众号 IP 白名单", false, "owned_elsewhere"],
    ["帮我发公众号草稿箱", false, "owned_elsewhere"],
    ["把这篇文章拆成小红书", false, "owned_elsewhere"],
    ["今天天气怎么样", false, "none"],
  ] as const)("%s → trigger=%s", (text, trigger, intent) => {
    const decision = assessWechatOfficialAccountRoute(text);
    expect(decision.trigger, decision.reason).toBe(trigger);
    expect(decision.intent).toBe(intent);
  });

  it("lifts the skill into the current turn only", () => {
    expect(resolveTurnPreferSkillNames("做公众号运营涨粉")).toEqual(["wechat-official-account"]);
    expect(resolveTurnPreferSkillNames("帮我发公众号草稿箱")).toEqual([]);
    expect(formatTurnPreferSkillHint(["wechat-official-account"])).toContain(
      "`wechat-official-account`",
    );
    expect(formatTurnPreferSkillHint([])).toBeUndefined();
  });
});
