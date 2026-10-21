using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Terra.Api.Data;

namespace Terra.Api.Infrastructure;

/// <summary>
/// Makes POST/PUT retries safe: the first successful response for an Idempotency-Key is stored
/// in SQL and replayed for any repeat (scoped per player, method and path).
/// </summary>
public sealed class IdempotencyMiddleware(RequestDelegate next, IServiceScopeFactory scopes, ILogger<IdempotencyMiddleware> log)
{
    public async Task InvokeAsync(HttpContext ctx)
    {
        var method = ctx.Request.Method;
        if (!(HttpMethods.IsPost(method) || HttpMethods.IsPut(method)) ||
            !ctx.Request.Path.StartsWithSegments("/api") ||
            !ctx.Request.Headers.TryGetValue("Idempotency-Key", out var keyHeader))
        {
            await next(ctx);
            return;
        }

        var raw = keyHeader.ToString();
        if (raw.Length is 0 or > 100)
        {
            await Results.Problem("Idempotency-Key must be 1–100 characters.", statusCode: 400).ExecuteAsync(ctx);
            return;
        }

        var player = ctx.Request.Headers["X-Terra-Player"].ToString();
        var key = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes($"{player}|{method}|{ctx.Request.Path}|{raw}")));

        using (var scope = scopes.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<TerraDbContext>();
            var existing = await db.IdempotencyRecords.AsNoTracking().FirstOrDefaultAsync(r => r.Key == key, ctx.RequestAborted);
            if (existing is not null)
            {
                ctx.Response.StatusCode = existing.StatusCode;
                ctx.Response.ContentType = existing.ContentType;
                ctx.Response.Headers["Idempotent-Replayed"] = "true";
                await ctx.Response.WriteAsync(existing.Body, ctx.RequestAborted);
                return;
            }
        }

        var original = ctx.Response.Body;
        await using var buffer = new MemoryStream();
        ctx.Response.Body = buffer;
        try
        {
            await next(ctx);
        }
        finally
        {
            ctx.Response.Body = original;
        }

        buffer.Position = 0;
        if (ctx.Response.StatusCode is >= 200 and < 300 && buffer.Length < 64_000)
        {
            try
            {
                using var scope = scopes.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<TerraDbContext>();
                db.IdempotencyRecords.Add(new IdempotencyRecord
                {
                    Key = key,
                    Method = method,
                    Path = ctx.Request.Path.ToString()[..Math.Min(256, ctx.Request.Path.ToString().Length)],
                    StatusCode = ctx.Response.StatusCode,
                    ContentType = ctx.Response.ContentType ?? "application/json",
                    Body = Encoding.UTF8.GetString(buffer.ToArray()),
                    CreatedAt = DateTime.UtcNow,
                });
                await db.SaveChangesAsync(ctx.RequestAborted);
            }
            catch (DbUpdateException ex)
            {
                // a concurrent request with the same key won the race; its response is equivalent
                log.LogDebug(ex, "Idempotency record already stored");
            }
        }
        await buffer.CopyToAsync(original, ctx.RequestAborted);
    }
}

/// <summary>Hourly housekeeping: expire idempotency records after 24 hours.</summary>
public sealed class MaintenanceService(IServiceScopeFactory scopes, ILogger<MaintenanceService> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromHours(1));
        do
        {
            try
            {
                using var scope = scopes.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<TerraDbContext>();
                var cutoff = DateTime.UtcNow.AddHours(-24);
                var removed = await db.IdempotencyRecords.Where(r => r.CreatedAt < cutoff).ExecuteDeleteAsync(stoppingToken);
                if (removed > 0) log.LogInformation("Expired {Count} idempotency records", removed);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogWarning(ex, "Maintenance failed");
            }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}
