/**
 * Controllable in-memory site for SAR.
 * Search, detail, login, public query, and logged-in query ship with ground truth.
 * Resettable. Faults are injectable. Credentials are fixture-only.
 */

import type { SiteCapabilityManifest } from "./contract.js";
import { TrustedOperationFault, type TrustedPagePort } from "./operations.js";

export const SAR_FIXTURE_ORIGIN = "https://fixture.sar.test";

/** Obvious fake pair. Never a personal credential. */
export const SAR_FIXTURE_CREDENTIALS = {
  username: "fixture-user",
  password: "fixture-pass",
} as const;

export const SAR_FIXTURE_GROUND_TRUTH = {
  search: {
    query: "widget",
    items: [
      { id: "item-1", title: "Widget A" },
      { id: "item-2", title: "Widget B" },
    ],
  },
  detail: {
    "item-1": { id: "item-1", title: "Widget A", price: "10", stock: "in_stock" },
    "item-2": { id: "item-2", title: "Widget B", price: "20", stock: "in_stock" },
  },
  login: {
    authenticated: true,
    displayName: "Fixture User",
  },
  publicQuery: {
    query: "widget",
    items: [
      { id: "pub-1", title: "Public Widget" },
      { id: "pub-2", title: "Public Gadget" },
    ],
  },
  accountQuery: {
    query: "order",
    orders: [{ id: "ord-1", title: "Fixture Order" }],
  },
  /**
   * Notes read is not a preinstalled capability. Task A and the held-out
   * topic are separate ground-truth rows. Unknown topics stay empty.
   */
  notes: {
    taskA: {
      topic: "alpha",
      notes: [{ id: "note-1", title: "Alpha note" }],
    },
    heldOut: {
      topic: "beta",
      notes: [{ id: "note-2", title: "Beta note" }],
    },
  },
} as const;

export const SAR_FIXTURE_CAPABILITY: SiteCapabilityManifest = {
  schemaVersion: "1",
  id: "fixture.sar.read",
  version: "1.0.0",
  site: "fixture.sar.test",
  operation: "read",
  description: "Read-only controllable fixture site",
  effect: "read",
  authMode: "browser_session",
  executionMode: "browser_dom",
  allowedOrigins: [SAR_FIXTURE_ORIGIN],
  permissions: ["navigate", "read_page", "request_context", "capture_result"],
};

export type FixtureScenario = "search" | "detail" | "login" | "public" | "account" | "notes";
export type FixtureFault =
  | "STRUCTURE_CHANGED"
  | "AUTH_REQUIRED"
  | "UPSTREAM_TIMEOUT"
  | "RESULT_UNKNOWN";

type SearchItem = { id: string; title: string };
type DetailRecord = { id: string; title: string; price: string; stock: string };

type PublicItem = { id: string; title: string };
type AccountOrder = { id: string; title: string };
type NoteItem = { id: string; title: string };

type PageState =
  | { kind: "home" }
  | { kind: "search"; query: string; items: SearchItem[] }
  | { kind: "detail"; item: DetailRecord }
  | { kind: "account"; authenticated: boolean; displayName: string }
  | { kind: "public"; query: string; items: PublicItem[] }
  | { kind: "accountQuery"; query: string; orders: AccountOrder[] }
  | { kind: "notes"; topic: string; notes: NoteItem[] }
  | { kind: "wrong" };

export class ControllableTestSite {
  private page: PageState = { kind: "home" };
  private authenticated = false;
  private displayName = "";
  private faults: Record<FixtureScenario, FixtureFault | null> = {
    search: null,
    detail: null,
    login: null,
    public: null,
    account: null,
    notes: null,
  };

  reset(): void {
    this.page = { kind: "home" };
    this.authenticated = false;
    this.displayName = "";
    this.faults = {
      search: null,
      detail: null,
      login: null,
      public: null,
      account: null,
      notes: null,
    };
  }

  currentPage(): PageState["kind"] {
    return this.page.kind;
  }

  injectError(scenario: FixtureScenario, fault: FixtureFault | null): void {
    this.faults[scenario] = fault;
  }

  search(
    query: string,
  ): { ok: true; items: readonly SearchItem[] } | { ok: false; fault: FixtureFault } {
    if (this.faults.search) {
      return { ok: false, fault: this.faults.search };
    }
    const items =
      query === SAR_FIXTURE_GROUND_TRUTH.search.query ? SAR_FIXTURE_GROUND_TRUTH.search.items : [];
    this.page = { kind: "search", query, items: [...items] };
    return { ok: true, items };
  }

