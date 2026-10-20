/**
 * Official Account ops-planning auto-route.
 * Keep this skill out of the default truncated prompt; lift it only when the
 * user asked for detailed growth / menu / conversion planning.
 */

export type WechatOfficialAccountIntent = "ops_planning" | "owned_elsewhere" | "none";

export type WechatOfficialAccountRouteDecision = {
  trigger: boolean;
  intent: WechatOfficialAccountIntent;
  reason: string;
  skillKey: "wechat-official-account";
};

const OPS_PLANNING =
  /公众号运营策划|详细.{0,8}(运营)?策划|运营策划|涨粉|粉丝增长|粉丝互动|转化策略|公众号菜单|内容支柱|订阅者人设|发文日历/i;
const OWNED_ELSEWHERE =
  /配公众号|IP\s*白名单|AppSecret|发公众号草稿|写入草稿箱|排版|成稿|封面配图|一源多平台|拆成小红书/i;

export function assessWechatOfficialAccountRoute(text: string): WechatOfficialAccountRouteDecision {
  const raw = text.trim();
  const skillKey = "wechat-official-account" as const;
  if (!raw) {
    return { trigger: false, intent: "none", reason: "empty", skillKey };
  }
  if (OWNED_ELSEWHERE.test(raw) && !OPS_PLANNING.test(raw)) {
    return { trigger: false, intent: "owned_elsewhere", reason: "owned-by-other-skill", skillKey };
  }
  if (OPS_PLANNING.test(raw)) {
    return { trigger: true, intent: "ops_planning", reason: "oa-ops-planning", skillKey };
  }
  return { trigger: false, intent: "none", reason: "no-oa-ops-intent", skillKey };
}

export function resolveTurnPreferSkillNames(text: string): string[] {
  return assessWechatOfficialAccountRoute(text).trigger ? ["wechat-official-account"] : [];
}

export function formatTurnPreferSkillHint(skillNames: string[]): string | undefined {
  if (!skillNames.includes("wechat-official-account")) {
    return undefined;
  }
  return [
    "## Turn skill",
    "This turn is WeChat Official Account growth/ops planning.",
    "Load and follow `wechat-official-account`. Produce the planning deliverables in that skill.",
    "Do not invent wechat-oa-* keys. Do not typeset, write the draft box, or bind AppID.",
    "Cross-platform repurpose stays `content-ops`.",
  ].join("\n");
}
