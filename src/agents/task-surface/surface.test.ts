import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyIncomingUserMessage } from "../../conversation-task/session-task-board.js";
import { replyForTaskSurfaceUtterance } from "./apply.js";
import {
  ghostInjectionShouldOmit,
  isOrdinalClarificationQuiz,
  labelGhostInjection,
  ledgerIdsToCancel,
  planKeepOnly,
  presentNonMainlineInjection,
  reconcileTaskSurface,
  type LedgerSurfaceRow,
  type SessionHangEntry,
} from "./surface.js";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-task-surface-"));
  temps.push(dir);
  return dir;
}

const sessionHang: SessionHangEntry[] = [
  { id: "task-ip", title: "近5年外企在华知识产权维权诉讼分析报告", kind: "current" },
  { id: "task-public", title: "你通过公开数据整理", kind: "parked" },
  {
    id: "task-review",
    title: "写审查记录、完成绑定，再跑制作、验收和 compile 生成 PDF",
    kind: "parked",
  },
  { id: "task-ppt", title: "把一篇文章做成一份精美的 PPT", kind: "parked" },
];

const ledger: LedgerSurfaceRow[] = [
  {
    id: "task_8eca69d7",
    title: "近5年外企在华知识产权维权诉讼分析报告",
    status: "active",
    description: "请认真研究和了解近5年外企在华知识产权维权诉讼案例",
  },
  { id: "task_desktop", title: "请用本机节点列出我的桌面文件", status: "active" },
  { id: "task_notes", title: "公开数据整理笔记", status: "paused" },
  { id: "task_done", title: "已经做完的报告", status: "done" },
  { id: "task_extra", title: "另一条只在登记表里的任务", status: "active" },
];

function seedBoard(sessionFile: string, hang: SessionHangEntry[] = sessionHang): void {
  const [current, ...parked] = hang;
  fs.writeFileSync(sessionFile, "", "utf8");
  fs.writeFileSync(
    `${sessionFile}.task-board.json`,
    `${JSON.stringify({
      current: current
        ? {
            taskId: current.id,
            title: current.title,
            goalText: current.title,
            unfinished: true,
            stop: { summary: "未完成", workspacePaths: [] },
            createdAtMs: 1,
          }
        : undefined,
      parked: parked.map((row, index) => ({
        taskId: row.id,
        title: row.title,
        goalText: row.title,
        unfinished: true,
        stop: { summary: "未完成", workspacePaths: [] },
        parkedAtMs: 10 - index,
        createdAtMs: index,
      })),
    })}\n`,
    "utf8",
  );
}

function seedLedger(workspaceDir: string, rows: LedgerSurfaceRow[] = ledger): string {
  const memory = path.join(workspaceDir, "memory");
  fs.mkdirSync(memory, { recursive: true });
  const ledgerPath = path.join(memory, "task_ledger.json");
  fs.writeFileSync(
    ledgerPath,
    `${JSON.stringify({
      version: 1,
      updated_at: "2026-10-21T00:00:00.000Z",
      items: rows.map((row) => ({
        id: row.id,
        scope: "agent",
        owner_id: "main",
        title: row.title,
        description: row.description ?? "",
        status: row.status,
        context: { key_points: [] },
        artifacts: [],
        last_session_id: "",
        updated_at: "2026-10-21T00:00:00.000Z",
        ...(row.surface_disposition ? { surface_disposition: row.surface_disposition } : {}),
      })),
    })}\n`,
    "utf8",
  );
  return ledgerPath;
}