  detail(id: string): { ok: true; item: DetailRecord } | { ok: false; fault: FixtureFault } {
    if (this.faults.detail) {
      return { ok: false, fault: this.faults.detail };
    }
    const item = SAR_FIXTURE_GROUND_TRUTH.detail[id as "item-1" | "item-2"];
    if (!item) {
      this.page = { kind: "detail", item: { id, title: "", price: "", stock: "missing" } };
      return { ok: true, item: { id, title: "", price: "", stock: "missing" } };
    }
    this.page = { kind: "detail", item: { ...item } };
    return { ok: true, item: { ...item } };
  }

  /**
   * Fixture login. Accepts only SAR_FIXTURE_CREDENTIALS.
   * This is harness state, not a SAR write operation.
   */
  login(
    username: string,
    password: string,
  ): { ok: true; displayName: string } | { ok: false; fault: FixtureFault } {
    if (this.faults.login) {
      return { ok: false, fault: this.faults.login };
    }
    if (
      username !== SAR_FIXTURE_CREDENTIALS.username ||
      password !== SAR_FIXTURE_CREDENTIALS.password
    ) {
      this.authenticated = false;
      this.displayName = "";
      this.page = { kind: "account", authenticated: false, displayName: "" };
      return { ok: false, fault: "AUTH_REQUIRED" };
    }
    this.authenticated = true;
    this.displayName = SAR_FIXTURE_GROUND_TRUTH.login.displayName;
    this.page = {
      kind: "account",
      authenticated: true,
      displayName: this.displayName,
    };
    return { ok: true, displayName: this.displayName };
  }

  publicQuery(
    query: string,
  ): { ok: true; items: readonly PublicItem[] } | { ok: false; fault: FixtureFault } {
    if (this.faults.public) {
      return { ok: false, fault: this.faults.public };
    }
    const items =
      query === SAR_FIXTURE_GROUND_TRUTH.publicQuery.query
        ? SAR_FIXTURE_GROUND_TRUTH.publicQuery.items
        : [];
    this.page = { kind: "public", query, items: [...items] };
    return { ok: true, items };
  }

  /**
   * Logged-in catalog query. Fixture login is harness state, not a SAR write.
   * Unauthenticated reads fail closed with AUTH_REQUIRED.
   */
  accountQuery(
    query: string,
  ): { ok: true; orders: readonly AccountOrder[] } | { ok: false; fault: FixtureFault } {
    if (this.faults.account) {
      return { ok: false, fault: this.faults.account };
    }
    if (!this.authenticated) {
      return { ok: false, fault: "AUTH_REQUIRED" };
    }
    const orders =
      query === SAR_FIXTURE_GROUND_TRUTH.accountQuery.query
        ? SAR_FIXTURE_GROUND_TRUTH.accountQuery.orders
        : [];
    this.page = { kind: "accountQuery", query, orders: [...orders] };
    return { ok: true, orders };
  }

  /**
   * Uncovered notes read. Not installed as a P1 capability.
   * Unknown topics are an empty success, not a rewritten catalog.
   */
  notes(
    topic: string,
  ): { ok: true; notes: readonly NoteItem[] } | { ok: false; fault: FixtureFault } {
    if (this.faults.notes) {
      return { ok: false, fault: this.faults.notes };
    }
    const notes =
      topic === SAR_FIXTURE_GROUND_TRUTH.notes.taskA.topic
        ? SAR_FIXTURE_GROUND_TRUTH.notes.taskA.notes
        : topic === SAR_FIXTURE_GROUND_TRUTH.notes.heldOut.topic
          ? SAR_FIXTURE_GROUND_TRUTH.notes.heldOut.notes
          : [];
    this.page = { kind: "notes", topic, notes: [...notes] };
    return { ok: true, notes };
  }

  faultSnapshot(): Record<FixtureScenario, FixtureFault | null> {
    return { ...this.faults };
  }

  session(): { authenticated: boolean; displayName: string } {
    return { authenticated: this.authenticated, displayName: this.displayName };
  }

