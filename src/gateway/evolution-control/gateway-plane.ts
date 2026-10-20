import path from "node:path";
import type { OpenBotConfig } from "../../config/config.js";
import { loadConfig } from "../../config/config.js";
import {
  createDelegationEvolutionInspector,
  type EvolutionAuthorizationInspector,
} from "../../diagnosis/evolution-proposal.js";
import { isGovernanceKillSwitchActive } from "../evolution-governance/persistent-store.js";
import {
  createCapsuleAdapter,
  createCapsuleEligibilityReader,
  createWorkspaceCapsuleStore,
} from "./adapters/capsule.js";
import {
  createFileOrganizationPolicyPort,
  createOrganizationAdapter,
} from "./adapters/organization.js";
import {
  createLiveRuntimeGovernancePort,
  createRuntimeGovernanceAdapter,
} from "./adapters/runtime-governance.js";
import {
  createDefaultSkillLifecyclePort,
  createSkillInstallationAdapter,
  createSkillSpecAdapter,
} from "./adapters/skill.js";
import { createWorkingDnaAdapter } from "./adapters/working-dna.js";
import { createEvolutionControlPlane, type EvolutionControlPlane } from "./control-plane.js";
import { getSharedDiagnosisDelegationMachine } from "./delegation-service.js";
import {
  createLiveDiagnosisRecheckPort,
  expectationFromControlPlane,
} from "./diagnosis-recheck-observer.js";
import { createCompositionRootVerifierHandle } from "./external-effect-registry.js";
import {
  createAdapterObservationProvider,
  type ExperimentObservationProvider,
} from "./observation.js";
import { resolveEvolutionAdapterDir, resolveEvolutionControlRoot } from "./persistent-store.js";
import { installCatalogBuiltins } from "./verifiers/catalog.js";

export function createGatewayEvolutionControlPlane(options?: {
  cfg?: OpenBotConfig;
  persistDir?: string;
  inspector?: EvolutionAuthorizationInspector;
  observationProvider?: ExperimentObservationProvider;
  skillInvocationConfigDir?: string;
}): EvolutionControlPlane {
  const cfg = options?.cfg ?? loadConfig();
  const persistDir = resolveEvolutionControlRoot(options?.persistDir);
  const adapterDir = resolveEvolutionAdapterDir(persistDir);
  const skillPort = createDefaultSkillLifecyclePort();
  const workingDnaAdapter = createWorkingDnaAdapter(cfg, { persistDir: adapterDir });
  const capsuleStore = createWorkspaceCapsuleStore(cfg);
  const capsuleAdapter = createCapsuleAdapter(capsuleStore, {
    persistDir: adapterDir,
  });
  const skillSpecAdapter = createSkillSpecAdapter(skillPort, { persistDir: adapterDir });
  const skillInstallationAdapter = createSkillInstallationAdapter(skillPort, {
    persistDir: adapterDir,
  });
  const organizationAdapter = createOrganizationAdapter(
    createFileOrganizationPolicyPort(
      path.join(persistDir, "organization-policies.json"),
      options?.skillInvocationConfigDir
        ? { skillEventsConfigDir: options.skillInvocationConfigDir }
        : undefined,
    ),
    {
      persistDir: adapterDir,
      ...(options?.skillInvocationConfigDir
        ? { skillEventsConfigDir: options.skillInvocationConfigDir }
        : {}),
    },
  );
  const runtimeGovernanceAdapter = createRuntimeGovernanceAdapter(
    createLiveRuntimeGovernancePort(),
    { persistDir: adapterDir },
  );
  const verifierHandle = createCompositionRootVerifierHandle(
    path.join(persistDir, "verifier-registry.json"),
  );
  installCatalogBuiltins(verifierHandle);
  let plane!: EvolutionControlPlane;
  plane = createEvolutionControlPlane({
    persistDir,
    styleConfig: cfg,
    skillEventsConfigDir: options?.skillInvocationConfigDir,
    verifierRegistry: verifierHandle.registry,
    readCapsuleEligibility: createCapsuleEligibilityReader(capsuleStore),
    inspector:
      options?.inspector ??
      createDelegationEvolutionInspector(getSharedDiagnosisDelegationMachine(persistDir)),
    workingDnaAdapter,
    capsuleAdapter,
    skillSpecAdapter,
    skillInstallationAdapter,
    organizationAdapter,
    runtimeGovernanceAdapter,
    isKillSwitchActive: () => isGovernanceKillSwitchActive(),
    diagnosisRecheckPort: createLiveDiagnosisRecheckPort({
      cfg,
      skillPort,
      resolveExpectation: (request) => expectationFromControlPlane(plane, request),
    }),
    observationProvider:
      options?.observationProvider ??
      createAdapterObservationProvider({
        persistDir,
        resolveAdapter(surfaceId) {
          if (surfaceId === "knowledge.experience-capsule") {
            return capsuleAdapter;
          }
          if (surfaceId === "capability.skill-spec") {
            return skillSpecAdapter;
          }
          if (surfaceId === "capability.skill-installation") {
            return skillInstallationAdapter;
          }
          if (
            surfaceId === "organization.task-routing" ||
            surfaceId === "organization.team-composition"
          ) {
            return organizationAdapter;
          }
          if (surfaceId === "system.runtime-binding-governance") {
            return runtimeGovernanceAdapter;
          }
          return workingDnaAdapter;
        },
      }),
  });
  return plane;
}
