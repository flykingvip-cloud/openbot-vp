import type { OpenBotConfig } from "openclaw/plugin-sdk/wecom";
import { describe, expect, it } from "vitest";
import { resolveWecomAccount } from "./accounts.js";
import { wecomPlugin } from "./channel.js";

describe("wecomPlugin config schema", () => {
  it("exposes UI hints for required enterprise fields", () => {
    const hints = wecomPlugin.configSchema?.uiHints ?? {};

    expect(hints.corpId?.label).toBe("Corp ID");
    expect(hints.agentId?.label).toBe("Agent ID");
    expect(hints.secret?.sensitive).toBe(true);
    expect(hints.token?.sensitive).toBe(true);
    expect(hints.encodingAesKey?.sensitive).toBe(true);
    expect(hints.webhookPath?.label).toBe("Webhook Path");
    expect(hints["accounts.*.corpId"]?.label).toBe("Corp ID");
    expect(hints["accounts.*.secret"]?.sensitive).toBe(true);
  });

  it("reports missing fields in unconfiguredReason", () => {
    const cfg = {
      channels: {
        wecom: {
          accounts: {
            default: { corpId: "ww1", secret: "sec" },
          },
        },
      },
    } as unknown as OpenBotConfig;
    const account = resolveWecomAccount({ cfg, accountId: "default" });
    expect(wecomPlugin.config.unconfiguredReason?.(account, cfg)).toContain("agentId, token");
  });
});
