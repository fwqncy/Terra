using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Terra.Api.Tests;

public sealed class TerraFactory : WebApplicationFactory<Program>
{
    private readonly string _db = Path.Combine(Path.GetTempPath(), $"terra-tests-{Guid.NewGuid():N}.db");

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.UseSetting("Database:Provider", "Sqlite");
        builder.UseSetting("ConnectionStrings:Sqlite", $"Data Source={_db}");
        builder.UseSetting("ConnectionStrings:Mongo", "");
        builder.UseSetting("Logistics:WarmupHours", "12");
        builder.UseSetting("Logistics:PersistEverySeconds", "1");
        builder.UseSetting("WordPress:BaseUrl", "");
        builder.UseSetting("Webhooks:PowerAutomateUrl", "");
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        try
        {
            File.Delete(_db);
        }
        catch (IOException)
        {
            // best effort
        }
    }
}

public sealed class ApiTests(TerraFactory factory) : IClassFixture<TerraFactory>
{
    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    private static JsonObject Network() => JsonNode.Parse("""
        { "levels": [ { "inputs": [0, 0], "outputs": [0], "biases": [0.1], "weights": [[0.5], [-0.25]] } ] }
        """)!.AsObject();

    private static JsonObject Save(double lifetime, int vans = 1) => JsonNode.Parse($$"""
        { "coins": {{lifetime / 2}}, "lifetime": {{lifetime}}, "lifetimeAllTime": {{lifetime}}, "tokens": 0,
          "generators": { "van": {{vans}} }, "upgrades": [], "achievements": [], "facilities": {},
          "lastSeen": {{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}},
          "stats": { "deliveries": { "road": 3, "air": 1, "sea": 0 }, "generations": 4 } }
        """)!.AsObject();

    [Fact]
    public async Task Health_ReportsSqlAndNoSql()
    {
        var h = await factory.CreateClient().GetFromJsonAsync<JsonObject>("/api/health");
        Assert.Equal("ok", (string?)h!["status"]);
        Assert.True((bool)h["sql"]!);
        Assert.True((bool)h["nosql"]!);
        Assert.Equal("in-memory", (string?)h["nosqlKind"]);
    }

    [Fact]
    public async Task Game_SyncAndReadBack_WithServerOfflineEarnings()
    {
        var client = factory.CreateClient();
        var id = Guid.NewGuid();
        var put = await client.PutAsJsonAsync($"/api/game/{id}", new { name = "Test Courier", state = Save(1_000, vans: 10), clientTime = 0 });
        put.EnsureSuccessStatusCode();
        var sync = await put.Content.ReadFromJsonAsync<JsonObject>();
        Assert.Equal(1, (int)sync!["revision"]!);
        Assert.True((double)sync["coinsPerSecond"]! >= 10);

        var game = await client.GetFromJsonAsync<JsonObject>($"/api/game/{id}");
        Assert.Equal(10, (int)game!["state"]!["generators"]!["van"]!);
        Assert.NotNull(game["offline"]);
    }

    [Fact]
    public async Task Game_RejectsImplausibleProgress()
    {
        var client = factory.CreateClient();
        var id = Guid.NewGuid();
        (await client.PutAsJsonAsync($"/api/game/{id}", new { name = "Honest", state = Save(100), clientTime = 0 })).EnsureSuccessStatusCode();
        var cheat = await client.PutAsJsonAsync($"/api/game/{id}", new { name = "Honest", state = Save(9e12), clientTime = 0 });
        Assert.Equal(HttpStatusCode.UnprocessableEntity, cheat.StatusCode);
        Assert.Contains("application/problem+json", cheat.Content.Headers.ContentType?.ToString());
    }

    [Fact]
    public async Task Leaderboard_OrdersByLifetime()
    {
        var client = factory.CreateClient();
        foreach (var (name, life) in new[] { ("Low", 10.0), ("High", 50_000.0), ("Mid", 5_000.0) })
            (await client.PutAsJsonAsync($"/api/game/{Guid.NewGuid()}", new { name, state = Save(life), clientTime = 0 })).EnsureSuccessStatusCode();
        var rows = await client.GetFromJsonAsync<JsonArray>("/api/leaderboard?take=100");
        var names = rows!.Select(r => (string?)r!["name"]).ToList();
        Assert.True(names.IndexOf("High") < names.IndexOf("Mid") && names.IndexOf("Mid") < names.IndexOf("Low"));
        Assert.Equal(1, (int)rows[0]!["rank"]!);
    }

    [Fact]
    public async Task Brains_AreValidatedStoredAndListed()
    {
        var client = factory.CreateClient();
        var bad = await client.PostAsJsonAsync("/api/brains", new { name = "Broken", domain = "city", network = new { levels = new[] { new { inputs = new[] { 0 } } } } });
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);

        var ok = await client.PostAsJsonAsync("/api/brains", new JsonObject { ["name"] = "Queen St Courier", ["domain"] = "city", ["generation"] = 12, ["fitness"] = 4200, ["network"] = Network() });
        Assert.Equal(HttpStatusCode.Created, ok.StatusCode);
        var id = (string?)(await ok.Content.ReadFromJsonAsync<JsonObject>())!["id"];

