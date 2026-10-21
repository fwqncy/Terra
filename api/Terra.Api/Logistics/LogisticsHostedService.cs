using Microsoft.EntityFrameworkCore;
using Terra.Api.Data;
using Terra.Api.Integrations;

namespace Terra.Api.Logistics;

public sealed class LogisticsOptions
{
    public uint Seed { get; set; } = 2032;
    /// <summary>Simulated minutes per real second.</summary>
    public double Speed { get; set; } = 2;
    public int PersistEverySeconds { get; set; } = 10;
    public bool Persist { get; set; } = true;
}

/// <summary>
/// Runs the live simulation in memory (the hot path) and mirrors changed shipments into SQL Server
/// every few seconds (the durable, queryable store). Critical events go to Power Automate.
/// </summary>
public sealed class LogisticsHostedService(
    LogisticsSimulator sim,
    IServiceScopeFactory scopes,
    PowerAutomateNotifier notifier,
    IConfiguration config,
    ILogger<LogisticsHostedService> log) : BackgroundService
{
    private readonly LogisticsOptions _opts = config.GetSection("Logistics").Get<LogisticsOptions>() ?? new LogisticsOptions();

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        sim.EventRaised += e =>
        {
            if (e.Severity == "critical") notifier.Enqueue(e);
        };

        if (_opts.Persist) await ResetMirrorAsync(stoppingToken);

        var lastPersist = DateTime.UtcNow;
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(1));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            sim.Tick(1, _opts.Speed);
            if (_opts.Persist && (DateTime.UtcNow - lastPersist).TotalSeconds >= _opts.PersistEverySeconds)
            {
                lastPersist = DateTime.UtcNow;
                try
                {
                    await PersistAsync(stoppingToken);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    log.LogWarning(ex, "Persisting shipments failed; will retry");
                }
            }
        }
    }

    /// <summary>The simulation is ephemeral, so the SQL mirror starts clean with the current network.</summary>
    private async Task ResetMirrorAsync(CancellationToken ct)
    {
        try
        {
            using var scope = scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<TerraDbContext>();
            await db.Shipments.ExecuteDeleteAsync(ct);
            sim.TakeDirty();
            var all = sim.Read(s => s.Shipments.ToList());
            db.Shipments.AddRange(all.Select(ToRecord));
            await db.SaveChangesAsync(ct);
            log.LogInformation("Mirrored {Count} shipments to SQL", all.Count);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning(ex, "Could not initialise the shipment mirror");
        }
    }

    public async Task PersistAsync(CancellationToken ct)
    {
        var dirty = sim.TakeDirty();
        if (dirty.Count == 0) return;
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<TerraDbContext>();
        var ids = dirty.Select(d => d.Id).ToList();
        var existing = await db.Shipments.Where(s => ids.Contains(s.Id)).ToDictionaryAsync(s => s.Id, ct);
        foreach (var s in dirty)
        {
            if (existing.TryGetValue(s.Id, out var rec)) Copy(s, rec);
            else db.Shipments.Add(ToRecord(s));
        }
        await db.SaveChangesAsync(ct);
    }

    private static DateTime At(double ms) => DateTimeOffset.FromUnixTimeMilliseconds((long)ms).UtcDateTime;

    public static ShipmentRecord ToRecord(Shipment s)
    {
        var r = new ShipmentRecord { Id = s.Id };
        Copy(s, r);
        return r;
    }

    private static void Copy(Shipment s, ShipmentRecord r)
    {
        r.Mode = s.Mode;
        r.Origin = s.Origin;
        r.Destination = s.Destination;
        r.DestinationName = s.DestinationName;
        r.Carrier = s.Carrier;
        r.Customer = s.Customer;
        r.Priority = s.Priority;
        r.WeightKg = s.WeightKg;
        r.Units = s.Units;
        r.UnitType = s.UnitType;
        r.DistanceKm = s.DistanceKm;
        r.CreatedAt = At(s.CreatedAt);
        r.DepartAt = At(s.DepartAt);
        r.EtaAt = At(s.EtaAt);
        r.SlaAt = At(s.SlaAt);
        r.DeliveredAt = s.DeliveredAt is { } d ? At(d) : null;
        r.Status = s.Status;
        r.Progress = s.Progress;
        r.CostAud = s.CostAud;
        r.Co2Kg = s.Co2Kg;
        r.DelayReason = s.DelayReason;
        r.OnTime = s.OnTime;
        r.Expedited = s.Expedited;
    }
}
