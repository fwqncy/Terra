using System.Threading.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.OpenApi.Models;
using Terra.Api.Data;
using Terra.Api.Documents;
using Terra.Api.Endpoints;
using Terra.Api.Infrastructure;
using Terra.Api.Integrations;
using Terra.Api.Logistics;

var builder = WebApplication.CreateBuilder(args);
var cfg = builder.Configuration;

// SQL: SQL Server in Docker/Azure; SQLite for a zero-setup `dotnet run` and the tests.
var provider = cfg["Database:Provider"] ?? "Sqlite";
builder.Services.AddDbContext<TerraDbContext>(o =>
{
    if (provider.Equals("SqlServer", StringComparison.OrdinalIgnoreCase))
        o.UseSqlServer(cfg.GetConnectionString("Sql"), sql => sql.EnableRetryOnFailure(5));
    else
        o.UseSqlite(cfg.GetConnectionString("Sqlite") ?? "Data Source=terra.db");
});

// NoSQL: MongoDB locally / Azure Cosmos DB for MongoDB in the cloud; in-memory when not configured.
builder.Services.AddSingleton<IDocumentStore>(_ =>
{
    var mongo = cfg.GetConnectionString("Mongo");
    return string.IsNullOrWhiteSpace(mongo) ? new InMemoryDocumentStore() : new MongoDocumentStore(mongo, cfg["Mongo:Database"] ?? "terra");
});

// Live logistics simulation (hot, in memory) mirrored into SQL Server.
builder.Services.AddSingleton(_ => new LogisticsSimulator(
    cfg.GetValue<uint>("Logistics:Seed", 2032),
    DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
    cfg.GetValue("Logistics:WarmupHours", 72.0)));
builder.Services.AddSingleton<PowerAutomateNotifier>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<PowerAutomateNotifier>());
builder.Services.AddSingleton<LogisticsHostedService>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<LogisticsHostedService>());
builder.Services.AddHostedService<MaintenanceService>();

builder.Services.AddMemoryCache();
builder.Services.AddHttpClient("webhooks", c => c.Timeout = TimeSpan.FromSeconds(10));
builder.Services.AddHttpClient<WordPressCms>(c => c.Timeout = TimeSpan.FromSeconds(4));
builder.Services.AddProblemDetails();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new OpenApiInfo
    {
        Title = "Terra API",
        Version = "v1",
        Description = "Saves, leaderboard, trained brains, worlds and live logistics for the Terra Brisbane sim. "
            + "OpenAPI 2.0 for the Power Platform custom connector is served at /swagger/v1/swagger-v2.json.",
    });
});
builder.Services.AddCors(o => o.AddDefaultPolicy(p => p
    .WithOrigins(cfg.GetSection("Cors:Origins").Get<string[]>() ?? ["http://localhost:4200"])
    .AllowAnyHeader()
    .AllowAnyMethod()
    .WithExposedHeaders("Idempotent-Replayed")));
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.AddPolicy("writes", ctx => RateLimitPartition.GetFixedWindowLimiter(
        ctx.Connection.RemoteIpAddress?.ToString() ?? "anonymous",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = cfg.GetValue("RateLimit:WritesPerMinute", 240), Window = TimeSpan.FromMinutes(1) }));
});

var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<TerraDbContext>();
    if (provider.Equals("SqlServer", StringComparison.OrdinalIgnoreCase)) await db.Database.MigrateAsync();
    else await db.Database.EnsureCreatedAsync();
}
if (app.Services.GetRequiredService<IDocumentStore>() is MongoDocumentStore mongoStore)
{
    try
    {
        await mongoStore.EnsureIndexesAsync();
    }
    catch (Exception ex)
    {
        app.Logger.LogWarning(ex, "MongoDB indexes not created (is the database reachable?)");
    }
}

app.UseExceptionHandler();
app.UseStatusCodePages();
app.UseCors();
app.UseRateLimiter();
app.UseSwagger();
app.UseSwagger(c =>
{
    c.RouteTemplate = "swagger/{documentName}/swagger-v2.json";
    c.SerializeAsV2 = true;
});
app.UseSwaggerUI(c => c.DocumentTitle = "Terra API");
app.UseMiddleware<IdempotencyMiddleware>();

// Optional single-container deploy: serve the Angular build from wwwroot.
app.UseDefaultFiles();
app.UseStaticFiles();
app.MapTerraApi();
if (File.Exists(Path.Combine(app.Environment.WebRootPath ?? "wwwroot", "index.html"))) app.MapFallbackToFile("index.html");

app.Run();

public partial class Program;
