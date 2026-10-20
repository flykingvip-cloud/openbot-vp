import { afterEach, describe, expect, it, vi } from "vitest";

describe("pi-model-discovery module compatibility", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("@earendil-works/pi-coding-agent");
  });

  it("loads without a public AuthStorage export from pi-coding-agent", async () => {
    vi.resetModules();
    vi.doMock("@earendil-works/pi-coding-agent", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
      return {
        ...actual,
        AuthStorage: undefined,
      };
    });

    await expect(import("./pi-model-discovery.js")).resolves.toMatchObject({
      discoverAuthStorage: expect.any(Function),
      discoverModels: expect.any(Function),
      AuthStorage: expect.any(Function),
    });
  });
});
