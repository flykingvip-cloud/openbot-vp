import fs from "node:fs";
import path from "node:path";
import { setControlPlaneIntentRegistrar } from "../evolution-governance/control-plane-intent-registration.js";
import { ensureCapabilityGapSystemGrant } from "./capability-gap-grant.js";
import type { EvolutionControlPlane } from "./control-plane.js";
import {
  getSharedDiagnosisDelegationMachine,
  resetSharedDiagnosisDelegationForTests,
} from "./delegation-service.js";
import { hydrateDiagnosisM1Receipts } from "./diagnosis-m1-status.js";
import { createGatewayEvolutionControlPlane } from "./gateway-plane.js";
import { resetEvolutionObservationIndexForTests } from "./observation-audit.js";
import { resolveEvolutionControlRoot } from "./persistent-store.js";
import { createShadowIntentProposalRegistrar } from "./shadow-intent-proposal.js";
import { listRegisteredEvolutionSurfaces } from "./surface-registry.js";

let started = false;
let defaultPlane: EvolutionControlPlane | undefined;

/** Idempotent production registration: construct the plane and persist the surface snapshot. */
export function ensureEvolutionControlPlaneStarted(): EvolutionControlPlane {
  if (defaultPlane) {
    started = true;
    return defaultPlane;
  }
  defaultPlane = createGatewayEvolutionControlPlane();
  setControlPlaneIntentRegistrar(createShadowIntentProposalRegistrar(defaultPlane));
  started = true;
  try {
    // Idempotent system grant for capability-gap suggest+expire (platform scope).
    // Per-tenant grants are ensured on ingest when a tenant-scoped gap is recorded.
    ensureCapabilityGapSystemGrant({
      machine: getSharedDiagnosisDelegationMachine(),
      tenantId: null,
    });
  } catch {
    // Grant registration is best-effort at bootstrap; ingest will retry per tenant.
  }
  try {
    hydrateDiagnosisM1Receipts(resolveEvolutionControlRoot());
  } catch {
    // Receipt hydrate is best-effort; missing/corrupt store fails closed on later reads.
  }
  try {
    persistSurfaceSnapshot();
  } catch {
    // persist is best-effort; plane is still usable in memory
  }
  return defaultPlane;
}

export function getDefaultEvolutionControlPlane(): EvolutionControlPlane | undefined {
  return defaultPlane;
}

export function persistSurfaceSnapshot(persistDir?: string): string {
  const root = resolveEvolutionControlRoot(persistDir);
  fs.mkdirSync(root, { recursive: true });
  const filePath = path.join(root, "surfaces.json");
  fs.writeFileSync(
    filePath,
    `${JSON.stringify({ surfaces: listRegisteredEvolutionSurfaces() }, null, 2)}\n`,
    "utf8",
  );
  return filePath;
}

export function resetEvolutionControlPlaneForTests(): void {
  started = false;
  defaultPlane = undefined;
  setControlPlaneIntentRegistrar();
  resetSharedDiagnosisDelegationForTests();
  resetEvolutionObservationIndexForTests();
}

export function isEvolutionControlPlaneStarted(): boolean {
  return started;
}
