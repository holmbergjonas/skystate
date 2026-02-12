using System;

namespace SkyState.Api.Models;

public abstract record SlugLookupResult
{
    public sealed record InvalidSlug() : SlugLookupResult;
    public sealed record NotFound() : SlugLookupResult;
    public sealed record Success(ProjectConfig Config, DateTime LastModified) : SlugLookupResult;
}
