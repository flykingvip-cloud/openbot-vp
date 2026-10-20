import { describe, expect, it, beforeEach } from "vitest";
import {
  INTERACTION_OWNERSHIP_COORDINATOR_LANDING,
  DEFAULT_OWNERSHIP_GRACE_MS,
  canAgentDriveInput,
  canHumanDriveInput,
  createInteractionOwnershipSnapshot,
  dispatchInteractionOwnership,
  getInteractionOwnership,
  humanPreemptsAgent,
  mergeInteractionOwnershipOnMove,
  moveInteractionOwnership,
  ownershipDataAttrs,
  reduceInteractionOwnership,
  resetInteractionOwnershipForTests,
  tickInteractionOwnershipGrace,
  type InteractionOwnershipSnapshot,
} from "./interaction-ownership.ts";

describe("INTERACTION_OWNERSHIP_COORDINATOR_M1", () => {
  beforeEach(() => {
    resetInteractionOwnershipForTests();
  });

  it("exports the loom landing id", () => {
    expect(INTERACTION_OWNERSHIP_COORDINATOR_LANDING).toBe("INTERACTION_OWNERSHIP_COORDINATOR_M1");
  });

  it("starts in BACKGROUND_AGENT with no capability owners", () => {
    const snap = createInteractionOwnershipSnapshot();
    expect(snap.phase).toBe("BACKGROUND_AGENT");
    expect(snap.owners).toEqual({
      keyboard: "none",
      mouse: "none",
      clipboard: "none",
      navigation: "none",
    });
    expect(canHumanDriveInput(snap, "s1")).toBe(false);
    expect(canAgentDriveInput(snap, "agent-a")).toBe(false);
  });

  it("BACKGROUND_AGENT → LEASE_REQUEST → INTERACTIVE grants agent all channels", () => {
    let snap = createInteractionOwnershipSnapshot();
    snap = reduceInteractionOwnership(snap, {
      type: "AGENT_LEASE_REQUEST",
      agentId: "agent-a",
    });
    expect(snap.phase).toBe("LEASE_REQUEST");
    expect(snap.pendingAgentId).toBe("agent-a");
    expect(snap.owners.keyboard).toBe("none");
    expect(snap.owners.navigation).toBe("agent");

    snap = reduceInteractionOwnership(snap, { type: "AGENT_LEASE_GRANT" });
    expect(snap.phase).toBe("INTERACTIVE");
    expect(snap.holderAgentId).toBe("agent-a");
    expect(snap.pendingAgentId).toBeNull();
    expect(snap.owners).toEqual({
      keyboard: "agent",
      mouse: "agent",
      clipboard: "agent",
      navigation: "agent",
    });
    expect(canAgentDriveInput(snap, "agent-a")).toBe(true);
    expect(canAgentDriveInput(snap, "agent-b")).toBe(false);
    expect(canHumanDriveInput(snap, "s1")).toBe(false);
  });

  it("human takeover preempts agent INTERACTIVE lease", () => {
    let snap = createInteractionOwnershipSnapshot();
    snap = reduceInteractionOwnership(snap, {
      type: "AGENT_LEASE_REQUEST",
      agentId: "agent-a",
    });
    snap = reduceInteractionOwnership(snap, { type: "AGENT_LEASE_GRANT" });
    expect(snap.phase).toBe("INTERACTIVE");

    snap = reduceInteractionOwnership(snap, {
      type: "HUMAN_TAKEOVER",
      sessionKey: "chat-1",
    });
    expect(snap.phase).toBe("HUMAN_TAKEOVER");
    expect(humanPreemptsAgent(snap)).toBe(true);
    expect(snap.humanSessionKey).toBe("chat-1");
    expect(snap.holderAgentId).toBe("agent-a"); // retained for observability
    expect(snap.pendingAgentId).toBeNull();
    expect(snap.owners).toEqual({
      keyboard: "human",
      mouse: "human",
      clipboard: "human",
      navigation: "human",
    });
    expect(canHumanDriveInput(snap, "chat-1")).toBe(true);
    expect(canHumanDriveInput(snap, "chat-other")).toBe(false);
    expect(canAgentDriveInput(snap, "agent-a")).toBe(false);
  });

  it("HUMAN_TAKEOVER → GRACE → BACKGROUND_AGENT after hand-back", () => {
    const t0 = 1_000_000;
    let snap = createInteractionOwnershipSnapshot();
    snap = reduceInteractionOwnership(snap, {
      type: "HUMAN_TAKEOVER",
      sessionKey: "chat-1",
    });
    snap = reduceInteractionOwnership(snap, { type: "HUMAN_HAND_BACK", graceMs: 500 }, t0);
    expect(snap.phase).toBe("GRACE");
    expect(snap.humanSessionKey).toBeNull();
    expect(snap.graceUntilMs).toBe(t0 + 500);
    expect(snap.owners.keyboard).toBe("none");
    expect(canHumanDriveInput(snap, "chat-1")).toBe(false);

    // Before deadline — stay in GRACE
    expect(tickInteractionOwnershipGrace(snap, t0 + 100).phase).toBe("GRACE");

    snap = tickInteractionOwnershipGrace(snap, t0 + 500);
    expect(snap.phase).toBe("BACKGROUND_AGENT");
    expect(snap.graceUntilMs).toBeNull();
  });

  it("agent lease request during HUMAN_TAKEOVER only queues pending", () => {
    let snap = createInteractionOwnershipSnapshot();
    snap = reduceInteractionOwnership(snap, {
      type: "HUMAN_TAKEOVER",
      sessionKey: "chat-1",
    });
    snap = reduceInteractionOwnership(snap, {
      type: "AGENT_LEASE_REQUEST",
      agentId: "agent-b",
    });
    expect(snap.phase).toBe("HUMAN_TAKEOVER");
    expect(snap.pendingAgentId).toBe("agent-b");
    expect(snap.owners.keyboard).toBe("human");
    // Grant must not steal from human
    const denied = reduceInteractionOwnership(snap, { type: "AGENT_LEASE_GRANT" });
    expect(denied.phase).toBe("HUMAN_TAKEOVER");
    expect(denied.owners.keyboard).toBe("human");
  });

  it("second agent cannot steal INTERACTIVE lease (v1 exclusive)", () => {
    let snap = createInteractionOwnershipSnapshot();
    snap = reduceInteractionOwnership(snap, {
      type: "AGENT_LEASE_REQUEST",
      agentId: "agent-a",
    });
    snap = reduceInteractionOwnership(snap, { type: "AGENT_LEASE_GRANT" });
    snap = reduceInteractionOwnership(snap, {
      type: "AGENT_LEASE_REQUEST",
      agentId: "agent-b",
    });
    expect(snap.phase).toBe("INTERACTIVE");
    expect(snap.holderAgentId).toBe("agent-a");
    expect(snap.pendingAgentId).toBe("agent-b");
    expect(canAgentDriveInput(snap, "agent-a")).toBe(true);
    expect(canAgentDriveInput(snap, "agent-b")).toBe(false);
  });

  it("AGENT_LEASE_DENY returns to BACKGROUND_AGENT", () => {
    let snap = createInteractionOwnershipSnapshot();
    snap = reduceInteractionOwnership(snap, {
      type: "AGENT_LEASE_REQUEST",
      agentId: "agent-a",
    });
    snap = reduceInteractionOwnership(snap, { type: "AGENT_LEASE_DENY" });
    expect(snap.phase).toBe("BACKGROUND_AGENT");
    expect(snap.pendingAgentId).toBeNull();
  });

  it("AGENT_RELEASE clears lease; default grace ms is exported", () => {
    expect(DEFAULT_OWNERSHIP_GRACE_MS).toBeGreaterThan(0);
    let snap = createInteractionOwnershipSnapshot();
    snap = reduceInteractionOwnership(snap, {
      type: "AGENT_LEASE_REQUEST",
      agentId: "agent-a",
    });
    snap = reduceInteractionOwnership(snap, { type: "AGENT_LEASE_GRANT" });
    snap = reduceInteractionOwnership(snap, { type: "AGENT_RELEASE" });
    expect(snap.phase).toBe("BACKGROUND_AGENT");
    expect(snap.holderAgentId).toBeNull();
    expect(snap.owners.keyboard).toBe("none");
  });

  it("ownershipDataAttrs expose phase and owners", () => {
    let snap = createInteractionOwnershipSnapshot();
    snap = reduceInteractionOwnership(snap, {
      type: "HUMAN_TAKEOVER",
      sessionKey: "s1",
    });
    expect(ownershipDataAttrs(snap)).toMatchObject({
      "data-ownership-phase": "HUMAN_TAKEOVER",
      "data-ownership-keyboard": "human",
      "data-ownership-mouse": "human",
      "data-ownership-clipboard": "human",
      "data-ownership-navigation": "human",
      "data-ownership-human": "s1",
    });
  });

  it("per-account store dispatches and resets", () => {
    const a = dispatchInteractionOwnership("tenant\0user", {
      type: "AGENT_LEASE_REQUEST",
      agentId: "agent-a",
    });
    expect(a.phase).toBe("LEASE_REQUEST");
    expect(getInteractionOwnership("tenant\0user").phase).toBe("LEASE_REQUEST");
    dispatchInteractionOwnership("tenant\0user", { type: "AGENT_LEASE_GRANT" });
    dispatchInteractionOwnership("tenant\0user", {
      type: "HUMAN_TAKEOVER",
      sessionKey: "chat-1",
    });
    expect(getInteractionOwnership("tenant\0user").phase).toBe("HUMAN_TAKEOVER");
    resetInteractionOwnershipForTests();
    expect(getInteractionOwnership("tenant\0user").phase).toBe("BACKGROUND_AGENT");
  });

  it("models clipboard ownership without implying sync", () => {
    let snap: InteractionOwnershipSnapshot = createInteractionOwnershipSnapshot();
    snap = reduceInteractionOwnership(snap, {
      type: "HUMAN_TAKEOVER",
      sessionKey: "chat-1",
    });
    // Flag is human-owned; Input Capability clipboard sync remains false elsewhere.
    expect(snap.owners.clipboard).toBe("human");
  });
});

