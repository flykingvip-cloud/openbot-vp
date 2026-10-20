import { afterEach, describe, expect, it, vi } from "vitest";
import { userModelingInferEnabled } from "./config.js";
import {
  buildSanitizedInferSummary,
  inferUserProfileSignals,
  parseInferredUserSignals,
} from "./infer.js";
import {
  recordUserInteractionSignalSafely,
  setUserProfileInferCallerForTests,
} from "./record-signal.js";
import { DEFAULT_USER_PROFILE } from "./types.js";

describe("buildSanitizedInferSummary", () => {
  it("does not include raw inbound message text", () => {
    const summary = buildSanitizedInferSummary({
      profile: DEFAULT_USER_PROFILE,
      directiveKinds: ["concise"],
      replyLanguage: "zh",
    });
    expect(summary).not.toContain("请简洁点");
    expect(summary).toContain("concise");
  });
});

describe("parseInferredUserSignals", () => {
  it("parses allowed directive kinds only", () => {
    const signals = parseInferredUserSignals(
      '{"directives":["concise","invalid_kind"],"replyLanguage":"en"}',
    );
    expect(signals.directives?.map((d) => d.kind)).toEqual(["concise"]);
    expect(signals.replyLanguage).toBe("en");
  });
});

describe("inferUserProfileSignals gating", () => {
  const prev = process.env.OPENBOT_USER_MODELING_INFER;

  afterEach(() => {
    if (prev === undefined) {
      delete process.env.OPENBOT_USER_MODELING_INFER;
    } else {
      process.env.OPENBOT_USER_MODELING_INFER = prev;
    }
  });

  it("returns empty when infer is disabled (fail-closed)", async () => {
    delete process.env.OPENBOT_USER_MODELING_INFER;
    expect(userModelingInferEnabled()).toBe(false);
    const result = await inferUserProfileSignals({
      cfg: {},
      profile: DEFAULT_USER_PROFILE,
      signals: { directives: [{ kind: "concise", matched: "x" }] },
      caller: async () => '{"directives":["verbose"],"replyLanguage":null}',
    });
    expect(result).toEqual({});
  });

  it("uses caller when infer is enabled", async () => {
    process.env.OPENBOT_USER_MODELING_INFER = "on";
    const caller = vi.fn(async () => '{"directives":["verbose"],"replyLanguage":null}');
    const result = await inferUserProfileSignals({
      cfg: {},
      profile: DEFAULT_USER_PROFILE,
      signals: { directives: [{ kind: "concise", matched: "x" }] },
      caller,
    });
    expect(caller).toHaveBeenCalledOnce();
    expect(result.directives?.[0]?.kind).toBe("verbose");
  });
});

describe("recordUserInteractionSignalSafely infer path", () => {
  afterEach(() => {
    setUserProfileInferCallerForTests(null);
  });

  it("does not call infer caller when infer disabled", async () => {
    delete process.env.OPENBOT_USER_MODELING_INFER;
    const caller = vi.fn(async () => '{"directives":["verbose"],"replyLanguage":null}');
    setUserProfileInferCallerForTests(caller);
    await recordUserInteractionSignalSafely(
      {},
      { canonicalId: "webchat:u@x.com", tenantId: null },
      "hello",
      {
        inferCaller: caller,
      },
    );
    expect(caller).not.toHaveBeenCalled();
  });
});
