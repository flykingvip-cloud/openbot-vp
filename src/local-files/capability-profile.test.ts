import { describe, expect, it } from "vitest";
import {
  checkProfileCommandSet,
  gateProfileCommand,
  LOCAL_FILES_READONLY_COMMANDS,
  PROFILE_DENIED_COMMANDS,
  verifyConnectionIdentity,
} from "./capability-profile.js";
import { LOCAL_FILES_READONLY_PROFILE } from "./types.js";

describe("profile command surface is exactly five commands (design 4.2)", () => {
  it("contains precisely the documented five", () => {
    expect([...LOCAL_FILES_READONLY_COMMANDS].toSorted()).toEqual([
      "archive.list",
      "archive.readEntry",
      "fs.list",
      "fs.read",
      "fs.stat",
    ]);
  });

  it("does not grow a general path-probing command", () => {
    // The design explicitly refuses a generic fs.resolve; resolution is a mode of
    // fs.stat instead (design 9.1 step 2, 9.7).
    expect(LOCAL_FILES_READONLY_COMMANDS).not.toContain("fs.resolve");
  });
});

describe("gateProfileCommand denies every system command (acceptance 6.8)", () => {
  it("denies the named system commands", () => {
    for (const command of PROFILE_DENIED_COMMANDS) {
      const res = gateProfileCommand(command);
      expect(res.ok).toBe(false);
      expect(!res.ok && res.reason).toBe("system-command-denied");
    }
  });

  it("denies an unseen system.* command by prefix, not by enumeration", () => {
    const res = gateProfileCommand("system.somethingBrandNew");
    expect(res.ok).toBe(false);
    expect(!res.ok && res.reason).toBe("system-command-denied");
  });

  it("denies commands outside the profile", () => {
    for (const command of [
      "browser.proxy",
      "camera.snap",
      "supervisor.worker.dispatch",
      "fs.write",
    ]) {
      const res = gateProfileCommand(command);
      expect(res.ok).toBe(false);
      expect(!res.ok && res.reason).toBe("not-in-profile");
    }
  });

  it("admits the five profile commands", () => {
    for (const command of LOCAL_FILES_READONLY_COMMANDS) {
      const res = gateProfileCommand(command);
      expect(res.ok).toBe(true);
      expect(res.ok && res.operation).toBe(command);
    }
  });
});

describe("declared command set must equal the profile (acceptance 9.6 case 6)", () => {
  it("accepts the exact set", () => {
    expect(checkProfileCommandSet([...LOCAL_FILES_READONLY_COMMANDS]).ok).toBe(true);
  });

  it("rejects one command too many", () => {
    const res = checkProfileCommandSet([...LOCAL_FILES_READONLY_COMMANDS, "system.run"]);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.reason).toBe("extra-commands");
    expect(!res.ok && res.extra).toEqual(["system.run"]);
  });

  it("rejects one command too few", () => {
    const res = checkProfileCommandSet(
      LOCAL_FILES_READONLY_COMMANDS.filter((cmd) => cmd !== "fs.read"),
    );
    expect(res.ok).toBe(false);
    expect(!res.ok && res.reason).toBe("missing-commands");
    expect(!res.ok && res.missing).toEqual(["fs.read"]);
  });

  it("rejects an empty declaration", () => {
    expect(checkProfileCommandSet([]).ok).toBe(false);
  });
});

describe("connection identity requires five-way equality (design 9.5)", () => {
  const base = {
    bindingProfile: LOCAL_FILES_READONLY_PROFILE,
    bindingDevicePublicKey: "key-aaa",
    nodeConfiguredProfile: LOCAL_FILES_READONLY_PROFILE,
    connectionDevicePublicKey: "key-aaa",
    declaredCommands: [...LOCAL_FILES_READONLY_COMMANDS],
  };

  it("accepts when all five agree", () => {
    expect(verifyConnectionIdentity(base).ok).toBe(true);
  });

  it("refuses a binding on a different profile", () => {
    const res = verifyConnectionIdentity({ ...base, bindingProfile: "something-else" });
    expect(!res.ok && res.reason).toBe("binding-profile-mismatch");
  });

  it("refuses when the node was launched with a different profile", () => {
    const res = verifyConnectionIdentity({ ...base, nodeConfiguredProfile: "shell-node" });
    expect(!res.ok && res.reason).toBe("node-profile-mismatch");
  });

  it("refuses when the authenticated device key is not the bound one", () => {
    const res = verifyConnectionIdentity({ ...base, connectionDevicePublicKey: "key-bbb" });
    expect(!res.ok && res.reason).toBe("device-key-mismatch");
  });

  it("refuses a declared command set that drifted from the profile", () => {
    const res = verifyConnectionIdentity({
      ...base,
      declaredCommands: [...LOCAL_FILES_READONLY_COMMANDS, "system.run"],
    });
    expect(!res.ok && res.reason).toBe("command-set-mismatch");
    expect(!res.ok && res.detail).toContain("system.run");
  });

  it("accepts a paired computer whose session profile is unset and that also declares system.run", () => {
    const res = verifyConnectionIdentity({
      ...base,
      nodeConfiguredProfile: "",
      declaredCommands: [
        "browser.proxy",
        "system.run",
        "system.run.prepare",
        "system.which",
        ...LOCAL_FILES_READONLY_COMMANDS,
      ],
    });
    expect(res.ok).toBe(true);
  });

  it("refuses a paired computer that is missing a file command", () => {
    const res = verifyConnectionIdentity({
      ...base,
      nodeConfiguredProfile: "",
      declaredCommands: [
        "system.run",
        ...LOCAL_FILES_READONLY_COMMANDS.filter((cmd) => cmd !== "fs.list"),
      ],
    });
    expect(!res.ok && res.reason).toBe("command-set-mismatch");
    expect(!res.ok && res.detail).toContain("fs.list");
  });
});
