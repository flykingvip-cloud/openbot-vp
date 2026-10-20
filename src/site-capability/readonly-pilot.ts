/**
 * P3 read-only pilot harness — **protocol fixture verification** (P3 redefinition).
 *
 * Expert acceptance renamed P3 from "real-job read-only pilot" to
 * "只读试点协议夹具验证". Two low-risk stations run through the production
 * runtime: fixed version, per-capability grant, and the caller's original
 * account binding. The pages are an in-memory `ReadonlyPilotSite` fixture.
 * Latency uses the harness step clock (`SAR_PILOT_STEP_MS`), not live RTT.
 *
 * This is **not** R5 live external-site evidence and must not be labeled
 * "R5 passed" or "verified enterprise external site". A production / R5
 * pilot still needs a live account-browser control bridge + logged-in session.
 * This module does not export cookies, start a Bridge daemon, or register
 * capabilities on the default process catalog. Xiaohongshu is not a station.
 */

import { createHash } from "node:crypto";
import type { LookupFn } from "../infra/net/ssrf.js";
import type { SiteCapabilityManifest } from "./contract.js";
import type { PrivatePlanDraft } from "./draft-store.js";
import { SarExecutionAuthority, memoryEpochStore } from "./execution-authority.js";
import { proposeRepair, type RepairProposal } from "./failure-class.js";
import { TrustedOperationFault, type TrustedPagePort } from "./operations.js";
import type { SiteEvidence, SiteRunResult } from "./result.js";
import {
  SiteCapabilityRuntime,
  type SiteCapabilityRecord,
  type SiteInputField,
  type SitePlanStep,
} from "./runtime.js";
import type { ServerPrincipal } from "./session-handle.js";
import {
  ThinValidationRunner,
  type IndependentReviewEvidence,
  type ValidationBasis,
  type ValidationRecord,
  type ValidationVerdict,
} from "./validation-record.js";

export const SAR_PILOT_VERSION = "2026.10.17";
export const SAR_PILOT_UNGRAENTED_VERSION = "9.9.9";
/** Fixed harness cost for one trusted page operation. Not a live network RTT. */
export const SAR_PILOT_STEP_MS = 5;

export const SAR_PILOT_BULLETIN_ORIGIN = "https://pilot.bulletin.test";
export const SAR_PILOT_INBOX_ORIGIN = "https://pilot.inbox.test";
export const SAR_PILOT_BULLETIN_ID = "pilot.bulletin.read";
export const SAR_PILOT_INBOX_ID = "pilot.inbox.summary";

export const SAR_PILOT_PRINCIPAL: ServerPrincipal = {
  tenantId: "tenant-pilot",
  userId: "user-pilot",
};
export const SAR_PILOT_BULLETIN_ONLY_PRINCIPAL: ServerPrincipal = {
  tenantId: "tenant-pilot",
  userId: "user-bulletin-only",
};
export const SAR_PILOT_OTHER_PRINCIPAL: ServerPrincipal = {
  tenantId: "tenant-pilot",
  userId: "user-other",
};

export const SAR_PILOT_BINDING_ID = "bind-pilot-original";
export const SAR_PILOT_SPARE_BINDING_ID = "bind-pilot-spare";
export const SAR_PILOT_BULLETIN_ONLY_BINDING_ID = "bind-pilot-bulletin-only";
export const SAR_PILOT_FOREIGN_BINDING_ID = "bind-pilot-foreign";

/** Obvious fake pair. Harness session only. Never returned by list, describe, or invoke. */
export const SAR_PILOT_FIXTURE_CREDENTIALS = {
  username: "pilot-fixture-user",
  password: "pilot-fixture-pass",
} as const;

export const SAR_PILOT_GROUND_TRUTH = {
  bulletin: {
    desk: "ops",
    bulletins: [
      { id: "bn-1", title: "Ops window" },
      { id: "bn-2", title: "Handoff note" },
    ],
  },
  inbox: {
    mailbox: "primary",
    messages: [{ id: "msg-1", title: "Unread summary" }],
  },
} as const;

const BULLETIN_PACKAGE_ID = "pilot-bulletin-pack";
const INBOX_PACKAGE_ID = "pilot-inbox-pack";
const READ_PERMISSIONS = ["navigate", "read_page", "request_context", "capture_result"] as const;

const publicLookup = (async () => [{ address: "93.184.216.34", family: 4 }]) as unknown as LookupFn;

export type PilotFault =
  | "STRUCTURE_CHANGED"
  | "AUTH_REQUIRED"
  | "UPSTREAM_TIMEOUT"
  | "RESULT_UNKNOWN"
  | "CAPTCHA"
  | "RATE_LIMITED";

