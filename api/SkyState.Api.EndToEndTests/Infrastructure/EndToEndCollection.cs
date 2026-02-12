using Xunit;

namespace SkyState.Api.EndToEndTests.Infrastructure;

/// <summary>
/// xUnit collection definition that serializes all E2E test classes
/// so they don't run in parallel against the shared PostgreSQL database.
/// </summary>
[CollectionDefinition(Name)]
public class EndToEndCollection
{
    public const string Name = "EndToEnd";
}
