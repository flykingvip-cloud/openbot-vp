import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  calls: [] as Array<{
    command: string;
    args: string[];
    options: Record<string, unknown>;
    done: (error: Error | null, stdout: string) => void;
    input: { on: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  }>,
}));
vi.mock("node:child_process", () => ({
  execFile: (
    command: string,
    args: string[],
    options: Record<string, unknown>,
    done: (error: Error | null, stdout: string) => void,
  ) => {
    const input = { on: vi.fn(), end: vi.fn() };
    mocks.calls.push({ command, args, options, done, input });
    return { stdin: input };
  },
}));
import { renderPptxIsolatedPreview } from "./office-pptx-isolated.js";
beforeEach(() => {
  mocks.calls.length = 0;
});
it("sends original bytes via stdin to a local bounded worker without network or host mounts", async () => {
  const bytes = Buffer.from("original PPTX");
  const result = renderPptxIsolatedPreview(bytes, "title", 2);
  const call = mocks.calls[0];
  expect(call.command).toBe("docker");
  expect(call.args[0]).toBe("--host");
  expect(call.args[1]).toMatch(/^unix:\/\//);
  expect(call.args).toContain("--pull=never");
  expect(
    call.args.slice(call.args.indexOf("--network"), call.args.indexOf("--network") + 2),
  ).toEqual(["--network", "none"]);
  expect(call.args).toContain("--read-only");
  expect(call.args).not.toContain("--volume");
  expect(call.args).not.toContain("--mount");
  expect(call.options.timeout).toBe(35000);
  expect(call.input.end).toHaveBeenCalledWith(bytes);
  expect(Object.keys(call.options.env as object)).toEqual(["PATH", "HOME"]);
  call.done(null, '<img src="data:image/png;base64,abc">');
  expect(await result).toContain("data:image/png");
});
it("shares identical work and refuses extra distinct work instead of building an unbounded queue", async () => {
  const first = renderPptxIsolatedPreview(Buffer.from("same"), "a", 1);
  const second = renderPptxIsolatedPreview(Buffer.from("same"), "b", 1);
  expect(await renderPptxIsolatedPreview(Buffer.from("different"), "c", 1)).toBeNull();
  expect(mocks.calls).toHaveLength(1);
  mocks.calls[0].done(null, '<img src="data:image/png;base64,abc">');
  expect(await first).toBe(await second);
});
it("cleans up only its named container after a conversion failure", async () => {
  const result = renderPptxIsolatedPreview(Buffer.from("pptx"), "a", 1);
  const name = mocks.calls[0].args[mocks.calls[0].args.indexOf("--name") + 1];
  mocks.calls[0].done(new Error("timeout"), "");
  mocks.calls[1].done(null, "");
  expect(await result).toBeNull();
  expect(mocks.calls[1].args.slice(-3)).toEqual(["rm", "-f", name]);
});
