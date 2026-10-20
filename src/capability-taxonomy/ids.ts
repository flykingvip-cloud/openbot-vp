/**
 * Semantic capability identifiers (architecture §7).
 *
 * Stable names for what an action *means*, independent of which tool performs it.
 * The architecture states the rule plainly: "Capabilities use stable semantic
 * identifiers rather than implementation-specific tool names", and §4.1 adds that
 * tool availability is never authorization.
 *
 * This module is a pure vocabulary. It grants nothing, decides nothing, performs no
 * IO, and imports no subsystem, so adopting it cannot change any existing behavior.
 * Its value is that §7 stops being prose: the identifiers become checkable, and
 * `convergence.ts` ties each one to the real predecessor operation that exists today.
 */

/** §7.1 Local computer. */
export const LOCAL_CAPABILITY_IDS = [
  "local.device.observe",
  "local.file.stat",
  "local.file.list",
  "local.file.read",
  "local.file.create",
  "local.file.modify",
  "local.file.move",
  "local.file.delete",
  "local.archive.inspect",
  "local.screen.capture",
  "local.window.observe",
  "local.app.launch",
  "local.app.interact",
  "local.clipboard.read",
  "local.clipboard.write",
  "local.process.observe",
  "local.shell.execute",
  "local.system.configure",
] as const;

/** §7.2 Public network. */
export const NETWORK_CAPABILITY_IDS = [
  "network.search.public",
  "network.fetch.public",
  "network.download.public",
  "network.browser.navigate",
  "network.domain.interact",
] as const;

/** §7.3 Connected services. */
export const ACCOUNT_CAPABILITY_IDS = [
  "account.mail.read",
  "account.mail.draft",
  "account.mail.send",
  "account.calendar.read",
  "account.calendar.modify",
  "account.drive.read",
  "account.drive.write",
  "account.crm.read",
  "account.crm.modify",
  "account.messaging.read",
  "account.messaging.send",
] as const;

/** §7.4 Transactions and external commitments. */
export const EXTERNAL_CAPABILITY_IDS = [
  "external.form.submit",
  "external.content.publish",
  "external.file.upload",
  "external.contract.accept",
  "external.purchase.prepare",
  "external.purchase.commit",
  "external.payment.commit",
  "external.permission.modify",
] as const;

/** §7.5 Agent collaboration. */
export const AGENT_CAPABILITY_IDS = [
  "agent.task.delegate",
  "agent.task.contribute",
  "agent.task.transfer_owner",
  "agent.context.share",
  "agent.artifact.share",
] as const;

export const CAPABILITY_IDS = [
  ...LOCAL_CAPABILITY_IDS,
  ...NETWORK_CAPABILITY_IDS,
  ...ACCOUNT_CAPABILITY_IDS,
  ...EXTERNAL_CAPABILITY_IDS,
  ...AGENT_CAPABILITY_IDS,
] as const;

export type CapabilityId = (typeof CAPABILITY_IDS)[number];

/** The five §7 groups, keyed by the identifier prefix. */
export type CapabilityGroup = "local" | "network" | "account" | "external" | "agent";

export function isCapabilityId(value: unknown): value is CapabilityId {
  return typeof value === "string" && (CAPABILITY_IDS as readonly string[]).includes(value);
}

/** Group of an identifier, taken from its first dot-separated segment. */
export function capabilityGroup(id: CapabilityId): CapabilityGroup {
  return id.slice(0, id.indexOf(".")) as CapabilityGroup;
}
