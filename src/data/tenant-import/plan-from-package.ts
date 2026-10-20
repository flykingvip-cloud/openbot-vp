import fs from "node:fs/promises";
import JSZip from "jszip";
import { buildIdRemapPlan, type IdRemapPlan } from "./id-remap.js";
import { TENANT_IMPORT_MANIFEST_NAME, type TenantImportManifest } from "./manifest.js";

/**
 * Derive an {@link IdRemapPlan} from a tenant-import package (SaaS §10 / K-07 "从包内解析源 id 建 plan").
 *
 * Sources of source ids:
 *  - users: manifest `contents.userDataSpaces`; emails parsed from `control-plane/platform-auth-slice.json`
 *    when present, enabling OQ-3 merge-by-email.
 *  - agents: distinct `agents/<id>` segments under each `users/<uid>/OpenBot/`.
 *  - seats: `seatId`s parsed from `control-plane/seat-assets.json` when present.
 *
 * The caller supplies the target tenant's `existingUsersByEmail` / `existingAgentIds` (read from the
 * live tenant stores) so the plan can merge users and resolve agent-id collisions. Extraction is
 * best-effort and defensive: an absent/malformed slice simply yields fewer source ids (uuid-keyed
 * ids like seats stay stable, which is safe for a fresh tenant).
 */

export type BuildPlanFromPackageOptions = {
  targetTenantId: string;
  existingUsersByEmail?: Record<string, string>;
  existingAgentIds?: string[];
  newId?: () => string;
};

function collectSeatIds(raw: unknown): string[] {
  const out: string[] = [];
  const seats = (raw as { seats?: unknown } | null)?.seats;
  const entries = Array.isArray(seats)
    ? seats
    : seats && typeof seats === "object"
      ? Object.values(seats)
      : [];
  for (const entry of entries) {
    const seatId = (entry as { seatId?: unknown } | null)?.seatId;
    if (typeof seatId === "string" && seatId.trim()) {
      out.push(seatId.trim());
    }
  }
  return out;
}

function collectUserEmails(raw: unknown): Record<string, string> {
  const map: Record<string, string> = {};
  const users = (raw as { users?: unknown } | null)?.users;
  const entries = Array.isArray(users)
    ? users
    : users && typeof users === "object"
      ? Object.values(users)
      : [];
  for (const entry of entries) {
    const id = (entry as { id?: unknown } | null)?.id;
    const email = (entry as { email?: unknown } | null)?.email;
    if (typeof id === "string" && id.trim() && typeof email === "string" && email.trim()) {
      map[id.trim()] = email.trim();
    }
  }
  return map;
}

async function parseJsonEntry(zip: JSZip, name: string): Promise<unknown> {
  const entry = zip.file(name);
  if (!entry) {
    return null;
  }
  try {
    return JSON.parse(await entry.async("string"));
  } catch {
    return null;
  }
}

export async function buildRemapPlanFromPackage(
  params: { buffer?: Buffer; archivePath?: string } & BuildPlanFromPackageOptions,
): Promise<IdRemapPlan> {
  const buffer = params.buffer ?? (await fs.readFile(params.archivePath ?? ""));
  const zip = await JSZip.loadAsync(buffer);

  // Users + emails.
  const manifestRaw = (await parseJsonEntry(
    zip,
    TENANT_IMPORT_MANIFEST_NAME,
  )) as TenantImportManifest | null;
  const sourceUserIds = Array.isArray(manifestRaw?.contents?.userDataSpaces)
    ? manifestRaw.contents.userDataSpaces.filter((u): u is string => typeof u === "string")
    : [];
  const emailById = collectUserEmails(
    await parseJsonEntry(zip, "control-plane/platform-auth-slice.json"),
  );

  // Agents: distinct `agents/<id>` under each user data space.
  const agentIds = new Set<string>();
  for (const name of Object.keys(zip.files)) {
    const match = /^users\/[^/]+\/OpenBot\/agents\/([^/]+)\//.exec(name.replace(/\\/g, "/"));
    if (match?.[1]) {
      agentIds.add(match[1]);
    }
  }

  // Seats (best-effort from the seat-assets slice).
  const seatIds = collectSeatIds(await parseJsonEntry(zip, "control-plane/seat-assets.json"));

  return buildIdRemapPlan({
    targetTenantId: params.targetTenantId,
    users: sourceUserIds.map((id) => ({ sourceUserId: id, email: emailById[id] })),
    agentIds: [...agentIds],
    seatIds,
    existingUsersByEmail: params.existingUsersByEmail,
    existingAgentIds: params.existingAgentIds,
    newId: params.newId,
  });
}
