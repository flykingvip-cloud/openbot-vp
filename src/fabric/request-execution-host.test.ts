import { expect, it, vi } from "vitest";
import type { ToolRequest } from "./contract.js";
import { createRequestHostedFabricService } from "./request-execution-host.js";
import type { FabricService } from "./service.js";
it("isolates concurrent request hosts and disposes each on failure", async () => {
  const disposed: string[] = [];
  const control = { check: vi.fn(), registerAdapter: vi.fn() } as unknown as FabricService;
  const admit = vi.fn(async (request: ToolRequest) => ({
    service: {
      execute: async () => {
        if (request.id === "bad") {
          throw new Error("failed");
        }
        return { result: { id: request.id } };
      },
    } as unknown as FabricService,
    dispose: async () => {
      disposed.push(request.id);
    },
  }));
  const service = createRequestHostedFabricService({ control, admit });
  const outcomes = await Promise.allSettled([
    service.execute({ id: "good" } as ToolRequest),
    service.execute({ id: "bad" } as ToolRequest),
  ]);
  expect(outcomes.map((row) => row.status)).toEqual(["fulfilled", "rejected"]);
  expect(disposed.toSorted()).toEqual(["bad", "good"]);
  expect(admit).toHaveBeenCalledTimes(2);
});
it("does not execute when admission rejects", async () => {
  const execute = vi.fn();
  const control = { execute } as unknown as FabricService;
  const service = createRequestHostedFabricService({
    control,
    admit: async () => {
      throw new Error("unauthorized");
    },
  });
  await expect(service.execute({ id: "request" } as ToolRequest)).rejects.toThrow("unauthorized");
  expect(execute).not.toHaveBeenCalled();
});

it("does not accept a result after its admitted lease was cancelled", async () => {
  const controller = new AbortController();
  const dispose = vi.fn(async () => {});
  const service = createRequestHostedFabricService({
    control: {} as FabricService,
    admit: async () => ({
      signal: controller.signal,
      dispose,
      service: {
        execute: async () => {
          controller.abort(new Error("lease lost"));
          return { result: { id: "request" } };
        },
      } as unknown as FabricService,
    }),
  });
  await expect(service.execute({ id: "request" } as ToolRequest)).rejects.toThrow("lease lost");
  expect(dispose).toHaveBeenCalledTimes(1);
});
