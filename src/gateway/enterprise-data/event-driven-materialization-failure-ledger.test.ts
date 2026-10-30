// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  findMaterializationFailure,
  loadMaterializationFailureLedger,
  normalizeMaterializationFailureLedgerStore,
  recordMaterializationFailure,
  resolveMaterializationFailure,
  saveMaterializationFailureLedger,
} from "./event-driven-materialization-failure-ledger.js";

describe("event-driven materialization failure ledger", () => {
  let tmp = "";

  afterEach(() => {
    if (tmp) {
      fs.rmSync(tmp, { recursive: true, force: true });
      tmp = "";
    }
  });

  it("persists open failure and resolves on success path", async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "p1f-fail-ledger-"));
    const storePath = path.join(tmp, "failures.json");
    const store = normalizeMaterializationFailureLedgerStore(null);
    const open = recordMaterializationFailure({
      store,
      tenantId: "tenant-acme",
      eventId: "evt-1",
      sourceId: "src-a",
      externalId: "ext-1",
      stage: "load",
      errorCode: "store_load_failed",
      nowIso: "2026-10-30T12:00:00.000Z",
      lastError: "EIO load",
    });
    expect(open.status).toBe("open");
    expect(open.attemptCount).toBe(1);
    await saveMaterializationFailureLedger(store, storePath);

    const reloaded = await loadMaterializationFailureLedger(storePath);
    expect(findMaterializationFailure(reloaded, "tenant-acme", "evt-1")?.status).toBe("open");

    const again = recordMaterializationFailure({
      store: reloaded,
      tenantId: "tenant-acme",
      eventId: "evt-1",
      sourceId: "src-a",
      externalId: "ext-1",
      stage: "save",
      errorCode: "store_save_failed",
      nowIso: "2026-10-30T12:01:00.000Z",
    });
    expect(again.attemptCount).toBe(2);
    expect(again.stage).toBe("save");

    const resolved = resolveMaterializationFailure({
      store: reloaded,
      tenantId: "tenant-acme",
      eventId: "evt-1",
      nowIso: "2026-10-30T12:02:00.000Z",
    });
    expect(resolved?.status).toBe("resolved");
    expect(resolved?.resolvedAt).toBe("2026-10-30T12:02:00.000Z");
    await saveMaterializationFailureLedger(reloaded, storePath);

    const final = await loadMaterializationFailureLedger(storePath);
    expect(findMaterializationFailure(final, "tenant-acme", "evt-1")?.status).toBe("resolved");
  });
});
