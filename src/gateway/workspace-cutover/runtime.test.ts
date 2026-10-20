import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createWorkspaceCutoverOperation,
  FileWorkspaceCutoverStore,
  resolveWorkspaceCutoverOperationsPath,
} from "./index.js";
import { listActiveCutoverOperationsForResource } from "./runtime.js";

describe("workspace cutover runtime", () => {
  it("resolves store path under data root .meta", () => {
    expect(resolveWorkspaceCutoverOperationsPath("/srv/OpenBot")).toBe(
      path.join("/srv/OpenBot", ".meta", "workspace-cutover", "operations.json"),
    );
  });

  it("lists only non-terminal operations for a resource", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-cutover-runtime-"));
    const store = new FileWorkspaceCutoverStore(
      path.join(root, ".meta", "workspace-cutover", "operations.json"),
    );
    const resourceId = "ws:tenant-a:group:g1";
    store.save(
      createWorkspaceCutoverOperation({
        operationId: "op-active",
        resourceId,
        sourceBindingId: "src",
        targetBindingId: "dst",
        expectedContentVersion: "v1",
      }),
    );
    store.save({
      ...createWorkspaceCutoverOperation({
        operationId: "op-retired",
        resourceId,
        sourceBindingId: "src",
        targetBindingId: "dst",
        expectedContentVersion: "v1",
      }),
      state: "retired",
    });
    const active = listActiveCutoverOperationsForResource(store, resourceId);
    expect(active.map((op) => op.operationId)).toEqual(["op-active"]);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
