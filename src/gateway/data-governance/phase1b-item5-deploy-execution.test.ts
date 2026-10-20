import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveStateDir } from "../../config/paths.js";
import type { AgentRegistryStore } from "../agent-registry/types.js";
import { resolveDataGovernanceCatalogPath } from "./paths.js";
import {
  blockedDeployExecution,
  executeAuthorizedDeployProduction,
  isUnredactedDeployDump,
  normalizeDeployOccupants,
  preflightAuthorizedDeployExecution,
} from "./phase1b-item5-deploy-execution.js";
import {
  ProductionWriteTargetError,
  classifyProductionWriteTargetError,
  inspectProductionWriteTarget,
  resolveProductionDeployTarget,
} from "./phase1b-item5-deploy-production-target.js";
import {
  executeAuthorizedProductionContainerWrite,
  productionWriteTargetReachable,
} from "./phase1b-item5-production-container-write.js";
import {
  deriveMainAssetMembershipRebind,
  executeRegistryMainMembershipRebind,
} from "./phase1b-item5-registry-main-rebind.js";
import { resetSharedDataGovernanceCatalogForTests } from "./runtime-catalog.js";

const DECISION_PATH = path.resolve(
  process.cwd(),
  "docs/design/evidence/memory-workspace-phase1b-item5-deploy-execution-decision.json",
);

const savedDecision = fs.existsSync(DECISION_PATH) ? fs.readFileSync(DECISION_PATH, "utf8") : null;

const memberships = [{ userId: "90fed19a-1c8b-4420-87e0-bcc6165e32fa", enterpriseId: "001" }];
const seatOccupants = [
  {
    seatId: "1b25d120-013f-4ad5-b64a-bb0f9e1cd490",
    userId: "90fed19a-1c8b-4420-87e0-bcc6165e32fa",
    enterpriseId: "001",
  },
];

function writeAuthorizedDecision(): void {
  fs.writeFileSync(
    DECISION_PATH,
    JSON.stringify({
      deployExecution: "authorized",
      path: "authorize-production-container-write-and-registry-main-rebind",
      executed: false,
      deployAuthorized: true,
      productionContainerWrite: true,
      registryMainRebind: true,
      wiredToProductionResolver: false,
      live: "host-openbot-and-production",
    }),
  );
}

function stubStore(): AgentRegistryStore {
  const agentAssetId = "1515f244-b9f1-4509-9eb9-fd7e4f2b9e13";
  return {
    version: 1,
    assets: {
      [agentAssetId]: {
        agentAssetId,
        enterpriseId: "001",
        legacyAgentId: "main",
        status: "archived",
        agentSlug: "main",
        displayName: "main",
        createdAt: "2026-07-31T10:13:35.148Z",
        updatedAt: "2026-08-01T01:13:19.785Z",
      },
    },
    ownerBindings: {
      old: {
        bindingId: "old",
        enterpriseId: "001",
        agentAssetId: "1515f244-b9f1-4509-9eb9-fd7e4f2b9e13",
        ownerType: "seat",
        ownerId: "1b25d120-013f-4ad5-b64a-bb0f9e1cd490",
        isPrimary: true,
        effectiveAt: "2026-07-31T10:13:35.148Z",
        endedAt: "2026-08-01T01:13:19.785Z",
        endedReason: "asset_archived",
      },
    },
    deployments: {},
    revisions: {},
    quarantine: {},
  };
}

function seedProductionStateDir(stateDir: string): string {
  fs.mkdirSync(stateDir, { recursive: true });
  const registryPath = path.join(stateDir, "openbot-agent-registry.json");
  fs.writeFileSync(registryPath, `${JSON.stringify(stubStore(), null, 2)}\n`);
  return registryPath;
}

function productionEnv(stateDir: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    OPENBOT_PRODUCTION_STATE_DIR: stateDir,
    OPENBOT_PRODUCTION_EXECUTION_MODE: "production",
    OPENBOT_PRODUCTION_ON_GATEWAY_HOST: "1",
    OPENBOT_STATE_DIR: stateDir,
    ...extra,
  };
}

afterEach(() => {
  resetSharedDataGovernanceCatalogForTests();
  if (savedDecision) {
    fs.writeFileSync(DECISION_PATH, savedDecision);
  } else if (fs.existsSync(DECISION_PATH)) {
    fs.rmSync(DECISION_PATH, { force: true });
  }
});

