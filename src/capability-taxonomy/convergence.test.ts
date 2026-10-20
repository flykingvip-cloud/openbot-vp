import { describe, expect, it } from "vitest";
import { DEFAULT_DANGEROUS_NODE_COMMANDS } from "../gateway/node-command-policy.js";
import {
  NODE_BROWSER_PROXY_COMMAND,
  NODE_LOCAL_FILES_READONLY_COMMANDS,
  NODE_SYSTEM_RUN_COMMANDS,
} from "../infra/node-commands.js";
import { LOCAL_FILES_OPERATIONS } from "../local-files/types.js";
import {
  CAPABILITY_CONVERGENCE,
  CAPABILITY_TAXONOMY_UNCOVERED_COMMANDS,
  capabilitiesForNodeCommand,
  landedNodeCommands,
  pendingNodeCommands,
} from "./convergence.js";
import { CAPABILITY_IDS, capabilityGroup, isCapabilityId, LOCAL_CAPABILITY_IDS } from "./ids.js";

describe("identifier vocabulary", () => {
  it("has no duplicates", () => {
    expect(new Set(CAPABILITY_IDS).size).toBe(CAPABILITY_IDS.length);
  });

  it("uses lowercase dotted segments so identifiers stay machine-comparable", () => {
    for (const id of CAPABILITY_IDS) {
      expect(id, id).toMatch(/^[a-z]+(?:\.[a-z_]+)+$/);
    }
  });

  it("groups every identifier by its prefix", () => {
    for (const id of CAPABILITY_IDS) {
      expect(["local", "network", "account", "external", "agent"], id).toContain(
        capabilityGroup(id),
      );
    }
  });

  it("recognizes only real identifiers", () => {
    expect(isCapabilityId("local.file.read")).toBe(true);
    expect(isCapabilityId("local.file.teleport")).toBe(false);
    expect(isCapabilityId("computer.full")).toBe(false); // §20 red line, never an identifier
  });
});

describe("convergence mapping completeness", () => {
  it("covers every identifier, so a new one cannot land unmapped", () => {
    const mapped = new Set(Object.keys(CAPABILITY_CONVERGENCE));
    for (const id of CAPABILITY_IDS) {
      expect(mapped.has(id), `${id} has no convergence row`).toBe(true);
    }
    expect(mapped.size).toBe(CAPABILITY_IDS.length);
  });

  it("states a predecessor for every identifier", () => {
    for (const id of CAPABILITY_IDS) {
      expect(CAPABILITY_CONVERGENCE[id].predecessor.trim().length, id).toBeGreaterThan(0);
    }
  });

  it("uses only the three modes that apply to existing surfaces", () => {
    for (const id of CAPABILITY_IDS) {
      expect(["reuse", "adapt", "extend"], id).toContain(CAPABILITY_CONVERGENCE[id].mode);
    }
  });

  it("marks the mature shell path as reuse, not extend", () => {
    // §9.4 and §7.6 both classify this subsystem as mature; rewriting it is a red line.
    expect(CAPABILITY_CONVERGENCE["local.shell.execute"].mode).toBe("reuse");
  });
});

describe("claimed predecessors exist in the live command constants", () => {
  // This is the point of the module: the §7.6 mapping is only worth anything if the
  // commands it names are the commands the repository actually has.
  const live = new Set<string>([
    ...DEFAULT_DANGEROUS_NODE_COMMANDS,
    ...NODE_LOCAL_FILES_READONLY_COMMANDS,
    ...NODE_SYSTEM_RUN_COMMANDS,
    NODE_BROWSER_PROXY_COMMAND,
    // Non-dangerous platform commands are declared privately in node-command-policy,
    // so they cannot be imported. Listed here as the mapping's assumption, which the
    // uncovered-surface test below keeps honest.
    "device.info",
    "device.status",
    "device.permissions",
    "device.health",
    "calendar.events",
    "notifications.list",
    "notifications.actions",
  ]);

  it("names at least one real command", () => {
    expect(landedNodeCommands().length).toBeGreaterThan(0);
  });

  it("names no command that does not exist", () => {
    for (const command of landedNodeCommands()) {
      expect(
        live.has(command),
        `${command} is claimed as a landed predecessor but is not a live command`,
      ).toBe(true);
    }
  });

  it("maps every local-files operation to a local capability", () => {
    for (const operation of LOCAL_FILES_OPERATIONS) {
      const ids = capabilitiesForNodeCommand(operation);
      expect(ids.length, `${operation} maps to no capability`).toBeGreaterThan(0);
      for (const id of ids) {
        expect(LOCAL_CAPABILITY_IDS as readonly string[], `${operation} -> ${id}`).toContain(id);
      }
    }
  });

  it("maps the shell commands to local.shell.execute", () => {
    for (const command of NODE_SYSTEM_RUN_COMMANDS) {
      expect(capabilitiesForNodeCommand(command)).toContain("local.shell.execute");
    }
  });
});

describe("pending predecessors", () => {
  // The mirror of the rule above. A pending claim is only honest while the command
  // is genuinely absent, so absence is asserted rather than assumed.
  it("has nothing pending once the local-files-readonly commands landed", () => {
    // Exact on purpose, like the uncovered-surface assertion: adding a pending claim
    // should be a deliberate edit here, together with a tripwire for its landing.
    expect(pendingNodeCommands()).toEqual([]);
  });

  it("claims no command that is already live", () => {
    const live = new Set<string>([
      ...DEFAULT_DANGEROUS_NODE_COMMANDS,
      ...NODE_LOCAL_FILES_READONLY_COMMANDS,
      ...NODE_SYSTEM_RUN_COMMANDS,
      NODE_BROWSER_PROXY_COMMAND,
    ]);
    for (const command of pendingNodeCommands()) {
      expect(
        live.has(command),
        `${command} is claimed as pending but is already a live command; move it to nodeCommands`,
      ).toBe(false);
    }
  });
});

describe("uncovered surface", () => {
  // §7 does not name the mobile and personal-data commands the node policy already
  // implements. Asserting the exact set means a NEW uncovered command fails here
  // instead of quietly existing with no semantic name.
  it("records exactly the dangerous commands that have no identifier", () => {
    const uncoveredDangerous = [...DEFAULT_DANGEROUS_NODE_COMMANDS]
      .filter((command) => capabilitiesForNodeCommand(command).length === 0)
      .toSorted();
    expect(uncoveredDangerous).toEqual(
      [...CAPABILITY_TAXONOMY_UNCOVERED_COMMANDS]
        .filter((command) =>
          (DEFAULT_DANGEROUS_NODE_COMMANDS as readonly string[]).includes(command),
        )
        .toSorted(),
    );
  });

  it("keeps the recorded uncovered list free of anything that is in fact covered", () => {
    for (const command of CAPABILITY_TAXONOMY_UNCOVERED_COMMANDS) {
      expect(
        capabilitiesForNodeCommand(command),
        `${command} is recorded as uncovered but maps to a capability`,
      ).toEqual([]);
    }
  });

  it("covers the dangerous commands that do have an identifier", () => {
    // Guards the other direction: these were mapped deliberately and must stay mapped.
    expect(capabilitiesForNodeCommand("screen.record")).toContain("local.screen.capture");
    expect(capabilitiesForNodeCommand("calendar.add")).toContain("account.calendar.modify");
    expect(capabilitiesForNodeCommand("sms.send")).toContain("account.messaging.send");
  });
});
