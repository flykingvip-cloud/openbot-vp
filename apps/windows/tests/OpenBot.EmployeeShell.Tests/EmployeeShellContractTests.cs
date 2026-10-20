using OpenBot.EmployeeShell.Bootstrap;
using OpenBot.EmployeeShell.Bridge;
using OpenBot.EmployeeShell.Host;
using OpenBot.EmployeeShell.Routing;
using Xunit;

namespace OpenBot.EmployeeShell.Tests;

/// <summary>
/// Stage 55 contract pins. Run on Windows: <c>dotnet test apps/windows/OpenBot.Windows.sln</c>.
/// Mac verification uses the Node twin in <c>ui/.../windows-host-contract.node.test.ts</c>.
/// </summary>
public class EmployeeShellContractTests
{
    [Fact]
    public void Default_target_is_embed_overview_without_mobile_shell()
    {
        Assert.Equal("/embed/employee/overview", EmployeeShellBootstrap.DefaultTarget);
        Assert.False(EmployeeShellBootstrap.TargetHasMobileShellMarker(EmployeeShellBootstrap.DefaultTarget));
        var url = EmployeeShellBootstrap.BootstrapUrl("https://gw.example.test", "tok", EmployeeShellBootstrap.DefaultTarget);
        Assert.Contains("/native/bootstrap?", url);
        Assert.DoesNotContain(EmployeeShellBootstrap.MobileShellMarker, url);
    }

    [Fact]
    public void Rejects_mobile_shell_marker_on_desktop()
    {
        Assert.Throws<InvalidOperationException>(() =>
            EmployeeShellBootstrap.AssertDesktopTarget("/embed/employee/overview?shell=mobile"));
    }

    [Fact]
    public void Bridge_parses_openSpace_and_signOut()
    {
        var space = EmployeeShellBridge.Parse("""{"version":1,"type":"openSpace","payload":{"spaceId":"sp_1"}}""");
        Assert.Equal(new EmployeeShellIntent.OpenSpace("sp_1"), space);
        Assert.Equal(new EmployeeShellIntent.SignOut(), EmployeeShellBridge.Parse("""{"version":1,"type":"signOut","payload":{}}"""));
        Assert.Null(EmployeeShellBridge.Parse("""{"version":2,"type":"openSpace","payload":{"spaceId":"sp_1"}}"""));
    }

    [Fact]
    public void Embed_routing_matches_Mac_desktop()
    {
        Assert.Equal(
            new EmployeeShellRouteAction.EmbedNavigation("/embed/employee/workspace?session=space%3Asp_1"),
            EmployeeEmbedRouting.Action(new EmployeeShellIntent.OpenSpace("sp_1")));
        Assert.Equal(
            new EmployeeShellRouteAction.Native(new EmployeeShellIntent.OpenDeviceSettings(null)),
            EmployeeEmbedRouting.Action(new EmployeeShellIntent.OpenDeviceSettings(null)));
    }

    [Fact]
    public void Auth_gate_defers_when_signed_out()
    {
        var controller = new EmployeeShellController();
        controller.Open();
        Assert.True(controller.LoginPresented);
        Assert.Equal(EmployeeShellBootstrap.DefaultTarget, controller.PendingPath);

        controller.CompleteLogin();
        Assert.True(controller.IsLoggedIn);
        Assert.False(controller.LoginPresented);
        Assert.Equal(EmployeeShellBootstrap.DefaultTarget, controller.LastOpenedPath);
    }

    [Fact]
    public void Employee_deeplinks_open_shell_non_employee_rejected()
    {
        var controller = new EmployeeShellController();
        controller.SetLoggedIn(true);
        Assert.True(controller.HandleDeepLink(new Uri("openbot://employee/me")));
        Assert.Equal("/embed/employee/me", controller.LastOpenedPath);
        Assert.False(controller.HandleDeepLink(new Uri("openbot://agent?message=hi")));
    }

    [Fact]
    public void Device_settings_stay_native_host_action()
    {
        var controller = new EmployeeShellController();
        controller.SetLoggedIn(true);
        var action = controller.HandleBridgeIntent(new EmployeeShellIntent.OpenDeviceSettings("permissions"));
        Assert.IsType<EmployeeShellRouteAction.Native>(action);
        Assert.Equal(1, controller.DeviceSettingsOpenCount);
        Assert.Null(controller.LastOpenedPath);
    }
}
