FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY SkyState.Api/SkyState.Api.csproj SkyState.Api/
RUN dotnet restore SkyState.Api/SkyState.Api.csproj
COPY . .
RUN dotnet publish SkyState.Api/SkyState.Api.csproj -c Release -o /app/publish

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
COPY --from=build /app/publish .
ENV ASPNETCORE_URLS=http://+:5148
EXPOSE 5148
ENTRYPOINT ["dotnet", "SkyState.Api.dll"]
