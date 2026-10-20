import type { ChannelOnboardingAdapter, OpenBotConfig } from "openclaw/plugin-sdk/wecom";
import { resolveWecomAccount } from "./accounts.js";

const channel = "wecom" as const;

function hasWecomCreds(cfg: OpenBotConfig): boolean {
  const account = resolveWecomAccount({ cfg });
  return account.configured;
}

export const wecomOnboardingAdapter: ChannelOnboardingAdapter = {
  channel,
  getStatus: async ({ cfg }) => {
    const configured = hasWecomCreds(cfg);
    return {
      channel,
      configured,
      statusLines: configured
        ? ["WeCom: configured (connection not verified)"]
        : ["WeCom: needs corpId / agentId / secret (callback) or botId / secret (websocket)"],
      selectionHint: configured ? "configured" : "needs WeCom credentials",
      quickstartScore: configured ? 2 : 0,
    };
  },
  configure: async ({ cfg, prompter }) => {
    const corpId = String(
      await prompter.text({
        message: "WeCom Corp ID",
        placeholder: "ww…",
      }),
    ).trim();
    const agentIdRaw = String(
      await prompter.text({
        message: "WeCom Agent ID",
        placeholder: "1000001",
      }),
    ).trim();
    const secret = String(
      await prompter.text({
        message: "WeCom Secret",
        placeholder: "secret",
      }),
    ).trim();
    const token = String(
      await prompter.text({
        message: "WeCom Token (callback)",
        placeholder: "token",
      }),
    ).trim();
    const encodingAesKey = String(
      await prompter.text({
        message: "WeCom EncodingAESKey (callback)",
        placeholder: "43-char key",
      }),
    ).trim();
    const agentId = Number.parseInt(agentIdRaw, 10);
    if (!Number.isFinite(agentId)) {
      throw new Error("WeCom Agent ID must be a number");
    }

    const next: OpenBotConfig = {
      ...cfg,
      channels: {
        ...cfg.channels,
        wecom: {
          ...(cfg.channels?.wecom ?? {}),
          corpId,
          agentId,
          secret,
          token,
          encodingAesKey,
          connectionMode: "callback",
        },
      },
    };
    return { cfg: next };
  },
};
