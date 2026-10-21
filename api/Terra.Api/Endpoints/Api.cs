using System.Reflection;
using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Terra.Api.Data;
using Terra.Api.Documents;
using Terra.Api.Game;
using Terra.Api.Integrations;
using Terra.Api.Logistics;

namespace Terra.Api.Endpoints;

public sealed record HealthResponse(string Status, string Version, bool Sql, bool Nosql, string NosqlKind, DateTime Time, bool Cms, bool Webhooks);
public sealed record PlayerRequest(string Name);
public sealed record PlayerResponse(Guid Id, string Name);
public sealed record GameSyncRequest(string? Name, JsonObject State, double ClientTime);
public sealed record GameSyncResponse(int Revision, double ServerTime, int Rank, double CoinsPerSecond);
public sealed record GameResponse(JsonObject State, double ServerTime, Economy.Offline Offline, int Revision);
public sealed record LeaderRow(int Rank, string Name, double Lifetime, int Deliveries, int Tokens);
public sealed record BrainCreated(string Id);
public sealed record TelemetryRequest(List<JsonObject> Events);
public sealed record ShipmentDto(
    string Id, string Mode, string Origin, string Destination, string DestinationName, string Carrier, string Customer, string Priority,
    double WeightKg, int Units, string UnitType, double DistanceKm, double CreatedAt, double DepartAt, double EtaAt, double SlaAt,
    double? DeliveredAt, string Status, double Progress, double CostAud, double Co2Kg, string? DelayReason, bool? OnTime, bool Expedited);
public sealed record ShipmentPageResponse(int Total, int Page, int PageSize, List<ShipmentDto> Items);

public static class Api
{
    private static readonly string Version = Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "1.0.0";

