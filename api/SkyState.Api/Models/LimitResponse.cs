namespace SkyState.Api.Models;

public record LimitResponse(
    string Resource,       // "projects", "environments", "storage"
    long Current,
    long Limit,
    string Tier,
    string? UpgradeTier,   // "hobby", "pro", or null for pro (boost instead)
    string? CheckoutUrl,   // frontend upgrade URL path
    string Code            // "LIMIT_PROJECTS", "LIMIT_ENVIRONMENTS", "LIMIT_STORAGE"
);
