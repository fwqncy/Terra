namespace Terra.Api.Data;

public sealed class Player
{
    public Guid Id { get; set; }
    public string Name { get; set; } = "";
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
    public GameSave? Save { get; set; }
}

/// <summary>The full save is kept as JSON; the columns the leaderboard and reporting need are lifted out.</summary>
public sealed class GameSave
{
    public Guid PlayerId { get; set; }
    public Player? Player { get; set; }
    public string StateJson { get; set; } = "{}";
    public double Coins { get; set; }
    public double Lifetime { get; set; }
    public double LifetimeAllTime { get; set; }
    public int Tokens { get; set; }
    public int Deliveries { get; set; }
    public int Generations { get; set; }
    public int Achievements { get; set; }
    public DateTime LastSeen { get; set; }
    public DateTime UpdatedAt { get; set; }
    public int Revision { get; set; }
}

/// <summary>Mirror of the live simulation's shipments (refreshed incrementally by the background service).</summary>
public sealed class ShipmentRecord
{
    public string Id { get; set; } = "";
    public string Mode { get; set; } = "";
    public string Origin { get; set; } = "";
    public string Destination { get; set; } = "";
    public string DestinationName { get; set; } = "";
    public string Carrier { get; set; } = "";
    public string Customer { get; set; } = "";
    public string Priority { get; set; } = "";
    public double WeightKg { get; set; }
    public int Units { get; set; }
    public string UnitType { get; set; } = "";
    public double DistanceKm { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime DepartAt { get; set; }
    public DateTime EtaAt { get; set; }
    public DateTime SlaAt { get; set; }
    public DateTime? DeliveredAt { get; set; }
    public string Status { get; set; } = "";
    public double Progress { get; set; }
    public double CostAud { get; set; }
    public double Co2Kg { get; set; }
    public string? DelayReason { get; set; }
    public bool? OnTime { get; set; }
    public bool Expedited { get; set; }
}

/// <summary>Stored responses for retried writes (Idempotency-Key header).</summary>
public sealed class IdempotencyRecord
{
    public string Key { get; set; } = "";
    public string Method { get; set; } = "";
    public string Path { get; set; } = "";
    public int StatusCode { get; set; }
    public string ContentType { get; set; } = "application/json";
    public string Body { get; set; } = "";
    public DateTime CreatedAt { get; set; }
}
