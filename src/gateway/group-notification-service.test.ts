import { describe, expect, it, vi } from "vitest";
import {
  formatAssetShareNotification,
  sendGroupNotification,
} from "./group-notification-service.js";

describe("group-notification-service", () => {
  describe("formatAssetShareNotification", () => {
    it("formats asset share notification with all details", () => {
      const message = formatAssetShareNotification({
        assetName: "周报模板",
        assetType: "template",
        sharedBy: "张三",
        groupName: "产品研发小组",
      });
      expect(message).toBe("📢 来自 张三 分享了模板「周报模板」到本小组");
    });

    it("formats asset share notification without group name", () => {
      const message = formatAssetShareNotification({
        assetName: "客户跟进流程",
        assetType: "workflow",
        sharedBy: "李四",
      });
      expect(message).toBe("📢 来自 李四 分享了工作流「客户跟进流程」");
    });

    it("maps asset types to Chinese labels", () => {
      const types = ["prompt", "template", "workflow", "knowledge", "agent", "capability"];
      const labels = ["提示词", "模板", "工作流", "知识库", "智能体", "能力"];
      for (let i = 0; i < types.length; i++) {
        const message = formatAssetShareNotification({
          assetName: "test",
          assetType: types[i],
          sharedBy: "user",
        });
        expect(message).toContain(labels[i]);
      }
    });
  });

  describe("sendGroupNotification", () => {
    it("calls nodeSendToSession with group.notification event when delivery context provided", async () => {
      const nodeSendToSession = vi.fn();
      const buildSessionKey = vi.fn().mockReturnValue("agent:bot-1:main:space:test-group");

      await sendGroupNotification({
        groupId: "test-group",
        message: "测试通知",
        metadata: { type: "asset_shared", relatedResourceId: "cap-1", actionBy: "alice" },
        delivery: {
          groupId: "test-group",
          botId: "bot-1",
          nodeSendToSession,
          buildSessionKey,
        },
      });

      expect(buildSessionKey).toHaveBeenCalledWith("bot-1", "test-group");
      expect(nodeSendToSession).toHaveBeenCalledTimes(1);
      expect(nodeSendToSession).toHaveBeenCalledWith(
        "agent:bot-1:main:space:test-group",
        "group.notification",
        expect.objectContaining({
          groupId: "test-group",
          message: expect.stringContaining("测试通知"),
          type: "asset_shared",
          relatedResourceId: "cap-1",
          actionBy: "alice",
          timestamp: expect.any(Number),
        }),
      );
    });

    it("falls back to log-only when no delivery context (no botId)", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      await sendGroupNotification({
        groupId: "test-group",
        message: "简单通知",
        metadata: { type: "asset_shared" },
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("[GroupNotification]"),
        expect.stringContaining("简单通知"),
      );
      consoleSpy.mockRestore();
    });

    it("falls back to log-only when delivery has no nodeSendToSession", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      await sendGroupNotification({
        groupId: "test-group",
        message: "无上下文",
        delivery: { groupId: "test-group", botId: "bot-1" },
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("[GroupNotification]"),
        expect.stringContaining("无上下文"),
      );
      consoleSpy.mockRestore();
    });

    it("does not throw when nodeSendToSession throws", async () => {
      const nodeSendToSession = vi.fn().mockImplementation(() => {
        throw new Error("connection closed");
      });
      const buildSessionKey = vi.fn().mockReturnValue("agent:bot-1:main:space:g1");
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await expect(
        sendGroupNotification({
          groupId: "g1",
          message: "error test",
          delivery: {
            groupId: "g1",
            botId: "bot-1",
            nodeSendToSession,
            buildSessionKey,
          },
        }),
      ).resolves.toBeUndefined();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("[GroupNotification] push failed"),
        expect.any(Error),
      );
      consoleSpy.mockRestore();
    });
  });
});