describe("task surface reconcile", () => {
  it("shows session ordinals and marks rows the ledger does not have", () => {
    const surface = reconcileTaskSurface({ sessionHang, ledger });
    expect(surface.inconsistent).toBe(true);
    expect(surface.items.map((item) => item.ordinal)).toEqual([1, 2, 3, 4]);
    expect(surface.items[0]).toMatchObject({ ledgerId: "task_8eca69d7", booked: true, mark: "" });
    expect(surface.items[2]).toMatchObject({
      sessionId: "task-review",
      booked: false,
      mark: "未入账",
    });
    expect(surface.displayText).toContain(
      "1. 近5年外企在华知识产权维权诉讼分析报告（task_8eca69d7）",
    );
    expect(surface.displayText).toContain(
      "3. 写审查记录、完成绑定，再跑制作、验收和 compile 生成 PDF（未入账）",
    );
    expect(surface.displayText).not.toMatch(/请你确认|是不是|你选择哪一种/);
    expect(isOrdinalClarificationQuiz(surface.displayText)).toBe(false);
    expect(surface.unlistedLedgerIds).toContain("task_extra");
    expect(surface.unlistedLedgerIds).not.toContain("task_done");
  });

  it("plans keep-only against the shown ordinal and does not ask", () => {
    const surface = reconcileTaskSurface({ sessionHang, ledger });
    const plan = planKeepOnly(surface.items, 3);
    expect(plan.asksUser).toBe(false);
    expect(plan.outOfRange).toBe(false);
    expect(plan.kept.map((item) => item.sessionId)).toEqual(["task-review"]);
    expect(plan.cancelled.map((item) => item.sessionId)).toEqual([
      "task-ip",
      "task-public",
      "task-ppt",
    ]);
    expect(plan.receipt).toContain("保留：session:task-review（未入账）");
    expect(plan.receipt).toContain("task_8eca69d7");
    expect(plan.receipt).toContain("取消：");
    expect(isOrdinalClarificationQuiz(plan.receipt)).toBe(false);
    const withFile = ledgerIdsToCancel(plan, { task_8eca69d7: true, task_extra: true });
    const withoutFile = ledgerIdsToCancel(plan, {});
    expect(withFile).toEqual(withoutFile);
    expect(withFile).toEqual(["task_8eca69d7"]);
    expect(withFile).not.toContain("task_extra");
  });
});

describe("task surface keep-only", () => {
  it("keeps the ordinal that was shown, even if the board order later drifts", () => {
    const dir = tempDir();
    const sessionFile = path.join(dir, "session.jsonl");
    const ledgerPath = seedLedger(dir);
    seedBoard(sessionFile);
    const cfg = { agents: { defaults: { workspace: dir } } };
    const display = replyForTaskSurfaceUtterance({
      text: "现在挂着的任务有几个？",
      cfg,
      workspaceDir: dir,
      agentId: "main",
      sessionKey: "agent:main:main",
      sessionFile,
    });
    expect(display).toContain("（未入账）");
    expect(display).toContain("task_8eca69d7");
    expect(isOrdinalClarificationQuiz(display ?? "")).toBe(false);

    const drifted = [...sessionHang].toReversed();
    seedBoard(sessionFile, drifted);

    const receipt = replyForTaskSurfaceUtterance({
      text: "只保留第三条，其它都清掉",
      cfg,
      workspaceDir: dir,
      agentId: "main",
      sessionKey: "agent:main:main",
      sessionFile,
      filePresentById: { task_extra: true, "old-deliverable.md": true },
    });
    expect(receipt).toContain("已按当前展示序号保留第 3 条。");
    expect(receipt).toContain("保留：session:task-review（未入账）");
    expect(receipt).toContain("task_8eca69d7");
    expect(isOrdinalClarificationQuiz(receipt ?? "")).toBe(false);

    const board = JSON.parse(fs.readFileSync(`${sessionFile}.task-board.json`, "utf8")) as {
      current?: { taskId: string };
      parked: Array<{ taskId: string }>;
    };
    expect(board.current?.taskId).toBe("task-review");
    expect(board.parked).toEqual([]);

    const stored = JSON.parse(fs.readFileSync(ledgerPath, "utf8")) as {
      items: Array<{ id: string; status: string; surface_disposition?: string }>;
    };
    const cancelled = stored.items.find((item) => item.id === "task_8eca69d7");
    const extra = stored.items.find((item) => item.id === "task_extra");
    expect(cancelled).toMatchObject({ status: "paused", surface_disposition: "cancelled" });
    expect(extra).toMatchObject({ status: "active" });
    expect(extra?.surface_disposition).toBeUndefined();

    const again = replyForTaskSurfaceUtterance({
      text: "只保留第三条，其它都清掉",
      cfg,
      workspaceDir: dir,
      agentId: "main",
      sessionKey: "agent:main:main",
      sessionFile,
    });
    expect(again).toBe(receipt);
    expect(isOrdinalClarificationQuiz(again ?? "")).toBe(false);
  });

  it("still cancels the session list when the ledger write fails", () => {
    const dir = tempDir();
    const sessionFile = path.join(dir, "session.jsonl");
    const ledgerPath = seedLedger(dir);
    const before = fs.readFileSync(ledgerPath, "utf8");
    seedBoard(sessionFile);
    const cfg = { agents: { defaults: { workspace: dir } } };
    replyForTaskSurfaceUtterance({
      text: "现在挂着的任务有几个",
      cfg,
      workspaceDir: dir,
      agentId: "main",
      sessionFile,
    });
    const receipt = replyForTaskSurfaceUtterance({
      text: "只保留第3条",
      cfg,
      workspaceDir: dir,
      agentId: "main",
      sessionFile,
      writeLedgerFile: () => {
        const err = new Error("EACCES");
        (err as NodeJS.ErrnoException).code = "EACCES";
        throw err;
      },
    });
    expect(receipt).toContain("保留：session:task-review（未入账）");
    expect(receipt).toContain("取消：");
    expect(receipt).toContain("side_path_bypass: memory/task_ledger.json EACCES");
    expect(isOrdinalClarificationQuiz(receipt ?? "")).toBe(false);
    expect(fs.readFileSync(ledgerPath, "utf8")).toBe(before);
    const board = JSON.parse(fs.readFileSync(`${sessionFile}.task-board.json`, "utf8")) as {
      current?: { taskId: string };
      parked: unknown[];
    };
    expect(board.current?.taskId).toBe("task-review");
    expect(board.parked).toEqual([]);
    const second = replyForTaskSurfaceUtterance({
      text: "只保留第3条",
      cfg,
      workspaceDir: dir,
      agentId: "main",
      sessionFile,
      writeLedgerFile: () => {
        const err = new Error("EACCES");
        (err as NodeJS.ErrnoException).code = "EACCES";
        throw err;
      },
    });
    expect(second).toBe(receipt);
  });

  it("does not turn a keep-only utterance into a new parked task", () => {
    const started = applyIncomingUserMessage({
      board: { parked: [] },
      incomingText: "写审查记录并生成 PDF",
    });
    const kept = applyIncomingUserMessage({
      board: started.board,
      incomingText: "只保留第三条，其它都清掉",
    });
    expect(kept.action).toBe("continue");
    expect(kept.board.current?.title).toBe(started.board.current?.title);
    expect(kept.board.current?.title).not.toContain("只保留");
    const listed = applyIncomingUserMessage({
      board: started.board,
      incomingText: "现在挂着的任务有几个？",
    });
    expect(listed.action).toBe("continue");
    expect(listed.board.current?.taskId).toBe(started.board.current?.taskId);
  });
});

