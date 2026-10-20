import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createNodeSeatBindingRequest } from "./node-seat-binding-request-store.js";
import { getNodeSeatBinding, upsertNodeSeatBinding } from "./node-seat-binding-store.js";
import {
  persistOperatorComputerAlwaysAllow,
  resolveOperatorComputerNode,
} from "./operator-computer-binding.js";

describe("resolveOperatorComputerNode", () => {
  it("copies a same-operator node onto the active seat", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "operator-computer-"));
    const bindingStorePath = path.join(dir, "bindings.json");
    const requestStorePath = path.join(dir, "requests.json");
    await upsertNodeSeatBinding(
      { tenantId: "t1", seatId: "seat-stale", nodeId: "mac-node" },
      bindingStorePath,
    );
    const request = await createNodeSeatBindingRequest(
      { tenantId: "t1", seatId: "seat-stale", nodeId: "mac-node", userId: "emp-1" },
      requestStorePath,
    );
    const { resolveNodeSeatBindingRequest } = await import("./node-seat-binding-request-store.js");
    await resolveNodeSeatBindingRequest(
      { requestId: request.requestId, decision: "approved" },
      requestStorePath,
    );

    const resolved = await resolveOperatorComputerNode({
      tenantId: "t1",
      activeSeatId: "seat-ceo",
      operatorUserId: "emp-1",
      agentId: "bot-skill",
      operatorAgentIds: ["main", "bot-skill"],
      occupiedSeatIds: ["seat-ceo", "seat-stale"],
      bindingStorePath,
      requestStorePath,
    });
    expect(resolved).toEqual({ nodeId: "mac-node" });
    await expect(getNodeSeatBinding("t1", "seat-ceo", bindingStorePath)).resolves.toMatchObject({
      nodeId: "mac-node",
    });
    await expect(
      resolveOperatorComputerNode({
        tenantId: "t1",
        activeSeatId: "seat-ceo",
        operatorUserId: "emp-1",
        agentId: "panda",
        operatorAgentIds: ["bot-skill"],
        occupiedSeatIds: ["seat-ceo"],
        bindingStorePath,
        requestStorePath,
      }),
    ).resolves.toBeNull();
  });

  it("persists Always Allow on the live node and skips inventing bindings on allow-once paths", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "operator-computer-always-"));
    const bindingStorePath = path.join(dir, "bindings.json");
    const requestStorePath = path.join(dir, "requests.json");

    const persisted = await persistOperatorComputerAlwaysAllow({
      tenantId: "t1",
      seatId: "seat-ceo",
      nodeId: "mac-live",
      operatorUserId: "emp-uuid-1",
      bindingStorePath,
      requestStorePath,
    });
    expect(persisted).toEqual({ nodeId: "mac-live", alwaysAllowDesktop: true });
    await expect(getNodeSeatBinding("t1", "seat-ceo", bindingStorePath)).resolves.toMatchObject({
      nodeId: "mac-live",
      alwaysAllowDesktop: true,
    });

    const resolved = await resolveOperatorComputerNode({
      tenantId: "t1",
      activeSeatId: "seat-ceo",
      operatorUserId: "emp-uuid-1",
      operatorUserIdAliases: ["ceo@example.com"],
      agentId: "bot-skill",
      operatorAgentIds: ["bot-skill"],
      occupiedSeatIds: ["seat-ceo"],
      bindingStorePath,
      requestStorePath,
    });
    expect(resolved).toEqual({ nodeId: "mac-live", alwaysAllowDesktop: true });
  });

  it("matches an email-approved request to the employee UUID via aliases", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "operator-computer-email-"));
    const bindingStorePath = path.join(dir, "bindings.json");
    const requestStorePath = path.join(dir, "requests.json");
    await upsertNodeSeatBinding(
      { tenantId: "t1", seatId: "seat-stale", nodeId: "mac-live" },
      bindingStorePath,
    );
    const request = await createNodeSeatBindingRequest(
      { tenantId: "t1", seatId: "seat-stale", nodeId: "mac-live", userId: "ceo@example.com" },
      requestStorePath,
    );
    const { resolveNodeSeatBindingRequest } = await import("./node-seat-binding-request-store.js");
    await resolveNodeSeatBindingRequest(
      { requestId: request.requestId, decision: "approved" },
      requestStorePath,
    );

    const resolved = await resolveOperatorComputerNode({
      tenantId: "t1",
      activeSeatId: "seat-ceo",
      operatorUserId: "emp-uuid-1",
      operatorUserIdAliases: ["ceo@example.com"],
      preferredNodeIds: ["mac-live"],
      agentId: "bot-skill",
      operatorAgentIds: ["bot-skill"],
      occupiedSeatIds: ["seat-ceo", "seat-stale"],
      bindingStorePath,
      requestStorePath,
    });
    expect(resolved).toEqual({ nodeId: "mac-live" });
  });
});
