using System;
using System.Security.Claims;
using Microsoft.AspNetCore.Http;

namespace SkyState.Api.Services;

public interface ICurrentUserService
{
    Guid GetUserId();
}

public class CurrentUserService(IHttpContextAccessor httpContextAccessor) : ICurrentUserService
{
    public Guid GetUserId()
    {
        var user = httpContextAccessor.HttpContext?.User
            ?? throw new InvalidOperationException("No HttpContext available");

        var sub = user.FindFirst("sub")?.Value
               ?? user.FindFirst(ClaimTypes.NameIdentifier)?.Value;

        if (sub is null || !Guid.TryParse(sub, out var userId))
        {
            throw new InvalidOperationException("User ID claim not found or invalid");
        }

        return userId;
    }
}