describe("moveInteractionOwnership human-wins", () => {
  beforeEach(() => {
    resetInteractionOwnershipForTests();
  });

  it("pending HUMAN_TAKEOVER wins over dest agent INTERACTIVE (never drop human)", () => {
    dispatchInteractionOwnership("pending-key", {
      type: "HUMAN_TAKEOVER",
      sessionKey: "chat-human",
    });
    dispatchInteractionOwnership("real-key", {
      type: "AGENT_LEASE_REQUEST",
      agentId: "agent-a",
    });
    dispatchInteractionOwnership("real-key", { type: "AGENT_LEASE_GRANT" });
    expect(getInteractionOwnership("real-key").phase).toBe("INTERACTIVE");

    const merged = moveInteractionOwnership("pending-key", "real-key");
    expect(merged.phase).toBe("HUMAN_TAKEOVER");
    expect(merged.humanSessionKey).toBe("chat-human");
    expect(merged.owners.keyboard).toBe("human");
    expect(getInteractionOwnership("real-key").phase).toBe("HUMAN_TAKEOVER");
    // from key abandoned
    expect(getInteractionOwnership("pending-key").phase).toBe("BACKGROUND_AGENT");
  });

  it("dest HUMAN_TAKEOVER wins over pending agent INTERACTIVE / LEASE_REQUEST", () => {
    dispatchInteractionOwnership("real-key", {
      type: "HUMAN_TAKEOVER",
      sessionKey: "chat-human",
    });
    dispatchInteractionOwnership("pending-key", {
      type: "AGENT_LEASE_REQUEST",
      agentId: "agent-b",
    });
    dispatchInteractionOwnership("pending-key", { type: "AGENT_LEASE_GRANT" });

    const merged = moveInteractionOwnership("pending-key", "real-key");
    expect(merged.phase).toBe("HUMAN_TAKEOVER");
    expect(merged.humanSessionKey).toBe("chat-human");
    expect(merged.owners.keyboard).toBe("human");
  });

  it("pending HUMAN wins over dest LEASE_REQUEST", () => {
    dispatchInteractionOwnership("pending-key", {
      type: "HUMAN_TAKEOVER",
      sessionKey: "s1",
    });
    dispatchInteractionOwnership("real-key", {
      type: "AGENT_LEASE_REQUEST",
      agentId: "agent-a",
    });
    expect(moveInteractionOwnership("pending-key", "real-key").phase).toBe("HUMAN_TAKEOVER");
  });

  it("migrates pending INTERACTIVE onto BACKGROUND dest", () => {
    dispatchInteractionOwnership("pending-key", {
      type: "AGENT_LEASE_REQUEST",
      agentId: "agent-a",
    });
    dispatchInteractionOwnership("pending-key", { type: "AGENT_LEASE_GRANT" });
    const merged = moveInteractionOwnership("pending-key", "real-key");
    expect(merged.phase).toBe("INTERACTIVE");
    expect(merged.holderAgentId).toBe("agent-a");
  });

  it("keeps dest INTERACTIVE when source is BACKGROUND", () => {
    dispatchInteractionOwnership("real-key", {
      type: "AGENT_LEASE_REQUEST",
      agentId: "agent-a",
    });
    dispatchInteractionOwnership("real-key", { type: "AGENT_LEASE_GRANT" });
    // pending-key never written → BACKGROUND on get after move with no source
    // Write explicit BACKGROUND by RESET on pending then ensure no entry...
    // Create source as BACKGROUND via request+deny
    dispatchInteractionOwnership("pending-key", {
      type: "AGENT_LEASE_REQUEST",
      agentId: "x",
    });
    dispatchInteractionOwnership("pending-key", { type: "AGENT_LEASE_DENY" });
    expect(getInteractionOwnership("pending-key").phase).toBe("BACKGROUND_AGENT");

    const merged = moveInteractionOwnership("pending-key", "real-key");
    expect(merged.phase).toBe("INTERACTIVE");
    expect(merged.holderAgentId).toBe("agent-a");
  });

  it("mergeInteractionOwnershipOnMove is bidirectional for human", () => {
    const human = reduceInteractionOwnership(createInteractionOwnershipSnapshot(), {
      type: "HUMAN_TAKEOVER",
      sessionKey: "h1",
    });
    let agent = reduceInteractionOwnership(createInteractionOwnershipSnapshot(), {
      type: "AGENT_LEASE_REQUEST",
      agentId: "a1",
    });
    agent = reduceInteractionOwnership(agent, { type: "AGENT_LEASE_GRANT" });
    expect(mergeInteractionOwnershipOnMove(human, agent).phase).toBe("HUMAN_TAKEOVER");
    expect(mergeInteractionOwnershipOnMove(agent, human).phase).toBe("HUMAN_TAKEOVER");
  });

  it("no-op when from missing leaves dest intact", () => {
    dispatchInteractionOwnership("real-key", {
      type: "HUMAN_TAKEOVER",
      sessionKey: "h1",
    });
    const merged = moveInteractionOwnership("ghost-key", "real-key");
    expect(merged.phase).toBe("HUMAN_TAKEOVER");
  });
});
