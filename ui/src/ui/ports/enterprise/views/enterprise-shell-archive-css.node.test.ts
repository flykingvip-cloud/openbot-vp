import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SHELL_URL = new URL("./enterprise-shell.ts", import.meta.url);
const CHANNEL_CSS_URL = new URL("../../../../styles/enterprise-im-channels.css", import.meta.url);

/**
 * Production render goes through enterprise-surfaces-core (static), not the
 * lazy CSS loader in enterprise-surface-lazy.ts. Guard the live shell import
 * so archive footer nowrap / scroll rules and the channel switcher stay in the
 * control-ui CSS bundle. The re-export shim ui/src/ui/shells/enterprise-shell.ts
 * is not on the app-render path.
 */
describe("enterprise-shell archive CSS pack", () => {
  it("statically imports enterprise-org-archive.css on the live shell path", async () => {
    const source = await readFile(fileURLToPath(SHELL_URL), "utf8");
    expect(source).toContain('import "../../../../styles/enterprise-org-archive.css"');
  });

  it("statically imports enterprise-im-channels.css on the live shell path", async () => {
    const source = await readFile(fileURLToPath(SHELL_URL), "utf8");
    expect(source).toContain('import "../../../../styles/enterprise-im-channels.css"');
  });

  it("keeps the channel switcher quiet: no refresh hook and no accent fill", async () => {
    const css = await readFile(fileURLToPath(CHANNEL_CSS_URL), "utf8");
    expect(css).toContain(".enterprise-im-switcher");
    expect(css).toContain("flex-flow: row wrap");
    expect(css).toContain("background: transparent");
    expect(css).not.toContain("enterprise-im-switcher__refresh");
    expect(css).not.toContain("color-mix(in srgb, var(--accent) 8%");
  });
});
