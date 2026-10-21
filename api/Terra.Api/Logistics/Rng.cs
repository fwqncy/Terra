namespace Terra.Api.Logistics;

/// <summary>
/// Mulberry32 — bit-for-bit identical to engine/math/rng.js so the server and the browser
/// produce the same simulated network from the same seed.
/// </summary>
public sealed class Rng(uint seed)
{
    private uint _a = seed;

    public double Next()
    {
        unchecked
        {
            _a += 0x6d2b79f5;
            var t = _a;
            t = (uint)((int)(t ^ (t >> 15)) * (int)(t | 1));
            t ^= t + (uint)((int)(t ^ (t >> 7)) * (int)(t | 61));
            return (t ^ (t >> 14)) / 4294967296.0;
        }
    }

    public double Range(double min, double max) => min + (max - min) * Next();

    public T Pick<T>(IReadOnlyList<T> items) => items[(int)Math.Floor(Next() * items.Count)];

    public bool Chance(double p) => Next() < p;

    /// <summary>JavaScript Math.round (half rounds up), unlike .NET's banker's rounding.</summary>
    public static double JsRound(double v) => Math.Floor(v + 0.5);
}
