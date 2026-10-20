import { describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import {
  buildPlaintextApiKeyGovernanceNote,
  findInlinePlaintextProviderApiKeys,
} from "./plaintext-config-audit.js";

function cfg(providers: Record<string, unknown>): OpenBotConfig {
  return { models: { providers } } as unknown as OpenBotConfig;
}

describe("findInlinePlaintextProviderApiKeys", () => {
  it("flags inline plaintext apiKeys", () => {
    const out = findInlinePlaintextProviderApiKeys(
      cfg({
        deepseek: { apiKey: "sk-plaintext-value" },
        openai: { apiKey: "sk-another" },
      }),
    );
    expect(out).toEqual(["deepseek", "openai"]);
  });

  it("ignores SecretRef objects, env templates, markers, and sentinels", () => {
    const out = findInlinePlaintextProviderApiKeys(
      cfg({
        viaRef: { apiKey: { source: "file", provider: "filemain", id: "/providers/x/apiKey" } },
        viaEnvTemplate: { apiKey: "${OPENAI_API_KEY}" },
        viaEnvTemplateBare: { apiKey: "$OPENAI_API_KEY" },
        viaMarker: { apiKey: "OPENAI_API_KEY" },
        viaSentinel: { apiKey: "__OPENCLAW_REDACTED__" },
        noKey: { baseUrl: "https://x.example/v1" },
      }),
    );
    expect(out).toEqual([]);
  });

  it("returns empty when there are no providers", () => {
    expect(findInlinePlaintextProviderApiKeys({} as OpenBotConfig)).toEqual([]);
  });
});

describe("buildPlaintextApiKeyGovernanceNote", () => {
  it("returns null when nothing is plaintext", () => {
    expect(
      buildPlaintextApiKeyGovernanceNote(cfg({ viaMarker: { apiKey: "OPENAI_API_KEY" } })),
    ).toBeNull();
  });

  it("names the flagged providers when plaintext is present", () => {
    const note = buildPlaintextApiKeyGovernanceNote(cfg({ deepseek: { apiKey: "sk-x" } }));
    expect(note).toContain("deepseek");
    expect(note).toContain("task 2.9");
  });
});
