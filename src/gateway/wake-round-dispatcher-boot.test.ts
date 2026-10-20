import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getWakeRoundDispatcher,
  setWakeRoundDispatcher,
} from "./collaboration-dispatch/wake-round-dispatch.js";
import {
  bindGatewayWakeRoundDispatcher,
  unbindGatewayWakeRoundDispatcher,
} from "./wake-round-dispatcher-boot.js";

vi.mock("./collaboration-learning/space-store.js", () => ({
  listGatewayCollaborationSpaces: vi.fn(async () => ({ spaces: [] })),
}));

describe("wake-round-dispatcher-boot", () => {
  afterEach(() => {
    setWakeRoundDispatcher(null);
  });

  it("bindGatewayWakeRoundDispatcher registers process dispatcher", () => {
    expect(getWakeRoundDispatcher()).toBeNull();
    bindGatewayWakeRoundDispatcher({ cfg: {} as never });
    expect(getWakeRoundDispatcher()).toEqual(expect.any(Function));
  });

  it("unbindGatewayWakeRoundDispatcher clears registry", () => {
    bindGatewayWakeRoundDispatcher({ cfg: {} as never });
    unbindGatewayWakeRoundDispatcher();
    expect(getWakeRoundDispatcher()).toBeNull();
  });
});
