import { describe, expect, it } from "vitest";
import { chatCheckpointsPack } from "./chat-checkpoints.pack.js";
import {
  mergePackHandlers,
  mergePackMethodNames,
  validateGatewayMethodPacks,
} from "./pack-merge.js";
import { GATEWAY_METHOD_PACKS } from "./packs/registry.js";
import { stewardWorkspaceFilePack } from "./steward-workspace-file.pack.js";

describe("gateway method packs", () => {
  it("registry packs validate cleanly", () => {
    expect(validateGatewayMethodPacks(GATEWAY_METHOD_PACKS)).toEqual([]);
  });

  it("mergePackMethodNames preserves pack order", () => {
    const names = mergePackMethodNames(GATEWAY_METHOD_PACKS);
    // artifact-grant pack lands first on main (#442); chat checkpoints remain present.
    expect(names[0]).toBe("artifact.grant.redeem");
    expect(names).toContain("chat.checkpoints.list");
    expect(names).toContain("lane.attach");
    expect(names).toContain("workbench.steward-file.read");
    expect(names).toContain("workbench.steward-file.preview");
    expect(names).toContain("workbench.steward-file.open");
    expect(names).toContain("workbench.steward-file.write");
    expect(names).toContain("workbench.steward-file.patch-pptx");
    expect(names).toContain("workbench.group-file.preview");
    expect(names).toContain("workbench.group-file.open");
    expect(names).toContain("workbench.group-file.write");
    expect(names).toContain("workbench.group-file.patch-pptx");
    expect(names).toContain("supervisor.task.create");
  });

  it("mergePackHandlers exposes local pack handlers", () => {
    const merged = mergePackHandlers(GATEWAY_METHOD_PACKS);
    expect(typeof merged["chat.checkpoints.list"]).toBe("function");
    expect(typeof merged["workbench.steward-file.read"]).toBe("function");
    expect(typeof merged["workbench.group-file.write"]).toBe("function");
    expect(typeof merged["supervisor.task.create"]).toBe("function");
  });

  it("rejects duplicate methods across packs", () => {
    const errors = validateGatewayMethodPacks([
      stewardWorkspaceFilePack,
      {
        ...chatCheckpointsPack,
        id: "duplicate-steward",
        methods: ["workbench.steward-file.read"],
        scopes: { "operator.read": ["workbench.steward-file.read"] },
        handlers: stewardWorkspaceFilePack.handlers,
      },
    ]);
    expect(errors.some((e) => e.includes("duplicate pack method"))).toBe(true);
  });
});
