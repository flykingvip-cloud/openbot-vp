/**
 * Tip B matrix:
 *  - accept + business write → denied
 *  - accept + AcceptanceStep via ValidatorPort → allowed
 *  - implement mode unaffected
 *  - flag/lane disabled → zero behavior change
 *  - accept + git push / gh pr merge via exec → denied
 *  - merge mode + raw gh pr merge → denied (Tip C; use lane.requestMerge)
 *  - accept + lane.seal / supervisor.task.get → allowed
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isDeliveryLaneEnabled } from "./feature.js";
import {
  argvMatchesDeniedMerge,
  evaluateLaneModeToolPolicy,
  isLaneModeMutexActive,
  laneModeDenyToolPolicy,
} from "./mode-policy.js";
import { attachLane, setLaneMode } from "./service.js";

describe("Tip B mode-policy matrix", () => {
  it("flag default OFF → zero behavior change (feature helper)", () => {
    expect(isDeliveryLaneEnabled({}, () => false)).toBe(false);
  });

  it("deliveryLaneEnabled=false → always allow even for accept + write", () => {
    const d = evaluateLaneModeToolPolicy({
      mode: "accept",
      toolName: "write",
      deliveryLaneEnabled: false,
    });
    expect(d.allowed).toBe(true);
    expect(d.reason).toBe("delivery_lane_disabled");
  });

  it("no mode → allow", () => {
    expect(
      evaluateLaneModeToolPolicy({ mode: null, toolName: "write", deliveryLaneEnabled: true })
        .allowed,
    ).toBe(true);
  });

  it("implement mode unaffected (write still allowed by Tip B)", () => {
    const d = evaluateLaneModeToolPolicy({
      mode: "implement",
      toolName: "write",
      deliveryLaneEnabled: true,
    });
    expect(d.allowed).toBe(true);
    expect(isLaneModeMutexActive("implement")).toBe(false);
    expect(laneModeDenyToolPolicy("implement").deny).toEqual([]);
  });

  it("merge mode is not Tip B mutex; Tip C denies raw merge argv (use lane.requestMerge)", () => {
    // Tip B: merge is not accept|review mutex. Tip C closes raw merge argv.
    expect(isLaneModeMutexActive("merge")).toBe(false);
    const d = evaluateLaneModeToolPolicy({
      mode: "merge",
      toolName: "exec",
      argv: ["git", "push", "origin", "HEAD"],
      deliveryLaneEnabled: true,
    });
    expect(d.allowed).toBe(false);
    expect(!d.allowed && d.reason).toMatch(/requestMerge|raw_merge/);
  });

  it("accept + business write → denied", () => {
    for (const tool of ["write", "edit", "apply_patch", "apply-patch"]) {
      const d = evaluateLaneModeToolPolicy({
        mode: "accept",
        toolName: tool,
        deliveryLaneEnabled: true,
      });
      expect(d.allowed).toBe(false);
      expect(!d.allowed && d.reason).toMatch(/denies_write_tool/);
    }
    expect(laneModeDenyToolPolicy("accept").deny).toEqual(
      expect.arrayContaining(["write", "edit", "apply_patch"]),
    );
  });

  it("review + business write → denied", () => {
    const d = evaluateLaneModeToolPolicy({
      mode: "review",
      toolName: "edit",
      deliveryLaneEnabled: true,
    });
    expect(d.allowed).toBe(false);
  });

  it("accept + AcceptanceStep via ValidatorPort → still allowed", () => {
    const d = evaluateLaneModeToolPolicy({
      mode: "accept",
      toolName: "exec",
      argv: ["npm", "test"],
      channel: "validator-port",
      deliveryLaneEnabled: true,
    });
    expect(d.allowed).toBe(true);
    expect(d.reason).toBe("validator_port_acceptance_step");
  });

  it("accept + git push / git merge / gh pr merge via exec → denied", () => {
    const cases: Array<{ argv: string[] }> = [
      { argv: ["git", "push", "origin", "main"] },
      { argv: ["/usr/bin/git", "merge", "feature"] },
      { argv: ["gh", "pr", "merge", "123"] },
    ];
    for (const { argv } of cases) {
      expect(argvMatchesDeniedMerge(argv)).toBe(true);
      const d = evaluateLaneModeToolPolicy({
        mode: "accept",
        toolName: "exec",
        argv,
        deliveryLaneEnabled: true,
      });
      expect(d.allowed).toBe(false);
      expect(!d.allowed && d.reason).toBe("lane_mode_accept_denies_merge_argv");
    }
  });

  it("accept + readonly / lane.seal / supervisor.task.get → allowed", () => {
    expect(
      evaluateLaneModeToolPolicy({
        mode: "accept",
        toolName: "read",
        deliveryLaneEnabled: true,
      }).allowed,
    ).toBe(true);
    expect(
      evaluateLaneModeToolPolicy({
        mode: "accept",
        toolName: "lane.seal",
        channel: "lane-api",
        deliveryLaneEnabled: true,
      }).allowed,
    ).toBe(true);
    expect(
      evaluateLaneModeToolPolicy({
        mode: "accept",
        toolName: "lane.focus",
        deliveryLaneEnabled: true,
      }).allowed,
    ).toBe(true);
    expect(
      evaluateLaneModeToolPolicy({
        mode: "accept",
        toolName: "supervisor.task.get",
        channel: "supervisor-read",
        deliveryLaneEnabled: true,
      }).allowed,
    ).toBe(true);
    expect(
      evaluateLaneModeToolPolicy({
        mode: "accept",
        toolName: "supervisor.task.list",
        deliveryLaneEnabled: true,
      }).allowed,
    ).toBe(true);
  });
});

describe("Tip B setLaneMode", () => {
  let laneDir: string;

  beforeEach(() => {
    laneDir = mkdtempSync(path.join(tmpdir(), "dl-mode-"));
  });

  afterEach(() => {
    rmSync(laneDir, { recursive: true, force: true });
  });

  it("setLaneMode(accept) then write denied by policy; implement unaffected", async () => {
    const { lane } = await attachLane({
      templateId: "default",
      agentId: "bot-a",
      storeDir: laneDir,
    });
    expect(lane.mode).toBe("implement");

    const after = await setLaneMode({
      laneId: lane.laneId,
      mode: "accept",
      storeDir: laneDir,
    });
    expect(after.lane.mode).toBe("accept");

    expect(
      evaluateLaneModeToolPolicy({
        mode: after.lane.mode,
        toolName: "write",
        deliveryLaneEnabled: true,
      }).allowed,
    ).toBe(false);

    const back = await setLaneMode({
      laneId: lane.laneId,
      mode: "implement",
      storeDir: laneDir,
    });
    expect(
      evaluateLaneModeToolPolicy({
        mode: back.lane.mode,
        toolName: "write",
        deliveryLaneEnabled: true,
      }).allowed,
    ).toBe(true);
  });
});
