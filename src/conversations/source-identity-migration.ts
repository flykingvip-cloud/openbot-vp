/**
 * Migrate legacy openbotPath / ingestion provenance → MemorySourceIdentity + locator aliases.
 * Canonical CW store uses ingestions/events/atoms/evidence/journals (no SourceBinding table);
 * callers synthesize initial bindings from those rows (plan §14.3 / T1).
 * Idempotent; does not re-ingest atoms or increase source counts (CL-P0-04).
 */
import { createHash } from "node:crypto";
import type { OpenBotConfig } from "../config/config.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import type { ConversationCatalogRepository } from "./catalog/repository.js";
import { buildMemorySourceIdentity, computeMemorySourceIdentityId } from "./ids.js";
import type { MemorySourceLocatorAlias } from "./types.js";

const log = createSubsystemLogger("conversations/source-identity-migrate");

export type LegacySourceBindingRow = {
  id: string;
  dataPlaneId: string;
  sourceLocator: string;
  sourceChecksum: string;
  status: string;
  /** Optional session metadata from binding payload. */
  sessionId?: string;
  sessionKey?: string;
  conversationId?: string;
  bindingId?: string;
};

export type SourceIdentityMigrationResult = {
  examined: number;
  migrated: number;
  skipped: number;
  failed: number;
  errors: string[];
};

/**
 * Derive conversation/binding/session from openbotPath / session key heuristics.
 */
export function parseLegacyLocator(locator: string): {
  sessionId: string | null;
  sessionKey: string | null;
  looksLikePath: boolean;
} {
  const normalized = locator.trim().split("\\").join("/");
  const looksLikePath = normalized.includes("/") || normalized.endsWith(".jsonl");
  let sessionId: string | null = null;
  const base = normalized.split("/").pop() ?? normalized;
  const withoutExt = base.replace(/\.jsonl$/i, "");
  if (/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(withoutExt) && !withoutExt.includes(":")) {
    sessionId = withoutExt;
  }
  const sessionKey = normalized.includes("agent:") ? normalized : null;
  return { sessionId, sessionKey, looksLikePath };
}

export function planSourceIdentityMigration(params: {
  dataPlaneId: string;
  legacy: LegacySourceBindingRow;
  conversationId: string;
  bindingId: string;
  sessionId: string;
  firstTurnId?: string;
  lastTurnId?: string;
}): {
  sourceIdentityId: string;
  alias: MemorySourceLocatorAlias;
  identity: ReturnType<typeof buildMemorySourceIdentity>;
} {
  const firstTurnId = params.firstTurnId ?? "0";
  const lastTurnId = params.lastTurnId ?? "0";
  const identity = buildMemorySourceIdentity({
    dataPlaneId: params.dataPlaneId,
    conversationId: params.conversationId,
    bindingId: params.bindingId,
    sessionId: params.sessionId,
    firstTurnId,
    lastTurnId,
  });
  const alias: MemorySourceLocatorAlias = {
    sourceIdentityId: identity.sourceIdentityId,
    storageTier: "HOT",
    locator: params.legacy.sourceLocator.split("\\").join("/"),
    checksum:
      params.legacy.sourceChecksum ||
      createHash("sha256").update(params.legacy.sourceLocator).digest("hex"),
    active: params.legacy.status === "active",
    createdAt: new Date().toISOString(),
    retiredAt: null,
  };
  return { sourceIdentityId: identity.sourceIdentityId, alias, identity };
}

/**
 * Migrate a batch of legacy locators into Catalog source identity + aliases.
 * Does not mutate CogniWeave atom counts — only Catalog metadata + optional
 * side-table of identity id for future dual-read.
 */
