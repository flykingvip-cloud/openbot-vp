import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getNodeSeatBinding,
  listNodeSeatBindings,
  removeNodeSeatBinding,
  upsertNodeSeatBinding,
} from "./node-seat-binding-store.js";

describe("node-seat-binding-store", () => {
  let storePath: string;

  beforeEach(() => {
    storePath = path.join(mkdtempSync(path.join(tmpdir(), "node-seat-bind-")), "bindings.json");
  });

  afterEach(() => {
    rmSync(path.dirname(storePath), { recursive: true, force: true });
  });

  it("upserts and reads seat bindings", async () => {
    await upsertNodeSeatBinding(
      { tenantId: "t1", seatId: "seat-9", nodeId: "mac-node" },
      storePath,
    );
    await expect(getNodeSeatBinding("t1", "seat-9", storePath)).resolves.toMatchObject({
      nodeId: "mac-node",
    });
    const listed = await listNodeSeatBindings("t1", storePath);
    expect(listed).toHaveLength(1);
  });

  it("remove clears binding", async () => {
    await upsertNodeSeatBinding(
      { tenantId: "t1", seatId: "seat-9", nodeId: "mac-node" },
      storePath,
    );
    expect(await removeNodeSeatBinding("t1", "seat-9", storePath)).toBe(true);
    await expect(getNodeSeatBinding("t1", "seat-9", storePath)).resolves.toBeNull();
  });
});
