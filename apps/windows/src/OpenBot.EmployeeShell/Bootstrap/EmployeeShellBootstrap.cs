// Bootstrap mint + URL building for the Windows WebView2 employee shell.
// Desktop parity with Mac: NEVER append shell=mobile.

using System.Net;
using System.Text.Json;

namespace OpenBot.EmployeeShell.Bootstrap;

public sealed class EmployeeShellUnauthorizedException : Exception
{
    public EmployeeShellUnauthorizedException()
        : base("employee shell mint unauthorized (401)")
    {
    }
}

public static class EmployeeShellBootstrap
{
    public const string MintPath = "/native/bootstrap/mint";
    public const string BootstrapPath = "/native/bootstrap";
    public const string DefaultTarget = "/embed/employee/overview";

    /// <summary>
    /// Phone shells opt into phone-only trims via this marker. Desktop Windows
    /// keeps full web parity by NOT setting it (same as macOS).
    /// </summary>
    public const string MobileShellMarker = "shell=mobile";

    public static bool TargetHasMobileShellMarker(string target) =>
        target.Contains(MobileShellMarker, StringComparison.Ordinal);

    public static string AssertDesktopTarget(string target)
    {
        if (TargetHasMobileShellMarker(target))
        {
            throw new InvalidOperationException(
                $"desktop Windows host must not use {MobileShellMarker}: {target}");
        }

        return target;
    }

    public static string BootstrapUrl(string baseUrl, string token, string target)
    {
        var safeTarget = AssertDesktopTarget(target);
        var root = baseUrl.TrimEnd('/');
        return $"{root}{BootstrapPath}?token={Enc(token)}&target={Enc(safeTarget)}";
    }

    public static string EmbedUrl(string baseUrl, string pathWithOptionalQuery)
    {
        var root = baseUrl.TrimEnd('/');
        if (!pathWithOptionalQuery.StartsWith('/'))
        {
            pathWithOptionalQuery = "/" + pathWithOptionalQuery;
        }

        return root + pathWithOptionalQuery;
    }

    public static bool IsLoopbackGateway(string baseUrl)
    {
        if (!Uri.TryCreate(baseUrl, UriKind.Absolute, out var uri))
        {
            return false;
        }

        var host = uri.Host.Trim().Trim('[', ']').ToLowerInvariant();
        return host is "127.0.0.1" or "localhost" or "::1";
    }

    /// <summary>
    /// POST /native/bootstrap/mint?target=… using an HttpClient whose cookie
    /// container carries the employee platform-auth session cookie.
    /// </summary>
    public static async Task<string> MintTokenAsync(
        string baseUrl,
        HttpClient client,
        string target,
        CancellationToken cancellationToken = default)
    {
        var safeTarget = AssertDesktopTarget(target);
        var url = $"{baseUrl.TrimEnd('/')}{MintPath}?target={Enc(safeTarget)}";
        using var request = new HttpRequestMessage(HttpMethod.Post, url);
        using var response = await client.SendAsync(request, cancellationToken).ConfigureAwait(false);
        if ((int)response.StatusCode == 401)
        {
            throw new EmployeeShellUnauthorizedException();
        }

        response.EnsureSuccessStatusCode();
        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken)
            .ConfigureAwait(false);
        using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken)
            .ConfigureAwait(false);
        if (!doc.RootElement.TryGetProperty("token", out var tokenEl))
        {
            throw new InvalidOperationException("mint response missing token");
        }

        var token = tokenEl.GetString()?.Trim();
        if (string.IsNullOrEmpty(token))
        {
            throw new InvalidOperationException("mint response missing token");
        }

        return token;
    }

    private static string Enc(string value) => WebUtility.UrlEncode(value);
}
