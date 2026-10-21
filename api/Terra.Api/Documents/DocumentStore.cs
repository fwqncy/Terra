using System.Collections.Concurrent;
using System.Text.Json.Nodes;
using MongoDB.Bson;
using MongoDB.Driver;

namespace Terra.Api.Documents;

public sealed record BrainSummary(string Id, string Name, string Domain, string? Map, int Generation, double Fitness, DateTime SavedAt, string? Player);

/// <summary>
/// Schemaless documents: trained neural networks, player worlds and telemetry events.
/// MongoDB locally, Azure Cosmos DB for MongoDB in the cloud (same driver), in-memory in tests.
/// </summary>
public interface IDocumentStore
{
    string Kind { get; }
    Task<bool> PingAsync(CancellationToken ct = default);
    Task<string> InsertBrainAsync(JsonObject brain, CancellationToken ct = default);
    Task<IReadOnlyList<BrainSummary>> ListBrainsAsync(string? domain, int take, CancellationToken ct = default);
    Task<JsonObject?> GetBrainAsync(string id, CancellationToken ct = default);
    Task UpsertWorldAsync(string playerId, string mapId, JsonObject world, CancellationToken ct = default);
    Task<JsonObject?> GetWorldAsync(string playerId, string mapId, CancellationToken ct = default);
    Task InsertTelemetryAsync(IEnumerable<JsonObject> events, CancellationToken ct = default);
    Task<long> CountTelemetryAsync(CancellationToken ct = default);
}

public sealed class InMemoryDocumentStore : IDocumentStore
{
    private readonly ConcurrentDictionary<string, JsonObject> _brains = new();
    private readonly ConcurrentDictionary<string, JsonObject> _worlds = new();
    private long _telemetry;

    public string Kind => "in-memory";

    public Task<bool> PingAsync(CancellationToken ct = default) => Task.FromResult(true);

    public Task<string> InsertBrainAsync(JsonObject brain, CancellationToken ct = default)
    {
        var id = ObjectId.GenerateNewId().ToString();
        brain["id"] = id;
        _brains[id] = brain;
        return Task.FromResult(id);
    }

    public Task<IReadOnlyList<BrainSummary>> ListBrainsAsync(string? domain, int take, CancellationToken ct = default)
    {
        IReadOnlyList<BrainSummary> list = _brains.Values
            .Where(b => domain is null || (string?)b["domain"] == domain)
            .Select(ToSummary)
            .OrderByDescending(b => b.Fitness)
            .Take(take)
            .ToList();
        return Task.FromResult(list);
    }

    public Task<JsonObject?> GetBrainAsync(string id, CancellationToken ct = default) =>
        Task.FromResult(_brains.TryGetValue(id, out var b) ? b : null);

    public Task UpsertWorldAsync(string playerId, string mapId, JsonObject world, CancellationToken ct = default)
    {
        _worlds[$"{playerId}:{mapId}"] = world;
        return Task.CompletedTask;
    }

    public Task<JsonObject?> GetWorldAsync(string playerId, string mapId, CancellationToken ct = default) =>
        Task.FromResult(_worlds.TryGetValue($"{playerId}:{mapId}", out var w) ? w : null);

    public Task InsertTelemetryAsync(IEnumerable<JsonObject> events, CancellationToken ct = default)
    {
        Interlocked.Add(ref _telemetry, events.LongCount());
        return Task.CompletedTask;
    }

    public Task<long> CountTelemetryAsync(CancellationToken ct = default) => Task.FromResult(Interlocked.Read(ref _telemetry));

    internal static BrainSummary ToSummary(JsonObject b) => new(
        (string?)b["id"] ?? "",
        (string?)b["name"] ?? "Unnamed",
        (string?)b["domain"] ?? "city",
        (string?)b["map"],
        (int?)b["generation"] ?? 0,
        (double?)b["fitness"] ?? 0,
        b["savedAt"] is JsonValue v && v.TryGetValue<DateTime>(out var d) ? d : DateTime.UtcNow,
        (string?)b["player"]);
}

public sealed class MongoDocumentStore : IDocumentStore
{
    private readonly IMongoDatabase _db;
    private readonly IMongoCollection<BsonDocument> _brains;
    private readonly IMongoCollection<BsonDocument> _worlds;
    private readonly IMongoCollection<BsonDocument> _telemetry;

    public MongoDocumentStore(string connectionString, string database)
    {
        var client = new MongoClient(connectionString);
        _db = client.GetDatabase(database);
        _brains = _db.GetCollection<BsonDocument>("brains");
        _worlds = _db.GetCollection<BsonDocument>("worlds");
        _telemetry = _db.GetCollection<BsonDocument>("telemetry");
    }

    public string Kind => "mongodb";

