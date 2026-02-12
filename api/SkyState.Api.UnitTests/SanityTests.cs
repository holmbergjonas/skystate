using Xunit;

namespace SkyState.Api.UnitTests;

/// <summary>
/// Placeholder test class that ensures the unit test project has at least one discoverable test.
/// Without this, xUnit reports a catastrophic failure for assemblies with zero tests,
/// causing <c>dotnet test</c> to exit with code 1.
/// Remove this file only after adding other unit tests to this project.
/// </summary>
public class SanityTests
{
    [Fact]
    public void TestInfrastructure_IsWorking()
    {
        Assert.True(true);
    }
}