describe("ghost injection labels", () => {
  it("omits an unrelated heartbeat or restore task and labels one that stays", () => {
    const title = "近5年外企在华知识产权维权诉讼分析报告";
    expect(
      ghostInjectionShouldOmit({
        source: "heartbeat",
        taskId: "task_8eca69d7",
        title,
        userUtterance: "沙箱已经具备 Playwright 和 Node 20 这个条件了，请继续尝试",
      }),
    ).toBe(true);
    expect(
      ghostInjectionShouldOmit({
        source: "restore",
        taskId: "task_8eca69d7",
        title,
        userUtterance: "请继续写审查记录、完成绑定",
      }),
    ).toBe(true);
    expect(
      ghostInjectionShouldOmit({
        source: "ledger",
        taskId: "task_live",
        title: "写审查记录、完成绑定",
        userUtterance: "请继续写审查记录、完成绑定",
        mainlineTaskId: "task_live",
      }),
    ).toBe(false);
    expect(labelGhostInjection({ source: "heartbeat", taskId: "task_8eca69d7", title })).toBe(
      "[source=heartbeat id=task_8eca69d7] 近5年外企在华知识产权维权诉讼分析报告",
    );
    expect(
      presentNonMainlineInjection({
        text: "Task: 知识产权",
        taskId: "task_8eca69d7",
        title,
        source: "heartbeat",
        userUtterance: "请继续尝试",
      }),
    ).toBe("");
    expect(
      presentNonMainlineInjection({
        text: "Task: 知识产权",
        taskId: "task_8eca69d7",
        title,
        source: "ledger",
        userUtterance: "现在挂着的任务有几个",
      }),
    ).toContain("[source=ledger id=task_8eca69d7]");
  });
});