        var list = await client.GetFromJsonAsync<JsonArray>("/api/brains?domain=city");
        Assert.Contains(list!, b => (string?)b!["id"] == id);
        var full = await client.GetFromJsonAsync<JsonObject>($"/api/brains/{id}");
        Assert.NotNull(full!["network"]!["levels"]);
    }

    [Fact]
    public async Task Idempotency_ReplaysTheFirstResponse()
    {
        var client = factory.CreateClient();
        HttpRequestMessage Req()
        {
            var m = new HttpRequestMessage(HttpMethod.Post, "/api/brains") { Content = JsonContent.Create(new JsonObject { ["name"] = "Once", ["domain"] = "sea", ["network"] = Network() }) };
            m.Headers.Add("Idempotency-Key", "test-key-123");
            m.Headers.Add("X-Terra-Player", "player-1");
            return m;
        }
        var first = await client.SendAsync(Req());
        var second = await client.SendAsync(Req());
        Assert.Equal(HttpStatusCode.Created, first.StatusCode);
        Assert.Equal(HttpStatusCode.Created, second.StatusCode);
        Assert.Equal(await first.Content.ReadAsStringAsync(), await second.Content.ReadAsStringAsync());
        Assert.True(second.Headers.Contains("Idempotent-Replayed"));
        var seaBrains = await client.GetFromJsonAsync<JsonArray>("/api/brains?domain=sea");
        Assert.Single(seaBrains!, b => (string?)b!["name"] == "Once");
    }

    [Fact]
    public async Task Worlds_RoundTrip()
    {
        var client = factory.CreateClient();
        var world = new JsonObject { ["version"] = 1, ["graph"] = new JsonObject { ["points"] = new JsonArray(0, 0, 100, 0), ["segments"] = new JsonArray(0, 1) } };
        Assert.Equal(HttpStatusCode.NoContent, (await client.PutAsJsonAsync("/api/worlds/p1/brisbane", world)).StatusCode);
        var back = await client.GetFromJsonAsync<JsonObject>("/api/worlds/p1/brisbane");
        Assert.Equal(4, back!["graph"]!["points"]!.AsArray().Count);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PutAsJsonAsync("/api/worlds/p1/sydney", new JsonObject { ["nope"] = 1 })).StatusCode);
    }

    [Fact]
    public async Task Logistics_SnapshotAndSqlBackedShipmentQueries()
    {
        var client = factory.CreateClient();
        var snap = await client.GetFromJsonAsync<JsonObject>("/api/logistics/snapshot");
        Assert.InRange((double)snap!["kpis"]!["otd"]!, 0, 1);
        Assert.Equal(48, snap["series"]!.AsArray().Count);

        // the background service mirrors the simulation into SQL shortly after start
        JsonObject? page = null;
        for (var i = 0; i < 40 && ((int?)page?["total"] ?? 0) == 0; i++)
        {
            await Task.Delay(250);
            page = await client.GetFromJsonAsync<JsonObject>("/api/logistics/shipments?mode=road&status=Active&sort=costAud&dir=desc&pageSize=5");
        }
        Assert.True((int)page!["total"]! > 0);
        var items = page["items"]!.AsArray();
        Assert.InRange(items.Count, 1, 5);
        Assert.All(items, s => Assert.Equal("road", (string?)s!["mode"]));
        Assert.All(items, s => Assert.NotEqual("Delivered", (string?)s!["status"]));
        var costs = items.Select(s => (double)s!["costAud"]!).ToList();
        Assert.Equal(costs.OrderByDescending(c => c), costs);

        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsync("/api/logistics/shipments/TRA-0/expedite", null)).StatusCode);
        var target = (string?)items[0]!["id"];
        var exp = await client.PostAsync($"/api/logistics/shipments/{target}/expedite", null);
        Assert.Equal(HttpStatusCode.OK, exp.StatusCode);
        Assert.True((bool)(await exp.Content.ReadFromJsonAsync<JsonObject>())!["expedited"]!);
    }

    [Fact]
    public async Task Telemetry_IsAccepted()
    {
        var res = await factory.CreateClient().PostAsJsonAsync("/api/telemetry", new { events = new[] { new { type = "delivery", mode = "air" } } });
        Assert.Equal(HttpStatusCode.Accepted, res.StatusCode);
    }

    [Fact]
    public async Task Cms_ReturnsAnEmptyListWhenWordPressIsNotConfigured()
    {
        var posts = await factory.CreateClient().GetFromJsonAsync<JsonArray>("/api/cms/posts");
        Assert.Empty(posts!);
    }

    [Fact]
    public async Task OpenApi_IsServedInV3AndInV2ForThePowerPlatformConnector()
    {
        var client = factory.CreateClient();
        var v3 = await client.GetFromJsonAsync<JsonObject>("/swagger/v1/swagger.json");
        Assert.StartsWith("3.", (string?)v3!["openapi"]);
        var v2 = await client.GetFromJsonAsync<JsonObject>("/swagger/v1/swagger-v2.json");
        Assert.Equal("2.0", (string?)v2!["swagger"]);
        Assert.NotNull(v2["paths"]!["/api/logistics/snapshot"]);
    }

    [Fact]
    public async Task Validation_ReturnsProblemDetails()
    {
        var res = await factory.CreateClient().PutAsJsonAsync($"/api/players/{Guid.NewGuid()}", new { name = "" });
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        var body = await res.Content.ReadFromJsonAsync<JsonObject>(Web);
        Assert.NotNull(body!["errors"]!["name"]);
    }
}
