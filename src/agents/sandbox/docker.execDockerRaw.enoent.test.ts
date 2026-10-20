import { describe, expect, it } from "vitest";
import { withEnvAsync } from "../../test-utils/env.js";
import { execDockerRaw } from "./docker.js";

describe("execDockerRaw", () => {
  it("wraps docker ENOENT with an actionable configuration error", async () => {
    await withEnvAsync({ PATH: "" }, async () => {
      let err: unknown;
      try {
        await execDockerRaw(["version"]);
      } catch (caught) {
        err = caught;
      }

      expect(err).toBeInstanceOf(Error);
      expect(err).toMatchObject({ code: "INVALID_CONFIG" });
      const message = (err as Error).message;
      expect(message).toContain("Sandbox mode requires Docker");
      expect(message).toContain("docker exec");
      expect(message).toContain("OPENCLAW_INSTALL_DOCKER_CLI=1");
      expect(message).toContain("Do not ask the user to set agents.defaults.sandbox.mode=off");
      expect(message).not.toContain("to disable sandboxing");
    });
  });
});
