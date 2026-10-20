import type { ChannelOnboardingAdapter } from "../../../src/channels/plugins/onboarding-types.js";
import type { OpenBotConfig } from "../../../src/config/types.openbot.js";
import { resolveDingtalkAccount } from "./accounts.js";

const channel = "dingtalk" as const;

export const dingtalkOnboardingAdapter: ChannelOnboardingAdapter = {
  channel,
  getStatus: async ({ cfg }) => {
    const account = resolveDingtalkAccount({ cfg });
    const configured = account.configured;
    return {
      channel,
      configured,
      statusLines: configured
        ? ["DingTalk: configured (connection not verified)"]
        : ["DingTalk: needs Client ID and Client Secret"],
      selectionHint: configured ? "configured" : "needs Client ID + Secret",
      quickstartScore: configured ? 2 : 0,
    };
  },
  configure: async ({ cfg, prompter }) => {
    const clientId = String(
      await prompter.text({
        message: "DingTalk Client ID",
        placeholder: "ding…",
      }),
    ).trim();
    const clientSecret = String(
      await prompter.text({
        message: "DingTalk Client Secret",
        placeholder: "secret",
      }),
    ).trim();
    const next: OpenBotConfig = {
      ...cfg,
      channels: {
        ...cfg.channels,
        dingtalk: {
          ...(cfg.channels?.dingtalk ?? {}),
          clientId,
          clientSecret,
        },
      },
    };
    return { cfg: next };
  },
};
