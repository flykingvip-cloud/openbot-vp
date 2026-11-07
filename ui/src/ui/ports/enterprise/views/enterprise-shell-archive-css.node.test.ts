import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SHELL_URL = new URL("./enterprise-shell.ts", import.meta.url);

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
});
