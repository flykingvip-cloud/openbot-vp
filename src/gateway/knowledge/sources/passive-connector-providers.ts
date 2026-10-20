/**
 * P5 provider registry for passive connectors.
 * Adapters implement list/fetch when ready; scaffold providers stay not_ready.
 */
import type {
  PassiveConnectorBinding,
  PassiveConnectorKind,
  PassiveConnectorSyncCandidate,
  PassiveConnectorSyncCommitFile,
} from "./passive-connector-types.js";
import { PASSIVE_CONNECTOR_PROVIDER_NOT_READY_MESSAGE } from "./passive-connector-types.js";

export type PassiveConnectorProvider = {
  kind: Exclude<PassiveConnectorKind, "localFolder">;
  /** Human label for UI. */
  displayName: string;
  /** Whether list/fetch is implemented (false = bind-only scaffold). */
  ready: boolean;
  /** Validate non-secret locator; return error message or null. */
  validateLocator: (locator: string, config: Record<string, string>) => string | null;
  /**
   * Optional: list remote inventory for server-side scan.
   * When not ready, callers must use client-driven sync.plan/commit.
   */
  listCandidates?: (binding: PassiveConnectorBinding) => Promise<PassiveConnectorSyncCandidate[]>;
  /** Optional: fetch one file for server-side commit. */
  fetchContent?: (
    binding: PassiveConnectorBinding,
    relativePath: string,
  ) => Promise<PassiveConnectorSyncCommitFile | null>;
};

function requireNonEmptyLocator(locator: string, label: string): string | null {
  if (!locator.trim()) {
    return `${label} locator required`;
  }
  return null;
}

const gitRepoProvider: PassiveConnectorProvider = {
  kind: "gitRepo",
  displayName: "Git repository",
  ready: false,
  validateLocator: (locator) => {
    const err = requireNonEmptyLocator(locator, "git");
    if (err) {
      return err;
    }
    const value = locator.trim();
    // Accept https git URLs or owner/repo shorthand.
    if (/^https?:\/\//i.test(value) || /^git@/i.test(value) || /^[\w.-]+\/[\w.-]+$/.test(value)) {
      return null;
    }
    return "git locator must be an https/git URL or owner/repo";
  },
};

const cloudDriveProvider: PassiveConnectorProvider = {
  kind: "cloudDrive",
  displayName: "Cloud drive",
  ready: false,
  validateLocator: (locator, config) => {
    const err = requireNonEmptyLocator(locator, "cloud drive");
    if (err) {
      return err;
    }
    const provider = (config.provider ?? "").trim().toLowerCase();
    if (provider && !["google", "onedrive", "dropbox", "generic"].includes(provider)) {
      return "cloudDrive config.provider must be google|onedrive|dropbox|generic";
    }
    return null;
  },
};

const mailAttachmentProvider: PassiveConnectorProvider = {
  kind: "mailAttachment",
  displayName: "Mail attachments",
  ready: false,
  validateLocator: (locator) => {
    const err = requireNonEmptyLocator(locator, "mail");
    if (err) {
      return err;
    }
    // mailbox or account id — keep loose for scaffold
    if (locator.trim().length < 3) {
      return "mail locator too short";
    }
    return null;
  },
};

const PROVIDERS: Record<Exclude<PassiveConnectorKind, "localFolder">, PassiveConnectorProvider> = {
  gitRepo: gitRepoProvider,
  cloudDrive: cloudDriveProvider,
  mailAttachment: mailAttachmentProvider,
};

export function getPassiveConnectorProvider(
  kind: Exclude<PassiveConnectorKind, "localFolder">,
): PassiveConnectorProvider {
  return PROVIDERS[kind];
}

export function listPassiveConnectorProviders(): PassiveConnectorProvider[] {
  return Object.values(PROVIDERS);
}

export function isPassiveConnectorProviderReady(
  kind: Exclude<PassiveConnectorKind, "localFolder">,
): boolean {
  return PROVIDERS[kind]?.ready;
}

export function passiveConnectorNotReadyError(kind: string): string {
  return `${kind}: ${PASSIVE_CONNECTOR_PROVIDER_NOT_READY_MESSAGE}`;
}
