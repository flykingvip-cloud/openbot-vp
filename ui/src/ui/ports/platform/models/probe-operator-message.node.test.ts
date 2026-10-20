import { describe, expect, it } from "vitest";
import { formatOperatorProbeMessage } from "./probe-operator-message.ts";

describe("formatOperatorProbeMessage", () => {
  it("translates the managed-sandbox account refusal for operators", () => {
    const raw =
      "Managed multitenant sandbox requires a server-derived account (tenantId and userId).";
    expect(formatOperatorProbeMessage(raw)).toBe(
      "这次探测没有带上服务端租户身份（tenantId 与 userId），调用没有到达模型。不能据此判断密钥或模型不可用。",
    );
    expect(formatOperatorProbeMessage(`Error: ${raw}`)).not.toContain("Managed multitenant");
  });

  it("leaves ordinary probe errors unchanged", () => {
    expect(formatOperatorProbeMessage("调用测试失败，请检查模型 ID 与 Provider 凭证。")).toBe(
      "调用测试失败，请检查模型 ID 与 Provider 凭证。",
    );
  });
});