  acceptNavigation(url: string): { finalUrl: string } {
    const parsed = new URL(url);
    if (parsed.origin !== SAR_FIXTURE_ORIGIN) {
      throw new TrustedOperationFault("STRUCTURE_CHANGED");
    }
    if (parsed.pathname === "/search") {
      const result = this.search(parsed.searchParams.get("q") ?? "");
      if (!result.ok) {
        throw new TrustedOperationFault(result.fault);
      }
      return { finalUrl: url };
    }
    if (parsed.pathname === "/detail") {
      const result = this.detail(parsed.searchParams.get("id") ?? "");
      if (!result.ok) {
        throw new TrustedOperationFault(result.fault);
      }
      return { finalUrl: url };
    }
    if (parsed.pathname === "/public") {
      const result = this.publicQuery(parsed.searchParams.get("q") ?? "");
      if (!result.ok) {
        throw new TrustedOperationFault(result.fault);
      }
      return { finalUrl: url };
    }
    if (parsed.pathname === "/account/query") {
      const result = this.accountQuery(parsed.searchParams.get("q") ?? "");
      if (!result.ok) {
        throw new TrustedOperationFault(result.fault);
      }
      return { finalUrl: url };
    }
    if (parsed.pathname === "/notes") {
      const result = this.notes(parsed.searchParams.get("topic") ?? "");
      if (!result.ok) {
        throw new TrustedOperationFault(result.fault);
      }
      return { finalUrl: url };
    }
    if (parsed.pathname === "/wrong") {
      this.page = { kind: "wrong" };
      return { finalUrl: url };
    }
    if (parsed.pathname === "/account") {
      this.page = {
        kind: "account",
        authenticated: this.authenticated,
        displayName: this.displayName,
      };
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
    if (name === "session") {
      return {
        origin: SAR_FIXTURE_ORIGIN,
        data: { authenticated: this.authenticated, displayName: this.displayName },
      };
    }
    if (name === "search" && this.page.kind === "search") {
      return {
        origin: SAR_FIXTURE_ORIGIN,
        data: { query: this.page.query, count: this.page.items.length },
      };
    }
    if (name === "detail" && this.page.kind === "detail") {
      return { origin: SAR_FIXTURE_ORIGIN, data: { id: this.page.item.id } };
    }
    return { origin: SAR_FIXTURE_ORIGIN, data: { page: this.page.kind } };
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

  private assertPageFault(): void {
    if (this.page.kind === "search" && this.faults.search) {
      throw new TrustedOperationFault(this.faults.search);
    }
    if (this.page.kind === "detail" && this.faults.detail) {
      throw new TrustedOperationFault(this.faults.detail);
    }
    if (this.page.kind === "account" && this.faults.login) {
      throw new TrustedOperationFault(this.faults.login);
    }
    if (this.page.kind === "public" && this.faults.public) {
      throw new TrustedOperationFault(this.faults.public);
    }
    if (this.page.kind === "accountQuery" && this.faults.account) {
      throw new TrustedOperationFault(this.faults.account);
    }
    if (this.page.kind === "notes" && this.faults.notes) {
      throw new TrustedOperationFault(this.faults.notes);
    }
  }

  private fieldSource(): Record<string, string> {
    if (this.page.kind === "search") {
      return {
        query: this.page.query,
        count: String(this.page.items.length),
        firstTitle: this.page.items[0]?.title ?? "",
      };
    }
    if (this.page.kind === "detail") {
      return {
        id: this.page.item.id,
        title: this.page.item.title,
        price: this.page.item.price,
        stock: this.page.item.stock,
      };
    }
    if (this.page.kind === "account") {
      return {
        authenticated: this.page.authenticated ? "true" : "false",
        displayName: this.page.displayName,
      };
    }
    if (this.page.kind === "public") {
      return {
        query: this.page.query,
        count: String(this.page.items.length),
        firstTitle: this.page.items[0]?.title ?? "",
      };
    }
    if (this.page.kind === "accountQuery") {
      return {
        query: this.page.query,
        count: String(this.page.orders.length),
        firstTitle: this.page.orders[0]?.title ?? "",
      };
    }
    if (this.page.kind === "notes") {
      return {
        topic: this.page.topic,
        count: String(this.page.notes.length),
        firstTitle: this.page.notes[0]?.title ?? "",
      };
    }
    if (this.page.kind === "wrong") {
      return { marker: "WRONG_VERSION" };
    }
    return { page: "home" };
  }

  private groundTruth(): Record<string, unknown> {
    if (this.page.kind === "search") {
      return { query: this.page.query, items: this.page.items };
    }
    if (this.page.kind === "detail") {
      return { ...this.page.item };
    }
    if (this.page.kind === "account") {
      return { authenticated: this.page.authenticated, displayName: this.page.displayName };
    }
    if (this.page.kind === "public") {
      return { query: this.page.query, items: this.page.items };
    }
    if (this.page.kind === "accountQuery") {
      return { query: this.page.query, orders: this.page.orders };
    }
    if (this.page.kind === "notes") {
      return { topic: this.page.topic, notes: this.page.notes };
    }
    if (this.page.kind === "wrong") {
      return { marker: "WRONG_VERSION" };
    }
    return { page: "home" };
  }
}

export function createTestSitePort(site: ControllableTestSite): TrustedPagePort {
  return {
    navigate: async (url) => site.acceptNavigation(url),
    readFields: async (fields) => site.readFields(fields),
    requestContext: async (name) => site.requestContext(name),
    capture: async (fields) => site.capture(fields),
  };
}
