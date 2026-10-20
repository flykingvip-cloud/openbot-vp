import { describe, expect, it } from "vitest";
import { suggestPaths } from "../../loom/learn.js";

describe("loom/learn — suggestPaths", () => {
  it("groups files under a parent dir into a `dir/**` glob", () => {
    const out = suggestPaths({
      candidateFiles: ["src/auth/login.ts", "src/auth/logout.ts", "src/auth/token.ts"],
    });
    expect(out).toHaveLength(1);
    expect(out[0].glob).toBe("src/auth/**");
    expect(out[0].files).toHaveLength(3);
  });

  it("scores denser directories with higher confidence", () => {
    const out = suggestPaths({
      candidateFiles: [
        "src/auth/a.ts",
        "src/auth/b.ts",
        "src/auth/c.ts", // 3 files → high
        "src/session/only.ts", // 1 file → low
      ],
    });
    const auth = out.find((s) => s.glob === "src/auth/**")!;
    const session = out.find((s) => s.glob === "src/session/**")!;
    expect(auth.confidence).toBeGreaterThan(session.confidence);
    // sorted highest-confidence first
    expect(out[0].glob).toBe("src/auth/**");
  });

  it("suggests root-level files verbatim at low confidence", () => {
    const out = suggestPaths({ candidateFiles: ["README.md"] });
    expect(out[0]).toMatchObject({ glob: "README.md", confidence: 45 });
  });

  it("returns nothing for no candidates (suggest never invents)", () => {
    expect(suggestPaths({ candidateFiles: [] })).toEqual([]);
  });
});
