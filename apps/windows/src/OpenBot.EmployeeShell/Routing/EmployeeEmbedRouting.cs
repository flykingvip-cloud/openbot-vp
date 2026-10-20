// Maps a decoded bridge intent to embed navigation or a native host action.
// Mirrors Mac EmployeeEmbedRouting / Android EmployeeEmbedRouting (desktop: no shell=mobile).

using System.Net;
using OpenBot.EmployeeShell.Bridge;

namespace OpenBot.EmployeeShell.Routing;

public abstract record EmployeeShellRouteAction
{
    public sealed record EmbedNavigation(string Path) : EmployeeShellRouteAction;
    public sealed record Native(EmployeeShellIntent Intent) : EmployeeShellRouteAction;
}

public static class EmployeeEmbedRouting
{
    public const string EmbedPrefix = "/embed/employee";

    public static string EmbedPath(string surface) => $"{EmbedPrefix}/{surface}";

    public static string CollaborationSessionKey(string spaceId)
    {
        var identity = spaceId.Trim();
        while (identity.StartsWith("space:", StringComparison.OrdinalIgnoreCase))
        {
            identity = identity[6..].Trim();
        }

        return $"space:{identity}";
    }

    public static string EmbedPathForSpace(string spaceId) =>
        PathWithQuery("workspace", new[] { ("session", CollaborationSessionKey(spaceId)) });

    public static string EmbedPathForKnowledge(string objectId, string? kind)
    {
        var items = new List<(string, string)> { ("objectId", objectId) };
        if (!string.IsNullOrWhiteSpace(kind))
        {
            items.Add(("kind", kind.Trim()));
        }

        return PathWithQuery("knowledge", items);
    }

    public static string EmbedPathForChat(string? sessionKey, string? agentId)
    {
        var key = sessionKey?.Trim() ?? string.Empty;
        var trimmedAgent = agentId?.Trim() ?? string.Empty;
        var resolved = key.Length > 0
            ? key
            : (trimmedAgent.Length > 0 ? $"agent:{trimmedAgent}:main" : string.Empty);
        var surface = resolved.StartsWith("space:", StringComparison.Ordinal) ? "workspace" : "overview";
        if (resolved.Length == 0)
        {
            return EmbedPath(surface);
        }

        return PathWithQuery(surface, new[] { ("session", resolved) });
    }

    public static EmployeeShellRouteAction Action(EmployeeShellIntent intent) =>
        intent switch
        {
            EmployeeShellIntent.OpenSpace openSpace =>
                new EmployeeShellRouteAction.EmbedNavigation(EmbedPathForSpace(openSpace.SpaceId)),
            EmployeeShellIntent.OpenKnowledgeObject openKnowledge =>
                new EmployeeShellRouteAction.EmbedNavigation(
                    EmbedPathForKnowledge(openKnowledge.ObjectId, openKnowledge.Kind)),
            EmployeeShellIntent.OpenChat openChat =>
                new EmployeeShellRouteAction.EmbedNavigation(
                    EmbedPathForChat(openChat.SessionKey, openChat.AgentId)),
            EmployeeShellIntent.OpenAssistant openAssistant =>
                new EmployeeShellRouteAction.EmbedNavigation(
                    EmbedPathForChat(null, openAssistant.AgentId)),
            EmployeeShellIntent.OpenDeviceSettings or EmployeeShellIntent.SignOut or EmployeeShellIntent.Ready =>
                new EmployeeShellRouteAction.Native(intent),
            _ => new EmployeeShellRouteAction.Native(intent),
        };

    private static string PathWithQuery(string surface, IReadOnlyList<(string Name, string Value)> items)
    {
        if (items.Count == 0)
        {
            return EmbedPath(surface);
        }

        var query = string.Join("&", items.Select(item =>
            $"{WebUtility.UrlEncode(item.Name)}={WebUtility.UrlEncode(item.Value)}"));
        return $"{EmbedPath(surface)}?{query}";
    }
}
