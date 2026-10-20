/**
 * Convergence mapping for the semantic capability identifiers (architecture §7.6).
 *
 * §7.6 records, for every identifier, the predecessor that already exists and the
 * convergence mode to apply. Holding that here rather than only in prose means the
 * claims can be tested: `convergence.test.ts` asserts that every predecessor naming
 * a real node command actually exists in the live command constants, and that every
 * elevated-risk command the policy already knows about has an identifier.
 *
 * `mode` uses the §3.2 vocabulary. Only the three modes that apply to existing
 * surfaces appear here; `new-primitive` and `retire` are not mapping outcomes.
 */

import type { CapabilityId } from "./ids.js";

export type ConvergenceMode = "reuse" | "adapt" | "extend";

export type CapabilityConvergence = {
  /** §3.2 mode to apply when this capability is implemented. */
  mode: ConvergenceMode;
  /**
   * Concrete node command names that already implement part of this capability.
   * Empty when the predecessor is a workspace tool, connector or library rather
   * than a node command, which `predecessor` then describes in prose.
   */
  nodeCommands: readonly string[];
  /**
   * Node commands whose predecessor is real but has not landed on this base yet.
   * Deliberately the mirror of `nodeCommands`: the test asserts these are NOT in
   * the live command constants, and a tripwire fails once the owning module
   * lands, so a pending claim cannot quietly become a stale one.
   */
  pendingNodeCommands?: readonly string[];
  /** The §7.6 "current predecessor or owner" note, condensed. */
  predecessor: string;
};

/**
 * One row per identifier. Kept complete on purpose: a missing row is a gap in the
 * mapping, and `convergence.test.ts` fails when an identifier has no row.
 */
