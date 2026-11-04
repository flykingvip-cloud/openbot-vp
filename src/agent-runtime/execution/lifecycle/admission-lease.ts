import type { tryAcquireEnterpriseAgentRun } from "../../../gateway/billing/agent-run-governance.js";

type AdmissionInput = Parameters<typeof tryAcquireEnterpriseAgentRun>[0];
type AdmissionResult = Awaited<ReturnType<typeof tryAcquireEnterpriseAgentRun>>;

/** Fixed host bindings; no configuration callbacks or optional authorization bypass. */
export type RunAdmissionLeasePorts = {
  acquire: (input: AdmissionInput) => Promise<AdmissionResult>;
  release: () => void;
  forgetSnapshot: () => void;
};

/** Own the original per-turn admission slot lifetime, not model selection or retries.
 * One serial turn owner only; concurrent acquire/dispose is not supported. */
export function createRunAdmissionLease(ports: RunAdmissionLeasePorts) {
  let held = false;
  let disposed = false;
  return {
    get held() {
      return held;
    },
    async acquire(input: AdmissionInput): Promise<AdmissionResult> {
      if (disposed) {
        throw new Error("Admission lease is already disposed");
      }
      const result = await ports.acquire(input);
      if (result.acquired) {
        held = true;
      }
      return result;
    },
    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      if (held) {
        ports.release();
        ports.forgetSnapshot();
      }
    },
  };
}
