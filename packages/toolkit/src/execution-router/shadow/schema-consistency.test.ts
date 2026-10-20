import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const designRoot = path.resolve(here, "../../../../../.kiro/specs/execution-router-phase1");

function readJson(filePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
}

describe("Phase 1 I1 schema consistency", () => {
  it("keeps production schemas aligned with the merged design schemas", () => {
    const envelope = readJson(path.join(here, "task-envelope.schema.json"));
    const event = readJson(path.join(here, "shadow-events.schema.json"));
    expect(envelope.$id).toBe("openbot.execution-router.task-envelope.v1");
    expect(event.$id).toBe("openbot.execution-router.shadow-event.v1");
    expect((event.properties as { apply: { const: boolean } }).apply.const).toBe(false);
    const flags = (
      event.properties as {
        flags: { properties: Record<string, { const: boolean }> };
      }
    ).flags.properties;
    expect(flags.SHADOW_ROUTER_APPLY.const).toBe(false);
    expect(flags.ORCHESTRATION_LIVE_INVOKE.const).toBe(false);

    const designEnvelope = path.join(designRoot, "task-envelope.schema.json");
    const designEvent = path.join(designRoot, "shadow-events.schema.json");
    expect(existsSync(designEnvelope)).toBe(true);
    expect(readJson(designEnvelope)).toEqual(envelope);
    expect(readJson(designEvent)).toEqual(event);
  });
});
