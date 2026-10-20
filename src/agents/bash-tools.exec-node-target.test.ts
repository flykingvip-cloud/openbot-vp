import { describe, expect, it } from "vitest";
import { selectSystemRunNode, type ExecNodeCandidate } from "./bash-tools.exec-node-target.js";

function node(overrides: Partial<ExecNodeCandidate> & { nodeId: string }): ExecNodeCandidate {
  return {
    commands: ["system.run"],
    ...overrides,
  };
}

describe("selectSystemRunNode", () => {
  it("auto-selects the only system.run node", () => {
    const selected = selectSystemRunNode([
      node({ nodeId: "mac-1", displayName: "UPBEYONDdeMacBook-Pro.local", platform: "darwin" }),
    ]);
    expect(selected.nodeId).toBe("mac-1");
  });

  it("auto-selects the only online system.run node when another is offline", () => {
    const selected = selectSystemRunNode([
      node({ nodeId: "mac-offline", connected: false, displayName: "Old-Mac.local" }),
      node({ nodeId: "mac-live", connected: true, displayName: "Studio-Mac.local" }),
      node({ nodeId: "phone", commands: ["canvas.snapshot"], connected: true }),
    ]);
    expect(selected.nodeId).toBe("mac-live");
  });

  it("errors when several online system.run nodes have no binding", () => {
    expect(() =>
      selectSystemRunNode([
        node({ nodeId: "mac-a", connected: true }),
        node({ nodeId: "mac-b", connected: true }),
      ]),
    ).toThrow(/requires a node id when multiple nodes are available/);
  });

  it("errors when nothing is paired or nothing can run commands", () => {
    expect(() => selectSystemRunNode([])).toThrow(/none available/);
    expect(() =>
      selectSystemRunNode([node({ nodeId: "phone", commands: ["canvas.snapshot"] })]),
    ).toThrow(/supports system.run/);
  });

  it("honors an explicit node id or display name", () => {
    const nodes = [
      node({ nodeId: "mac-a", displayName: "Desk.local", connected: true }),
      node({ nodeId: "mac-b", displayName: "Travel.local", connected: true }),
    ];
    expect(selectSystemRunNode(nodes, "mac-b").nodeId).toBe("mac-b");
    expect(selectSystemRunNode(nodes, "Desk.local").nodeId).toBe("mac-a");
  });

  it("rejects an explicit node that cannot run commands", () => {
    expect(() =>
      selectSystemRunNode(
        [node({ nodeId: "phone", commands: ["canvas.snapshot"], displayName: "Phone" })],
        "phone",
      ),
    ).toThrow(/supports system.run/);
  });
});
