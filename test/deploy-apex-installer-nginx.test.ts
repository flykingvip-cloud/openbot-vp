import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apexConf = readFileSync(
  path.join(repoRoot, "deploy/production/proxy/nginx/apex.openbot.love.conf"),
  "utf8",
);

function locationIndex(needle: string): number {
  const idx = apexConf.indexOf(needle);
  expect(idx, `missing ${needle}`).toBeGreaterThanOrEqual(0);
  return idx;
}

describe("apex.openbot.love.conf installer static locations", () => {
  it("declares installer and downloads locations before the SPA catch-all", () => {
    const catchAll = locationIndex("\n    location / {");
    const installSh = locationIndex("location = /install.sh");
    const installCli = locationIndex("location = /install-cli.sh");
    const installPs1 = locationIndex("location = /install.ps1");
    const downloads = locationIndex("location ^~ /downloads/");

    expect(installSh).toBeLessThan(catchAll);
    expect(installCli).toBeLessThan(catchAll);
    expect(installPs1).toBeLessThan(catchAll);
    expect(downloads).toBeLessThan(catchAll);
  });

  it("serves install-cli.sh from the install-cli.sh payload", () => {
    const cliBlock = apexConf.slice(
      locationIndex("location = /install-cli.sh"),
      locationIndex("location = /install.ps1"),
    );
    expect(cliBlock).toContain("alias /var/www/openbot-downloads/install-cli.sh;");
    expect(cliBlock).not.toContain("alias /var/www/openbot-downloads/install.sh;");
    expect(cliBlock).toContain('filename="install-cli.sh"');
    expect(cliBlock).not.toContain("proxy_pass");
  });

  it("does not proxy installer paths to the gateway", () => {
    const installSh = apexConf.slice(
      locationIndex("location = /install.sh"),
      locationIndex("location = /install-cli.sh"),
    );
    expect(installSh).not.toContain("proxy_pass");
    expect(installSh).toContain("alias /var/www/openbot-downloads/install.sh;");
    expect(installSh).toContain("application/x-sh");
  });
});
