/** Request-local credential traversal. The existing caller owns the model retry loop. */
export function createAuthProfileRotation(input: {
  candidates: Array<string | undefined>;
  lockedProfileId?: string;
  inCooldown: (profileId: string) => boolean;
  apply: (profileId: string | undefined) => Promise<void>;
}) {
  let index = 0;
  return {
    get current() {
      return input.candidates[index];
    },
    async initialize(options: { allowTransientCooldownProbe: boolean; onProbe: () => void }) {
      let didProbe = false;
      while (index < input.candidates.length) {
        const candidate = input.candidates[index];
        const inCooldown =
          candidate && candidate !== input.lockedProfileId && input.inCooldown(candidate);
        if (inCooldown) {
          if (options.allowTransientCooldownProbe && !didProbe) {
            didProbe = true;
            options.onProbe();
          } else {
            index += 1;
            continue;
          }
        }
        await input.apply(input.candidates[index]);
        return true;
      }
      return false;
    },
    async advance() {
      if (input.lockedProfileId) {
        return false;
      }
      let nextIndex = index + 1;
      while (nextIndex < input.candidates.length) {
        const candidate = input.candidates[nextIndex];
        if (candidate && input.inCooldown(candidate)) {
          nextIndex += 1;
          continue;
        }
        try {
          await input.apply(candidate);
          index = nextIndex;
          return true;
        } catch (error) {
          if (candidate && candidate === input.lockedProfileId) {
            throw error;
          }
          nextIndex += 1;
        }
      }
      return false;
    },
  };
}
