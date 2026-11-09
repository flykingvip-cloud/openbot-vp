import type { tryAcquireEnterpriseAgentRun } from "../../gateway/billing/agent-run-governance.js";

type AdmissionInput = Parameters<typeof tryAcquireEnterpriseAgentRun>[0];
type AdmissionResult = Awaited<ReturnType<typeof tryAcquireEnterpriseAgentRun>>;

/** Fixed host bindings; no configuration callbacks or optional authorization bypass. */
export type RunAdmissionLeasePorts<
  Input = AdmissionInput,
  Result extends { acquired: boolean } = AdmissionResult,
> = {
  acquire: (input: Input) => Promise<Result>;
  release: () => void | Promise<void>;
  forgetSnapshot: () => void;
};

/** Own the original per-turn admission slot lifetime, not model selection or retries.
 * One serial turn owner only; concurrent acquire/dispose is not supported. */
export function createRunAdmissionLease<
  Input = AdmissionInput,
  Result extends { acquired: boolean } = AdmissionResult,
>(ports: RunAdmissionLeasePorts<Input, Result>) {
  let held = false;
  let disposed = false;
  let disposal: Promise<void> | undefined;
  return {
    get held() {
      return held;
    },
    async acquire(input: Input): Promise<Result> {
      if (disposed) {
        throw new Error("Admission lease is already disposed");
      }
      const result = await ports.acquire(input);
      if (result.acquired) {
        held = true;
      }
      return result;
    },
    dispose(): Promise<void> {
      if (disposal) {
        return disposal;
      }
      disposed = true;
      disposal = (async () => {
        if (held) {
          try {
            await ports.release();
          } finally {
            held = false;
            ports.forgetSnapshot();
          }
        }
      })();
      return disposal;
    },
  };
}