export type PilotStationId = "bulletin" | "inbox";

type Bulletin = { id: string; title: string };
type InboxMessage = { id: string; title: string };

type PilotPage =
  | { kind: "home" }
  | { kind: "bulletin"; desk: string; bulletins: Bulletin[] }
  | { kind: "inbox"; mailbox: string; messages: InboxMessage[] };

export type PilotStation = {
  id: PilotStationId;
  capabilityId: string;
  version: string;
  origin: string;
  argName: "desk" | "mailbox";
  manifest: SiteCapabilityManifest;
  plan: readonly SitePlanStep[];
  inputFields: readonly SiteInputField[];
  artifactDigest: string;
  packageId: string;
  captureFields: readonly string[];
  browserReadFields: readonly string[];
};

export type PilotHarness = {
  site: ReadonlyPilotSite;
  runtime: SiteCapabilityRuntime;
  authority: SarExecutionAuthority;
  port: TrustedPagePort;
  principal: ServerPrincipal;
  bulletinOnlyPrincipal: ServerPrincipal;
  otherPrincipal: ServerPrincipal;
  bindingId: string;
  spareBindingId: string;
  stations: { bulletin: PilotStation; inbox: PilotStation };
  resetMetrics(): void;
  metrics(): { dispatches: number; now: number };
  dispose(): void;
};

function digest(capabilityId: string, version: string, plan: readonly SitePlanStep[]): string {
  const body = JSON.stringify({ capabilityId, version, plan });
  return `sha256:${createHash("sha256").update(body).digest("hex")}`;
}

function manifestFor(input: {
  id: string;
  version: string;
  site: string;
  operation: string;
  description: string;
  authMode: SiteCapabilityManifest["authMode"];
  origin: string;
}): SiteCapabilityManifest {
  return {
    schemaVersion: "1",
    id: input.id,
    version: input.version,
    site: input.site,
    operation: input.operation,
    description: input.description,
    effect: "read",
    authMode: input.authMode,
    executionMode: "browser_dom",
    allowedOrigins: [input.origin],
    permissions: [...READ_PERMISSIONS],
  };
}

function buildStation(input: {
  id: PilotStationId;
  capabilityId: string;
  site: string;
  operation: string;
  description: string;
  authMode: SiteCapabilityManifest["authMode"];
  origin: string;
  argName: "desk" | "mailbox";
  path: string;
  captureFields: readonly string[];
  browserReadFields: readonly string[];
  packageId: string;
}): PilotStation {
  const plan: SitePlanStep[] = [
    {
      op: "navigate",
      urlTemplate: `${input.origin}${input.path}?${input.argName}={${input.argName}}`,
    },
    { op: "capture_result", fields: [...input.captureFields] },
  ];
  return {
    id: input.id,
    capabilityId: input.capabilityId,
    version: SAR_PILOT_VERSION,
    origin: input.origin,
    argName: input.argName,
    manifest: manifestFor({
      id: input.capabilityId,
      version: SAR_PILOT_VERSION,
      site: input.site,
      operation: input.operation,
      description: input.description,
      authMode: input.authMode,
      origin: input.origin,
    }),
    plan,
    inputFields: [{ name: input.argName, required: true }],
    artifactDigest: digest(input.capabilityId, SAR_PILOT_VERSION, plan),
    packageId: input.packageId,
    captureFields: input.captureFields,
    browserReadFields: input.browserReadFields,
  };
}

export const SAR_PILOT_BULLETIN = buildStation({
  id: "bulletin",
  capabilityId: SAR_PILOT_BULLETIN_ID,
  site: "pilot.bulletin.test",
  operation: "bulletin.read",
  description: "Read published notices for one desk",
  authMode: "none",
  origin: SAR_PILOT_BULLETIN_ORIGIN,
  argName: "desk",
  path: "/bulletins",
  captureFields: ["desk", "bulletins"],
  browserReadFields: ["count", "firstTitle"],
  packageId: BULLETIN_PACKAGE_ID,
});

export const SAR_PILOT_INBOX = buildStation({
  id: "inbox",
  capabilityId: SAR_PILOT_INBOX_ID,
  site: "pilot.inbox.test",
  operation: "inbox.summary",
  description: "Read the bound account inbox summary",
  authMode: "browser_session",
  origin: SAR_PILOT_INBOX_ORIGIN,
  argName: "mailbox",
  path: "/inbox",
  captureFields: ["mailbox", "messages"],
  browserReadFields: ["count", "firstTitle"],
  packageId: INBOX_PACKAGE_ID,
});

