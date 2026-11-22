import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ load: vi.fn(), snapshot: vi.fn() }));
vi.mock("./platform-auth/seat-store-loader.js", () => ({
  loadSeatAssetsStoreForTenantId: mocks.load,
}));
vi.mock("./enterprise-seat-assets-store.js", () => ({
  buildEmployeeAccessSnapshot: mocks.snapshot,
}));
import { conversationSeatAgentIds } from "./conversation-seat-grants.js";
beforeEach(() => {
  vi.resetAllMocks();
});
it("uses the requested tenant store and authenticated employee identity", async () => {
  const store = { marker: "tenant-a" };
  mocks.load.mockResolvedValue(store);
  mocks.snapshot.mockImplementation(({ tenantId, employeeId }) => ({
    agentIds: tenantId === "a" && employeeId === "alice" ? ["bot-a"] : [],
  }));
  expect(await conversationSeatAgentIds("a", "alice")).toEqual(["bot-a"]);
  expect(mocks.load).toHaveBeenCalledWith("a");
  expect(mocks.snapshot).toHaveBeenCalledWith({ store, tenantId: "a", employeeId: "alice" });
  expect(await conversationSeatAgentIds("b", "alice")).toEqual([]);
  expect(await conversationSeatAgentIds("a", "bob")).toEqual([]);
});
it("fails closed when control-plane storage fails", async () => {
  mocks.load.mockRejectedValue(new Error("unavailable"));
  expect(await conversationSeatAgentIds("a", "alice")).toEqual([]);
  expect(mocks.snapshot).not.toHaveBeenCalled();
});
it("rejects missing identity before accessing storage", async () => {
  expect(await conversationSeatAgentIds("", "alice")).toEqual([]);
  expect(await conversationSeatAgentIds("a", "")).toEqual([]);
  expect(mocks.load).not.toHaveBeenCalled();
});
