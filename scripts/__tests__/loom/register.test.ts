import { describe, expect, it } from "vitest";
import { IllegalTransitionError } from "../../loom/lifecycle.js";
import { applyRegister } from "../../loom/register.js";
import { emptyRegistry } from "../../loom/registry.js";

const now = new Date("2026-06-12T00:00:00.000Z");

describe("loom/register — applyRegister", () => {
  it("creates a new task (requires owner)", () => {
    const reg = applyRegister(emptyRegistry(), {
      taskId: "auth",
      owner: "kiro-auth",
      intent: ["backend"],
      paths: ["src/auth/**"],
      now,
    });
    expect(reg.tasks).toHaveLength(1);
    expect(reg.tasks[0]).toMatchObject({
      id: "auth",
      owner: "kiro-auth",
      intent: ["backend"],
      paths: ["src/auth/**"],
      state: "active",
    });
    expect(reg.tasks[0].since).toBe("2026-06-12");
  });

  it("throws when creating a task without an owner", () => {
    expect(() => applyRegister(emptyRegistry(), { taskId: "x" })).toThrow(/without --owner/);
  });

  // R2.2: `issue` is the intent → code → release join key.
  it("binds an issue on create", () => {
    const reg = applyRegister(emptyRegistry(), {
      taskId: "234-enterprise-plan",
      owner: "cursor-agent",
      issue: 234,
      now,
    });
    expect(reg.tasks[0].issue).toBe(234);
  });

  it("binds an issue on update when the task had none", () => {
    const base = applyRegister(emptyRegistry(), { taskId: "auth", owner: "kiro-auth", now });
    expect(base.tasks[0].issue).toBeUndefined();
    const bound = applyRegister(base, { taskId: "auth", issue: 77, now });
    expect(bound.tasks[0].issue).toBe(77);
  });

  it("is idempotent when re-binding the same issue", () => {
    const base = applyRegister(emptyRegistry(), {
      taskId: "auth",
      owner: "kiro-auth",
      issue: 77,
      now,
    });
    expect(applyRegister(base, { taskId: "auth", issue: 77, now }).tasks[0].issue).toBe(77);
  });

  // Silently re-pointing a task at another issue would rewrite the traceability of
  // every commit already made under it, so this is refused rather than merged.
  it("refuses to rebind an already-bound task to a different issue", () => {
    const base = applyRegister(emptyRegistry(), {
      taskId: "auth",
      owner: "kiro-auth",
      issue: 77,
      now,
    });
    expect(() => applyRegister(base, { taskId: "auth", issue: 88, now })).toThrow(
      /already bound to issue #77/,
    );
    expect(base.tasks[0].issue).toBe(77);
  });

  it("leaves an existing binding untouched when no issue is passed", () => {
    const base = applyRegister(emptyRegistry(), {
      taskId: "auth",
      owner: "kiro-auth",
      issue: 77,
      now,
    });
    const updated = applyRegister(base, { taskId: "auth", paths: ["src/auth/**"], now });
    expect(updated.tasks[0].issue).toBe(77);
  });

  it("merges paths/intent additively on update", () => {
    const base = applyRegister(emptyRegistry(), {
      taskId: "auth",
      owner: "kiro-auth",
      paths: ["src/auth/**"],
      now,
    });
    const updated = applyRegister(base, {
      taskId: "auth",
      paths: ["src/session/**", "src/auth/**"],
      now,
    });
    expect(updated.tasks[0].paths).toEqual(["src/auth/**", "src/session/**"]);
  });

  it("validates state transitions through the lifecycle machine", () => {
    const base = applyRegister(emptyRegistry(), {
      taskId: "auth",
      owner: "k",
      state: "ready",
      now,
    });
    const landed = applyRegister(base, { taskId: "auth", state: "landed", now });
    expect(landed.tasks[0].state).toBe("landed");
    expect(() => applyRegister(landed, { taskId: "auth", state: "active", now })).toThrow(
      IllegalTransitionError,
    );
  });

  it("upserts a session and stamps lastSignalAt (closes the dead loop)", () => {
    const reg = applyRegister(emptyRegistry(), {
      taskId: "auth",
      owner: "k",
      session: { id: "s1", ide: "cursor", agent: "a" },
      now,
    });
    expect(reg.tasks[0].sessions).toHaveLength(1);
    expect(reg.tasks[0].sessions[0].lastSignalAt).toBe(now.toISOString());

    const later = new Date("2026-06-13T00:00:00.000Z");
    const reg2 = applyRegister(reg, {
      taskId: "auth",
      session: { id: "s1", ide: "cursor", agent: "a", status: "idle" },
      now: later,
    });
    expect(reg2.tasks[0].sessions).toHaveLength(1);
    expect(reg2.tasks[0].sessions[0].status).toBe("idle");
    expect(reg2.tasks[0].sessions[0].lastSignalAt).toBe(later.toISOString());
  });

  it("refreshes ALL session signals on a paths-only write (accept is a signal)", () => {
    const base = applyRegister(emptyRegistry(), {
      taskId: "auth",
      owner: "k",
      session: { id: "s1", ide: "cursor", agent: "a" },
      now,
    });
    // accept-style update: only paths, no session/state change.
    const later = new Date("2026-06-14T00:00:00.000Z");
    const accepted = applyRegister(base, { taskId: "auth", paths: ["src/auth/**"], now: later });
    expect(accepted.tasks[0].sessions[0].lastSignalAt).toBe(later.toISOString());
  });

  it("records the outgoing owner in ownerHistory on takeover (accountability)", () => {
    const base = applyRegister(emptyRegistry(), {
      taskId: "auth",
      owner: "cursor-fable",
      now,
    });
    expect(base.tasks[0].ownerHistory).toEqual([]);

    const later = new Date("2026-06-13T00:00:00.000Z");
    const taken = applyRegister(base, {
      taskId: "auth",
      owner: "kiro-daibai",
      via: "verified",
      now: later,
    });
    // owner stays single-valued = current accountable executor
    expect(taken.tasks[0].owner).toBe("kiro-daibai");
    // the full transfer is preserved with from/to/when/how for 追责
    expect(taken.tasks[0].ownerHistory).toEqual([
      {
        fromOwner: "cursor-fable",
        toOwner: "kiro-daibai",
        at: later.toISOString(),
        via: "verified",
      },
    ]);
  });

  it("defaults takeover authorization to confirmed and chains multiple handoffs", () => {
    const t0 = applyRegister(emptyRegistry(), { taskId: "auth", owner: "a", now });
    const t1 = applyRegister(t0, { taskId: "auth", owner: "b", now });
    const t2 = applyRegister(t1, { taskId: "auth", owner: "c", via: "verified", now });
    expect(t2.tasks[0].owner).toBe("c");
    // full chain reconstructable: a → b → c
    expect(t2.tasks[0].ownerHistory.map((h) => [h.fromOwner, h.toOwner])).toEqual([
      ["a", "b"],
      ["b", "c"],
    ]);
    expect(t2.tasks[0].ownerHistory[0].via).toBe("confirmed"); // default
    expect(t2.tasks[0].ownerHistory[1].via).toBe("verified");
  });

  it("does not append ownerHistory when owner is unchanged", () => {
    const base = applyRegister(emptyRegistry(), { taskId: "auth", owner: "a", now });
    const same = applyRegister(base, { taskId: "auth", owner: "a", paths: ["x/**"], now });
    expect(same.tasks[0].ownerHistory).toEqual([]);
  });

  it("merges session metadata on update instead of clobbering it", () => {
    const base = applyRegister(emptyRegistry(), {
      taskId: "auth",
      owner: "k",
      session: { id: "s1", ide: "cursor", agent: "a", metadata: { branch: "feat/x" } },
      now,
    });
    expect(base.tasks[0].sessions[0].metadata).toEqual({ branch: "feat/x" });

    // A later signal that carries new metadata must preserve the prior keys.
    const later = new Date("2026-06-13T00:00:00.000Z");
    const updated = applyRegister(base, {
      taskId: "auth",
      session: { id: "s1", ide: "cursor", agent: "a", metadata: { provisionId: "p1" } },
      now: later,
    });
    expect(updated.tasks[0].sessions[0].metadata).toEqual({ branch: "feat/x", provisionId: "p1" });
  });
});
