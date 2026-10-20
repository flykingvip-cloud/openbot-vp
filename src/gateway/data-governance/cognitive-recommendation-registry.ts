import fs from "node:fs";
import path from "node:path";
import { TENANT_SEAT_ASSETS_FILE } from "../tenant-store-paths.js";
import type { ActorRef, OwnershipPrincipal } from "./types.js";

/**
 * Read-only occupancy checks against the existing seat/group registries.
 * Missing or unreadable stores fail closed — this is not a second SoT.
 */
export async function actorMayRepresentOwner(params: {
  callerTenantId: string | null;
  actor: ActorRef;
  owner: OwnershipPrincipal;
  stateDir?: string;
}): Promise<boolean> {
  const { actor, owner, callerTenantId } = params;
  if (owner.kind === "user" && actor.kind === "user" && actor.userId === owner.userId) {
    return true;
  }
  if (owner.kind === "position" && actor.kind === "user" && callerTenantId) {
    return actorOccupiesSeat({
      tenantId: callerTenantId,
      seatId: owner.seatId,
      userId: actor.userId,
      stateDir: params.stateDir,
    });
  }
  if (owner.kind === "group" && actor.kind === "user") {
    return actorInGroup({
      groupId: owner.groupId,
      userId: actor.userId,
      stateDir: params.stateDir,
    });
  }
  return false;
}

async function actorOccupiesSeat(params: {
  tenantId: string;
  seatId: string;
  userId: string;
  stateDir?: string;
}): Promise<boolean> {
  const storePath = params.stateDir
    ? path.join(path.resolve(params.stateDir), TENANT_SEAT_ASSETS_FILE)
    : null;
  if (!storePath || !fs.existsSync(storePath)) {
    return false;
  }
  try {
    const { loadEnterpriseSeatAssetsStore, listTenantSeats } =
      await import("../enterprise-seat-assets-store.js");
    const store = await loadEnterpriseSeatAssetsStore(storePath);
    return listTenantSeats(store, params.tenantId).some(
      (seat) => seat.seatId === params.seatId && seat.currentEmployeeId === params.userId,
    );
  } catch {
    return false;
  }
}

async function actorInGroup(params: {
  groupId: string;
  userId: string;
  stateDir?: string;
}): Promise<boolean> {
  if (!params.stateDir) {
    return false;
  }
  const membersPath = path.join(
    path.resolve(params.stateDir),
    "collaboration",
    "groups",
    params.groupId,
    "members.json",
  );
  if (!fs.existsSync(membersPath)) {
    return false;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(membersPath, "utf8")) as {
      members?: Array<{ userId?: string }>;
    };
    return (raw.members ?? []).some((member) => member.userId === params.userId);
  } catch {
    return false;
  }
}