export const CAPABILITY_CONVERGENCE: Readonly<Record<CapabilityId, CapabilityConvergence>> = {
  // §7.1 Local computer
  "local.device.observe": {
    mode: "adapt",
    nodeCommands: ["device.info", "device.status", "device.permissions", "device.health"],
    predecessor: "Typed device commands already exist, including the Android additions.",
  },
  "local.file.stat": {
    mode: "extend",
    nodeCommands: ["fs.stat"],
    predecessor:
      "Workspace file tools and local-folder policies; local-disk child design adds fs.stat.",
  },
  "local.file.list": {
    mode: "extend",
    nodeCommands: ["fs.list"],
    predecessor:
      "Workspace file tools and local-folder policies; local-disk child design adds fs.list.",
  },
  "local.file.read": {
    mode: "extend",
    nodeCommands: ["fs.read"],
    predecessor: "Workspace and knowledge local-file paths; local-disk child design adds fs.read.",
  },
  "local.file.create": {
    mode: "adapt",
    nodeCommands: [],
    predecessor: "Workspace write tools and the mature shell path; no typed local-node command.",
  },
  "local.file.modify": {
    mode: "adapt",
    nodeCommands: [],
    predecessor: "Workspace write tools and the mature shell path; atomic typed command missing.",
  },
  "local.file.move": {
    mode: "adapt",
    nodeCommands: [],
    predecessor: "Workspace filesystem and the mature shell path; typed operation missing.",
  },
  "local.file.delete": {
    mode: "adapt",
    nodeCommands: [],
    predecessor:
      "Workspace filesystem, trash or shell depending on surface; L3 typed operation missing.",
  },
  "local.archive.inspect": {
    mode: "extend",
    nodeCommands: ["archive.list", "archive.readEntry"],
    predecessor:
      "Archive libraries and attachment processing; local-disk child design adds the commands.",
  },
  "local.screen.capture": {
    mode: "adapt",
    nodeCommands: ["screen.record"],
    predecessor:
      "screen.record is an existing dangerous command; canvas snapshot is a different surface.",
  },
  "local.window.observe": {
    mode: "extend",
    nodeCommands: [],
    predecessor: "Browser and canvas observation are partial predecessors.",
  },
  "local.app.launch": {
    mode: "extend",
    nodeCommands: [],
    predecessor:
      "Browser, canvas and shell can launch indirectly; shell stays the restricted fallback.",
  },
  "local.app.interact": {
    mode: "adapt",
    nodeCommands: [],
    predecessor: "Browser and canvas interaction exist for their own surfaces.",
  },
  "local.clipboard.read": {
    mode: "extend",
    nodeCommands: [],
    predecessor: "No canonical typed owner identified.",
  },
  "local.clipboard.write": {
    mode: "extend",
    nodeCommands: [],
    predecessor: "No canonical typed owner identified.",
  },
  "local.process.observe": {
    mode: "adapt",
    nodeCommands: ["device.status"],
    predecessor: "Device status and system.run provide partial evidence.",
  },
  "local.shell.execute": {
    mode: "reuse",
    nodeCommands: ["system.run", "system.run.prepare", "system.which"],
    predecessor:
      "system.run, exec policy, approvals, node invocation and sandbox. Mature and live.",
  },
  "local.system.configure": {
    mode: "adapt",
    nodeCommands: [],
    predecessor: "system.run can perform the effect but carries no semantic contract.",
  },

  // §7.2 Public network
  "network.search.public": {
    mode: "reuse",
    nodeCommands: [],
    predecessor: "Existing web search tool surface.",
  },
  "network.fetch.public": {
    mode: "reuse",
    nodeCommands: [],
    predecessor: "Existing web fetch and browser read surfaces.",
  },
  "network.download.public": {
    mode: "adapt",
    nodeCommands: ["browser.proxy"],
    predecessor: "Web fetch, browser proxy file handling and attachment pipelines.",
  },
  "network.browser.navigate": {
    mode: "reuse",
    nodeCommands: ["browser.proxy"],
    predecessor: "Existing browser tool and browser.proxy.",
  },
  "network.domain.interact": {
    mode: "adapt",
    nodeCommands: ["browser.proxy"],
    predecessor: "Existing browser actions, needing domain and effect boundaries.",
  },

  // §7.3 Connected services
  "account.mail.read": {
    mode: "reuse",
    nodeCommands: [],
    predecessor: "User and enterprise operational identities, IMAP and connector actions.",
  },
  "account.mail.draft": {
    mode: "adapt",
    nodeCommands: [],
    predecessor: "Operational-identity draft flows and connector actions.",
  },
  "account.mail.send": {
    mode: "adapt",
    nodeCommands: [],
    predecessor: "Outbound messaging and operational-identity execution, behind approval.",
  },
  "account.calendar.read": {
    mode: "reuse",
    nodeCommands: ["calendar.events"],
    predecessor: "calendar.events node command and calendar connectors.",
  },
  "account.calendar.modify": {
    mode: "adapt",
    nodeCommands: ["calendar.add"],
    predecessor:
      "calendar.add is an existing dangerous command; connector mutations may also exist.",
  },
  "account.drive.read": {
    mode: "reuse",
    nodeCommands: [],
    predecessor: "Enterprise-data and cloud-storage connectors.",
  },
  "account.drive.write": {
    mode: "adapt",
    nodeCommands: [],
    predecessor: "Enterprise-data connector actions.",
  },
  "account.crm.read": {
    mode: "reuse",
    nodeCommands: [],
    predecessor: "Enterprise-data connector capabilities and policy-backed grants.",
  },
  "account.crm.modify": {
    mode: "adapt",
    nodeCommands: [],
    predecessor: "Enterprise-data connector actions.",
  },
  "account.messaging.read": {
    mode: "reuse",
    nodeCommands: ["notifications.list", "notifications.actions"],
    predecessor: "Channel and operational-identity read surfaces; node notification commands.",
  },
  "account.messaging.send": {
    mode: "adapt",
    nodeCommands: ["sms.send"],
    predecessor: "Outbound messaging; sms.send is an existing dangerous command.",
  },

  // §7.4 Transactions and external commitments
  "external.form.submit": {
    mode: "adapt",
    nodeCommands: ["browser.proxy"],
    predecessor: "Browser actions can submit today with no semantic commit boundary.",
  },
  "external.content.publish": {
    mode: "adapt",
    nodeCommands: [],
    predecessor: "Operational-identity social and publishing paths.",
  },
  "external.file.upload": {
    mode: "adapt",
    nodeCommands: [],
    predecessor: "Connector and browser upload paths; data-egress policy applies.",
  },
  "external.contract.accept": {
    mode: "extend",
    nodeCommands: [],
    predecessor: "No owner. Requires prepared effect and explicit approval.",
  },
  "external.purchase.prepare": {
    mode: "extend",
    nodeCommands: [],
    predecessor: "No owner.",
  },
  "external.purchase.commit": {
    mode: "extend",
    nodeCommands: [],
    predecessor: "No owner. L4, transaction-specific authority required.",
  },
  "external.payment.commit": {
    mode: "extend",
    nodeCommands: [],
    predecessor: "No owner. L4, payment credentials never enter model context.",
  },
  "external.permission.modify": {
    mode: "extend",
    nodeCommands: [],
    predecessor:
      "Governance and access-control surfaces exist but carry no external commit contract.",
  },

  // §7.5 Agent collaboration
  "agent.task.delegate": {
    mode: "adapt",
    nodeCommands: [],
    predecessor: "Supervisor worker dispatch and collaboration dispatch.",
  },
  "agent.task.contribute": {
    mode: "adapt",
    nodeCommands: [],
    predecessor: "Collaboration runtime and progress ledger contributions.",
  },
  "agent.task.transfer_owner": {
    mode: "adapt",
    nodeCommands: [],
    predecessor: "Loom ownership takeover and conversation-task ownership.",
  },
  "agent.context.share": {
    mode: "adapt",
    nodeCommands: [],
    predecessor: "Collaboration context sharing, tenant-scoped.",
  },
  "agent.artifact.share": {
    mode: "adapt",
    nodeCommands: [],
    predecessor: "Deliverable and artifact surfaces.",
  },
} as const;

