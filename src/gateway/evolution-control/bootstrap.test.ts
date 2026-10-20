import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tmpDir = path.join(os.tmpdir(), `openbot-evo-boot-${Date.now()}`);
const setControlPlaneIntentRegistrar = vi.fn();
vi.mock("../../utils.js", () => ({ CONFIG_DIR: tmpDir }));
vi.mock("../evolution-governance/control-plane-intent-registration.js", () => ({
  setControlPlaneIntentRegistrar,
}));
vi.mock("./gateway-plane.js", () => ({
  createGatewayEvolutionControlPlane: () => ({
    getProposal: () => undefined,
    registerProposal: vi.fn(),
    listProposals: () => [],
  }),
}));

const {
  ensureEvolutionControlPlaneStarted,
  isEvolutionControlPlaneStarted,
  persistSurfaceSnapshot,
  resetEvolutionControlPlaneForTests,
} = await import("./bootstrap.js");

describe("evolution-control bootstrap", () => {
  beforeEach(() => {
    resetEvolutionControlPlaneForTests();
    fs.mkdirSync(tmpDir, { recursive: true });
  });
  afterEach(() => {
    resetEvolutionControlPlaneForTests();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("constructs the plane once and writes surfaces.json", () => {
    const first = ensureEvolutionControlPlaneStarted();
    const second = ensureEvolutionControlPlaneStarted();
    expect(first).toBe(second);
    expect(setControlPlaneIntentRegistrar).toHaveBeenCalledWith(expect.any(Function));
    expect(isEvolutionControlPlaneStarted()).toBe(true);
    const snapshot = path.join(tmpDir, "evolution-control", "surfaces.json");
    expect(fs.existsSync(snapshot)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(snapshot, "utf8")) as { surfaces: unknown[] };
    expect(parsed.surfaces.length).toBeGreaterThan(0);
  });

  it("persistSurfaceSnapshot can write an explicit persist dir", () => {
    const persistDir = path.join(tmpDir, "explicit");
    const filePath = persistSurfaceSnapshot(persistDir);
    expect(filePath).toBe(path.join(persistDir, "surfaces.json"));
    expect(fs.existsSync(filePath)).toBe(true);
  });
});
