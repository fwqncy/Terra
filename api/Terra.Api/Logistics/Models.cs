namespace Terra.Api.Logistics;

/// <summary>Same shape as the browser simulator's shipment (times are epoch milliseconds).</summary>
public sealed class Shipment
{
    public required string Id { get; init; }
    public required string Mode { get; init; }
    public required string Origin { get; init; }
    public required string Destination { get; init; }
    public required string DestinationName { get; init; }
    public required string Carrier { get; init; }
    public required string Customer { get; init; }
    public string Priority { get; set; } = "Standard";
    public double WeightKg { get; init; }
    public int Units { get; init; }
    public required string UnitType { get; init; }
    public double DistanceKm { get; init; }
    public double CreatedAt { get; init; }
    public double DepartAt { get; init; }
    public double EtaAt { get; set; }
    public double SlaAt { get; init; }
    public double? DeliveredAt { get; set; }
    public string Status { get; set; } = "Booked";
    public double Progress { get; set; }
    public double CostAud { get; set; }
    public double Co2Kg { get; init; }
    public string? DelayReason { get; set; }
    public double? DelayUntil { get; set; }
    public bool? OnTime { get; set; }
    public bool Expedited { get; set; }
}

public sealed record LogisticsEvent(string Id, double At, string Type, string ShipmentId, string Mode, string Message, string Severity);

public sealed class Bucket
{
    public double T { get; init; }
    public Dictionary<string, int> Created { get; } = new() { ["road"] = 0, ["air"] = 0, ["sea"] = 0 };
    public Dictionary<string, int> Delivered { get; } = new() { ["road"] = 0, ["air"] = 0, ["sea"] = 0 };
    public int OnTime { get; set; }
    public int Late { get; set; }
    public double Co2 { get; set; }
    public double Revenue { get; set; }
    public int Delays { get; set; }
}

public sealed record ModeTriple(double Road, double Air, double Sea);

public sealed record Kpis(
    double Otd, int Delivered24h, int InTransit, int Booked, int Delayed, int Exceptions,
    double Revenue24h, double Co2Kg24h, double Co2PerTkm, double CostPerKg, ModeTriple AvgTransitH, ModeTriple Utilization);

public sealed record SeriesPoint(double T, int Road, int Air, int Sea, int OnTime, int Late, double Co2, double Revenue, int Created);

public sealed record LaneRow(
    string Lane, string Origin, string Destination, string Mode, int Volume, int Delivered, int OnTime, double DelayH,
    double Revenue, double Co2, double? Otd, double AvgDelayH);

public sealed record CarrierRow(
    string Carrier, string Mode, int Volume, int Delivered, int OnTime, double Cost, double Tkm, double Co2,
    double? Otd, double CostPerTkm, double Co2PerTkm);

public sealed record HubRow(
    string Id, string Name, string Kind, double Lon, double Lat, int Capacity, string Unit, double Occupancy, int DockDoorsBusy, int DockDoors);

public sealed record ModeStat(int Delivered, double Tkm, double Co2Kg, double Revenue, int OnTime);

public sealed record Snapshot(
    double Now, Kpis Kpis, Dictionary<string, int> ModeSplit, Dictionary<string, ModeStat> ModeStats, List<SeriesPoint> Series,
    List<LaneRow> Lanes, List<CarrierRow> Carriers, List<HubRow> Hubs, List<Shipment> Departures, List<LogisticsEvent> Alerts);

public sealed record ShipmentPage(int Total, int Page, int PageSize, List<Shipment> Items);
