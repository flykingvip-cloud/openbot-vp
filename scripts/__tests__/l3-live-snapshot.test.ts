import { describe, expect, it } from "vitest";
import {
  BLOCK_BEGIN,
  BLOCK_END,
  buildSnapshot,
  findProblems,
  parseProbe,
  renderL3Block,
  replaceGeneratedBlock,
  type L3Snapshot,
} from "../ops/l3-live-snapshot.js";

/** Probe output shaped like the real production host on 2026-07-27. */
const HEALTHY_PROBE = [
  "L3|probedAt=2026-07-27T09:10:05+08:00",
  "L3|container.name=openbot-gateway-rc",
  "L3|container.created=2026-07-26 18:31:05.333111321 +0800 CST",
  "L3|container.image=localhost/openbot:rc-amd64-provenance-aad4f39891c0",
  "L3|container.imageId=fa5faeec9e5a9846483a4a67316500961ce2edfcc8d6ba82779551ab15598f84",
  "L3|container.running=true",
  "L3|container.restartCount=0",
  "L3|container.startedAt=2026-07-26 18:31:05.496071769 +0800 CST",
  'L3|build.raw={"version":"2026.7.12-rc.2","commit":"aad4f39891c04a10e276581a4527f38ddb7c1aab","builtAt":"2026-07-26T10:29:24.742Z"}',
  "L3|ui.served=index-DGAEGlu2.js",
  "L3|ui.bundleCount=1",
  "L3|ui.appleDouble=0",
  "L3|health.healthz=200",
  'L3|health.readyz={"ready":true,"failing":[],"uptimeMs":52733214}',
  "L3|port.pid=2507992",
  "L3|port.ownedByContainer=true",
  "L3|harden.systemdUnit=masked",
  "L3|harden.npmGlobals=corepack@0.34.6,npm@10.9.7,pm2@7.0.1",
  "L3|harden.gatewayBins=0",
  "L3|rollback.container=openbot-gateway-rc-prev-provenance-safety",
  "L3|rollback.image=localhost/openbot:rc-amd64-provenance-5cf014a637b6",
].join("\n");

function healthySnapshot(): L3Snapshot {
  return buildSnapshot({
    host: "root@example-gateway",
    probe: parseProbe(HEALTHY_PROBE),
    publicHosts: [{ host: "www.example.test", status: 200, bundle: "index-DGAEGlu2.js" }],
  });
}

describe("l3-live-snapshot probe parsing", () => {
  it("parses L3| key=value lines and ignores unrelated stdout noise", () => {
    const raw = ["ssh: banner noise", "L3|ui.served=index-DGAEGlu2.js", "not a probe line"].join(
      "\n",
    );
    const map = parseProbe(raw);
    expect(map.get("ui.served")).toBe("index-DGAEGlu2.js");
    expect(map.size).toBe(1);
  });

  it("keeps values that themselves contain '=' (JSON payloads)", () => {
    const map = parseProbe('L3|health.readyz={"ready":true,"a=b":1}');
    expect(map.get("health.readyz")).toBe('{"ready":true,"a=b":1}');
  });

  it("builds a typed snapshot from probe output", () => {
    const s = healthySnapshot();
    expect(s.container.image).toBe("localhost/openbot:rc-amd64-provenance-aad4f39891c0");
    expect(s.container.running).toBe(true);
    expect(s.build.commit).toBe("aad4f39891c04a10e276581a4527f38ddb7c1aab");
    expect(s.controlUi.servedBundle).toBe("index-DGAEGlu2.js");
    expect(s.port.ownedByContainer).toBe(true);
    expect(s.rollback?.container).toBe("openbot-gateway-rc-prev-provenance-safety");
  });

  it("tolerates an unparseable build-info instead of throwing", () => {
    const s = buildSnapshot({
      host: "h",
      probe: parseProbe("L3|build.raw=not-json"),
      publicHosts: [],
    });
    expect(s.build).toEqual({ version: "", commit: "", builtAt: "" });
  });

  it("reports no rollback target when no safety container exists", () => {
    const s = buildSnapshot({
      host: "h",
      probe: parseProbe("L3|rollback.container="),
      publicHosts: [],
    });
    expect(s.rollback).toBeNull();
  });
});

describe("l3-live-snapshot problem detection", () => {
  it("finds nothing wrong with a healthy snapshot", () => {
    expect(findProblems(healthySnapshot())).toEqual([]);
  });

  it("flags a host process holding :18789 — the 2026-07-26 incident signature", () => {
    const s = healthySnapshot();
    s.port.ownedByContainer = false;
    expect(findProblems(s).join(" ")).toContain(":18789");
  });

  it("flags un-masked systemd unit and gateway bins back on PATH", () => {
    const s = healthySnapshot();
    s.hardening.systemdUnit = "disabled";
    s.hardening.gatewayBinsOnPath = 2;
    const problems = findProblems(s).join(" ");
    expect(problems).toContain("masked");
    expect(problems).toContain("PATH");
  });

  it("flags stale bundle accumulation and macOS AppleDouble leftovers", () => {
    const s = healthySnapshot();
    s.controlUi.bundleCount = 4;
    s.controlUi.appleDoubleCount = 1;
    const problems = findProblems(s);
    expect(problems.some((p) => p.includes("bundle"))).toBe(true);
    expect(problems.some((p) => p.includes("._"))).toBe(true);
  });

  it("flags a public host serving a different bundle than the container", () => {
    const s = healthySnapshot();
    s.publicHosts = [{ host: "www.example.test", status: 200, bundle: "index-OLDOLDOL.js" }];
    expect(findProblems(s).join(" ")).toContain("不一致");
  });

  it("flags unhealthy gateway responses", () => {
    const s = healthySnapshot();
    s.health.healthz = "502";
    s.health.readyz = '{"ready":false,"failing":["wecom"]}';
    const problems = findProblems(s).join(" ");
    expect(problems).toContain("502");
    expect(problems).toContain("readyz");
  });
});

describe("l3-live-snapshot rendering and block replacement", () => {
  it("renders the live image, commit and served bundle", () => {
    const md = renderL3Block(healthySnapshot());
    expect(md).toContain("rc-amd64-provenance-aad4f39891c0");
    expect(md).toContain("aad4f398");
    expect(md).toContain("index-DGAEGlu2.js");
    expect(md).toContain("No problems detected");
  });

  it("lists detected problems in the rendered block", () => {
    const s = healthySnapshot();
    s.container.running = false;
    expect(renderL3Block(s)).toContain("Problems detected");
  });

  it("replaces only the delimited block and preserves surrounding text", () => {
    const doc = [
      "# Record",
      "",
      "before text",
      BLOCK_BEGIN,
      "stale content",
      BLOCK_END,
      "",
      "after text",
    ].join("\n");
    const out = replaceGeneratedBlock(doc, "fresh content");
    expect(out).toContain("before text");
    expect(out).toContain("after text");
    expect(out).toContain("fresh content");
    expect(out).not.toContain("stale content");
    expect(out.indexOf(BLOCK_BEGIN)).toBeLessThan(out.indexOf(BLOCK_END));
  });

  it("is idempotent across repeated writes", () => {
    const doc = ["head", BLOCK_BEGIN, BLOCK_END, "tail"].join("\n");
    const once = replaceGeneratedBlock(doc, "body");
    expect(replaceGeneratedBlock(once, "body")).toBe(once);
  });

  it("throws a directive error when the markers are missing", () => {
    expect(() => replaceGeneratedBlock("# Record with no markers", "body")).toThrow(
      /markers not found/,
    );
  });
});