export const SAR_PILOT_STATION_IDS = [SAR_PILOT_BULLETIN_ID, SAR_PILOT_INBOX_ID] as const;

export function pilotNavigationUrl(
  station: PilotStation,
  args: Readonly<Record<string, string>>,
): string {
  const value = args[station.argName] ?? "";
  return `${station.origin}${station.id === "bulletin" ? "/bulletins" : "/inbox"}?${station.argName}=${encodeURIComponent(value)}`;
}

function recordFor(
  station: PilotStation,
  version = station.version,
  plan = station.plan,
): SiteCapabilityRecord {
  const artifactDigest =
    version === station.version && plan === station.plan
      ? station.artifactDigest
      : digest(station.capabilityId, version, plan);
  return {
    manifest: { ...station.manifest, version },
    inputFields: station.inputFields,
    inputSchema: {
      type: "object",
      properties: { [station.argName]: { type: "string" } },
      required: [station.argName],
      additionalProperties: false,
    },
    outputSchema: { type: "object" },
    accountSummary:
      station.manifest.authMode === "browser_session"
        ? "Requires the original account-browser binding for this capability."
        : "No site login. Runs in the caller's account browser.",
    verification: "passed",
    artifactDigest,
    disabled: false,
    packageId: station.packageId,
    plan,
    lifecycle: "approved",
  };
}

/**
 * Controllable read-only pages for the two pilot stations.
 * Session establishment is harness state. It is not a SAR write and it does
 * not export cookies.
 */
export class ReadonlyPilotSite {
  private page: PilotPage = { kind: "home" };
  private authenticated = false;
  private faults: Record<PilotStationId, PilotFault | null> = {
    bulletin: null,
    inbox: null,
  };

  reset(): void {
    this.page = { kind: "home" };
    this.authenticated = false;
    this.faults = { bulletin: null, inbox: null };
  }

  currentPage(): PilotPage["kind"] {
    return this.page.kind;
  }

  authenticatedSession(): boolean {
    return this.authenticated;
  }

  injectError(station: PilotStationId, fault: PilotFault | null): void {
    this.faults[station] = fault;
  }

  faultSnapshot(): Record<PilotStationId, PilotFault | null> {
    return { ...this.faults };
  }

  /**
   * Bind the fixture browser session to the original account.
   * Callers must not send these credentials through site_invoke.
   */
  establishFixtureSession(username: string, password: string): boolean {
    const ok =
      username === SAR_PILOT_FIXTURE_CREDENTIALS.username &&
      password === SAR_PILOT_FIXTURE_CREDENTIALS.password;
    this.authenticated = ok;
    return ok;
  }

  acceptNavigation(url: string): { finalUrl: string } {
    const parsed = new URL(url);
    if (parsed.origin === SAR_PILOT_BULLETIN_ORIGIN && parsed.pathname === "/bulletins") {
      this.readBulletin(parsed.searchParams.get("desk") ?? "");
      return { finalUrl: url };
    }
    if (parsed.origin === SAR_PILOT_INBOX_ORIGIN && parsed.pathname === "/inbox") {
      this.readInbox(parsed.searchParams.get("mailbox") ?? "");
      return { finalUrl: url };
    }
    throw new TrustedOperationFault("STRUCTURE_CHANGED");
  }

  readFields(fields: readonly string[]): Record<string, string | null> {
    this.assertPageFault();
    const source = this.fieldSource();
    const out: Record<string, string | null> = {};
    for (const field of fields) {
      const value = source[field];
      out[field] = value === undefined ? null : value;
    }
    return out;
  }

  requestContext(name: string): { origin: string; data: Record<string, unknown> } {
    const origin = this.page.kind === "inbox" ? SAR_PILOT_INBOX_ORIGIN : SAR_PILOT_BULLETIN_ORIGIN;
    if (name === "session") {
      return { origin, data: { authenticated: this.authenticated } };
    }
    return { origin, data: { page: this.page.kind } };
  }

  capture(fields: readonly string[]): Record<string, unknown> {
    this.assertPageFault();
    const ground = this.groundTruth();
    const data: Record<string, unknown> = {};
    for (const field of fields) {
      if (field in ground) {
        data[field] = ground[field];
      }
    }
    return data;
  }

  private readBulletin(desk: string): void {
    const fault = this.faults.bulletin;
    if (fault) {
      throw new TrustedOperationFault(fault);
    }
    const bulletins =
      desk === SAR_PILOT_GROUND_TRUTH.bulletin.desk
        ? [...SAR_PILOT_GROUND_TRUTH.bulletin.bulletins]
        : [];
    this.page = { kind: "bulletin", desk, bulletins };
  }

