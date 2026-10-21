# syntax=docker/dockerfile:1.7
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY Terra.Api/Terra.Api.csproj Terra.Api/
RUN dotnet restore Terra.Api/Terra.Api.csproj
COPY Terra.Api/ Terra.Api/
RUN dotnet publish Terra.Api/Terra.Api.csproj -c Release -o /app --no-restore /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS runtime
WORKDIR /app
ENV ASPNETCORE_HTTP_PORTS=8080 \
    DOTNET_EnableDiagnostics=0 \
    ConnectionStrings__Sqlite="Data Source=/tmp/terra.db"
COPY --from=build /app .
USER $APP_UID
EXPOSE 8080
ENTRYPOINT ["dotnet", "Terra.Api.dll"]