describe("production deploy target resolution", () => {
  it("allows explicit /root/.openbot when execution mode is production on gateway host", () => {
    const target = resolveProductionDeployTarget({
      HOME: "/root",
      OPENBOT_STATE_DIR: "/root/.openbot",
      OPENBOT_PRODUCTION_STATE_DIR: "/root/.openbot",
      OPENBOT_PRODUCTION_EXECUTION_MODE: "production",
      OPENBOT_PRODUCTION_ON_GATEWAY_HOST: "1",
    });
    expect(target.stateDir).toBe(path.resolve("/root/.openbot"));
    expect(target.registryStorePath).toBe(
      path.join(path.resolve("/root/.openbot"), "openbot-agent-registry.json"),
    );
    expect(target.catalogPath).toBe(
      resolveDataGovernanceCatalogPath(path.resolve("/root/.openbot")),
    );
  });

  it("rejects implicit dev resolveStateDir without gateway-host marker", () => {
    const devState = resolveStateDir();
    expect(() =>
      resolveProductionDeployTarget({
        ...process.env,
        OPENBOT_PRODUCTION_STATE_DIR: devState,
        OPENBOT_PRODUCTION_EXECUTION_MODE: "production",
      }),
    ).toThrow(ProductionWriteTargetError);
    try {
      resolveProductionDeployTarget({
        ...process.env,
        OPENBOT_PRODUCTION_STATE_DIR: devState,
        OPENBOT_PRODUCTION_EXECUTION_MODE: "production",
      });
    } catch (error) {
      expect(classifyProductionWriteTargetError(error)).toBe("production_write_target_rejected");
      expect((error as Error).message).toBe("production_state_dir_dev_implicit_forbidden");
    }
  });

  it("reports unconfigured when OPENBOT_PRODUCTION_STATE_DIR is unset", () => {
    const env = { ...process.env };
    delete env.OPENBOT_PRODUCTION_STATE_DIR;
    expect(productionWriteTargetReachable(env)).toBe(false);
    const status = inspectProductionWriteTarget(env);
    expect(status.reachable).toBe(false);
    if (!status.reachable) {
      expect(status.code).toBe("production_write_target_unconfigured");
    }
  });

  it("classifies configured-but-rejected targets separately from unconfigured", () => {
    const devState = resolveStateDir();
    const error = (() => {
      try {
        resolveProductionDeployTarget({
          OPENBOT_PRODUCTION_STATE_DIR: devState,
          OPENBOT_PRODUCTION_EXECUTION_MODE: "production",
        });
        return null;
      } catch (caught) {
        return caught;
      }
    })();
    expect(error).not.toBeNull();
    const blocked = blockedDeployExecution(error, {
      OPENBOT_PRODUCTION_STATE_DIR: devState,
      OPENBOT_PRODUCTION_EXECUTION_MODE: "production",
    });
    expect(blocked.code).toBe("production_write_target_rejected");
    expect(blocked.productionTargetConfigured).toBe(true);
  });
});

describe("registry main membership rebind", () => {
  it("accepts dump seatOccupancies as occupants and in-memory-unredacted dumps", () => {
    expect(
      normalizeDeployOccupants({
        seatOccupancies: seatOccupants,
      }),
    ).toEqual(seatOccupants);
    expect(
      isUnredactedDeployDump({ identifierPolicy: "in-memory-unredacted", gitWrite: false }),
    ).toBe(true);
    expect(isUnredactedDeployDump({ identifierPolicy: "opaque-redacted", gitWrite: false })).toBe(
      false,
    );
  });

  it("derives membership owner from ended seat binding + occupancy + membership", () => {
    const derivation = deriveMainAssetMembershipRebind({
      store: stubStore(),
      memberships,
      seatOccupants,
    });
    expect(derivation?.proof).toBe("historical_seat_binding_occupancy_membership");
    expect(derivation?.hashedUserId).toMatch(/^[0-9a-f]{16}$/);
    expect(
      JSON.stringify({ proof: derivation?.proof, hashedUserId: derivation?.hashedUserId }),
    ).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });
});

