import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BROWSER_PLAN_ONCE_PHASE_GATES,
  resolvePlanOncePhaseGates,
  resetPlanOncePhaseProviderForTests,
  setPlanOncePhaseProvider,
} from "./browser-plan-once-phase-gates.js";
import { evaluatePlanOnceWireGate, runPlanOnceViaBrowser } from "./browser-plan-once-wire.js";
import type { PlanOnceBrowserPort } from "./browser-plan-once-wire.js";

afterEach(() => {
  resetPlanOncePhaseProviderForTests();
});

describe("resolvePlanOncePhaseGates", () => {
  it("auto-injects from provider when tool args omit phases", () => {
    setPlanOncePhaseProvider(() => ({
      sessionPhase: "INTERACTIVE",
      ownershipPhase: "BACKGROUND_AGENT",
    }));
    const resolved = resolvePlanOncePhaseGates({
      explicit: {},
      requirePhases: true,
    });
    expect(resolved.sessionPhase).toBe("INTERACTIVE");
    expect(resolved.ownershipPhase).toBe("BACKGROUND_AGENT");
    expect(resolved.injected).toBe(true);
    expect(resolved.missingRequired).toBe(false);
    expect(resolved.source).toBe("provider");
    expect(resolved.omittedBeforeInject).toBe(true);
  });

  it("prefers explicit args over provider", () => {
    setPlanOncePhaseProvider(() => ({
      sessionPhase: "FIRST_FRAME",
      ownershipPhase: "HUMAN_TAKEOVER",
    }));
    const resolved = resolvePlanOncePhaseGates({
      explicit: {
        sessionPhase: "INTERACTIVE",
        ownershipPhase: "INTERACTIVE",
      },
      requirePhases: true,
    });
    expect(resolved.sessionPhase).toBe("INTERACTIVE");
    expect(resolved.ownershipPhase).toBe("INTERACTIVE");
    expect(resolved.injected).toBe(false);
    expect(resolved.source).toBe("explicit");
  });

  it("marks missingRequired + reason when production requirePhases and still omitted", () => {
    const resolved = resolvePlanOncePhaseGates({
      explicit: { sessionPhase: "INTERACTIVE" },
      requirePhases: true,
    });
    expect(resolved.missingRequired).toBe(true);
    expect(resolved.missingReason).toMatch(/ownershipPhase/);
    expect(BROWSER_PLAN_ONCE_PHASE_GATES).toBe("BROWSER_PLAN_ONCE_PHASE_GATES");
  });

  it("allowMissingPhaseGates never sets missingRequired", () => {
    const resolved = resolvePlanOncePhaseGates({
      explicit: {},
      requirePhases: true,
      allowMissingPhaseGates: true,
    });
    expect(resolved.missingRequired).toBe(false);
  });
});

describe("evaluatePlanOnceWireGate requirePhases", () => {
  it("allows omit when requirePhases false (unit / inject-deps)", () => {
    expect(evaluatePlanOnceWireGate()).toEqual({ ok: true });
  });

  it("blocks omit when requirePhases true", () => {
    expect(evaluatePlanOnceWireGate({ requirePhases: true })).toMatchObject({
      ok: false,
      status: "BLOCKED",
    });
    expect(
      evaluatePlanOnceWireGate({
        sessionPhase: "INTERACTIVE",
        requirePhases: true,
      }),
    ).toMatchObject({ ok: false, reason: expect.stringMatching(/ownershipPhase/) });
  });

  it("allows INTERACTIVE + ownership when requirePhases true", () => {
    expect(
      evaluatePlanOnceWireGate({
        sessionPhase: "INTERACTIVE",
        ownershipPhase: "BACKGROUND_AGENT",
        requirePhases: true,
      }),
    ).toEqual({ ok: true });
  });
});

describe("runPlanOnceViaBrowser production requirePhases", () => {
  function mockPort(): PlanOnceBrowserPort {
    return {
      snapshot: vi.fn(async () => ({
        format: "aria" as const,
        url: "https://shop.example",
        nodes: [{ ref: "e1", role: "button", name: "加入购物车" }],
      })),
      act: vi.fn(async () => ({ ok: true })),
    };
  }

  it("BLOCKED when requirePhases and phases omitted (no silent allow)", async () => {
    const port = mockPort();
    const result = await runPlanOnceViaBrowser(
      { steps: [{ action: "click", target: "加入购物车" }] },
      port,
      { requirePhases: true, settleWaitOnly: true },
    );
    expect(result.status).toBe("BLOCKED");
    expect(result.progress.cheapDisambiguationsUsed).toBe(0);
    expect(result.reason).toMatch(/sessionPhase|ownershipPhase|production plan_once/);
    expect(result.phaseGatesLanding).toBe(BROWSER_PLAN_ONCE_PHASE_GATES);
    expect(result.chatFinalAllowed).toBe(false);
    expect(port.act).not.toHaveBeenCalled();
  });

  it("injects via provider then runs", async () => {
    setPlanOncePhaseProvider(() => ({
      sessionPhase: "INTERACTIVE",
      ownershipPhase: "BACKGROUND_AGENT",
    }));
    const port = mockPort();
    const result = await runPlanOnceViaBrowser(
      {
        finishes_task: true,
        steps: [{ action: "click", target: "加入购物车" }],
      },
      port,
      {
        requirePhases: true,
        settleWaitOnly: true,
        settleOverrides: { quiet_ms: 0, settle_timeout_ms: 1 },
      },
    );
    expect(result.status).not.toBe("BLOCKED");
    expect(port.snapshot).toHaveBeenCalled();
  });

  it("wires observeForModel companion when secret_inputs present", async () => {
    const port = mockPort();
    // Full path with phases so we reach deps creation
    const { createPlanOnceDepsFromBrowser } = await import("./browser-plan-once-wire.js");
    const deps = createPlanOnceDepsFromBrowser(port, {
      modelObservePlan: { secret_inputs: ["验证码"], allowed_risks: [] },
    });
    expect(deps.observeForModel).toBeTypeOf("function");
    // Port nodes have no secret values; still returns a snapshot
    const prepared = await deps.observeForModel!();
    expect(prepared.elements.length).toBeGreaterThan(0);
  });
});
