import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyAuthorizedSqlitePath,
  isRejectedFixturePath,
  ITEM6_AUTHORIZED_SQLITE_ENV,
  ITEM6_AUTHORIZED_SQLITE_TRUSTED_ROOT_ENV,
  requireItem6AuthorizedSqlitePath,
} from "./item6-authorized-sqlite-path.js";
import { createItem6TrustedOperatorFixture } from "./item6-authorized-sqlite-test-fixtures.js";

describe("Item 6 authorized sqlite path gate", () => {
  it("fail-closed when env is unset", () => {
    expect(classifyAuthorizedSqlitePath({}).status).toBe("unconfigured");
    expect(requireItem6AuthorizedSqlitePath({}).ok).toBe(false);
  });

  it("requires operator-issued trusted root binding", () => {
    const { sqlitePath } = createItem6TrustedOperatorFixture("missing-root");
    expect(classifyAuthorizedSqlitePath({ [ITEM6_AUTHORIZED_SQLITE_ENV]: sqlitePath }).status).toBe(
      "missing-trusted-root",
    );
  });

  it("rejects evidence, host, and tmp fixture paths", () => {
    const evidence = path.join(process.cwd(), "docs/design/evidence/fixture.sqlite");
    expect(
      classifyAuthorizedSqlitePath({
        [ITEM6_AUTHORIZED_SQLITE_ENV]: evidence,
        [ITEM6_AUTHORIZED_SQLITE_TRUSTED_ROOT_ENV]: path.dirname(evidence),
      }).status,
    ).toBe("rejected-evidence-path");

    const hostDir = path.join(os.homedir(), ".openbot", "memory");
    expect(
      classifyAuthorizedSqlitePath({
        [ITEM6_AUTHORIZED_SQLITE_ENV]: path.join(hostDir, "fixture.sqlite"),
        [ITEM6_AUTHORIZED_SQLITE_TRUSTED_ROOT_ENV]: hostDir,
      }).status,
    ).toBe("host-not-production-sot");

    const tmpRoot = path.resolve(os.tmpdir());
    const tmp = path.join(tmpRoot, "openbot-item6-fixture.sqlite");
    expect(
      classifyAuthorizedSqlitePath({
        [ITEM6_AUTHORIZED_SQLITE_ENV]: tmp,
        [ITEM6_AUTHORIZED_SQLITE_TRUSTED_ROOT_ENV]: tmpRoot,
      }).status,
    ).toBe("rejected-fixture-path");

    const varTmp = path.join("/var/tmp", `openbot-item6-fixture-${process.pid}.sqlite`);
    expect(isRejectedFixturePath(varTmp)).toBe(true);
    expect(
      classifyAuthorizedSqlitePath({
        [ITEM6_AUTHORIZED_SQLITE_ENV]: varTmp,
        [ITEM6_AUTHORIZED_SQLITE_TRUSTED_ROOT_ENV]: "/var/tmp",
      }).status,
    ).toBe("rejected-fixture-path");
  });

  it("accepts operator-issued path only when bound under trusted root", () => {
    const fixture = createItem6TrustedOperatorFixture("bound");
    const result = requireItem6AuthorizedSqlitePath(fixture.env);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resolved).toBe(path.resolve(fixture.sqlitePath));
      expect(result.trustedRoot).toBe(path.resolve(fixture.trustedRoot));
      expect(result.pathToken).toMatch(/^sha256:/);
    }
  });

  it("denies path outside trusted root and symlink escape", () => {
    const realBase = process.env.OPENCLAW_REAL_HOME ?? os.homedir();
    const trustedRoot = path.join(realBase, `.item6-outside-root-${process.pid}`);
    fs.mkdirSync(trustedRoot, { recursive: true });
    const outside = path.join(realBase, `.item6-outside-file-${process.pid}`, "memory.sqlite");
    fs.mkdirSync(path.dirname(outside), { recursive: true });
    fs.writeFileSync(outside, "not-sqlite");

    expect(
      classifyAuthorizedSqlitePath({
        [ITEM6_AUTHORIZED_SQLITE_ENV]: outside,
        [ITEM6_AUTHORIZED_SQLITE_TRUSTED_ROOT_ENV]: trustedRoot,
      }).status,
    ).toBe("path-outside-trusted-root");

    const varTmpTarget = path.join("/var/tmp", `openbot-item6-symlink-${process.pid}.sqlite`);
    fs.writeFileSync(varTmpTarget, "sqlite-placeholder");
    const linkPath = path.join(trustedRoot, "link.sqlite");
    const outsideTarget = path.join(realBase, `.item6-symlink-target-${process.pid}.sqlite`);
    fs.writeFileSync(outsideTarget, "sqlite-placeholder");
    try {
      fs.symlinkSync(outsideTarget, linkPath);
    } catch {
      return;
    }
    expect(
      classifyAuthorizedSqlitePath({
        [ITEM6_AUTHORIZED_SQLITE_ENV]: linkPath,
        [ITEM6_AUTHORIZED_SQLITE_TRUSTED_ROOT_ENV]: trustedRoot,
      }).status,
    ).toBe("path-outside-trusted-root");

    const varTmpLink = path.join(trustedRoot, "var-tmp-link.sqlite");
    try {
      fs.symlinkSync(varTmpTarget, varTmpLink);
    } catch {
      return;
    }
    expect(
      classifyAuthorizedSqlitePath({
        [ITEM6_AUTHORIZED_SQLITE_ENV]: varTmpLink,
        [ITEM6_AUTHORIZED_SQLITE_TRUSTED_ROOT_ENV]: trustedRoot,
      }).status,
    ).toBe("rejected-fixture-path");
  });
});
