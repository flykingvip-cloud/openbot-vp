import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalMetadataStore } from "../adapters/local-metadata.js";
import {
  computeIngestionChecksum,
  computeWriteOperationKey,
  createMemoryPartitionKeyV1,
  resolveSourceLocatorForOperationKey,
} from "../keys.js";
import type { MemorySubject, Scope } from "../models.js";
import { InMemoryMetadataStore } from "../storage/in-memory.js";
import {
  LOCAL_TENANT_SENTINEL,
  authorizeMemoryAccess,
  createMemorySubjectBinding,
  markMemorySubjectBindingUnbound,
  resolveLocalMemorySubject,
  resolveMemorySubjectTenantId,
  serializePartitionKey,
} from "./binding.js";

const scope: Scope = {
  workspaceId: "ws_p3",
  projectId: "proj_p3",
  agentId: "agent_main",
  visibility: "private",
};

describe("CW2-P3-01 MemorySubject binding", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps writeOperationKey stable when subjects are bound", () => {
    const partition = createMemoryPartitionKeyV1("dp_p3", scope);
    const contentChecksum = computeIngestionChecksum("body", {
      openbotPath: "/tmp/p3-session.jsonl",
    });
    const before = computeWriteOperationKey({
      partition,
      sourceType: "chat",
      sourceLocator: resolveSourceLocatorForOperationKey({
        metadata: { openbotPath: "/tmp/p3-session.jsonl" },
      }),
      contentChecksum,
    });

    const subjectA = resolveLocalMemorySubject("agent_main", "agent");
    const subjectB: MemorySubject = {
      tenantId: "tenant_enterprise",
      ownerType: "user",
      ownerId: "user_1",
    };
    createMemorySubjectBinding({ partition, scope, subject: subjectA });
    createMemorySubjectBinding({ partition, scope, subject: subjectB, scopeType: "personal" });

    const after = computeWriteOperationKey({
      partition,
      sourceType: "chat",
      sourceLocator: "/tmp/p3-session.jsonl",
      contentChecksum,
    });
    expect(after).toBe(before);
    expect(serializePartitionKey(partition).includes("tenant")).toBe(false);
    expect(before.includes("tenant_enterprise")).toBe(false);
  });

  it("denies cross-tenant access and unbound partitions", () => {
    const partition = createMemoryPartitionKeyV1("dp_acl", scope);
    const binding = createMemorySubjectBinding({
      partition,
      scope,
      subject: {
        tenantId: "tenant_a",
        ownerType: "user",
        ownerId: "user_a",
      },
      scopeType: "personal",
    });

    expect(
      authorizeMemoryAccess([binding], {
        partition,
        caller: { tenantId: "tenant_b", ownerType: "user", ownerId: "user_a" },
      }),
    ).toEqual({ allowed: false, reason: "TENANT_MISMATCH" });

    expect(
      authorizeMemoryAccess([binding], {
        partition,
        caller: { tenantId: "tenant_a", ownerType: "user", ownerId: "user_other" },
      }),
    ).toEqual({ allowed: false, reason: "OWNER_MISMATCH" });

    expect(
      authorizeMemoryAccess([binding], {
        partition,
        caller: { tenantId: "tenant_a", ownerType: "user", ownerId: "user_a" },
      }),
    ).toEqual({ allowed: true, bindingId: binding.id });

    expect(
      authorizeMemoryAccess([], {
        partition,
        caller: { tenantId: "tenant_a", ownerType: "user", ownerId: "user_a" },
      }),
    ).toEqual({ allowed: false, reason: "UNBOUND" });
  });

  it("uses local sentinel and blocks enterprise escalation into local bindings", () => {
    expect(resolveMemorySubjectTenantId(null)).toBe(LOCAL_TENANT_SENTINEL);
    expect(resolveMemorySubjectTenantId("  ")).toBe(LOCAL_TENANT_SENTINEL);
    expect(resolveMemorySubjectTenantId("tenant_real")).toBe("tenant_real");

    const partition = createMemoryPartitionKeyV1("dp_local", scope);
    const local = createMemorySubjectBinding({
      partition,
      scope,
      subject: resolveLocalMemorySubject("agent_main", "agent"),
      scopeType: "agent",
    });

    expect(
      authorizeMemoryAccess([local], {
        partition,
        caller: resolveLocalMemorySubject("agent_main", "agent"),
      }),
    ).toEqual({ allowed: true, bindingId: local.id });

    expect(
      authorizeMemoryAccess([local], {
        partition,
        caller: {
          tenantId: "tenant_evil",
          ownerType: "agent",
          ownerId: "agent_main",
        },
      }),
    ).toEqual({ allowed: false, reason: "LOCAL_SENTINEL_VIOLATION" });

    const unbound = markMemorySubjectBindingUnbound(local);
    expect(
      authorizeMemoryAccess([unbound], {
        partition,
        caller: resolveLocalMemorySubject("agent_main", "agent"),
      }),
    ).toEqual({ allowed: false, reason: "UNBOUND" });
  });

  it("persists subject bindings in InMemory and Local metadata stores", async () => {
    const partition = createMemoryPartitionKeyV1("dp_store", scope);
    const binding = createMemorySubjectBinding({
      partition,
      scope,
      subject: {
        tenantId: "tenant_store",
        ownerType: "seat",
        ownerId: "seat_1",
      },
      scopeType: "seat",
    });

    const memory = new InMemoryMetadataStore();
    await memory.saveMemorySubjectBinding!(binding);
    expect(await memory.getMemorySubjectBinding!(binding.id)).toEqual(binding);
    const listed = await memory.listMemorySubjectBindings!({
      tenantId: "tenant_store",
      liveOnly: true,
    });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(binding.id);

    const dir = mkdtempSync(join(tmpdir(), "cw2-p3-subject-"));
    tempDirs.push(dir);
    const path = join(dir, "canonical.sqlite");
    const local = new LocalMetadataStore({
      path,
      backend: "local",
      environment: "local",
    });
    await local.saveMemorySubjectBinding!(binding);
    expect(await local.getMemorySubjectBinding!(binding.id)).toEqual(binding);
    const byPartition = await local.listMemorySubjectBindings!({
      dataPlaneId: partition.dataPlaneId,
      scopeFingerprint: partition.scopeFingerprint,
      liveOnly: true,
    });
    expect(byPartition.map((row) => row.id)).toEqual([binding.id]);

    const rebound = markMemorySubjectBindingUnbound(binding, "2026-07-19T12:00:00.000Z");
    await local.saveMemorySubjectBinding!(rebound);
    expect((await local.listMemorySubjectBindings!({ liveOnly: true })).length).toBe(0);
    expect((await local.listMemorySubjectBindings!()).length).toBe(1);
    local.close();

    const reopened = new LocalMetadataStore({
      path,
      backend: "local",
      environment: "local",
    });
    expect(await reopened.getMemorySubjectBinding!(binding.id)).toEqual(rebound);
    reopened.close();
  });
});