export async function migrateLegacySourceBindings(params: {
  catalog: ConversationCatalogRepository;
  dataPlaneId: string;
  rows: LegacySourceBindingRow[];
  /** Resolve conversation/binding/session for a legacy row. */
  resolveContext: (row: LegacySourceBindingRow) => Promise<{
    conversationId: string;
    bindingId: string;
    sessionId: string;
  } | null>;
}): Promise<SourceIdentityMigrationResult> {
  let migrated = 0;
  let skipped = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const row of params.rows) {
    try {
      const parsed = parseLegacyLocator(row.sourceLocator);
      if (!parsed.looksLikePath && !parsed.sessionId) {
        // Already identity-like?
        if (row.sourceLocator.startsWith("msrc_") || row.sourceLocator.startsWith("msrc-")) {
          skipped += 1;
          continue;
        }
      }
      const ctx = await params.resolveContext(row);
      if (!ctx) {
        skipped += 1;
        continue;
      }
      const plan = planSourceIdentityMigration({
        dataPlaneId: params.dataPlaneId,
        legacy: row,
        conversationId: ctx.conversationId,
        bindingId: ctx.bindingId,
        sessionId: ctx.sessionId,
      });
      const existing = await params.catalog.getSourceIdentity(
        params.dataPlaneId,
        plan.sourceIdentityId,
      );
      if (!existing) {
        await params.catalog.saveSourceIdentity(plan.identity);
      }
      await params.catalog.saveLocatorAlias(params.dataPlaneId, plan.alias);
      migrated += 1;
    } catch (err) {
      failed += 1;
      errors.push(`${row.id}:${err instanceof Error ? err.message : String(err)}`.slice(0, 200));
    }
  }

  log.info(
    `source identity migration examined=${params.rows.length} migrated=${migrated} skipped=${skipped} failed=${failed}`,
  );
  return {
    examined: params.rows.length,
    migrated,
    skipped,
    failed,
    errors,
  };
}

/**
 * Load legacy source bindings from CogniWeave metadata store when available.
 */
export async function loadLegacySourceBindingsFromCogniWeave(params: {
  cfg: OpenBotConfig;
  agentId: string;
}): Promise<LegacySourceBindingRow[]> {
  try {
    const { getMemorySearchManager } = await import("../memory/search-manager.js");
    const { manager } = await getMemorySearchManager({
      cfg: params.cfg,
      agentId: params.agentId,
    });
    if (!manager) {
      return [];
    }
    // Access metadata via private runtime if listSourceBindings available on store
    const anyMgr = manager as unknown as {
      defaultScope?: unknown;
      getOrCreateScopeState?: (scope: unknown) => {
        runtime: {
          engine: {
            // not public
          };
        };
        // LocalMetadataStore surface
      };
      metadataStorePath?: string;
    };
    // Use in-memory list via reflection of EMBEDDED - simpler: read from manager's known API
    // CogniWeaveMemoryManager doesn't expose list — use LocalMetadataStore reopen
    const storePath = anyMgr.metadataStorePath;
    if (!storePath) {
      return [];
    }
    const { LocalMetadataStore } =
      await import("../../packages/cogniweave-sdk/src/adapters/local-metadata.js");
    const store = new LocalMetadataStore({
      path: storePath,
      backend: "sqlite",
      environment: "local",
    } as ConstructorParameters<typeof LocalMetadataStore>[0]);
    const bindings = (await store.listSourceBindings?.()) ?? [];
    const dataPlaneId = (await store.ensureDataPlaneId?.()) ?? "";
    const rows: LegacySourceBindingRow[] = bindings.map((b) => ({
      id: b.id,
      dataPlaneId,
      sourceLocator: b.sourceLocator,
      sourceChecksum: createHash("sha256").update(b.sourceLocator).digest("hex"),
      status: b.status,
    }));
    // LocalMetadataStore may not have close — ignore
    try {
      (store as { close?: () => void }).close?.();
    } catch {
      // ignore
    }
    return rows;
  } catch (err) {
    log.warn(`load legacy source bindings failed: ${String(err)}`);
    return [];
  }
}

/**
 * Full migration run: load CW bindings + map via catalog session bindings.
 */
