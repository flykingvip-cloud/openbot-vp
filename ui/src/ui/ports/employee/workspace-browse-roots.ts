export type WorkspaceBrowseRoot = {
  id: string;
  label: string;
  path: string;
};

export type WorkspacePathSegment = {
  label: string;
  path: string;
};

function joinHomePath(homedir: string, segment: string, platform: string) {
  const trimmedHome = homedir.replace(/[/\\]+$/, "");
  if (platform === "win32") {
    return `${trimmedHome}\\${segment}`;
  }
  return `${trimmedHome}/${segment}`;
}

export function isLoopbackHost(host: string) {
  const normalized = host.trim().toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]" ||
    normalized.startsWith("127.")
  );
}

/** True only when Control UI and Gateway both run on the user's computer (loopback). */
export function isLocalComputerGateway(params: { gatewayUrl: string; pageUrl?: string }) {
  if (typeof window === "undefined" && !params.pageUrl) {
    return false;
  }
  try {
    const pageUrl = params.pageUrl ?? window.location.href;
    const page = new URL(pageUrl);
    const gateway = new URL(params.gatewayUrl, page);
    // Public SaaS entry (openbot.love, etc.) always browses the remote gateway host — not the user's disk.
    if (!isLoopbackHost(page.hostname)) {
      return false;
    }
    return isLoopbackHost(gateway.hostname);
  } catch {
    return false;
  }
}

export function resolveWorkspaceBrowseRoots(
  platform: string,
  homedir: string,
): WorkspaceBrowseRoot[] {
  const trimmedHome = homedir.trim();
  const roots: WorkspaceBrowseRoot[] = [];

  if (platform === "darwin" || platform === "win32") {
    if (trimmedHome) {
      roots.push(
        { id: "desktop", label: "桌面", path: joinHomePath(trimmedHome, "Desktop", platform) },
        { id: "documents", label: "文稿", path: joinHomePath(trimmedHome, "Documents", platform) },
        { id: "downloads", label: "下载", path: joinHomePath(trimmedHome, "Downloads", platform) },
        { id: "home", label: "主目录", path: trimmedHome },
      );
    }
    if (platform === "darwin") {
      roots.push({ id: "volumes", label: "所有磁盘", path: "/Volumes" });
      roots.push({ id: "fs-root", label: "系统根 (/)", path: "/" });
    } else {
      const driveRoot = /^[a-zA-Z]:\\/.exec(trimmedHome)?.[0] ?? "C:\\";
      roots.push({ id: "fs-root", label: "系统盘", path: driveRoot });
    }
    return roots;
  }

  if (trimmedHome) {
    roots.push({ id: "home", label: "主目录", path: trimmedHome });
  }
  roots.push({ id: "fs-root", label: "系统根 (/)", path: "/" });
  return roots;
}

export function resolveDefaultWorkspaceBrowsePath(params: {
  platform: string;
  homedir: string;
  isLocalGateway: boolean;
  browseRoots: WorkspaceBrowseRoot[];
  preferredPath?: string | null;
}) {
  const preferred = params.preferredPath?.trim();
  if (preferred) {
    return preferred;
  }
  if (params.platform === "darwin" && params.isLocalGateway) {
    const desktop = params.browseRoots.find((root) => root.id === "desktop");
    if (desktop) {
      return desktop.path;
    }
  }
  if (params.homedir.trim()) {
    return params.homedir.trim();
  }
  return params.browseRoots[0]?.path ?? "/";
}

export function splitWorkspacePathBreadcrumbs(currentPath: string): WorkspacePathSegment[] {
  const trimmed = currentPath.trim();
  if (!trimmed) {
    return [];
  }
  if (trimmed.startsWith("/")) {
    const parts = trimmed.split("/").filter(Boolean);
    if (parts.length === 0) {
      return [{ label: "系统根", path: "/" }];
    }
    return [
      { label: "系统根", path: "/" },
      ...parts.map((part, index) => ({
        label: part,
        path: `/${parts.slice(0, index + 1).join("/")}`,
      })),
    ];
  }
  const parts = trimmed.split(/[/\\]/).filter(Boolean);
  return parts.map((part, index) => ({
    label: part,
    path: parts.slice(0, index + 1).join(trimmed.includes("\\") ? "\\" : "/"),
  }));
}