/**
 * Identifiers whose predecessor includes the given node command.
 *
 * Searches landed and pending predecessors alike: whether a command has a
 * semantic name is a property of the vocabulary, not of what has merged.
 */
export function capabilitiesForNodeCommand(command: string): CapabilityId[] {
  return (Object.keys(CAPABILITY_CONVERGENCE) as CapabilityId[]).filter((id) => {
    const row = CAPABILITY_CONVERGENCE[id];
    return row.nodeCommands.includes(command) || (row.pendingNodeCommands ?? []).includes(command);
  });
}

/**
 * Every node command this mapping claims as an already-landed predecessor.
 */
export function landedNodeCommands(): string[] {
  return [
    ...new Set(
      (Object.keys(CAPABILITY_CONVERGENCE) as CapabilityId[]).flatMap(
        (id) => CAPABILITY_CONVERGENCE[id].nodeCommands,
      ),
    ),
  ].toSorted();
}

/**
 * Every node command this mapping claims as an in-flight predecessor.
 *
 * Empty today. The five `local-files-readonly` operations were pending until the
 * local disk read grant landed and were then promoted to `nodeCommands`. Derived
 * from the rows rather than hand-listed, so the two cannot drift apart.
 */
export function pendingNodeCommands(): string[] {
  return [
    ...new Set(
      (Object.keys(CAPABILITY_CONVERGENCE) as CapabilityId[]).flatMap(
        (id) => CAPABILITY_CONVERGENCE[id].pendingNodeCommands ?? [],
      ),
    ),
  ].toSorted();
}

/**
 * Node commands that exist today with no semantic identifier covering them.
 *
 * §7 does not describe the mobile and personal-data surface the node command policy
 * already implements. Recorded rather than hidden: these are real capabilities with
 * no semantic name, so nothing can grant or audit them by meaning.
 */
export const CAPABILITY_TAXONOMY_UNCOVERED_COMMANDS = [
  "camera.clip",
  "camera.list",
  "camera.snap",
  "contacts.add",
  "contacts.search",
  "location.get",
  "motion.activity",
  "motion.pedometer",
  "photos.latest",
  "reminders.add",
  "reminders.list",
] as const;
