/**
 * The `local-files-readonly` capability profile (design 4.2 and 9.5).
 *
 * Two things this module exists to prevent:
 *
 * 1. A node that declares read-only commands but still answers `system.run`.
 *    Hiding `system.run` from the model's tool list is not enough — the node must
 *    refuse the command on arrival even if the gateway mistakenly forwards it.
 *
 * 2. A node whose declared command set drifts from the profile. The commands a
 *    node declares about itself are not a security document. Connection identity
 *    requires five values to be exactly equal, and one command too many or too
 *    few is a refusal.
 */

import { LOCAL_FILES_CAP } from "./events.js";
import {
  LOCAL_FILES_OPERATIONS,
  LOCAL_FILES_READONLY_PROFILE,
  type LocalFilesOperation,
} from "./types.js";

/** The complete command surface. Exactly five, no more and no fewer. */
export const LOCAL_FILES_READONLY_COMMANDS: readonly LocalFilesOperation[] = LOCAL_FILES_OPERATIONS;

const PROFILE_COMMAND_SET: ReadonlySet<string> = new Set<string>(LOCAL_FILES_READONLY_COMMANDS);

/**
 * Commands explicitly named as denied for this profile, so a rejection can cite a
 * rule rather than just "not in the allowlist". The `system.*` prefix check below
 * is the actual guarantee; this list keeps the audit trail legible.
 */
export const PROFILE_DENIED_COMMANDS = [
  "system.run",
  "system.run.prepare",
  "system.which",
  "system.notify",
  "system.execApprovals.get",
  "system.execApprovals.set",
] as const;

export type CommandGateResult =
  | { ok: true; operation: LocalFilesOperation }
  | { ok: false; reason: "system-command-denied" | "not-in-profile"; command: string };

/**
 * Gate a single command against the profile.
 *
 * `system.*` is refused by prefix, not by enumerating names, so a future
 * `system.anything` is denied by default rather than by remembering to add it.
 */
export function gateProfileCommand(command: string): CommandGateResult {
  const trimmed = command.trim();
  if (trimmed.startsWith("system.")) {
    return { ok: false, reason: "system-command-denied", command: trimmed };
  }
  if (!PROFILE_COMMAND_SET.has(trimmed)) {
    return { ok: false, reason: "not-in-profile", command: trimmed };
  }
  return { ok: true, operation: trimmed as LocalFilesOperation };
}

export type ProfileCommandSetCheck =
  | { ok: true }
  | {
      ok: false;
      reason: "extra-commands" | "missing-commands";
      extra: string[];
      missing: string[];
    };

/**
 * Require a declared command list to equal the profile exactly.
 *
 * Not a subset check: a node declaring four of the five is as wrong as one
 * declaring six, because both mean the running configuration is not the profile
 * that was bound.
 */
export function checkProfileCommandSet(declared: readonly string[]): ProfileCommandSetCheck {
  const declaredSet = new Set(declared.map((cmd) => cmd.trim()).filter(Boolean));
  const extra = [...declaredSet].filter((cmd) => !PROFILE_COMMAND_SET.has(cmd)).toSorted();
  const missing = LOCAL_FILES_READONLY_COMMANDS.filter((cmd) => !declaredSet.has(cmd)).toSorted();
  if (extra.length > 0) {
    return { ok: false, reason: "extra-commands", extra, missing };
  }
  if (missing.length > 0) {
    return { ok: false, reason: "missing-commands", extra, missing };
  }
  return { ok: true };
}

export type ConnectionIdentityInput = {
  /** Profile recorded on the device binding. */
  bindingProfile: string;
  /** Device public key recorded on the binding. */
  bindingDevicePublicKey: string;
  /** Profile the node host was launched with. */
  nodeConfiguredProfile: string;
  /** Device public key authenticated for this live connection. */
  connectionDevicePublicKey: string;
  /** Commands the node declared in its handshake. */
  declaredCommands: readonly string[];
};

