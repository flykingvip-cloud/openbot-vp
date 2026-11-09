/**
 * Package5: misleading recovery/completion aliases retired.
 * New main chain owns arm + confirmPending; old names must not reappear as control.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import * as statePublic from "../index.js";
import * as recovery from "./async-wait-job-recovery.js";

it("public state API no longer exports woke/deliver-named recovery aliases", () => {
  expect("claimAsyncWaitJobIntent" in statePublic).toBe(false);
  expect("deliverRecoveredAsyncWaitCompletion" in statePublic).toBe(false);
  expect(typeof statePublic.armAsyncWaitRecoveryContinuation).toBe("function");
  expect(typeof statePublic.recoverAsyncWaitJobsAtGatewayBoot).toBe("function");
});

it("recovery module sole arm entry is armAsyncWaitRecoveryContinuation", () => {
  expect("claimAsyncWaitJobIntent" in recovery).toBe(false);
  expect("deliverRecoveredAsyncWaitCompletion" in recovery).toBe(false);
  expect(typeof recovery.armAsyncWaitRecoveryContinuation).toBe("function");
});

it("source keeps archive pointer and drops deprecated function bodies", () => {
  const srcPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "async-wait-job-recovery.ts",
  );
  const src = fs.readFileSync(srcPath, "utf8");
  expect(src).toMatch(/Retired Package5 aliases/);
  expect(src).not.toMatch(/outcome: "woke"/);
  expect(src).not.toMatch(/export function claimAsyncWaitJobIntent/);
  expect(src).not.toMatch(/export function deliverRecoveredAsyncWaitCompletion/);
});
