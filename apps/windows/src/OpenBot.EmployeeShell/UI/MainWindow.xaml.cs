using Microsoft.UI.Xaml;
using OpenBot.EmployeeShell.Bootstrap;
using OpenBot.EmployeeShell.Host;

namespace OpenBot.EmployeeShell.UI;

public sealed partial class MainWindow : Window
{
    private readonly EmployeeShellController _controller = new();
    private EmployeeShellWebViewHost? _host;

    public MainWindow()
    {
        InitializeComponent();
        Title = "Employee Workbench";
        _ = InitializeShellAsync();
    }

    private async Task InitializeShellAsync()
    {
        // Protocol activation (openbot://…) can be wired via App activation args
        // on a Windows machine; the pure HandleDeepLink path is already covered.
        _controller.Open();
        if (_controller.LoginPresented)
        {
            StatusText.Text = "Sign in required — employee login jar ≠ node pairing.";
            // Full login UI is out of this slice; host presents a gate stub.
            // Operators can mark logged-in for local WebView2 smoke after cookie setup.
            return;
        }

        _host = new EmployeeShellWebViewHost(
            _controller,
            async target =>
            {
                // Callers must supply an HttpClient with the employee session cookie.
                // Until then, loopback gateways can load the embed without mint.
                if (EmployeeShellBootstrap.IsLoopbackGateway(_controller.GatewayBaseUrl))
                {
                    return "loopback-dev-token";
                }

                using var client = new HttpClient();
                return await EmployeeShellBootstrap.MintTokenAsync(
                    _controller.GatewayBaseUrl, client, target);
            });

        await _host.AttachAsync(ShellWebView);
        await _host.BootstrapAsync(_controller.LastOpenedPath);
        StatusText.Text = "Employee Workbench / 员工工作台";
    }
}