export async function runOpenbotPathSourceIdentityMigration(params: {
  catalog: ConversationCatalogRepository;
  cfg: OpenBotConfig;
  dataPlaneId: string;
  agentId?: string;
}): Promise<SourceIdentityMigrationResult> {
  // Prefer provenance synthesis (ingestions/evidence/journals) when SourceBinding is empty.
  const provenance = await runProvenanceSourceIdentityMigration(params);
  if (provenance.examined > 0) {
    return provenance;
  }
  const rows = await loadLegacySourceBindingsFromCogniWeave({
    cfg: params.cfg,
    agentId: params.agentId ?? "main",
  });
  return migrateLegacySourceBindings({
    catalog: params.catalog,
    dataPlaneId: params.dataPlaneId,
    rows,
    resolveContext: async (row) => {
      const parsed = parseLegacyLocator(row.sourceLocator);
      if (parsed.sessionId) {
        const binding = await params.catalog.findBindingBySessionId(
          params.dataPlaneId,
          parsed.sessionId,
        );
        if (binding) {
          return {
            conversationId: binding.conversationId,
            bindingId: binding.bindingId,
            sessionId: binding.sessionId,
          };
        }
      }
      // Fallback: stable synthetic conversation key from locator hash
      const digest = createHash("sha256").update(row.sourceLocator).digest("hex").slice(0, 16);
      return {
        conversationId: `conv_legacy_${digest}`,
        bindingId: `cbind_legacy_${digest}`,
        sessionId: parsed.sessionId ?? `sess_legacy_${digest}`,
      };
    },
  });
}

/**
 * Synthesize LegacySourceBindingRow from provenance-like locators
 * (ingestion/event/evidence/journal) when SourceBinding table is empty (plan §14.3 / T1).
 */
export function synthesizeLegacyRowsFromProvenanceLocators(params: {
  dataPlaneId: string;
  locators: Array<{ locator: string; checksum?: string; status?: string; id?: string }>;
}): LegacySourceBindingRow[] {
  const seen = new Set<string>();
  const rows: LegacySourceBindingRow[] = [];
  for (const item of params.locators) {
    const locator = item.locator.trim().split("\\").join("/");
    if (!locator || seen.has(locator)) {
      continue;
    }
    // Skip already identity-stable locators.
    if (locator.startsWith("msrc://") || locator.startsWith("msrc_")) {
      continue;
    }
    seen.add(locator);
    const digest = createHash("sha256").update(locator).digest("hex").slice(0, 16);
    rows.push({
      id: item.id ?? `legacy_${digest}`,
      dataPlaneId: params.dataPlaneId,
      sourceLocator: locator,
      sourceChecksum: item.checksum ?? createHash("sha256").update(locator).digest("hex"),
      status: item.status ?? "active",
    });
  }
  return rows;
}

/**
 * Load provenance locators from CW metadata: sourceBindings + evidence URIs + journal input paths.
 */
