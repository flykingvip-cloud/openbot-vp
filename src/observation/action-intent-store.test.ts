import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createActionIntentStore } from "./action-intent-store.js";
import { createActionIntent, type ActionIntent } from "./action-intent.js";
const scope = {
  kind: "enterprise",
  tenantId: "tenant",
  enterpriseDomainId: "domain",
  subjectRef: "subject:private",
  authzScopeRef: "auth",
} as const;
let root = "";
const intent = () =>
  createActionIntent(
    {
      actionIntentId: "../../intent",
      findingRef: { findingId: "finding", source: "rule_v1" },
      target: {
        controlPlane: "evolution",
        targetType: "agent",
        targetId: "bot",
        scopeRef: "tenant",
        expectedConfigVersion: "v1",
        diffDigest: "diff",
        previewRef: "preview",
        rollbackPointRef: "point",
        rollbackExpectedVersion: "v0",
        rollbackDiffDigest: "old",
      },
      evidence: {
        sampleRefs: [],
        metricDictVersion: 1,
        metricId: "metric",
        denominatorDefinition: "tips",
        cohortRef: "cohort",
        window: { from: 0, to: 1 },
        eligibility: "unknown",
        improvementEligible: false,
        environment: "production",
        provenance: "unknown",
        reasons: [],
      },
    },
    1,
  );
const commit = (
  store: ReturnType<typeof createActionIntentStore>,
  value: ActionIntent,
  commandId = "create",
  expectedRevision = -1,
  requestDigest = "digest",
) => store.commit({ scope, intent: value, commandId, expectedRevision, requestDigest });
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "intent-store-"));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
describe("durable intent correlation history", () => {
  it("enforces cross-process CAS through the filesystem lock", async () => {
    const script = path.join(root, "race.ts");
    const modulePath = fileURLToPath(new URL("./action-intent-store.ts", import.meta.url));
    await fs.writeFile(
      script,
      "import {createActionIntentStore} from " +
        JSON.stringify(modulePath) +
        "; const input=JSON.parse(process.argv[2]); try { await createActionIntentStore(input.root).commit(input.commit); console.log('ok'); } catch(e) { console.log('rejected'); }",
    );
    const run = promisify(execFile);
    const results = await Promise.all(
      ["one", "two"].map((commandId) =>
        run("bun", [
          script,
          JSON.stringify({
            root: path.join(root, "store"),
            commit: {
              scope,
              intent: intent(),
              expectedRevision: -1,
              commandId,
              requestDigest: "digest",
            },
          }),
        ]),
      ),
    );
    expect(results.map((r) => r.stdout.trim()).toSorted()).toEqual(["ok", "rejected"]);
  });
  it("validates scoped metadata and canonical replay independent of key order", async () => {
    const store = createActionIntentStore(root);
    const value = intent();
    await commit(store, value);
    const reordered = Object.fromEntries(Object.entries(value).toReversed()) as ActionIntent;
    expect((await commit(store, reordered)).replayed).toBe(true);
    const detail = await store.detail(scope, value.actionIntentId);
    expect(detail?.evidence.provenance).toBe("unknown");
    if (detail) {
      detail.target.targetId = "changed";
    }
    expect((await store.detail(scope, value.actionIntentId))?.target.targetId).toBe("bot");
    await expect(
      commit(store, { ...value, target: { ...value.target, scopeRef: "other" } }, "bad"),
    ).rejects.toThrow("scope_mismatch");
    await expect(
      commit(store, { ...value, receipts: "bad" } as unknown as ActionIntent, "bad"),
    ).rejects.toThrow();
    await expect(
      commit(store, { ...value, body: "SECRET" } as ActionIntent, "bad"),
    ).rejects.toThrow();
  });
  it("recovers immutable revisions and command replay after restart", async () => {
    const first = createActionIntentStore(root);
    const value = intent();
    await commit(first, value);
    const next = { ...value, revision: 1, state: "needs_evidence" as const, updatedAt: 2 };
    await commit(first, next, "next", 0);
    const restarted = createActionIntentStore(root);
    expect((await restarted.query(scope, value.actionIntentId, 0))?.state).toBe("draft");
    expect((await restarted.query(scope, value.actionIntentId))?.revision).toBe(1);
    expect(await commit(restarted, value)).toEqual({ replayed: true, revision: 0 });
    await expect(commit(restarted, value, "create", -1, "other")).rejects.toThrow("command_rebind");
    await expect(commit(restarted, value, "overwrite")).rejects.toThrow("revision_conflict");
  });
  it("serializes CAS competition across store instances", async () => {
    const value = intent();
    const results = await Promise.allSettled([
      commit(createActionIntentStore(root), value, "one"),
      commit(createActionIntentStore(root), value, "two"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });
  it("isolates scope and read paths never create files", async () => {
    const missing = path.join(root, "missing");
    expect(await createActionIntentStore(missing).query(scope, "missing")).toBeNull();
    expect(await fs.readdir(root)).toEqual([]);
    const store = createActionIntentStore(root);
    await commit(store, intent());
    expect(await store.query({ ...scope, tenantId: "other" }, intent().actionIntentId)).toBeNull();
    expect(JSON.stringify(await store.query(scope, intent().actionIntentId))).not.toContain(
      "private",
    );
    expect((await fs.readdir(root)).every((n) => /^[a-f0-9]{64}$/.test(n))).toBe(true);
  });
  it("ignores incomplete temporary writes and fails closed on corrupt committed history", async () => {
    const store = createActionIntentStore(root);
    await commit(store, intent());
    const [dir] = await fs.readdir(root);
    const [name] = await fs.readdir(path.join(root, dir));
    await fs.writeFile(path.join(root, dir, name + ".interrupted.tmp"), "{");
    expect(
      (await createActionIntentStore(root).query(scope, intent().actionIntentId))?.revision,
    ).toBe(0);
    await fs.writeFile(path.join(root, dir, name), "{}");
    await expect(store.query(scope, intent().actionIntentId)).rejects.toThrow(
      "corrupt_intent_history",
    );
  });
});
