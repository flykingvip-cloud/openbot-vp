import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { sessionTaskState } from "../index.js";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
it("absence permits ordinary interaction without creating task state", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "interaction-state-"));
  roots.push(root);
  const file = path.join(root, "session.jsonl");
  expect(sessionTaskState.readForInteraction(file)).toEqual({ parked: [], focusRevision: 0 });
  expect(fs.readdirSync(root)).toEqual([]);
});
it.each(["{invalid", JSON.stringify({ parked: "wrong" })])(
  "corrupt state is unavailable rather than silently an empty task",
  (bytes) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "interaction-state-"));
    roots.push(root);
    const file = path.join(root, "session.jsonl");
    fs.writeFileSync(`${file}.task-board.json`, bytes);
    expect(() => sessionTaskState.readForInteraction(file)).toThrow(SyntaxError);
    expect(fs.readFileSync(`${file}.task-board.json`, "utf8")).toBe(bytes);
  },
);