export async function loadProvenanceLocatorsFromCogniWeave(params: {
  cfg: OpenBotConfig;
  agentId: string;
}): Promise<Array<{ locator: string; checksum?: string; status?: string; id?: string }>> {
  const out: Array<{ locator: string; checksum?: string; status?: string; id?: string }> = [];
  try {
    const { getMemorySearchManager } = await import("../memory/search-manager.js");
    const { manager } = await getMemorySearchManager({
      cfg: params.cfg,
      agentId: params.agentId,
    });
    if (!manager) {
      return out;
    }
    const storePath = (manager as { metadataStorePath?: string }).metadataStorePath;
    if (!storePath) {
      return out;
    }
    const { LocalMetadataStore } =
      await import("../../packages/cogniweave-sdk/src/adapters/local-metadata.js");
    const store = new LocalMetadataStore({
      path: storePath,
      backend: "sqlite",
      environment: "local",
    } as ConstructorParameters<typeof LocalMetadataStore>[0]);

    try {
      const bindings = (await store.listSourceBindings?.()) ?? [];
      for (const b of bindings) {
        out.push({
          id: b.id,
          locator: b.sourceLocator,
          checksum: createHash("sha256").update(b.sourceLocator).digest("hex"),
          status: b.status,
        });
      }
    } catch {
      // sourceBindings may be empty / unsupported
    }

    // Evidence URIs often carry document:// or path locators.
    try {
      const listEvidence = (
        store as {
          listEvidence?: (q?: unknown) => Promise<Array<{ id: string; uri?: string }>>;
        }
      ).listEvidence;
      if (typeof listEvidence === "function") {
        const evidence = await listEvidence.call(store, {});
        for (const e of evidence) {
          if (e.uri) {
            const uri = e.uri.replace(/^document:\/\//, "");
            out.push({ id: e.id, locator: uri });
          }
        }
      }
    } catch {
      // ignore
    }

    try {
      (store as { close?: () => void }).close?.();
    } catch {
      // ignore
    }
  } catch (err) {
    log.warn(`load provenance locators failed: ${String(err)}`);
  }
  return out;
}

/**
 * Full migration from provenance synthesis (preferred when SourceBinding table is empty).
 */
export async function runProvenanceSourceIdentityMigration(params: {
  catalog: ConversationCatalogRepository;
  cfg: OpenBotConfig;
  dataPlaneId: string;
  agentId?: string;
}): Promise<SourceIdentityMigrationResult> {
  const locators = await loadProvenanceLocatorsFromCogniWeave({
    cfg: params.cfg,
    agentId: params.agentId ?? "main",
  });
  const rows = synthesizeLegacyRowsFromProvenanceLocators({
    dataPlaneId: params.dataPlaneId,
    locators,
  });
  return migrateLegacySourceBindings({
    catalog: params.catalog,
    dataPlaneId: params.dataPlaneId,
    rows,
    resolveContext: async (row) => {
      const parsed = parseLegacyLocator(row.sourceLocator);
      if (parsed.sessionId) {
        const binding = await params.catalog.findBindingBySessionId(
          params.dataPlaneId,
          parsed.sessionId,
        );
        if (binding) {
          return {
            conversationId: binding.conversationId,
            bindingId: binding.bindingId,
            sessionId: binding.sessionId,
          };
        }
      }
      const digest = createHash("sha256").update(row.sourceLocator).digest("hex").slice(0, 16);
      return {
        conversationId: `conv_legacy_${digest}`,
        bindingId: `cbind_legacy_${digest}`,
        sessionId: parsed.sessionId ?? `sess_legacy_${digest}`,
      };
    },
  });
}

/**
 * Sync sealed session-source-index ranges into Catalog identities + path aliases.
 * Does not re-ingest; registers metadata for dual-read / purge.
 */
export async function syncSealedSessionRangesToCatalog(params: {
  catalog: ConversationCatalogRepository;
  indexDir: string;
}): Promise<{ examined: number; synced: number; failed: number }> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  let examined = 0;
  let synced = 0;
  let failed = 0;
  let names: string[];
  try {
    names = await fs.readdir(params.indexDir);
  } catch {
    return { examined: 0, synced: 0, failed: 0 };
  }

  for (const name of names) {
    if (!name.endsWith(".json")) {
      continue;
    }
    try {
      const raw = await fs.readFile(path.join(params.indexDir, name), "utf8");
      const index = JSON.parse(raw) as {
        dataPlaneId: string;
        conversationId: string;
        bindingId: string;
        sessionId: string;
        ranges: Array<{
          sourceIdentityId: string;
          firstTurnId: string;
          lastTurnId: string;
          turnIndexRange: [number, number];
          contentChecksum: string;
          pathAlias: string;
        }>;
      };
      for (const range of index.ranges ?? []) {
        examined += 1;
        try {
          const identity = buildMemorySourceIdentity({
            dataPlaneId: index.dataPlaneId,
            conversationId: index.conversationId,
            bindingId: index.bindingId,
            sessionId: index.sessionId,
            firstTurnId: range.firstTurnId,
            lastTurnId: range.lastTurnId,
            turnIndexRange: range.turnIndexRange,
            contentChecksum: range.contentChecksum,
          });
          // Prefer stored id if it matches encoding; otherwise still save built identity.
          const toSave =
            identity.sourceIdentityId === range.sourceIdentityId
              ? identity
              : { ...identity, sourceIdentityId: range.sourceIdentityId };
          await params.catalog.saveSourceIdentity(toSave);
          if (range.pathAlias) {
            await params.catalog.saveLocatorAlias(index.dataPlaneId, {
              sourceIdentityId: range.sourceIdentityId,
              storageTier: "HOT",
              locator: range.pathAlias,
              checksum: range.contentChecksum || "",
              active: true,
              createdAt: new Date().toISOString(),
              retiredAt: null,
            });
          }
          synced += 1;
        } catch {
          failed += 1;
        }
      }
    } catch {
      failed += 1;
    }
  }
  log.info(`sealed range catalog sync examined=${examined} synced=${synced} failed=${failed}`);
  return { examined, synced, failed };
}

// re-export for tests
export { computeMemorySourceIdentityId };
