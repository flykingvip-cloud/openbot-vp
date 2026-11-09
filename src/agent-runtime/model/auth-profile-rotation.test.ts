import { expect, it, vi } from "vitest";
import { createAuthProfileRotation } from "./auth-profile-rotation.js";
it("keeps a user pin even in cooldown and never rotates it", async () => {
  const apply = vi.fn(async (_id: string | undefined) => {});
  const rotation = createAuthProfileRotation({
    candidates: ["pin"],
    lockedProfileId: "pin",
    inCooldown: () => true,
    apply,
  });
  expect(await rotation.initialize({ allowTransientCooldownProbe: false, onProbe: vi.fn() })).toBe(
    true,
  );
  expect(rotation.current).toBe("pin");
  expect(await rotation.advance()).toBe(false);
  expect(apply).toHaveBeenCalledExactlyOnceWith("pin");
});
it("preserves candidate order across credential failures and cooldowns", async () => {
  const apply = vi.fn(async (id: string | undefined) => {
    if (id === "a" || id === "c") {
      throw new Error("credential unavailable");
    }
  });
  const rotation = createAuthProfileRotation({
    candidates: ["a", "b", "c", "d"],
    inCooldown: (id) => id === "b",
    apply,
  });
  await expect(
    rotation.initialize({ allowTransientCooldownProbe: false, onProbe: vi.fn() }),
  ).rejects.toThrow("credential unavailable");
  expect(rotation.current).toBe("a");
  expect(await rotation.advance()).toBe(true);
  expect(rotation.current).toBe("d");
  expect(apply.mock.calls.map(([id]) => id)).toEqual(["a", "c", "d"]);
  expect(await rotation.advance()).toBe(false);
  expect(rotation.current).toBe("d");
});
it("allows only the explicit transient cooldown probe", async () => {
  const apply = vi.fn(async (_id: string | undefined) => {});
  const onProbe = vi.fn();
  const create = () =>
    createAuthProfileRotation({ candidates: ["a", "b"], inCooldown: () => true, apply });
  expect(await create().initialize({ allowTransientCooldownProbe: false, onProbe })).toBe(false);
  expect(apply).not.toHaveBeenCalled();
  expect(await create().initialize({ allowTransientCooldownProbe: true, onProbe })).toBe(true);
  expect(onProbe).toHaveBeenCalledOnce();
  expect(apply).toHaveBeenCalledExactlyOnceWith("a");
});
