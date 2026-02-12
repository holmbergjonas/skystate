namespace SkyState.Api.Models;

public record Version(int Major, int Minor, int Patch)
{
    public override string ToString() => $"{Major}.{Minor}.{Patch}";
}