export type ConnectionIdentityResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "binding-profile-mismatch"
        | "node-profile-mismatch"
        | "device-key-mismatch"
        | "command-set-mismatch";
      detail?: string;
    };

/**
 * True when a node declared every read-only file command.
 *
 * Extra commands are allowed. A paired Mac also declares `system.run`; that
 * must not hide the file commands, and it must not turn the node into the
 * exclusive read-only profile (which refuses anything outside the five).
 */
export function declaresLocalFilesCommands(declared: readonly string[]): boolean {
  const declaredSet = new Set(declared.map((cmd) => cmd.trim()).filter(Boolean));
  return LOCAL_FILES_READONLY_COMMANDS.every((cmd) => declaredSet.has(cmd));
}

/**
 * Profile a connection advertised.
 *
 * Exclusive `local-files` (no `system` cap) is the read-only profile whose
 * handshake must match the five commands exactly. A paired computer advertises
 * both, and stays a normal node that can also serve signed file reads.
 */
export function capabilityProfileFromCaps(caps: unknown): string | undefined {
  const list = Array.isArray(caps) ? caps.map((cap) => String(cap)) : [];
  if (!list.includes(LOCAL_FILES_CAP)) {
    return undefined;
  }
  // `system` plus `local-files` is a paired computer, not the exclusive
  // profile. The handshake exact-set check applies only to the exclusive
  // profile, so a Mac that also runs commands can still connect.
  if (list.includes("system")) {
    return undefined;
  }
  return LOCAL_FILES_READONLY_PROFILE;
}

/**
 * Identity a connection must satisfy before a file capability is redeemed.
 *
 * The binding is always the read-only profile: that is the only profile the
 * device-binding store accepts, and it does not authorize `system.run`.
 *
 * Two nodes may present that binding:
 *
 * - An exclusive read-only node launched as `local-files-readonly`. Its
 *   declared commands must equal the five file commands. One extra command
 *   (for example `system.run`) is a drifted configuration and is refused.
 * - A paired computer. It advertises `local-files` together with `system`,
 *   so `capabilityProfileFromCaps` leaves the session profile unset. The
 *   redeem handler therefore passes an empty profile. That computer must
 *   still declare every file command. Extra commands stay on their own
 *   approval path and do not widen this capability.
 */
export function verifyConnectionIdentity(input: ConnectionIdentityInput): ConnectionIdentityResult {
  if (input.bindingProfile !== LOCAL_FILES_READONLY_PROFILE) {
    return { ok: false, reason: "binding-profile-mismatch", detail: input.bindingProfile };
  }
  if (input.bindingDevicePublicKey !== input.connectionDevicePublicKey) {
    return { ok: false, reason: "device-key-mismatch" };
  }

  const configured = input.nodeConfiguredProfile.trim();
  const exclusive = configured === LOCAL_FILES_READONLY_PROFILE;
  // Empty means the live session did not claim the exclusive profile. A
  // paired Mac looks like this: mixed caps, file commands plus system.run.
  const pairedComputer = configured.length === 0;
  if (!exclusive && !pairedComputer) {
    return { ok: false, reason: "node-profile-mismatch", detail: input.nodeConfiguredProfile };
  }

  if (exclusive) {
    const commandCheck = checkProfileCommandSet(input.declaredCommands);
    if (!commandCheck.ok) {
      return {
        ok: false,
        reason: "command-set-mismatch",
        detail: `extra=[${commandCheck.extra.join(",")}] missing=[${commandCheck.missing.join(",")}]`,
      };
    }
    return { ok: true };
  }

  if (!declaresLocalFilesCommands(input.declaredCommands)) {
    const commandCheck = checkProfileCommandSet(input.declaredCommands);
    const missing = commandCheck.ok ? [] : commandCheck.missing;
    return {
      ok: false,
      reason: "command-set-mismatch",
      detail: `missing=[${missing.join(",")}]`,
    };
  }
  return { ok: true };
}

export { LOCAL_FILES_READONLY_PROFILE };
