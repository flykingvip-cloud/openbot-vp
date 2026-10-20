import { describe, expect, it } from "vitest";
import { globToRegExp, matchesAnyGlob, parseStatus, statusKind } from "../../loom/glob.js";

describe("loom/glob — globToRegExp parity with legacy agent-attribution", () => {
  it("matches `dir/**` across separators and the bare dir", () => {
    const re = globToRegExp("ui/src/**");
    expect(re.test("ui/src/app.ts")).toBe(true);
    expect(re.test("ui/src/ports/employee/render-model.ts")).toBe(true);
    expect(re.test("ui/src/")).toBe(true);
    expect(re.test("ui/srcother.ts")).toBe(false);
    expect(re.test("other/ui/src/app.ts")).toBe(false);
  });

  it("matches single `*` within one segment only", () => {
    const re = globToRegExp("src/cli/*.ts");
    expect(re.test("src/cli/name.ts")).toBe(true);
    expect(re.test("src/cli/sub/name.ts")).toBe(false);
  });

  it("matches a prefix glob like `dir/foo*`", () => {
    const re = globToRegExp("ui/src/ui/ports/employee/render-model*");
    expect(re.test("ui/src/ui/ports/employee/render-model.ts")).toBe(true);
    expect(re.test("ui/src/ui/ports/employee/render-model.test.ts")).toBe(true);
    expect(re.test("ui/src/ui/ports/employee/other.ts")).toBe(false);
  });

  it("escapes regex metacharacters in literal path segments", () => {
    const re = globToRegExp("src/a.b+c(d)/file.ts");
    expect(re.test("src/a.b+c(d)/file.ts")).toBe(true);
    expect(re.test("src/aXbXcXdX/fileXts")).toBe(false);
  });

  it("anchors fully (no partial matches)", () => {
    const re = globToRegExp("package.json");
    expect(re.test("package.json")).toBe(true);
    expect(re.test("ui/package.json")).toBe(false);
    expect(re.test("package.json.bak")).toBe(false);
  });

  it("matchesAnyGlob ORs across globs", () => {
    const regexps = [globToRegExp("docs/**"), globToRegExp("README.md")];
    expect(matchesAnyGlob("docs/x/y.md", regexps)).toBe(true);
    expect(matchesAnyGlob("README.md", regexps)).toBe(true);
    expect(matchesAnyGlob("src/x.ts", regexps)).toBe(false);
  });
});

describe("loom/glob — parseStatus", () => {
  it("parses modified/added/untracked entries", () => {
    const z = "\0";
    const output = ` M src/a.ts${z}A  src/b.ts${z}?? src/c.ts${z}`;
    const entries = parseStatus(output);
    expect(entries).toEqual([
      { xy: " M", path: "src/a.ts" },
      { xy: "A ", path: "src/b.ts" },
      { xy: "??", path: "src/c.ts" },
    ]);
  });

  it("captures rename original path and consumes the following token", () => {
    const z = "\0";
    const output = `R  new/path.ts${z}old/path.ts${z} M other.ts${z}`;
    const entries = parseStatus(output);
    expect(entries).toEqual([
      { xy: "R ", path: "new/path.ts", originalPath: "old/path.ts" },
      { xy: " M", path: "other.ts" },
    ]);
  });
});

describe("loom/glob — statusKind", () => {
  it("classifies XY codes", () => {
    expect(statusKind("??")).toBe("untracked");
    expect(statusKind(" D")).toBe("deleted");
    expect(statusKind("A ")).toBe("added");
    expect(statusKind("R ")).toBe("renamed");
    expect(statusKind(" M")).toBe("modified");
    expect(statusKind("MM")).toBe("modified");
  });
});
