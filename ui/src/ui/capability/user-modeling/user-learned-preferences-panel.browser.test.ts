// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { GatewayBrowserClient } from "../../gateway.ts";
import "./user-learned-preferences-panel.ts";

function defaultProfile() {
  return {
    preferredReplyLanguage: null,
    preferredOutputFormat: "structured",
    preferredTone: "neutral",
    confirmationPreference: "confirm_first",
    verbosity: "normal",
    observations: {},
  };
}

function mockGatewayClient(request: GatewayBrowserClient["request"]): GatewayBrowserClient {
  return { connected: true, request } as GatewayBrowserClient;
}

describe("UserLearnedPreferencesPanel (browser)", () => {
  it("renders empty state for default profile", async () => {
    const el = document.createElement("user-learned-preferences-panel");
    el.locale = "zh-CN";
    el.client = mockGatewayClient(
      vi.fn().mockResolvedValue({
        userKeyHash: "abc123",
        tenantId: null,
        profile: defaultProfile(),
      }),
    );
    document.body.appendChild(el);
    await vi.waitFor(() => {
      expect(el.shadowRoot?.textContent).toContain("暂无学习到的偏好");
    });

    expect(el.shadowRoot?.textContent).toContain("清除我的画像");
    el.remove();
  });

  it("renders learned concise preference rows", async () => {
    const el = document.createElement("user-learned-preferences-panel");
    el.locale = "en";
    el.client = mockGatewayClient(
      vi.fn().mockResolvedValue({
        userKeyHash: "def456",
        tenantId: "tenant-a",
        profile: {
          ...defaultProfile(),
          preferredOutputFormat: "concise",
          verbosity: "terse",
        },
      }),
    );
    document.body.appendChild(el);
    await vi.waitFor(() => {
      expect(el.shadowRoot?.textContent).toContain("Output format");
    });

    expect(el.shadowRoot?.textContent).toContain("concise");
    expect(el.shadowRoot?.textContent).toContain("Profile ID");
    el.remove();
  });

  it("clears profile via reset RPC", async () => {
    let getProfileCalls = 0;
    const request = vi.fn(async (method: string) => {
      if (method === "user-modeling.get-profile") {
        getProfileCalls += 1;
        if (getProfileCalls === 1) {
          return {
            userKeyHash: "ghi789",
            tenantId: null,
            profile: { ...defaultProfile(), preferredOutputFormat: "concise" },
          };
        }
        return {
          userKeyHash: "ghi789",
          tenantId: null,
          profile: defaultProfile(),
        };
      }
      if (method === "user-modeling.reset-profile") {
        return { ok: true };
      }
      return null;
    });
    const el = document.createElement("user-learned-preferences-panel");
    el.locale = "zh-CN";
    el.client = mockGatewayClient(request as GatewayBrowserClient["request"]);
    document.body.appendChild(el);
    await vi.waitFor(() => {
      expect(el.shadowRoot?.querySelector("button.btn--danger")).toBeTruthy();
    });

    const clearButton = el.shadowRoot?.querySelector<HTMLButtonElement>("button.btn--danger");
    clearButton?.click();
    await vi.waitFor(() => {
      expect(request).toHaveBeenCalledWith("user-modeling.reset-profile", {});
    });
    el.remove();
  });
});
