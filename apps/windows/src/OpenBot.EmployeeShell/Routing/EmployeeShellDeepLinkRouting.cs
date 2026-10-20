// Stage 55 — pure maps from employee-grammar deep links → embed paths + auth gate.
// Mirrors Mac EmployeeShellDeepLinkRouting (portable desktop rules).

namespace OpenBot.EmployeeShell.Routing;

public abstract record EmployeeShellAuthGateDecision
{
    public sealed record PresentLogin(string PendingPath) : EmployeeShellAuthGateDecision;
    public sealed record OpenShell(string Path) : EmployeeShellAuthGateDecision;
}

public static class EmployeeShellDeepLinkRouting
{
    public static readonly HashSet<string> EmployeeHosts = new(StringComparer.OrdinalIgnoreCase)
    {
        "employee", "chat", "space", "knowledge",
    };

    public static readonly HashSet<string> NonShellHosts = new(StringComparer.OrdinalIgnoreCase)
    {
        "agent", "gateway", "workspace",
    };

    public static EmployeeShellAuthGateDecision AuthGate(bool isLoggedIn, string targetPath) =>
        isLoggedIn
            ? new EmployeeShellAuthGateDecision.OpenShell(targetPath)
            : new EmployeeShellAuthGateDecision.PresentLogin(targetPath);

    /// <summary>
    /// Embed path for an openbot:// employee-grammar deep link, or null for non-shell hosts.
    /// </summary>
    public static string? EmbedPathForUri(Uri uri)
    {
        if (!string.Equals(uri.Scheme, "openbot", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        var host = uri.Host;
        if (NonShellHosts.Contains(host) || !EmployeeHosts.Contains(host))
        {
            return null;
        }

        var query = ParseQuery(uri.Query);
        return host.ToLowerInvariant() switch
        {
            "employee" => EmployeeEmbedRouting.EmbedPath(SurfaceFromPath(uri.AbsolutePath)),
            "chat" => EmployeeEmbedRouting.EmbedPathForChat(
                Get(query, "sessionKey"), Get(query, "agentId")),
            "space" => EmployeeEmbedRouting.EmbedPathForSpace(
                Get(query, "spaceId") ?? uri.AbsolutePath.Trim('/')),
            "knowledge" => EmployeeEmbedRouting.EmbedPathForKnowledge(
                Get(query, "objectId") ?? uri.AbsolutePath.Trim('/'), Get(query, "kind")),
            _ => null,
        };
    }

    private static string SurfaceFromPath(string absolutePath)
    {
        var trimmed = absolutePath.Trim('/');
        return string.IsNullOrEmpty(trimmed) ? "overview" : trimmed.Split('/')[0];
    }

    private static Dictionary<string, string> ParseQuery(string query)
    {
        var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (string.IsNullOrEmpty(query))
        {
            return map;
        }

        var q = query.StartsWith('?') ? query[1..] : query;
        foreach (var part in q.Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var idx = part.IndexOf('=');
            if (idx <= 0)
            {
                continue;
            }

            var key = Uri.UnescapeDataString(part[..idx]);
            var value = Uri.UnescapeDataString(part[(idx + 1)..]);
            map[key] = value;
        }

        return map;
    }

    private static string? Get(Dictionary<string, string> query, string key) =>
        query.TryGetValue(key, out var value) && !string.IsNullOrWhiteSpace(value) ? value : null;
}
