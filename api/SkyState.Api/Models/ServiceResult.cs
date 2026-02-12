namespace SkyState.Api.Models;

public abstract record ServiceResult<T>
{
    public sealed record ValidationError(string Message) : ServiceResult<T>;
    public sealed record NotFound() : ServiceResult<T>;
    public sealed record OverLimit(LimitResponse Limit) : ServiceResult<T>;
    public sealed record Success(T Value) : ServiceResult<T>;
}