  private readInbox(mailbox: string): void {
    const fault = this.faults.inbox;
    if (fault) {
      throw new TrustedOperationFault(fault);
    }
    if (!this.authenticated) {
      throw new TrustedOperationFault("AUTH_REQUIRED");
    }
    const messages =
      mailbox === SAR_PILOT_GROUND_TRUTH.inbox.mailbox
        ? [...SAR_PILOT_GROUND_TRUTH.inbox.messages]
        : [];
    this.page = { kind: "inbox", mailbox, messages };
  }

  private assertPageFault(): void {
    if (this.page.kind === "bulletin" && this.faults.bulletin) {
      throw new TrustedOperationFault(this.faults.bulletin);
    }
    if (this.page.kind === "inbox" && this.faults.inbox) {
      throw new TrustedOperationFault(this.faults.inbox);
    }
  }

  private fieldSource(): Record<string, string> {
    if (this.page.kind === "bulletin") {
      return {
        desk: this.page.desk,
        count: String(this.page.bulletins.length),
        firstTitle: this.page.bulletins[0]?.title ?? "",
      };
    }
    if (this.page.kind === "inbox") {
      return {
        mailbox: this.page.mailbox,
        count: String(this.page.messages.length),
        firstTitle: this.page.messages[0]?.title ?? "",
      };
    }
    return { page: "home" };
  }

  private groundTruth(): Record<string, unknown> {
    if (this.page.kind === "bulletin") {
      return { desk: this.page.desk, bulletins: this.page.bulletins };
    }
    if (this.page.kind === "inbox") {
      return { mailbox: this.page.mailbox, messages: this.page.messages };
    }
    return { page: "home" };
  }
}

export function createReadonlyPilotHarness(): PilotHarness {
  const site = new ReadonlyPilotSite();
  let ticks = 0;
  let dispatches = 0;
  const port = countingPort(site, () => {
    dispatches += 1;
    ticks += SAR_PILOT_STEP_MS;
  });
  const authority = new SarExecutionAuthority(memoryEpochStore(), { lookupFn: publicLookup });
  authority.boot();
  authority.registerBinding({
    bindingId: SAR_PILOT_BINDING_ID,
    tenantId: SAR_PILOT_PRINCIPAL.tenantId,
    userId: SAR_PILOT_PRINCIPAL.userId,
  });
  authority.registerBinding({
    bindingId: SAR_PILOT_SPARE_BINDING_ID,
    tenantId: SAR_PILOT_PRINCIPAL.tenantId,
    userId: SAR_PILOT_PRINCIPAL.userId,
  });
  authority.registerBinding({
    bindingId: SAR_PILOT_BULLETIN_ONLY_BINDING_ID,
    tenantId: SAR_PILOT_BULLETIN_ONLY_PRINCIPAL.tenantId,
    userId: SAR_PILOT_BULLETIN_ONLY_PRINCIPAL.userId,
  });
  authority.registerBinding({
    bindingId: SAR_PILOT_FOREIGN_BINDING_ID,
    tenantId: SAR_PILOT_OTHER_PRINCIPAL.tenantId,
    userId: SAR_PILOT_OTHER_PRINCIPAL.userId,
  });
  const runtime = new SiteCapabilityRuntime({
    authority,
    portForScope: () => port,
    now: () => ticks,
  });
  const bulletin = recordFor(SAR_PILOT_BULLETIN);
  const inbox = recordFor(SAR_PILOT_INBOX);
  const ungranted = recordFor(SAR_PILOT_BULLETIN, SAR_PILOT_UNGRAENTED_VERSION, [
    { op: "navigate", urlTemplate: `${SAR_PILOT_BULLETIN_ORIGIN}/wrong?desk={desk}` },
    { op: "capture_result", fields: ["marker"] },
  ]);
  for (const record of [bulletin, inbox, ungranted]) {
    const registered = runtime.register(record);
    if (!registered.ok) {
      throw new Error(registered.message);
    }
  }
  runtime.grant({
    tenantId: SAR_PILOT_PRINCIPAL.tenantId,
    userId: SAR_PILOT_PRINCIPAL.userId,
    capabilityId: SAR_PILOT_BULLETIN.capabilityId,
    version: SAR_PILOT_VERSION,
    artifactDigest: SAR_PILOT_BULLETIN.artifactDigest,
    accountBindingIds: [SAR_PILOT_BINDING_ID],
  });
  runtime.grant({
    tenantId: SAR_PILOT_PRINCIPAL.tenantId,
    userId: SAR_PILOT_PRINCIPAL.userId,
    capabilityId: SAR_PILOT_INBOX.capabilityId,
    version: SAR_PILOT_VERSION,
    artifactDigest: SAR_PILOT_INBOX.artifactDigest,
    accountBindingIds: [SAR_PILOT_BINDING_ID],
  });
  runtime.grant({
    tenantId: SAR_PILOT_BULLETIN_ONLY_PRINCIPAL.tenantId,
    userId: SAR_PILOT_BULLETIN_ONLY_PRINCIPAL.userId,
    capabilityId: SAR_PILOT_BULLETIN.capabilityId,
    version: SAR_PILOT_VERSION,
    artifactDigest: SAR_PILOT_BULLETIN.artifactDigest,
    accountBindingIds: [SAR_PILOT_BULLETIN_ONLY_BINDING_ID],
  });
  return {
    site,
    runtime,
    authority,
    port,
    principal: SAR_PILOT_PRINCIPAL,
    bulletinOnlyPrincipal: SAR_PILOT_BULLETIN_ONLY_PRINCIPAL,
    otherPrincipal: SAR_PILOT_OTHER_PRINCIPAL,
    bindingId: SAR_PILOT_BINDING_ID,
    spareBindingId: SAR_PILOT_SPARE_BINDING_ID,
    stations: { bulletin: SAR_PILOT_BULLETIN, inbox: SAR_PILOT_INBOX },
    resetMetrics() {
      ticks = 0;
      dispatches = 0;
    },
    metrics() {
      return { dispatches, now: ticks };
    },
    dispose() {
      authority.dispose();
    },
  };
}