    public async Task EnsureIndexesAsync(CancellationToken ct = default)
    {
        await _brains.Indexes.CreateOneAsync(new CreateIndexModel<BsonDocument>(Builders<BsonDocument>.IndexKeys.Ascending("domain").Descending("fitness")), cancellationToken: ct);
        await _worlds.Indexes.CreateOneAsync(new CreateIndexModel<BsonDocument>(Builders<BsonDocument>.IndexKeys.Ascending("player").Ascending("map"), new CreateIndexOptions { Unique = true }), cancellationToken: ct);
        await _telemetry.Indexes.CreateOneAsync(new CreateIndexModel<BsonDocument>(Builders<BsonDocument>.IndexKeys.Ascending("at"), new CreateIndexOptions { ExpireAfter = TimeSpan.FromDays(30) }), cancellationToken: ct);
    }

    public async Task<bool> PingAsync(CancellationToken ct = default)
    {
        try
        {
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(TimeSpan.FromSeconds(2));
            await _db.RunCommandAsync((Command<BsonDocument>)"{ping:1}", cancellationToken: cts.Token);
            return true;
        }
        catch
        {
            return false;
        }
    }

    public async Task<string> InsertBrainAsync(JsonObject brain, CancellationToken ct = default)
    {
        var doc = ToBson(brain);
        doc.Remove("id");
        doc["savedAt"] = DateTime.UtcNow;
        await _brains.InsertOneAsync(doc, cancellationToken: ct);
        return doc["_id"].ToString()!;
    }

    public async Task<IReadOnlyList<BrainSummary>> ListBrainsAsync(string? domain, int take, CancellationToken ct = default)
    {
        var filter = domain is null ? Builders<BsonDocument>.Filter.Empty : Builders<BsonDocument>.Filter.Eq("domain", domain);
        var docs = await _brains.Find(filter)
            .Project(Builders<BsonDocument>.Projection.Exclude("network"))
            .Sort(Builders<BsonDocument>.Sort.Descending("fitness"))
            .Limit(take)
            .ToListAsync(ct);
        return docs.Select(d => InMemoryDocumentStore.ToSummary(FromBson(d))).ToList();
    }

    public async Task<JsonObject?> GetBrainAsync(string id, CancellationToken ct = default)
    {
        if (!ObjectId.TryParse(id, out var oid)) return null;
        var doc = await _brains.Find(Builders<BsonDocument>.Filter.Eq("_id", oid)).FirstOrDefaultAsync(ct);
        return doc is null ? null : FromBson(doc);
    }

    public async Task UpsertWorldAsync(string playerId, string mapId, JsonObject world, CancellationToken ct = default)
    {
        var doc = new BsonDocument { ["player"] = playerId, ["map"] = mapId, ["updatedAt"] = DateTime.UtcNow, ["world"] = ToBson(world) };
        var filter = Builders<BsonDocument>.Filter.And(Builders<BsonDocument>.Filter.Eq("player", playerId), Builders<BsonDocument>.Filter.Eq("map", mapId));
        await _worlds.ReplaceOneAsync(filter, doc, new ReplaceOptions { IsUpsert = true }, ct);
    }

    public async Task<JsonObject?> GetWorldAsync(string playerId, string mapId, CancellationToken ct = default)
    {
        var filter = Builders<BsonDocument>.Filter.And(Builders<BsonDocument>.Filter.Eq("player", playerId), Builders<BsonDocument>.Filter.Eq("map", mapId));
        var doc = await _worlds.Find(filter).FirstOrDefaultAsync(ct);
        return doc is null ? null : FromBson(doc["world"].AsBsonDocument);
    }

    public async Task InsertTelemetryAsync(IEnumerable<JsonObject> events, CancellationToken ct = default)
    {
        var docs = events.Select(e =>
        {
            var d = ToBson(e);
            d["at"] = DateTime.UtcNow;
            return d;
        }).ToList();
        if (docs.Count > 0) await _telemetry.InsertManyAsync(docs, cancellationToken: ct);
    }

    public Task<long> CountTelemetryAsync(CancellationToken ct = default) => _telemetry.EstimatedDocumentCountAsync(cancellationToken: ct);

    private static BsonDocument ToBson(JsonObject obj) => BsonDocument.Parse(obj.ToJsonString());

    private static JsonObject FromBson(BsonDocument doc)
    {
        var json = doc.ToJson(new MongoDB.Bson.IO.JsonWriterSettings { OutputMode = MongoDB.Bson.IO.JsonOutputMode.RelaxedExtendedJson });
        var node = JsonNode.Parse(json)!.AsObject();
        if (node["_id"] is JsonObject idObj && idObj["$oid"] is JsonNode oid) node["id"] = oid.GetValue<string>();
        node.Remove("_id");
        if (node["savedAt"] is JsonObject dateObj && dateObj["$date"] is JsonNode date) node["savedAt"] = JsonValue.Create(DateTime.Parse(date.GetValue<string>()).ToUniversalTime());
        return node;
    }

}
