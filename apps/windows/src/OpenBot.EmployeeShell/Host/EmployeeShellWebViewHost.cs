// WebView2 wiring for the Windows employee Web shell (Stage 55).
//
// ⚠️ Build + smoke on a Windows machine with WebView2 Runtime + Windows App SDK.
// This Mac checkout cannot compile WinUI. Pure routing/bootstrap live in sibling
// folders and are covered by Node contract tests + xUnit (on Windows).

using Microsoft.UI.Xaml.Controls;
using Microsoft.Web.WebView2.Core;
using OpenBot.EmployeeShell.Bootstrap;
using OpenBot.EmployeeShell.Bridge;
using OpenBot.EmployeeShell.Routing;

namespace OpenBot.EmployeeShell.Host;

public sealed class EmployeeShellWebViewHost
{
    private readonly EmployeeShellController _controller;
    private readonly Func<string, Task<string>> _tokenProvider;
    private WebView2? _webView;

    public EmployeeShellWebViewHost(
        EmployeeShellController controller,
        Func<string, Task<string>> tokenProvider)
    {
        _controller = controller;
        _tokenProvider = tokenProvider;
    }

    public async Task AttachAsync(WebView2 webView)
    {
        _webView = webView;
        await webView.EnsureCoreWebView2Async();
        var core = webView.CoreWebView2;

        // Optional alias so pages that look for window.openbotEmployeeShell still work.
        await core.AddScriptToExecuteOnDocumentCreatedAsync(
            $@"(function(){{
  if (window.chrome && window.chrome.webview && !window.{EmployeeShellBridge.HandlerName}) {{
    window.{EmployeeShellBridge.HandlerName} = {{
      postMessage: function(msg) {{ window.chrome.webview.postMessage(typeof msg === 'string' ? msg : JSON.stringify(msg)); }}
    }};
  }}
}})();");

        core.WebMessageReceived += OnWebMessageReceived;
    }

    public async Task BootstrapAsync(string? target = null)
    {
        if (_webView?.CoreWebView2 is null)
        {
            throw new InvalidOperationException("WebView2 is not attached");
        }

        var path = EmployeeShellBootstrap.AssertDesktopTarget(
            target ?? _controller.LastOpenedPath ?? EmployeeShellBootstrap.DefaultTarget);
        var token = await _tokenProvider(path).ConfigureAwait(true);
        var url = EmployeeShellBootstrap.BootstrapUrl(_controller.GatewayBaseUrl, token, path);
        if (url.Contains(EmployeeShellBootstrap.MobileShellMarker, StringComparison.Ordinal))
        {
            throw new InvalidOperationException("desktop Windows host must not emit shell=mobile");
        }

        _webView.CoreWebView2.Navigate(url);
    }

    public void NavigateEmbed(string path)
    {
        if (_webView?.CoreWebView2 is null)
        {
            return;
        }

        var safe = EmployeeShellBootstrap.AssertDesktopTarget(path);
        var url = EmployeeShellBootstrap.EmbedUrl(_controller.GatewayBaseUrl, safe);
        _webView.CoreWebView2.Navigate(url);
    }

    private void OnWebMessageReceived(CoreWebView2 sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        string raw;
        try
        {
            raw = args.TryGetWebMessageAsString();
        }
        catch (ArgumentException)
        {
            raw = args.WebMessageAsJson;
        }

        var intent = EmployeeShellBridge.Parse(raw);
        if (intent is null)
        {
            return;
        }

        var action = _controller.HandleBridgeIntent(intent);
        if (action is EmployeeShellRouteAction.EmbedNavigation embed)
        {
            NavigateEmbed(embed.Path);
        }
        // openDeviceSettings / signOut / ready handled in controller (native).
    }
}
