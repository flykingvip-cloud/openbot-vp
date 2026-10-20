// Coordinates auth gate, deferred deep links, and WebView2 shell navigation.
// Mirrors Mac EmployeeShellController for the portable desktop rules (Stage 55).
// Login UI / cookie jar persistence are intentionally thin stubs until a Windows
// companion ships; the contract (auth gate + pending route) is real and tested.

using OpenBot.EmployeeShell.Bootstrap;
using OpenBot.EmployeeShell.Bridge;
using OpenBot.EmployeeShell.Routing;

namespace OpenBot.EmployeeShell.Host;

public sealed class EmployeeShellController
{
    private string? _pendingPath;
    private bool _isLoggedIn;
    private string _gatewayBaseUrl = "https://www.openbot.love";

    public bool IsLoggedIn => _isLoggedIn;

    public string GatewayBaseUrl
    {
        get => _gatewayBaseUrl;
        set => _gatewayBaseUrl = string.IsNullOrWhiteSpace(value) ? _gatewayBaseUrl : value.Trim();
    }

    /// <summary>Last path the shell was told to open (for tests / host wiring).</summary>
    public string? LastOpenedPath { get; private set; }

    /// <summary>True when the last open presented the login surface instead of the shell.</summary>
    public bool LoginPresented { get; private set; }

    /// <summary>
    /// Device-settings requests stay host-owned. The Windows companion is still
    /// planned; we record the request and do NOT navigate the employee "me" embed
    /// (Mac Stage 53 boundary).
    /// </summary>
    public int DeviceSettingsOpenCount { get; private set; }

    public string? PendingPath => _pendingPath;

    public void SetLoggedIn(bool loggedIn) => _isLoggedIn = loggedIn;

    /// <summary>Open the shell (or login if signed out) at the default overview surface.</summary>
    public void Open() => Route(EmployeeShellBootstrap.DefaultTarget);

    /// <summary>Handle an openbot:// URI with the same auth gate as Mac Stage 54.</summary>
    public bool HandleDeepLink(Uri uri)
    {
        var path = EmployeeShellDeepLinkRouting.EmbedPathForUri(uri);
        if (path is null)
        {
            return false;
        }

        Route(path);
        return true;
    }

    public void Route(string targetPath)
    {
        var safe = EmployeeShellBootstrap.AssertDesktopTarget(targetPath);
        switch (EmployeeShellDeepLinkRouting.AuthGate(_isLoggedIn, safe))
        {
            case EmployeeShellAuthGateDecision.PresentLogin present:
                _pendingPath = present.PendingPath;
                LoginPresented = true;
                LastOpenedPath = null;
                break;
            case EmployeeShellAuthGateDecision.OpenShell open:
                LoginPresented = false;
                LastOpenedPath = open.Path;
                break;
        }
    }

    /// <summary>Continue a deferred deep link after a successful login.</summary>
    public void CompleteLogin()
    {
        _isLoggedIn = true;
        LoginPresented = false;
        var target = _pendingPath ?? EmployeeShellBootstrap.DefaultTarget;
        _pendingPath = null;
        LastOpenedPath = EmployeeShellBootstrap.AssertDesktopTarget(target);
    }

    public void Logout()
    {
        _isLoggedIn = false;
        LastOpenedPath = null;
        _pendingPath = null;
    }

    public EmployeeShellRouteAction HandleBridgeIntent(EmployeeShellIntent intent)
    {
        var action = EmployeeEmbedRouting.Action(intent);
        if (action is EmployeeShellRouteAction.Native { Intent: EmployeeShellIntent.OpenDeviceSettings })
        {
            DeviceSettingsOpenCount++;
        }

        if (action is EmployeeShellRouteAction.Native { Intent: EmployeeShellIntent.SignOut })
        {
            Logout();
        }

        if (action is EmployeeShellRouteAction.EmbedNavigation embed)
        {
            LastOpenedPath = embed.Path;
        }

        return action;
    }
}
