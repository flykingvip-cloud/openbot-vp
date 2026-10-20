// Tri-Platform Employee Shell — Windows bridge (Stage 55).
// Mirrors ui/src/ui/employee-shell/native-bridge.ts and the macOS/Android parsers.
// Pure + testable (no WinUI dependency).

using System.Text.Json;

namespace OpenBot.EmployeeShell.Bridge;

public abstract record EmployeeShellIntent
{
    public sealed record Ready(string? Surface) : EmployeeShellIntent;
    public sealed record OpenChat(string? SessionKey, string? AgentId) : EmployeeShellIntent;
    public sealed record OpenAssistant(string? AgentId) : EmployeeShellIntent;
    public sealed record OpenSpace(string SpaceId) : EmployeeShellIntent;
    public sealed record OpenKnowledgeObject(string ObjectId, string? Kind) : EmployeeShellIntent;
    public sealed record OpenDeviceSettings(string? Section) : EmployeeShellIntent;
    public sealed record SignOut : EmployeeShellIntent;
}

public static class EmployeeShellBridge
{
    /// <summary>Must match EMPLOYEE_SHELL_HOST_HANDLER in native-host.ts.</summary>
    public const string HandlerName = "openbotEmployeeShell";

    /// <summary>Must match EMPLOYEE_SHELL_BRIDGE_VERSION in native-bridge.ts.</summary>
    public const int ProtocolVersion = 1;

    /// <summary>Parse an UNTRUSTED bridge message (JSON string) into a typed intent, or null.</summary>
    public static EmployeeShellIntent? Parse(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        try
        {
            using var doc = JsonDocument.Parse(raw);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object)
            {
                return null;
            }

            if (!root.TryGetProperty("version", out var versionEl) || versionEl.GetInt32() != ProtocolVersion)
            {
                return null;
            }

            if (!root.TryGetProperty("type", out var typeEl) || typeEl.ValueKind != JsonValueKind.String)
            {
                return null;
            }

            var type = typeEl.GetString();
            JsonElement payload = default;
            var hasPayload = root.TryGetProperty("payload", out payload) && payload.ValueKind == JsonValueKind.Object;

            string? NonEmpty(string key)
            {
                if (!hasPayload || !payload.TryGetProperty(key, out var value) || value.ValueKind != JsonValueKind.String)
                {
                    return null;
                }

                var trimmed = value.GetString()?.Trim();
                return string.IsNullOrEmpty(trimmed) ? null : trimmed;
            }

            return type switch
            {
                "ready" => new EmployeeShellIntent.Ready(NonEmpty("surface")),
                "openChat" => new EmployeeShellIntent.OpenChat(NonEmpty("sessionKey"), NonEmpty("agentId")),
                "openAssistant" => new EmployeeShellIntent.OpenAssistant(NonEmpty("agentId")),
                "openSpace" => NonEmpty("spaceId") is { } spaceId
                    ? new EmployeeShellIntent.OpenSpace(spaceId)
                    : null,
                "openKnowledgeObject" => NonEmpty("objectId") is { } objectId
                    ? new EmployeeShellIntent.OpenKnowledgeObject(objectId, NonEmpty("kind"))
                    : null,
                "openDeviceSettings" => new EmployeeShellIntent.OpenDeviceSettings(NonEmpty("section")),
                "signOut" => new EmployeeShellIntent.SignOut(),
                _ => null,
            };
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
