/**
 * P2-G labeled loopback HTTP: AOR preferred order drives the first outbound call,
 * and that call performs a real HTTP POST to a local stub server (or undici
 * MockAgent when bind is forbidden). Not a claim of production Live provider /
 * public network.
 *
 * Listen uses once('error') + timeout; EPERM/EACCES falls back to MockAgent so
 * the suite never hangs and never silently claims pass on a stuck listen.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../config/types.js";
import { selectModelOrderWithinEffectiveSet } from "../gateway/model-entitlement/aor-selection.js";
import {
  startLoopbackHttpReceiver,
  type LoopbackHttpReceiver,
} from "../test-utils/loopback-http-receiver.js";
import { runWithModelFallback } from "./model-fallback.js";

describe("P2-G selection→outbound loopback HTTP (labeled network mock)", () => {
  let receiver: LoopbackHttpReceiver | null = null;

  afterEach(async () => {
    if (!receiver) {
      return;
    }
    const closing = receiver;
    receiver = null;
    await closing.close();
  });

  it("cheapest primary hits loopback provider stub first", async () => {
    receiver = await startLoopbackHttpReceiver({
      responseJson: { ok: true, labeled: "loopback-provider-mock" },
    });
    const base = receiver.baseUrl;

    const catalog = [
      {
        ref: { provider: "loopback-proxy", id: "cheap" },
        cost: { inputPerMtok: 0.1, outputPerMtok: 0.2 },
        taskTypeScores: { coding: 0.4 },
      },
      {
        ref: { provider: "loopback-proxy", id: "premium" },
        cost: { inputPerMtok: 10, outputPerMtok: 20 },
        taskTypeScores: { coding: 0.95 },
      },
    ];
    const effective = ["loopback-proxy/premium", "loopback-proxy/cheap"];
    const selection = selectModelOrderWithinEffectiveSet({
      mode: "aor_enhanced",
      effectiveModelIds: effective,
      aorExecution: {
        taskTypeId: "default",
        selectorStrategy: "cheapest",
        evaluatorMode: "content",
      },
      catalog,
    });
    expect(selection.orderedModelIds[0]).toBe("loopback-proxy/cheap");

    const cfg = {
      agents: {
        defaults: {
          model: {
            primary: "loopback-proxy/premium",
            fallbacks: ["loopback-proxy/cheap"],
          },
        },
      },
      models: {
        providers: {
          "loopback-proxy": {
            baseUrl: base,
            api: "openai-completions",
            models: [{ id: "cheap" }, { id: "premium" }],
          },
        },
      },
    } as unknown as OpenBotConfig;

    const calls: string[] = [];
    const result = await runWithModelFallback({
      cfg,
      provider: "loopback-proxy",
      model: "premium",
      preferredModelOrder: selection.orderedModelIds,
      run: async (provider, model) => {
        calls.push(`${provider}/${model}`);
        const response = await fetch(`${base}/v1/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            provider,
            labeled: "loopback-provider-mock-not-production-live",
          }),
        });
        if (!response.ok) {
          throw new Error(`stub ${response.status}`);
        }
        return { provider, model, text: "ok" };
      },
    });

    expect(["listen", "mock-agent"]).toContain(receiver.mode);
    expect(calls[0]).toBe("loopback-proxy/cheap");
    expect(result.result.provider).toBe("loopback-proxy");
    expect(result.result.model).toBe("cheap");
    expect(
      receiver.received.some(
        (h) => h.method === "POST" && h.body.includes("cheap") && h.url?.includes("chat"),
      ),
    ).toBe(true);
  });

  it("MockAgent fallback still proves selection→HTTP when listen is forced off", async () => {
    receiver = await startLoopbackHttpReceiver({
      forceMockAgent: true,
      responseJson: { ok: true, labeled: "loopback-provider-mock" },
    });
    expect(receiver.mode).toBe("mock-agent");
    const base = receiver.baseUrl;

    const catalog = [
      {
        ref: { provider: "loopback-proxy", id: "cheap" },
        cost: { inputPerMtok: 0.1, outputPerMtok: 0.2 },
        taskTypeScores: { coding: 0.4 },
      },
      {
        ref: { provider: "loopback-proxy", id: "premium" },
        cost: { inputPerMtok: 10, outputPerMtok: 20 },
        taskTypeScores: { coding: 0.95 },
      },
    ];
    const selection = selectModelOrderWithinEffectiveSet({
      mode: "aor_enhanced",
      effectiveModelIds: ["loopback-proxy/premium", "loopback-proxy/cheap"],
      aorExecution: {
        taskTypeId: "default",
        selectorStrategy: "cheapest",
        evaluatorMode: "content",
      },
      catalog,
    });
    expect(selection.orderedModelIds[0]).toBe("loopback-proxy/cheap");

    const cfg = {
      agents: {
        defaults: {
          model: {
            primary: "loopback-proxy/premium",
            fallbacks: ["loopback-proxy/cheap"],
          },
        },
      },
      models: {
        providers: {
          "loopback-proxy": {
            baseUrl: base,
            api: "openai-completions",
            models: [{ id: "cheap" }, { id: "premium" }],
          },
        },
      },
    } as unknown as OpenBotConfig;

    const calls: string[] = [];
    const result = await runWithModelFallback({
      cfg,
      provider: "loopback-proxy",
      model: "premium",
      preferredModelOrder: selection.orderedModelIds,
      run: async (provider, model) => {
        calls.push(`${provider}/${model}`);
        const response = await fetch(`${base}/v1/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            provider,
            labeled: "loopback-provider-mock-not-production-live",
          }),
        });
        if (!response.ok) {
          throw new Error(`stub ${response.status}`);
        }
        return { provider, model, text: "ok" };
      },
    });

    expect(calls[0]).toBe("loopback-proxy/cheap");
    expect(result.result.model).toBe("cheap");
    expect(receiver.received).toHaveLength(1);
    expect(receiver.received[0]?.body).toContain("cheap");
  });
});
