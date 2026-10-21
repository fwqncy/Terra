namespace Terra.Api.Logistics;

public sealed record Hub(string Id, string Name, string Kind, double Lon, double Lat, int Capacity, string Unit);

public sealed record Destination(string Id, string Name, double Km);

public sealed record Place(string Id, string Name, string Kind, double Lon, double Lat, bool Hub = false);

/// <summary>Mirror of engine/logistics/catalog.js (all businesses are fictional).</summary>
public static class Catalog
{
    public static readonly string[] Modes = ["road", "air", "sea"];

    public static readonly Hub[] Hubs =
    [
        new("EFD", "Eagle Farm DC", "warehouse", 153.08, -27.43, 12_000, "pallets"),
        new("ACR", "Acacia Ridge Intermodal", "warehouse", 153.03, -27.58, 18_000, "pallets"),
        new("YTL", "Yatala Distribution", "warehouse", 153.22, -27.74, 9_000, "pallets"),
        new("PBNE", "Port of Brisbane", "seaport", 153.17, -27.38, 6_000, "TEU"),
        new("BNEC", "Brisbane Airport Cargo", "airport", 153.12, -27.39, 900, "ULD"),
    ];

    public static readonly Place[] Places =
    [
        new("BNE", "Brisbane", "air", 153.117, -27.384, true),
        new("OOL", "Gold Coast", "air", 153.505, -28.164),
        new("SYD", "Sydney", "air", 151.177, -33.946),
        new("MEL", "Melbourne", "air", 144.843, -37.67),
        new("CNS", "Cairns", "air", 145.755, -16.886),
        new("HTI", "Hamilton Island", "air", 148.951, -20.358),
        new("LDH", "Lord Howe Island", "air", 159.077, -31.538),
        new("NLK", "Norfolk Island", "air", 167.939, -29.042),
        new("AKL", "Auckland", "air", 174.785, -37.008),
        new("WLG", "Wellington", "air", 174.805, -41.327),
        new("NOU", "Nouméa", "air", 166.213, -22.016),
        new("VLI", "Port Vila", "air", 168.32, -17.699),
        new("NAN", "Nadi", "air", 177.443, -17.755),
        new("POM", "Port Moresby", "air", 147.22, -9.443),
        new("HIR", "Honiara", "air", 160.055, -9.428),
        new("DPS", "Denpasar", "air", 115.167, -8.748),
        new("TBU", "Nukuʻalofa", "air", 184.8, -21.24),
        new("PBNE", "Port of Brisbane", "sea", 153.2, -27.36, true),
        new("TANG", "Tangalooma", "sea", 153.345, -27.18),
        new("DUNW", "Dunwich", "sea", 153.38, -27.49),
        new("GCSW", "Gold Coast Seaway", "sea", 153.48, -27.94),
        new("SYDP", "Port Jackson", "sea", 151.33, -33.84),
        new("LDHP", "Lord Howe Lagoon", "sea", 159.0, -31.6),
        new("NLKP", "Kingston, Norfolk", "sea", 167.95, -29.12),
        new("NOUP", "Port of Nouméa", "sea", 166.3, -22.42),
        new("AKLP", "Ports of Auckland", "sea", 174.95, -36.62),
        new("VILP", "Port Vila", "sea", 168.2, -17.8),
        new("SUVA", "Suva", "sea", 178.43, -18.22),
        new("POMP", "Port Moresby", "sea", 147.08, -9.6),
        new("HONP", "Honiara", "sea", 159.95, -9.35),
    ];

    public static readonly Destination[] Road =
    [
        new("GC", "Gold Coast", 79), new("SC", "Sunshine Coast", 105), new("TWB", "Toowoomba", 125),
        new("IPS", "Ipswich", 40), new("LGN", "Logan", 30), new("RDC", "Redcliffe", 36),
        new("BYR", "Byron Bay", 165), new("SYDR", "Sydney", 917), new("TSV", "Townsville", 1_360),
    ];

    public static readonly Destination[] Air = Places
        .Where(p => p.Kind == "air" && p.Id != "BNE")
        .Select(p => new Destination(p.Id, p.Name, Rng.JsRound(GreatCircleKm(Find("BNE"), p))))
        .ToArray();

    public static readonly Destination[] Sea = Places
        .Where(p => p.Kind == "sea" && p.Id != "PBNE")
        .Select(p => new Destination(p.Id, p.Name, Rng.JsRound(GreatCircleKm(Find("PBNE"), p) * 1.25 + 30)))
        .ToArray();

    public static readonly Dictionary<string, string[]> Carriers = new()
    {
        ["road"] = ["Jacaranda Haulage", "Bunya Express", "Moreton Freight Co."],
        ["air"] = ["Brolga Air Cargo", "Coral Wing"],
        ["sea"] = ["Coral Sea Lines", "Southern Cross Shipping"],
    };

    public static readonly string[] Customers =
    [
        "Bean & Bunya Coffee", "Paddington Paper Co.", "Wynnum Wharf Fish", "Kangaroo Point Climbing", "Valley Vinyl",
        "Mt Coot-tha Botanics", "West End Woolworks", "Story Bridge Brewing", "Southbank Solar", "Toowong Tools",
        "Bulimba Bikes", "New Farm Florals", "Woolloongabba Wheels", "Spring Hill Spices",
    ];

    public static readonly Dictionary<string, string[]> DelayReasons = new()
    {
        ["road"] = ["Traffic on the M1", "Driver fatigue break", "Mechanical fault", "Roadworks", "Loading dock queue"],
        ["air"] = ["Storm cell en route", "Slot congestion", "Customs hold", "Late ULD build-up"],
        ["sea"] = ["Port congestion", "Swell warning", "Customs hold", "Crane outage", "Pilot boarding delay"],
    };

    public static readonly Dictionary<string, double> Emissions = new() { ["road"] = 0.105, ["air"] = 0.602, ["sea"] = 0.016 };
    public static readonly Dictionary<string, double> SpeedKmh = new() { ["road"] = 62, ["air"] = 640, ["sea"] = 27 };
    public static readonly Dictionary<string, double> HandlingH = new() { ["road"] = 1, ["air"] = 7, ["sea"] = 30 };
    public static readonly Dictionary<string, double> RateAudTkm = new() { ["road"] = 0.21, ["air"] = 2.6, ["sea"] = 0.045 };
    public static readonly Dictionary<string, double> FixedAud = new() { ["road"] = 45, ["air"] = 180, ["sea"] = 420 };
    public static readonly Dictionary<string, double> SpawnPerHour = new() { ["road"] = 14, ["air"] = 3, ["sea"] = 1.2 };
    public static readonly Dictionary<string, double> DelayPerHour = new() { ["road"] = 0.012, ["air"] = 0.008, ["sea"] = 0.006 };

    public static Destination[] DestinationsFor(string mode) => mode switch { "road" => Road, "air" => Air, _ => Sea };

    private static Place Find(string id) => Places.First(p => p.Id == id);

    private static double GreatCircleKm(Place a, Place b)
    {
        const double R = 6371;
        static double Rad(double d) => d * Math.PI / 180;
        var dLat = Rad(b.Lat - a.Lat);
        var dLon = Rad(b.Lon - a.Lon);
        var h = Math.Pow(Math.Sin(dLat / 2), 2) + Math.Cos(Rad(a.Lat)) * Math.Cos(Rad(b.Lat)) * Math.Pow(Math.Sin(dLon / 2), 2);
        return 2 * R * Math.Asin(Math.Sqrt(h));
    }
}
