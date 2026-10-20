import type { OpenBotConfig } from "openclaw/plugin-sdk/wecom";
import { describe, expect, it } from "vitest";
import {
  describeWecomUnconfiguredReason,
  listMissingWecomHardConfigFields,
  resolveWecomAccount,
} from "./accounts.js";

describe("resolveWecomAccount configured gate", () => {
  it("requires corpId, agentId, secret, and token for callback mode", () => {
    const cfg = {
      channels: {
        wecom: {
          accounts: {
            default: {
              corpId: "ww1",
              agentId: 1000002,
              secret: "sec",
              token: "tok",
            },
          },
        },
      },
    } as unknown as OpenBotConfig;
    const account = resolveWecomAccount({ cfg, accountId: "default" });
    expect(account.connectionMode).toBe("callback");
    expect(account.configured).toBe(true);
  });

  it("requires botId and secret for websocket AIBot mode", () => {
    const cfg = {
      channels: {
        wecom: {
          accounts: {
            default: {
              connectionMode: "websocket",
              botId: "aib123",
              secret: "aibot-sec",
            },
          },
        },
      },
    } as unknown as OpenBotConfig;
    const account = resolveWecomAccount({ cfg, accountId: "default" });
    expect(account.connectionMode).toBe("websocket");
    expect(account.configured).toBe(true);
    expect(listMissingWecomHardConfigFields(account)).toEqual([]);
  });

  it("lists hard missing fields and describes unconfigured reason", () => {
    const cfg = {
      channels: {
        wecom: {
          accounts: {
            default: {
              corpId: "ww1",
              secret: "sec",
            },
          },
        },
      },
    } as unknown as OpenBotConfig;
    const account = resolveWecomAccount({ cfg, accountId: "default" });
    expect(account.configured).toBe(false);
    expect(listMissingWecomHardConfigFields(account)).toEqual(["agentId", "token"]);
    expect(describeWecomUnconfiguredReason(account)).toContain("agentId, token");
    expect(describeWecomUnconfiguredReason(account)).toContain("encodingAesKey");
  });
});
