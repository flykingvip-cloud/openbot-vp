import { describe, expect, it, beforeEach } from "vitest";
import {
  DESKTOP_TAKEOVER_LEARNING_LANDING,
  DESKTOP_TAKEOVER_SITEHOST_SKILL_LANDING,
  abandonTakeoverEpisode,
  beginTakeoverEpisode,
  completeTakeoverEpisode,
  consumeTakeoverSkillDrafts,
  createTakeoverLearningStore,
  deriveSiteSkillDraft,
  getActiveTakeoverEpisode,
  listTakeoverSkillDrafts,
  normalizeSiteHost,
  observeOwnershipTransitionForLearning,
  redactAgentActionSummary,
  resetTakeoverLearningForTests,
  setTakeoverSkillDraftHost,
  takeoverLearningDataAttrs,
} from "./desktop-takeover-learning.ts";
import {
  createInteractionOwnershipSnapshot,
  reduceInteractionOwnership,
  resetInteractionOwnershipForTests,
} from "./interaction-ownership.ts";

describe("DESKTOP_TAKEOVER_LEARNING_M5", () => {
  beforeEach(() => {
    resetTakeoverLearningForTests();
    resetInteractionOwnershipForTests();
  });

  it("exports the loom landing id", () => {
    expect(DESKTOP_TAKEOVER_LEARNING_LANDING).toBe("DESKTOP_TAKEOVER_LEARNING_M5");
  });

  it("normalizes siteHost from URL (strip credentials / query / path)", () => {
    expect(normalizeSiteHost("https://user:pass@portal.example.com:443/a/b?token=abc#x")).toBe(
      "portal.example.com",
    );
    expect(normalizeSiteHost("http://Shop.Example.COM/path")).toBe("shop.example.com");
    expect(normalizeSiteHost("portal.example.com/login?x=1")).toBe("portal.example.com");
    expect(normalizeSiteHost("")).toBeNull();
    expect(normalizeSiteHost(null)).toBeNull();
    expect(normalizeSiteHost("localhost")).toBe("localhost");
  });

  it("redacts tokens and full URLs from agentActionSummary (host path OK)", () => {
    const raw =
      "open https://portal.example.com/invoice/42?access_token=supersecret&x=1 with Bearer sk_live_abc";
    const redacted = redactAgentActionSummary(raw);
    expect(redacted).not.toMatch(/supersecret/);
    expect(redacted).not.toMatch(/sk_live_abc/);
    expect(redacted).not.toMatch(/https?:\/\//i);
    expect(redacted).toContain("portal.example.com/invoice/42");
    expect(redacted).toMatch(/access_token=REDACTED|REDACTED/);
  });

  it("begin → complete resolved → draft skill; abandon yields no draft", () => {
    const store = createTakeoverLearningStore();
    const ep = store.begin({
      accountKey: "acct-1",
      pageUrl: "https://vendor.example/app?token=xyz",
      sessionPhase: "INTERACTIVE",
      ownershipBefore: "INTERACTIVE",
      triggerReason: "uncertain_decision",
      agentActionSummary: "click Confirm on https://vendor.example/checkout?token=t",
      humanSessionKey: "chat-1",
      holderAgentId: "agent-a",
      now: 1_000,
      episodeId: "ep-1",
    });
    expect(ep.siteHost).toBe("vendor.example");
    expect(ep.outcome).toBe("unknown");
    expect(ep.agentActionSummary).not.toMatch(/token=t\b|https?:\/\//i);
    expect(store.getActive("acct-1")?.episodeId).toBe("ep-1");
    expect(deriveSiteSkillDraft(ep)).toBeNull();

    const done = store.complete({
      accountKey: "acct-1",
      outcome: "resolved",
      ownershipAfter: "GRACE",
      now: 2_000,
    });
    expect(done?.outcome).toBe("resolved");
    expect(done?.endedAt).toBe(2_000);
    expect(store.getActive("acct-1")).toBeNull();

    const draft = deriveSiteSkillDraft(done!);
    expect(draft).not.toBeNull();
    expect(draft?.siteHost).toBe("vendor.example");
    expect(draft?.title).toContain("vendor.example");
    expect(draft?.lesson).toContain("vendor.example");
    expect(draft?.lesson).not.toMatch(/https?:\/\//i);
    expect(draft?.capabilities).toContain("desktop.takeover");
    expect(draft?.capabilities).toContain("desktop.hand_back");

    const abandoned = store.begin({
      accountKey: "acct-1",
      siteHost: "other.example",
      now: 3_000,
    });
    store.abandon({ accountKey: "acct-1", now: 4_000 });
    expect(deriveSiteSkillDraft(abandoned)).toBeNull();
    expect(abandoned.outcome).toBe("abandoned");
  });

  it("draft requires resolved + siteHost", () => {
    const store = createTakeoverLearningStore();
    const noHost = store.begin({ accountKey: "a", now: 1 });
    store.complete({ accountKey: "a", outcome: "resolved", now: 2 });
    expect(deriveSiteSkillDraft(noHost)).toBeNull();

    const unresolved = store.begin({
      accountKey: "b",
      pageUrl: "https://x.example/",
      now: 3,
    });
    expect(deriveSiteSkillDraft(unresolved)).toBeNull();
  });

  it("default store begin/complete/abandon helpers work", () => {
    beginTakeoverEpisode({
      accountKey: "d1",
      pageUrl: "https://a.example/p",
      now: 10,
    });
    expect(getActiveTakeoverEpisode("d1")?.siteHost).toBe("a.example");
    expect(
      takeoverLearningDataAttrs(getActiveTakeoverEpisode("d1"))["data-takeover-learning"],
    ).toBe("active");
    completeTakeoverEpisode({ accountKey: "d1", now: 11 });
    expect(getActiveTakeoverEpisode("d1")).toBeNull();
    expect(takeoverLearningDataAttrs(null)["data-takeover-learning"]).toBe("idle");

    beginTakeoverEpisode({ accountKey: "d1", siteHost: "b.example", now: 12 });
    abandonTakeoverEpisode({ accountKey: "d1", now: 13 });
    expect(getActiveTakeoverEpisode("d1")).toBeNull();
  });

  it("ownership observer begins on HUMAN_TAKEOVER and completes on hand-back without changing FSM", () => {
    let snap = createInteractionOwnershipSnapshot();
    snap = reduceInteractionOwnership(snap, {
      type: "AGENT_LEASE_REQUEST",
      agentId: "agent-a",
    });
    snap = reduceInteractionOwnership(snap, { type: "AGENT_LEASE_GRANT" });
    expect(snap.phase).toBe("INTERACTIVE");

    const beforeTakeover = snap;
    snap = reduceInteractionOwnership(snap, {
      type: "HUMAN_TAKEOVER",
      sessionKey: "chat-1",
    });
    expect(snap.phase).toBe("HUMAN_TAKEOVER");

    const store = createTakeoverLearningStore();
    const started = observeOwnershipTransitionForLearning(beforeTakeover, snap, {
      accountKey: "acct-obs",
      pageUrl: "https://learn.example/flow?access_token=leak",
      sessionPhase: "INTERACTIVE",
      agentActionSummary: "navigate https://learn.example/step?token=x",
      store,
      now: 100,
    });
    expect(started?.ownershipDuring).toBe("HUMAN_TAKEOVER");
    expect(started?.siteHost).toBe("learn.example");
    expect(started?.triggerReason).toBe("user_preempt");
    expect(started?.agentActionSummary).not.toMatch(/leak|token=x|https?:\/\//i);

    // Ownership FSM unchanged by observer (we only passed copies / results of reduce).
    expect(snap.phase).toBe("HUMAN_TAKEOVER");
    expect(snap.owners.keyboard).toBe("human");

    const during = snap;
    snap = reduceInteractionOwnership(snap, { type: "HUMAN_HAND_BACK" }, 200);
    expect(snap.phase).toBe("GRACE");
    const completed = observeOwnershipTransitionForLearning(during, snap, {
      accountKey: "acct-obs",
      store,
      now: 200,
    });
    expect(completed?.outcome).toBe("resolved");
    expect(completed).not.toBeNull();
    if (!completed) {
      return;
    }
    expect(deriveSiteSkillDraft(completed)?.siteHost).toBe("learn.example");

    const inGrace = snap;
    snap = reduceInteractionOwnership(snap, { type: "GRACE_ELAPSE" }, 300);
    expect(snap.phase).toBe("BACKGROUND_AGENT");
    const again = observeOwnershipTransitionForLearning(inGrace, snap, {
      accountKey: "acct-obs",
      store,
      now: 300,
    });
    expect(again).toBeNull();
  });

  it("observer abandons when leaving HUMAN_TAKEOVER without GRACE", () => {
    const store = createTakeoverLearningStore();
    let snap = createInteractionOwnershipSnapshot();
    snap = reduceInteractionOwnership(snap, {
      type: "HUMAN_TAKEOVER",
      sessionKey: "s",
    });
    const before = createInteractionOwnershipSnapshot();
    observeOwnershipTransitionForLearning(before, snap, {
      accountKey: "acct-x",
      siteHost: "z.example",
      store,
      now: 1,
    });
    const during = snap;
    snap = reduceInteractionOwnership(snap, { type: "RESET" });
    const abandoned = observeOwnershipTransitionForLearning(during, snap, {
      accountKey: "acct-x",
      store,
      now: 2,
    });
    expect(abandoned?.outcome).toBe("abandoned");
    expect(deriveSiteSkillDraft(abandoned!)).toBeNull();
  });

  it("infers stall_recover trigger from STREAM_STALLED session phase", () => {
    const store = createTakeoverLearningStore();
    const prev = createInteractionOwnershipSnapshot();
    const next = reduceInteractionOwnership(prev, {
      type: "HUMAN_TAKEOVER",
      sessionKey: "s",
    });
    const ep = observeOwnershipTransitionForLearning(prev, next, {
      accountKey: "stall-1",
      siteHost: "stall.example",
      sessionPhase: "STREAM_STALLED",
      store,
      now: 5,
    });
    expect(ep?.triggerReason).toBe("stall_recover");
    store.complete({ accountKey: "stall-1", now: 6 });
    const draft = deriveSiteSkillDraft(ep!);
    // episode object is mutated by complete
    expect(ep!.outcome).toBe("resolved");
    expect(draft?.capabilities).toContain("desktop.stall_recover");
  });

  it("exports sitehost skill landing id", () => {
    expect(DESKTOP_TAKEOVER_SITEHOST_SKILL_LANDING).toBe("DESKTOP_TAKEOVER_SITEHOST_SKILL_M1");
  });

  it("exposes site host on data attrs when episode has host", () => {
    beginTakeoverEpisode({
      accountKey: "attr-1",
      pageUrl: "https://portal.example.com/app?x=1",
      now: 50,
    });
    const attrs = takeoverLearningDataAttrs(getActiveTakeoverEpisode("attr-1"));
    expect(attrs["data-takeover-learning"]).toBe("active");
    expect(attrs["data-takeover-site-host"]).toBe("portal.example.com");
  });

  it("buffers completed skill drafts and notifies optional host hook", () => {
    const seen: string[] = [];
    setTakeoverSkillDraftHost({
      onTakeoverSkillDraft: (draft) => {
        seen.push(draft.siteHost);
      },
    });
    beginTakeoverEpisode({
      accountKey: "draft-1",
      pageUrl: "https://shop.example/cart",
      triggerReason: "user_preempt",
      now: 100,
    });
    completeTakeoverEpisode({ accountKey: "draft-1", now: 200 });
    const listed = listTakeoverSkillDrafts();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.draft.siteHost).toBe("shop.example");
    expect(listed[0]?.draft.capabilities).toContain("desktop.takeover");
    expect(seen).toEqual(["shop.example"]);
    const consumed = consumeTakeoverSkillDrafts();
    expect(consumed).toHaveLength(1);
    expect(listTakeoverSkillDrafts()).toHaveLength(0);
  });

  it("does not buffer draft without siteHost", () => {
    beginTakeoverEpisode({ accountKey: "nohost", now: 1 });
    completeTakeoverEpisode({ accountKey: "nohost", now: 2 });
    expect(listTakeoverSkillDrafts()).toHaveLength(0);
  });
});
