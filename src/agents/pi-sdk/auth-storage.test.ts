import { describe, expect, it } from "vitest";
import { OpenBotAuthStorage } from "./auth-storage.js";

describe("OpenBotAuthStorage", () => {
  it("keeps runtime API keys in memory and isolated per store", async () => {
    const tenantA = OpenBotAuthStorage.inMemory({
      openai: { type: "api_key", key: "sk-profile-a" },
    });
    const tenantB = OpenBotAuthStorage.inMemory({
      openai: { type: "api_key", key: "sk-profile-b" },
    });

    tenantA.setRuntimeApiKey("openai", "sk-runtime-a");

    await expect(tenantA.getApiKey("openai")).resolves.toBe("sk-runtime-a");
    await expect(tenantB.getApiKey("openai")).resolves.toBe("sk-profile-b");
    expect(tenantB.hasAuth("anthropic")).toBe(false);

    tenantA.removeRuntimeApiKey("openai");
    await expect(tenantA.getApiKey("openai")).resolves.toBe("sk-profile-a");
  });

  it("does not write runtime keys into CredentialStore.modify persistence", async () => {
    const store = OpenBotAuthStorage.inMemory();
    store.setRuntimeApiKey("openai", "sk-runtime-only");

    const listed = await store.list();
    expect(listed).toEqual([{ providerId: "openai", type: "api_key" }]);

    await store.modify("openai", async () => ({ type: "api_key", key: "sk-written" }));
    await expect(store.getApiKey("openai")).resolves.toBe("sk-runtime-only");

    store.removeRuntimeApiKey("openai");
    await expect(store.getApiKey("openai")).resolves.toBe("sk-written");
  });
});
