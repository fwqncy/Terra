using System.Text.Json.Nodes;

namespace Terra.Api.Game;

/// <summary>
/// Server mirror of the parts of engine/idle/economy.js that need authority:
/// coins-per-second, offline earnings and a plausibility check for synced saves.
/// Parity with the JavaScript is covered by EconomyParityTests.
/// </summary>
public static class Economy
{
    public static readonly IReadOnlyDictionary<string, double> GeneratorCps = new Dictionary<string, double>
    {
        ["bike"] = 0.1, ["van"] = 1, ["ute"] = 8, ["truck"] = 47, ["drone"] = 260,
        ["plane"] = 1_400, ["ship"] = 7_800, ["terminal"] = 44_000, ["hyperloop"] = 260_000,
    };

    /// <summary>Upgrade id → (kind, target, value). Mirrors UPGRADES[].effect.</summary>
    private static readonly IReadOnlyDictionary<string, (string Kind, string? Target, double Value)> Effects = new Dictionary<string, (string, string?, double)>
    {
        ["panniers"] = ("gen", "bike", 2),
        ["parcel-tetris"] = ("gen", "van", 2),
        ["lidar"] = ("gen", "ute", 2),
        ["slim-dusty"] = ("gen", "truck", 2),
        ["magpie-radar"] = ("gen", "drone", 2),
        ["jet-stream"] = ("gen", "plane", 2),
        ["twin-lift"] = ("gen", "ship", 2),
        ["neural-dispatch"] = ("all", null, 1.5),
        ["green-diesel"] = ("all", null, 1.1),
        ["olympics"] = ("all", null, 2),
        ["night-shift"] = ("offlineCap", null, 4),
        ["mezzanine"] = ("offlineRate", null, 0.75),
        ["autopilot"] = ("offlineRate", null, 1),
    };

    public const double BaseOfflineHours = 2;
    public const double BaseOfflineRate = 0.5;

    public sealed record State(
        double Coins, double Lifetime, double LifetimeAllTime, int Tokens, IReadOnlyDictionary<string, int> Generators,
        IReadOnlyList<string> Upgrades, int Achievements, IReadOnlyDictionary<string, int> Facilities, double FrenzyUntil,
        double FrenzyMult, double LastSeen, int Deliveries, int Generations);

    /// <summary>Reads (and sanitises) the fields the server needs from an untrusted save.</summary>
    public static State Read(JsonObject s)
    {
        static double Num(JsonNode? n, double d = 0) => n is JsonValue v && v.TryGetValue<double>(out var x) && double.IsFinite(x) && x >= 0 ? x : d;
        var gens = new Dictionary<string, int>();
        foreach (var id in GeneratorCps.Keys) gens[id] = (int)Math.Floor(Num(s["generators"]?[id]));
        var ups = (s["upgrades"] as JsonArray)?.Select(u => u?.GetValue<string>() ?? "").Where(Effects.ContainsKey).Distinct().ToList() ?? [];
        var fac = new Dictionary<string, int>();
        if (s["facilities"] is JsonObject f)
            foreach (var (k, v) in f) fac[k] = (int)Math.Clamp(Math.Floor(Num(v, 1)), 1, 5);
        var del = s["stats"]?["deliveries"];
        return new State(
            Num(s["coins"]), Num(s["lifetime"]), Num(s["lifetimeAllTime"]), (int)Num(s["tokens"]), gens, ups,
            (s["achievements"] as JsonArray)?.Count ?? 0, fac, Num(s["frenzyUntil"]), Num(s["frenzyMult"], 1), Num(s["lastSeen"]),
            (int)(Num(del?["road"]) + Num(del?["air"]) + Num(del?["sea"])), (int)Num(s["stats"]?["generations"]));
    }

    public static double GlobalMultiplier(State s, double nowMs)
    {
        var mult = 1 + s.Tokens * 0.02;
        foreach (var u in s.Upgrades) if (Effects[u].Kind == "all") mult *= Effects[u].Value;
        mult *= 1 + s.Achievements * 0.01;
        foreach (var lvl in s.Facilities.Values) mult *= 1 + (lvl - 1) * 0.04;
        if (nowMs < s.FrenzyUntil) mult *= s.FrenzyMult > 0 ? s.FrenzyMult : 1;
        return mult;
    }

    public static double CoinsPerSecond(State s, double nowMs)
    {
        double total = 0;
        foreach (var (id, cps) in GeneratorCps)
        {
            var m = 1.0;
            foreach (var u in s.Upgrades)
            {
                var e = Effects[u];
                if (e.Kind == "gen" && e.Target == id) m *= e.Value;
            }
            total += cps * s.Generators.GetValueOrDefault(id) * m;
        }
        return total * GlobalMultiplier(s, nowMs);
    }

    public static double OfflineCapHours(State s) => BaseOfflineHours + s.Upgrades.Where(u => Effects[u].Kind == "offlineCap").Sum(u => Effects[u].Value);

    public static double OfflineRate(State s) => s.Upgrades.Where(u => Effects[u].Kind == "offlineRate").Select(u => Effects[u].Value).DefaultIfEmpty(BaseOfflineRate).Max();

    public sealed record Offline(double Seconds, double CappedSeconds, double Earned, double Rate, double CapHours);

    public static Offline OfflineEarnings(State s, double nowMs)
    {
        var seconds = Math.Max(0, (nowMs - s.LastSeen) / 1000);
        var capHours = OfflineCapHours(s);
        var capped = Math.Min(seconds, capHours * 3600);
        var rate = OfflineRate(s);
        var cps = CoinsPerSecond(s with { FrenzyUntil = 0 }, nowMs);
        return new Offline(seconds, capped, cps * capped * rate, rate, capHours);
    }

    /// <summary>
    /// Generous anti-cheat: lifetime earnings can't outrun the fleet (×12 covers frenzies, delivery
    /// bonuses and rush orders) plus a flat allowance for clicking.
    /// </summary>
    public static bool IsPlausible(State previous, State next, double elapsedSeconds, double nowMs)
    {
        var cps = Math.Max(CoinsPerSecond(previous, nowMs), CoinsPerSecond(next, nowMs));
        var allowance = cps * Math.Max(1, elapsedSeconds) * 12 + 250_000 * (1 + elapsedSeconds / 60) + previous.LifetimeAllTime * 0.05;
        return next.LifetimeAllTime <= previous.LifetimeAllTime + allowance;
    }
}

/// <summary>Port of NeuralNetwork.isValid: untrusted brains must be well-formed before storage.</summary>
public static class BrainValidator
{
    public static bool IsValid(JsonNode? network)
    {
        if (network?["levels"] is not JsonArray levels || levels.Count is 0 or > 8) return false;
        foreach (var l in levels)
        {
            if (l is not JsonObject level) return false;
            if (level["inputs"] is not JsonArray inputs || level["outputs"] is not JsonArray outputs) return false;
            if (level["biases"] is not JsonArray biases || level["weights"] is not JsonArray weights) return false;
            if (inputs.Count > 64 || outputs.Count > 64 || biases.Count != outputs.Count || weights.Count != inputs.Count) return false;
            if (!biases.All(IsFinite)) return false;
            foreach (var row in weights)
                if (row is not JsonArray r || r.Count != outputs.Count || !r.All(IsFinite)) return false;
        }
        return true;
    }

    private static bool IsFinite(JsonNode? n) => n is JsonValue v && v.TryGetValue<double>(out var d) && double.IsFinite(d);
}