    public static void MapTerraApi(this WebApplication app)
    {
        var api = app.MapGroup("/api");

        // ---------- health ----------
        api.MapGet("/health", async (TerraDbContext db, IDocumentStore docs, WordPressCms cms, PowerAutomateNotifier hooks, CancellationToken ct) =>
        {
            var sql = await db.Database.CanConnectAsync(ct);
            var nosql = await docs.PingAsync(ct);
            return Results.Ok(new HealthResponse(sql && nosql ? "ok" : "degraded", Version, sql, nosql, docs.Kind, DateTime.UtcNow, cms.Configured, hooks.Configured));
        }).Produces<HealthResponse>().WithName("GetHealth").WithTags("System").WithSummary("Service health, including SQL Server and NoSQL connectivity");

        // ---------- players & saves (SQL Server) ----------
        api.MapPut("/players/{id:guid}", async (Guid id, PlayerRequest req, TerraDbContext db, CancellationToken ct) =>
        {
            var name = Clean(req.Name);
            if (name is null) return Results.ValidationProblem(new Dictionary<string, string[]> { ["name"] = ["Use 1–32 characters."] });
            var player = await UpsertPlayer(db, id, name, ct);
            await db.SaveChangesAsync(ct);
            return Results.Ok(new PlayerResponse(player.Id, player.Name));
        }).WithName("UpsertPlayer").WithTags("Players").RequireRateLimiting("writes");

        api.MapGet("/game/{playerId:guid}", async (Guid playerId, TerraDbContext db, CancellationToken ct) =>
        {
            var save = await db.GameSaves.AsNoTracking().FirstOrDefaultAsync(s => s.PlayerId == playerId, ct);
            if (save is null) return Results.NotFound();
            var state = JsonNode.Parse(save.StateJson)!.AsObject();
            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            return Results.Ok(new GameResponse(state, now, Economy.OfflineEarnings(Economy.Read(state), now), save.Revision));
        }).WithName("GetGame").WithTags("Game").WithSummary("A player's save plus server-computed offline earnings");

        api.MapPut("/game/{playerId:guid}", async (Guid playerId, GameSyncRequest req, TerraDbContext db, CancellationToken ct) =>
        {
            var json = req.State.ToJsonString();
            if (json.Length > 64_000) return Results.Problem("Save is too large.", statusCode: 413);
            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var next = Economy.Read(req.State);
            var save = await db.GameSaves.FirstOrDefaultAsync(s => s.PlayerId == playerId, ct);
            if (save is not null)
            {
                var prev = Economy.Read(JsonNode.Parse(save.StateJson)!.AsObject());
                var elapsed = (DateTime.UtcNow - save.UpdatedAt).TotalSeconds;
                if (!Economy.IsPlausible(prev, next, elapsed, now))
                    return Results.Problem("Progress grew faster than your fleet can earn. Your previous save was kept.", statusCode: 422, title: "Save rejected");
            }
            var player = await UpsertPlayer(db, playerId, Clean(req.Name) ?? "Courier", ct);
            save ??= db.GameSaves.Add(new GameSave { PlayerId = player.Id }).Entity;
            save.StateJson = json;
            save.Coins = next.Coins;
            save.Lifetime = next.Lifetime;
            save.LifetimeAllTime = Math.Max(next.LifetimeAllTime, next.Lifetime);
            save.Tokens = next.Tokens;
            save.Deliveries = next.Deliveries;
            save.Generations = next.Generations;
            save.Achievements = next.Achievements;
            save.LastSeen = DateTimeOffset.FromUnixTimeMilliseconds((long)Math.Min(now, Math.Max(0, next.LastSeen))).UtcDateTime;
            save.UpdatedAt = DateTime.UtcNow;
            save.Revision++;
            try
            {
                await db.SaveChangesAsync(ct);
            }
            catch (DbUpdateConcurrencyException)
            {
                return Results.Problem("Another device saved at the same moment. Try again.", statusCode: 409);
            }
            var rank = 1 + await db.GameSaves.CountAsync(s => s.LifetimeAllTime > save.LifetimeAllTime, ct);
            return Results.Ok(new GameSyncResponse(save.Revision, now, rank, Economy.CoinsPerSecond(next, now)));
        }).WithName("SyncGame").WithTags("Game").WithSummary("Store a save after a server-side plausibility check").RequireRateLimiting("writes");

        api.MapGet("/leaderboard", async (int? take, TerraDbContext db, CancellationToken ct) =>
        {
            var n = Math.Clamp(take ?? 20, 1, 100);
            var rows = await db.GameSaves.AsNoTracking()
                .OrderByDescending(s => s.LifetimeAllTime)
                .Take(n)
                .Select(s => new { s.Player!.Name, s.LifetimeAllTime, s.Deliveries, s.Tokens })
                .ToListAsync(ct);
            return Results.Ok(rows.Select((r, i) => new LeaderRow(i + 1, r.Name, r.LifetimeAllTime, r.Deliveries, r.Tokens)));
        }).Produces<List<LeaderRow>>().WithName("GetLeaderboard").WithTags("Game");

        // ---------- brains & worlds (NoSQL documents) ----------
        api.MapPost("/brains", async (JsonObject body, IDocumentStore docs, HttpContext http, CancellationToken ct) =>
        {
            if (body.ToJsonString().Length > 200_000) return Results.Problem("Brain is too large.", statusCode: 413);
            var domain = (string?)body["domain"];
            if (domain is not ("city" or "motorway" or "sea" or "air")) return Results.ValidationProblem(new Dictionary<string, string[]> { ["domain"] = ["Use city, motorway, sea or air."] });
            if (!BrainValidator.IsValid(body["network"])) return Results.ValidationProblem(new Dictionary<string, string[]> { ["network"] = ["Expected { levels: [{ inputs, outputs, biases, weights }] } with finite numbers."] });
            var doc = new JsonObject
            {
                ["name"] = Clean((string?)body["name"]) ?? "Unnamed brain",
                ["domain"] = domain,
                ["map"] = (string?)body["map"],
                ["generation"] = (int?)body["generation"] ?? 0,
                ["fitness"] = (double?)body["fitness"] ?? 0,
                ["player"] = (string?)body["player"] ?? http.Request.Headers["X-Terra-Player"].ToString(),
                ["savedAt"] = DateTime.UtcNow,
                ["network"] = body["network"]!.DeepClone(),
            };
            var id = await docs.InsertBrainAsync(doc, ct);
            return Results.Created($"/api/brains/{id}", new BrainCreated(id));
        }).WithName("SaveBrain").WithTags("Brains").WithSummary("Store a trained neural network as a document").RequireRateLimiting("writes");

        api.MapGet("/brains", async (string? domain, int? take, IDocumentStore docs, CancellationToken ct) =>
            Results.Ok(await docs.ListBrainsAsync(domain, Math.Clamp(take ?? 20, 1, 100), ct)))
            .Produces<List<BrainSummary>>().WithName("ListBrains").WithTags("Brains");

        api.MapGet("/brains/{id}", async (string id, IDocumentStore docs, CancellationToken ct) =>
            await docs.GetBrainAsync(id, ct) is { } brain ? Results.Ok(brain) : Results.NotFound())
            .WithName("GetBrain").WithTags("Brains");

        api.MapPut("/worlds/{playerId}/{mapId}", async (string playerId, string mapId, JsonObject world, IDocumentStore docs, CancellationToken ct) =>
        {
            if (world.ToJsonString().Length > 1_000_000) return Results.Problem("World is too large.", statusCode: 413);
            if (world["graph"] is not JsonObject) return Results.ValidationProblem(new Dictionary<string, string[]> { ["graph"] = ["A world needs a graph."] });
            await docs.UpsertWorldAsync(playerId[..Math.Min(64, playerId.Length)], mapId[..Math.Min(32, mapId.Length)], world, ct);
            return Results.NoContent();
        }).WithName("SaveWorld").WithTags("Worlds").RequireRateLimiting("writes");

        api.MapGet("/worlds/{playerId}/{mapId}", async (string playerId, string mapId, IDocumentStore docs, CancellationToken ct) =>
            await docs.GetWorldAsync(playerId, mapId, ct) is { } w ? Results.Ok(w) : Results.NotFound())
            .WithName("GetWorld").WithTags("Worlds");

        api.MapPost("/telemetry", async (TelemetryRequest req, IDocumentStore docs, CancellationToken ct) =>
        {
            if (req.Events.Count > 200) return Results.Problem("Send at most 200 events per batch.", statusCode: 413);
            await docs.InsertTelemetryAsync(req.Events, ct);
            return Results.Accepted();
        }).WithName("IngestTelemetry").WithTags("Telemetry").RequireRateLimiting("writes");

        // ---------- logistics (in-memory sim + SQL mirror) ----------
        api.MapGet("/logistics/snapshot", (LogisticsSimulator sim) => Results.Ok(sim.Snapshot()))
            .Produces<Snapshot>().WithName("GetLogisticsSnapshot").WithTags("Logistics").WithSummary("KPIs, hourly series, lanes, carriers, hubs, departures and alerts");

        api.MapGet("/logistics/shipments", async (string? status, string? mode, string? q, string? sort, string? dir, int? page, int? pageSize, TerraDbContext db, CancellationToken ct) =>
        {
            var size = Math.Clamp(pageSize ?? 25, 1, 100_000);
            var p = Math.Max(1, page ?? 1);
            var query = db.Shipments.AsNoTracking().AsQueryable();
            if (status == "Active") query = query.Where(s => s.Status != "Delivered");
            else if (!string.IsNullOrEmpty(status)) query = query.Where(s => s.Status == status);
            if (!string.IsNullOrEmpty(mode)) query = query.Where(s => s.Mode == mode);
            if (!string.IsNullOrWhiteSpace(q))
            {
                var needle = q.Trim();
                query = query.Where(s => s.Id.Contains(needle) || s.Customer.Contains(needle) || s.DestinationName.Contains(needle) || s.Carrier.Contains(needle));
            }
            var desc = dir == "desc";
            query = (sort ?? "etaAt") switch
            {
                "id" => desc ? query.OrderByDescending(s => s.Id) : query.OrderBy(s => s.Id),
                "customer" => desc ? query.OrderByDescending(s => s.Customer) : query.OrderBy(s => s.Customer),
                "mode" => desc ? query.OrderByDescending(s => s.Mode) : query.OrderBy(s => s.Mode),
                "destinationName" => desc ? query.OrderByDescending(s => s.DestinationName) : query.OrderBy(s => s.DestinationName),
                "status" => desc ? query.OrderByDescending(s => s.Status) : query.OrderBy(s => s.Status),
                "weightKg" => desc ? query.OrderByDescending(s => s.WeightKg) : query.OrderBy(s => s.WeightKg),
                "costAud" => desc ? query.OrderByDescending(s => s.CostAud) : query.OrderBy(s => s.CostAud),
                _ => desc ? query.OrderByDescending(s => s.EtaAt) : query.OrderBy(s => s.EtaAt),
            };
            var total = await query.CountAsync(ct);
            var items = await query.Skip((p - 1) * size).Take(size).ToListAsync(ct);
            return Results.Ok(new ShipmentPageResponse(total, p, size, items.Select(ToDto).ToList()));
        }).Produces<ShipmentPageResponse>().WithName("QueryShipments").WithTags("Logistics").WithSummary("Filter, sort and page shipments from SQL Server");

        api.MapPost("/logistics/shipments/{id}/expedite", async (string id, LogisticsSimulator sim, LogisticsHostedService mirror, CancellationToken ct) =>
        {
            var s = sim.Expedite(id);
            if (s is null) return Results.NotFound();
            await mirror.PersistAsync(ct);
            return Results.Ok(s);
        }).Produces<Shipment>().Produces(StatusCodes.Status404NotFound).WithName("ExpediteShipment").WithTags("Logistics").RequireRateLimiting("writes");

        // ---------- integrations ----------
        api.MapGet("/cms/posts", async (WordPressCms cms, CancellationToken ct) => Results.Ok(await cms.GetPostsAsync(ct)))
            .WithName("GetDispatches").WithTags("CMS").WithSummary("Dispatches from the WordPress headless CMS (empty when not configured)");

        api.MapPost("/webhooks/test", async (PowerAutomateNotifier hooks, CancellationToken ct) =>
        {
            if (!hooks.Configured) return Results.Problem("Set Webhooks:PowerAutomateUrl first.", statusCode: 400);
            var ok = await hooks.SendAsync(new LogisticsEvent("test", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), "test", "TRA-000000", "road", "Test alert from Terra", "critical"), ct);
            return ok ? Results.Ok(new { sent = true }) : Results.Problem("The flow did not accept the test alert.", statusCode: 502);
        }).WithName("TestWebhook").WithTags("Integrations").RequireRateLimiting("writes");
    }

    private static string? Clean(string? name)
    {
        var n = (name ?? "").Trim();
        return n.Length is >= 1 and <= 32 ? n : null;
    }

    private static async Task<Player> UpsertPlayer(TerraDbContext db, Guid id, string name, CancellationToken ct)
    {
        var player = await db.Players.FirstOrDefaultAsync(p => p.Id == id, ct);
        if (player is null)
        {
            player = new Player { Id = id, Name = name, CreatedAt = DateTime.UtcNow };
            db.Players.Add(player);
        }
        player.Name = name;
        player.UpdatedAt = DateTime.UtcNow;
        return player;
    }

    private static ShipmentDto ToDto(ShipmentRecord s)
    {
        static double Ms(DateTime d) => new DateTimeOffset(DateTime.SpecifyKind(d, DateTimeKind.Utc)).ToUnixTimeMilliseconds();
        return new ShipmentDto(
            s.Id, s.Mode, s.Origin, s.Destination, s.DestinationName, s.Carrier, s.Customer, s.Priority, s.WeightKg, s.Units, s.UnitType,
            s.DistanceKm, Ms(s.CreatedAt), Ms(s.DepartAt), Ms(s.EtaAt), Ms(s.SlaAt), s.DeliveredAt is { } d ? Ms(d) : null,
            s.Status, s.Progress, s.CostAud, s.Co2Kg, s.DelayReason, s.OnTime, s.Expedited);
    }
}
