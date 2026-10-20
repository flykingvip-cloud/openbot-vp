import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  appendSharedDocReview,
  boardDeliverablePathForSharedDoc,
  buildRequestReviewEdgeDirective,
  claimSharedDocSection,
  formatSharedDocCardForPrompt,
  listSharedDocReviews,
  openOrCreateSharedDoc,
  sharedDocPaths,
  upsertSharedDocSection,
  writeSharedDocBody,
  tryBuildSharedDocPromptAppendixSync,
} from "./shared-group-doc.js";

const tmpRoots: string[] = [];

async function tmpGroupRoot(): Promise<string> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "shared-group-doc-"));
  tmpRoots.push(root);
  return root;
}

afterEach(async () => {
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (root) {
      await fsp.rm(root, { recursive: true, force: true });
    }
  }
});

describe("shared-group-doc", () => {
  test("all members open the same deliverables path (single SoT)", async () => {
    const root = await tmpGroupRoot();
    const a = await openOrCreateSharedDoc({
      groupWorkspaceRoot: root,
      groupId: "grp-demo",
      logicalId: "2030企业AI战略报告",
      title: "2030企业AI战略报告",
      taskId: "task-1",
    });
    const b = await openOrCreateSharedDoc({
      groupWorkspaceRoot: root,
      groupId: "grp-demo",
      logicalId: "2030企业AI战略报告",
      title: "2030企业AI战略报告",
    });
    expect(a.relativePath).toBe(b.relativePath);
    expect(a.relativePath).toBe(boardDeliverablePathForSharedDoc("2030企业AI战略报告"));
    expect(a.absolutePath).toBe(b.absolutePath);
    expect(fs.existsSync(a.absolutePath)).toBe(true);
    expect(a.body).toContain("2030企业AI战略报告");
    // second open must not fork a per-bot copy
    const listing = await fsp.readdir(path.join(root, "deliverables"));
    expect(listing.filter((name) => name.endsWith(".md"))).toHaveLength(1);
  });

  test("section claim enforces single owner (C0)", async () => {
    const root = await tmpGroupRoot();
    await openOrCreateSharedDoc({
      groupWorkspaceRoot: root,
      groupId: "grp-demo",
      logicalId: "report",
      title: "Report",
    });
    await upsertSharedDocSection({
      groupWorkspaceRoot: root,
      logicalId: "report",
      actorAgentId: "bot",
      section: {
        id: "sec-market",
        title: "市场章节",
        ownerAgentId: null,
        status: "todo",
      },
    });
    const claimed = await claimSharedDocSection({
      groupWorkspaceRoot: root,
      logicalId: "report",
      sectionId: "sec-market",
      agentId: "bot-2",
    });
    expect(claimed.sections[0]?.ownerAgentId).toBe("bot-2");
    expect(claimed.sections[0]?.status).toBe("claimed");

    await expect(
      claimSharedDocSection({
        groupWorkspaceRoot: root,
        logicalId: "report",
        sectionId: "sec-market",
        agentId: "bot--agent",
      }),
    ).rejects.toThrow(/held by bot-2/);
  });

  test("body write requires section owner when requested", async () => {
    const root = await tmpGroupRoot();
    await openOrCreateSharedDoc({
      groupWorkspaceRoot: root,
      groupId: "grp-demo",
      logicalId: "report",
      title: "Report",
      initialBody: "# Report\n\n",
    });
    await upsertSharedDocSection({
      groupWorkspaceRoot: root,
      logicalId: "report",
      actorAgentId: "bot",
      section: {
        id: "sec-a",
        title: "A",
        ownerAgentId: "bot-2",
        status: "claimed",
      },
    });
    await expect(
      writeSharedDocBody({
        groupWorkspaceRoot: root,
        logicalId: "report",
        content: "# hijack\n",
        actorAgentId: "panda",
        requireSectionOwner: "sec-a",
      }),
    ).rejects.toThrow(/owned by bot-2/);

    const written = await writeSharedDocBody({
      groupWorkspaceRoot: root,
      logicalId: "report",
      content: "# Report\n\n## A\nmarket notes\n",
      actorAgentId: "bot-2",
      requireSectionOwner: "sec-a",
    });
    expect(written.relativePath).toBe("deliverables/report.md");
    const body = await fsp.readFile(path.join(root, written.relativePath), "utf8");
    expect(body).toContain("market notes");
  });

  test("reviews append to sidecar and request_review edge is buildable (C2)", async () => {
    const root = await tmpGroupRoot();
    await openOrCreateSharedDoc({
      groupWorkspaceRoot: root,
      groupId: "grp-demo",
      logicalId: "report",
      title: "Report",
    });
    await upsertSharedDocSection({
      groupWorkspaceRoot: root,
      logicalId: "report",
      actorAgentId: "bot-2",
      section: {
        id: "sec-a",
        title: "A",
        ownerAgentId: "bot-2",
        status: "in_progress",
      },
    });
    const comment = await appendSharedDocReview({
      groupWorkspaceRoot: root,
      logicalId: "report",
      byAgentId: "bot--agent",
      sectionId: "sec-a",
      kind: "request_changes",
      body: "缺权威数据来源",
    });
    expect(comment.id).toMatch(/^rev_/);
    const reviews = await listSharedDocReviews({ groupWorkspaceRoot: root, logicalId: "report" });
    expect(reviews).toHaveLength(1);
    expect(reviews[0]?.body).toBe("缺权威数据来源");

    const edge = buildRequestReviewEdgeDirective({
      toAgentIdOrName: "高密度分析",
      reason: "请评审市场章",
      logicalId: "report",
      sectionId: "sec-a",
    });
    expect(edge).toContain("collab_edge:request_review");
    expect(edge).toContain("doc=report");
    expect(edge).toContain("section=sec-a");
  });

  test("prompt card points every viewer at the same path", async () => {
    const root = await tmpGroupRoot();
    const opened = await openOrCreateSharedDoc({
      groupWorkspaceRoot: root,
      groupId: "grp-demo",
      logicalId: "report",
      title: "Report",
    });
    await upsertSharedDocSection({
      groupWorkspaceRoot: root,
      logicalId: "report",
      actorAgentId: "bot",
      section: {
        id: "sec-a",
        title: "框架",
        ownerAgentId: "bot",
        status: "claimed",
      },
    });
    const paths = sharedDocPaths(root, "report");
    const meta = JSON.parse(await fsp.readFile(paths.metaPath, "utf8"));
    const card = formatSharedDocCardForPrompt({
      meta,
      viewerAgentId: "bot",
      reviewCount: 0,
    });
    expect(card).toContain(opened.relativePath);
    expect(card).toContain("（我的）");
    expect(card).toContain("同一相对路径");
  });

  test("sync prompt appendix discovers shared doc for all viewers", async () => {
    const root = await tmpGroupRoot();
    await openOrCreateSharedDoc({
      groupWorkspaceRoot: root,
      groupId: "grp-demo",
      logicalId: "report",
      title: "Report",
    });
    const card = tryBuildSharedDocPromptAppendixSync({
      groupWorkspaceRoot: root,
      viewerAgentId: "bot-2",
    });
    expect(card).toContain("deliverables/report.md");
    expect(card).toContain("group.sharedDoc.open");
  });
});
