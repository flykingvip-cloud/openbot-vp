import type {
  EvolutionAdapter,
  EvolutionDomain,
  EvolutionTarget,
  TargetSnapshot,
  ValidationResult,
} from "@openbot/evolution-core";

export function createFailClosedAdapter(
  adapterId: string,
  domain: EvolutionDomain,
): EvolutionAdapter {
  const deny = (operation: string): never => {
    throw new Error(`${adapterId} adapter is not enabled for ${operation}`);
  };
  return {
    adapterId,
    domain,
    async inspect(target: EvolutionTarget): Promise<TargetSnapshot> {
      return {
        target,
        version: "unavailable",
        surfaceId: adapterId,
        sourceOfTruth: "not-enabled",
      };
    },
    async validate(): Promise<ValidationResult> {
      return {
        ok: false,
        code: "adapter_not_enabled",
        reason: `${adapterId} apply path is not enabled`,
      };
    },
    async apply() {
      return deny("apply");
    },
    async observe() {
      return [];
    },
    async rollback() {
      return deny("rollback");
    },
  };
}
