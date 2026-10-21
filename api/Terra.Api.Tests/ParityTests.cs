using System.Text.Json.Nodes;
using Terra.Api.Game;
using Terra.Api.Logistics;

namespace Terra.Api.Tests;

/// <summary>
/// The browser engine (JavaScript) and the API (C#) must agree. Fixtures come from
/// tools/parity-fixtures.mjs running the real JS engine with a fixed seed and clock.
/// </summary>
public sealed class ParityTests
{
    private static readonly JsonObject Fixture = JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "parity.json")))!.AsObject();

    private static void Close(double expected, double actual, string what, double tol = 1e-9)
    {
        var scale = Math.Max(1, Math.Abs(expected));
        Assert.True(Math.Abs(expected - actual) <= tol * scale, $"{what}: expected {expected}, got {actual}");
    }

    private static LogisticsSimulator Sim()
    {
        var l = Fixture["logistics"]!;
        var sim = new LogisticsSimulator((uint)l["seed"]!.GetValue<int>(), Fixture["now"]!.GetValue<double>(), l["warmupHours"]!.GetValue<double>());
        sim.Advance(l["advanceMinutes"]!.GetValue<double>(), 1);
        return sim;
    }

    [Fact]
    public void Simulator_ProducesTheSameShipmentsAsTheBrowser()
    {
        var sim = Sim();
        var l = Fixture["logistics"]!;
        Assert.Equal(l["time"]!.GetValue<double>(), sim.Time);
        Assert.Equal(l["shipmentCount"]!.GetValue<int>(), sim.Shipments.Count);
        var expected = l["firstShipments"]!.AsArray();
        for (var i = 0; i < expected.Count; i++)
        {
            var e = expected[i]!;
            var s = sim.Shipments[i];
            Assert.Equal(e["id"]!.GetValue<string>(), s.Id);
            Assert.Equal(e["mode"]!.GetValue<string>(), s.Mode);
            Assert.Equal(e["destination"]!.GetValue<string>(), s.Destination);
            Assert.Equal(e["carrier"]!.GetValue<string>(), s.Carrier);
            Assert.Equal(e["customer"]!.GetValue<string>(), s.Customer);
            Assert.Equal(e["priority"]!.GetValue<string>(), s.Priority);
            Assert.Equal(e["status"]!.GetValue<string>(), s.Status);
            Close(e["weightKg"]!.GetValue<double>(), s.WeightKg, $"{s.Id} weight");
            Close(e["costAud"]!.GetValue<double>(), s.CostAud, $"{s.Id} cost");
            Close(e["co2Kg"]!.GetValue<double>(), s.Co2Kg, $"{s.Id} co2");
            Close(e["etaAt"]!.GetValue<double>(), s.EtaAt, $"{s.Id} eta");
        }
    }

    [Fact]
    public void Snapshot_KpisMatchTheBrowser()
    {
        var snap = Sim().Snapshot();
        var k = Fixture["logistics"]!["kpis"]!;
        Close(k["otd"]!.GetValue<double>(), snap.Kpis.Otd, "otd");
        Assert.Equal(k["delivered24h"]!.GetValue<int>(), snap.Kpis.Delivered24h);
        Assert.Equal(k["inTransit"]!.GetValue<int>(), snap.Kpis.InTransit);
        Assert.Equal(k["booked"]!.GetValue<int>(), snap.Kpis.Booked);
        Assert.Equal(k["delayed"]!.GetValue<int>(), snap.Kpis.Delayed);
        Assert.Equal(k["exceptions"]!.GetValue<int>(), snap.Kpis.Exceptions);
        Close(k["revenue24h"]!.GetValue<double>(), snap.Kpis.Revenue24h, "revenue");
        Close(k["co2Kg24h"]!.GetValue<double>(), snap.Kpis.Co2Kg24h, "co2");
        Close(k["co2PerTkm"]!.GetValue<double>(), snap.Kpis.Co2PerTkm, "co2/tkm");
        Close(k["costPerKg"]!.GetValue<double>(), snap.Kpis.CostPerKg, "cost/kg");
        Close(k["avgTransitH"]!["road"]!.GetValue<double>(), snap.Kpis.AvgTransitH.Road, "transit road");
        Close(k["utilization"]!["sea"]!.GetValue<double>(), snap.Kpis.Utilization.Sea, "utilization sea");
    }

    [Fact]
    public void Snapshot_SeriesLanesHubsAndDeparturesMatchTheBrowser()
    {
        var snap = Sim().Snapshot();
        var l = Fixture["logistics"]!;
        var totals = l["seriesTotals"]!;
        Assert.Equal(totals["road"]!.GetValue<int>(), snap.Series.Sum(p => p.Road));
        Assert.Equal(totals["air"]!.GetValue<int>(), snap.Series.Sum(p => p.Air));
        Assert.Equal(totals["sea"]!.GetValue<int>(), snap.Series.Sum(p => p.Sea));
        Assert.Equal(totals["onTime"]!.GetValue<int>(), snap.Series.Sum(p => p.OnTime));
        Assert.Equal(totals["late"]!.GetValue<int>(), snap.Series.Sum(p => p.Late));

        var lanes = l["topLanes"]!.AsArray();
        for (var i = 0; i < lanes.Count; i++)
        {
            Assert.Equal(lanes[i]!["lane"]!.GetValue<string>(), snap.Lanes[i].Lane);
            Assert.Equal(lanes[i]!["volume"]!.GetValue<int>(), snap.Lanes[i].Volume);
        }
        var hubs = l["hubs"]!.AsArray();
        for (var i = 0; i < hubs.Count; i++) Close(hubs[i]!["occupancy"]!.GetValue<double>(), snap.Hubs[i].Occupancy, $"hub {i}");
        Assert.Equal(l["departures"]!.AsArray().Select(d => d!.GetValue<string>()), snap.Departures.Take(5).Select(d => d.Id));
    }

    [Fact]
    public void Economy_CoinsPerSecondAndOfflineEarningsMatchTheBrowser()
    {
        var now = Fixture["now"]!.GetValue<double>();
        foreach (var c in Fixture["economy"]!.AsArray())
        {
            var name = c!["name"]!.GetValue<string>();
            var state = Economy.Read(c["state"]!.AsObject());
            Close(c["cps"]!.GetValue<double>(), Economy.CoinsPerSecond(state, now), $"{name} cps");
            var off = Economy.OfflineEarnings(state, now);
            Close(c["offline"]!["earned"]!.GetValue<double>(), off.Earned, $"{name} offline earned");
            Close(c["offline"]!["capHours"]!.GetValue<double>(), off.CapHours, $"{name} cap");
            Close(c["offline"]!["rate"]!.GetValue<double>(), off.Rate, $"{name} rate");
        }
    }

    [Theory]
    [InlineData(1u, new[] { 0.6270739405881613, 0.002735721180215478, 0.5274470399599522 })]
    [InlineData(2032u, new[] { 0.2050372799858451, 0.3276770126540214 })]
    public void Rng_MatchesTheJavaScriptMulberry32(uint seed, double[] expected)
    {
        // reference values printed by createRng(seed).next() in engine/math/rng.js
        var r = new Rng(seed);
        foreach (var e in expected) Assert.Equal(e, r.Next());
    }

    [Fact]
    public void JsRound_RoundsHalvesUpLikeJavaScript()
    {
        Assert.Equal(3, Rng.JsRound(2.5));
        Assert.Equal(-2, Rng.JsRound(-2.5));
        Assert.Equal(1, Rng.JsRound(0.5));
    }
}