function countingPort(site: ReadonlyPilotSite, charge: () => void): TrustedPagePort {
  return {
    navigate: async (url) => {
      charge();
      return site.acceptNavigation(url);
    },
    readFields: async (fields) => {
      charge();
      return site.readFields(fields);
    },
    requestContext: async (name) => {
      charge();
      return site.requestContext(name);
    },
    capture: async (fields) => {
      charge();
      return site.capture(fields);
    },
  };
}

/** Store one thin validation record for a pilot run. No extra scoring. */
export function recordPilotBusinessVerification(input: {
  runner: ThinValidationRunner;
  capabilityId: string;
  version: string;
  artifactDigest: string;
  args: Readonly<Record<string, string>>;
  generationParams: Readonly<Record<string, string>>;
  run: SiteRunResult;
  evidence: SiteEvidence;
  reviewer: string;
  reviewedAt: string;
  basis: ValidationBasis;
  humanVerdict?: ValidationVerdict;
  humanReason?: string;
  independentReviewEvidence?: IndependentReviewEvidence;
}): { ok: true; record: ValidationRecord } | { ok: false; code: string; message: string } {
  return input.runner.assess({
    capabilityId: input.capabilityId,
    version: input.version,
    artifactDigest: input.artifactDigest,
    args: input.args,
    generationParams: input.generationParams,
    run: input.run,
    evidence: input.evidence,
    reviewer: input.reviewer,
    reviewedAt: input.reviewedAt,
    basis: input.basis,
    humanVerdict: input.humanVerdict,
    humanReason: input.humanReason,
    independentReviewEvidence: input.independentReviewEvidence,
  });
}

export function pilotSourceDraft(
  station: PilotStation,
  principal: ServerPrincipal,
  accountBindingId: string,
): PrivatePlanDraft {
  return {
    draftId: `pilot-source-${station.id}`,
    capabilityId: station.capabilityId,
    version: station.version,
    lifecycle: "private",
    enabled: false,
    published: false,
    manifest: station.manifest,
    plan: station.plan,
    inputFields: station.inputFields,
    artifactDigest: station.artifactDigest,
    sourceEvidenceRef: "",
    generationParams: {},
    accountBindingIds: [accountBindingId],
    tenantId: principal.tenantId,
    userId: principal.userId,
    packageId: station.packageId,
    createdAt: "2026-10-17T00:00:00.000Z",
  };
}

/** Reuse P2 classification. The proposal cannot publish, switch accounts, or expand grants. */
export function attributePilotFailure(input: {
  result?: SiteRunResult;
  validationFailed?: boolean;
  source: PrivatePlanDraft;
  now?: string;
}): RepairProposal {
  return proposeRepair({
    result: input.result,
    validationFailed: input.validationFailed,
    sourceDraft: input.source,
    accountBindingId: input.source.accountBindingIds[0],
    now: input.now ?? "2026-10-17T00:00:00.000Z",
    mintDraftId: () => `pilot-repair-${input.source.capabilityId}`,
  });
}
