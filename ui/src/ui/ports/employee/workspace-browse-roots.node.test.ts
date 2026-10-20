import { describe, expect, it } from "vitest";
import {
  isLocalComputerGateway,
  resolveDefaultWorkspaceBrowsePath,
  resolveWorkspaceBrowseRoots,
  splitWorkspacePathBreadcrumbs,
} from "./workspace-browse-roots.ts";

describe("resolveWorkspaceBrowseRoots", () => {
  it("includes desktop and documents on darwin", () => {
    expect(resolveWorkspaceBrowseRoots("darwin", "/Users/daniel")).toEqual([
      { id: "desktop", label: "桌面", path: "/Users/daniel/Desktop" },
      { id: "documents", label: "文稿", path: "/Users/daniel/Documents" },
      { id: "downloads", label: "下载", path: "/Users/daniel/Downloads" },
      { id: "home", label: "主目录", path: "/Users/daniel" },
      { id: "volumes", label: "所有磁盘", path: "/Volumes" },
      { id: "fs-root", label: "系统根 (/)", path: "/" },
    ]);
  });

  it("includes home and filesystem root on linux", () => {
    expect(resolveWorkspaceBrowseRoots("linux", "/root")).toEqual([
      { id: "home", label: "主目录", path: "/root" },
      { id: "fs-root", label: "系统根 (/)", path: "/" },
    ]);
  });
});

describe("isLocalComputerGateway", () => {
  it("treats public SaaS entry as remote even when gateway URL is same-origin", () => {
    expect(
      isLocalComputerGateway({
        gatewayUrl: "wss://www.openbot.love/ws",
        pageUrl: "https://www.openbot.love/settings",
      }),
    ).toBe(false);
  });

  it("treats loopback control UI + loopback gateway as local", () => {
    expect(
      isLocalComputerGateway({
        gatewayUrl: "ws://127.0.0.1:18789",
        pageUrl: "http://127.0.0.1:18789/",
      }),
    ).toBe(true);
  });
});

describe("resolveDefaultWorkspaceBrowsePath", () => {
  it("opens desktop first on local darwin gateway", () => {
    const roots = resolveWorkspaceBrowseRoots("darwin", "/Users/daniel");
    expect(
      resolveDefaultWorkspaceBrowsePath({
        platform: "darwin",
        homedir: "/Users/daniel",
        isLocalGateway: true,
        browseRoots: roots,
      }),
    ).toBe("/Users/daniel/Desktop");
  });
});

describe("splitWorkspacePathBreadcrumbs", () => {
  it("splits unix paths into navigable segments", () => {
    expect(splitWorkspacePathBreadcrumbs("/Users/daniel/workspace")).toEqual([
      { label: "系统根", path: "/" },
      { label: "Users", path: "/Users" },
      { label: "daniel", path: "/Users/daniel" },
      { label: "workspace", path: "/Users/daniel/workspace" },
    ]);
  });
});
