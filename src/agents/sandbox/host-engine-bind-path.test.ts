import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  formatHostEngineDockerBind,
  parseRelocatedBindMounts,
  translateAccountDockerBindSource,
} from "./host-engine-bind-path.js";

const MOUNTINFO = [
  "22 1 0:21 / / rw - overlay overlay rw",
  "36 22 8:1 /var/lib/openbot/tenants /root/openbot-tenants rw,relatime - ext4 /dev/vda1 rw",
  "40 22 0:45 / /proc rw - proc proc rw",
  "41 22 8:1 /var/lib/openbot/tenants /root/openbot-tenants/nested rw - ext4 /dev/vda1 rw",
].join("\n");

const PROFILE = "/root/openbot-tenants/001/users/user-a/state/browser";

describe("translateAccountDockerBindSource", () => {
  it("rewrites a Path B tenants bind to the host mount source", () => {
    expect(
      translateAccountDockerBindSource(PROFILE, {
        env: { OPENBOT_TENANTS_ROOT: "/root/openbot-tenants" },
        mountinfo: MOUNTINFO,
      }),
    ).toBe("/var/lib/openbot/tenants/001/users/user-a/state/browser");
  });

  it("keeps the tenants mount when a nested mount does not cover that root", () => {
    expect(
      translateAccountDockerBindSource("/root/openbot-tenants/nested/001/state/browser", {
        env: { OPENBOT_TENANTS_ROOT: "/root/openbot-tenants" },
        mountinfo: MOUNTINFO,
      }),
    ).toBe("/var/lib/openbot/tenants/nested/001/state/browser");
  });

  it("leaves paths outside the tenants root on the container view", () => {
    const outside = "/tmp/openbot-not-tenants/browser";
    expect(
      translateAccountDockerBindSource(outside, {
        env: { OPENBOT_TENANTS_ROOT: "/root/openbot-tenants" },
        stateDir: "/root/.openbot",
        mountinfo: MOUNTINFO,
      }),
    ).toBe(path.resolve(outside));
  });

  it("rewrites an operator state/browser bind to the host state mount", () => {
    const profile = "/root/.openbot/operators/user-a/state/browser";
    const artifacts = "/root/.openbot/operators/user-a/OpenBot/artifacts";
    const mountinfo = [
      MOUNTINFO,
      "37 22 8:1 /var/lib/openbot/state /root/.openbot rw - ext4 /dev/vda1 rw",
    ].join("\n");
    const options = {
      env: { OPENBOT_TENANTS_ROOT: "/root/openbot-tenants" },
      stateDir: "/root/.openbot",
      mountinfo,
    };
    expect(translateAccountDockerBindSource(profile, options)).toBe(
      "/var/lib/openbot/state/operators/user-a/state/browser",
    );
    expect(translateAccountDockerBindSource(artifacts, options)).toBe(
      "/var/lib/openbot/state/operators/user-a/OpenBot/artifacts",
    );
  });

  it("keeps an identity state-dir mount on the same path", () => {
    const profile = "/root/.openbot/operators/user-a/state/browser";
    expect(
      translateAccountDockerBindSource(profile, {
        stateDir: "/root/.openbot",
        tenantsRoot: "/root/openbot-tenants",
        mountinfo: "36 22 8:1 /root/.openbot /root/.openbot rw - ext4 /dev/vda1 rw\n",
      }),
    ).toBe(profile);
  });

  it("is identity when the tenants root is not a relocated bind", () => {
    const local = "/var/lib/openbot/tenants/001/users/user-a/state/browser";
    expect(
      translateAccountDockerBindSource(local, {
        env: { OPENBOT_TENANTS_ROOT: "/var/lib/openbot/tenants" },
        mountinfo: "22 1 8:1 / /var rw - ext4 /dev/vda1 rw\n",
      }),
    ).toBe(local);
  });

  it("does not treat the container root overlay as a host bind", () => {
    expect(parseRelocatedBindMounts("22 1 0:21 / / rw - overlay overlay rw\n")).toEqual([]);
  });

  it("lets OPENBOT_HOST_BIND_MAP override mountinfo", () => {
    expect(
      translateAccountDockerBindSource(PROFILE, {
        env: {
          OPENBOT_TENANTS_ROOT: "/root/openbot-tenants",
          OPENBOT_HOST_BIND_MAP: "/root/openbot-tenants=/srv/tenants",
        },
        mountinfo: MOUNTINFO,
      }),
    ).toBe("/srv/tenants/001/users/user-a/state/browser");
  });

  it("formats the browser profile bind with the host source", () => {
    expect(
      formatHostEngineDockerBind(
        { hostPath: PROFILE, containerPath: "/account/browser", access: "rw" },
        {
          env: { OPENBOT_TENANTS_ROOT: "/root/openbot-tenants" },
          mountinfo: MOUNTINFO,
        },
      ),
    ).toBe("/var/lib/openbot/tenants/001/users/user-a/state/browser:/account/browser:rw");
  });
});