describe("authorized deploy execution", () => {
  it("uses one explicit production state dir for registry and catalog on non-root maintainer host", async () => {
    writeAuthorizedDecision();
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "item5-prod-maint-"));
    seedProductionStateDir(stateDir);
    const env = productionEnv(stateDir, { HOME: os.homedir() });

    const preflight = await preflightAuthorizedDeployExecution({
      memberships,
      seatOccupants,
      env,
    });
    expect(preflight.target.stateDir).toBe(path.resolve(stateDir));
    expect(path.dirname(preflight.target.registryStorePath)).toBe(path.resolve(stateDir));
    expect(path.dirname(preflight.target.catalogPath)).toContain(path.basename(stateDir));

    const result = await executeAuthorizedDeployProduction({
      candidates: [],
      memberships,
      seatOccupants,
      env,
    });
    expect(result.target.stateDir).toBe(path.resolve(stateDir));
    expect(result.registryMainRebind.registryStorePath).toBe(preflight.target.registryStorePath);
    expect(result.productionContainerWrite.target).toBe("production_state_dir");
    expect(result.wiredToProductionResolver).toBe(false);
    expect(result.item5).toBe("not-met");
    expect(
      JSON.stringify({
        wiredToProductionResolver: result.wiredToProductionResolver,
        item5: result.item5,
        hashedUserId: result.registryMainRebind.derivation.hashedUserId,
        hashedSeatId: result.registryMainRebind.derivation.hashedSeatId,
        proof: result.registryMainRebind.derivation.proof,
      }),
    ).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);

    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it("does not partially write registry or catalog when preflight fails", async () => {
    writeAuthorizedDecision();
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "item5-partial-"));
    const registryPath = seedProductionStateDir(stateDir);
    const catalogPath = resolveDataGovernanceCatalogPath(stateDir);
    const registryBefore = fs.readFileSync(registryPath, "utf8");
    const catalogBefore = fs.existsSync(catalogPath) ? fs.readFileSync(catalogPath, "utf8") : null;

    await expect(
      executeAuthorizedDeployProduction({
        candidates: [],
        memberships: [],
        seatOccupants: [],
        env: productionEnv(stateDir),
      }),
    ).rejects.toThrow(/main_asset_membership_rebind_derivation_missing/);

    expect(fs.readFileSync(registryPath, "utf8")).toBe(registryBefore);
    if (catalogBefore === null) {
      expect(fs.existsSync(catalogPath)).toBe(false);
    } else {
      expect(fs.readFileSync(catalogPath, "utf8")).toBe(catalogBefore);
    }

    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it("does not partially write when production target is rejected before execution", async () => {
    writeAuthorizedDecision();
    const devState = resolveStateDir();
    const registryPath = path.join(devState, "openbot-agent-registry.json");
    const hadRegistry = fs.existsSync(registryPath);
    const registryBefore = hadRegistry ? fs.readFileSync(registryPath, "utf8") : null;

    await expect(
      executeAuthorizedDeployProduction({
        candidates: [],
        memberships,
        seatOccupants,
        env: {
          ...process.env,
          OPENBOT_PRODUCTION_STATE_DIR: devState,
          OPENBOT_PRODUCTION_EXECUTION_MODE: "production",
        },
      }),
    ).rejects.toThrow(ProductionWriteTargetError);

    if (hadRegistry) {
      expect(fs.readFileSync(registryPath, "utf8")).toBe(registryBefore);
    }
  });

  it("keeps registry and catalog targets consistent via shared deploy target", async () => {
    writeAuthorizedDecision();
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "item5-consistent-"));
    const registryPath = seedProductionStateDir(stateDir);
    const store = JSON.parse(fs.readFileSync(registryPath, "utf8")) as AgentRegistryStore;

    const rebind = await executeRegistryMainMembershipRebind({
      store,
      storePath: registryPath,
      memberships,
      seatOccupants,
    });
    expect(path.dirname(rebind.registryStorePath)).toBe(path.resolve(stateDir));

    const catalog = await executeAuthorizedProductionContainerWrite({
      candidates: [],
      mainDerivation: rebind.derivation,
      deployTarget: resolveProductionDeployTarget(productionEnv(stateDir)),
    });
    expect(catalog.wiredToProductionResolver).toBe(false);
    expect(catalog.item5).toBe("not-met");
    expect(catalog.catalogPresent).toBe(true);

    fs.rmSync(stateDir, { recursive: true, force: true });
  });
});
