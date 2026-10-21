using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Channels;
using Microsoft.Extensions.Caching.Memory;
using Terra.Api.Logistics;

namespace Terra.Api.Integrations;

public sealed record CmsPost(string Id, string Title, string Excerpt, string Date, string Link, int Issue);

/// <summary>
/// WordPress as a headless CMS: "Dispatches" are posts on the Terra WordPress site.
/// The terra-fleet plugin exposes an issue number on each post (terra_issue).
/// </summary>
public sealed partial class WordPressCms(HttpClient http, IMemoryCache cache, IConfiguration config, ILogger<WordPressCms> log)
{
    public bool Configured => !string.IsNullOrWhiteSpace(config["WordPress:BaseUrl"]);

    public async Task<IReadOnlyList<CmsPost>> GetPostsAsync(CancellationToken ct)
    {
        if (!Configured) return [];
        return await cache.GetOrCreateAsync("cms:posts", async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(5);
            try
            {
                var url = $"{config["WordPress:BaseUrl"]!.TrimEnd('/')}/wp-json/wp/v2/posts?per_page=6&_fields=id,title,excerpt,date,link,terra_issue";
                var raw = await http.GetFromJsonAsync<JsonElement[]>(url, ct) ?? [];
                return (IReadOnlyList<CmsPost>)raw.Select((p, i) => new CmsPost(
                    p.GetProperty("id").ToString(),
                    StripHtml(p.GetProperty("title").GetProperty("rendered").GetString()),
                    StripHtml(p.GetProperty("excerpt").GetProperty("rendered").GetString()),
                    p.GetProperty("date").GetString() ?? "",
                    p.GetProperty("link").GetString() ?? "",
                    p.TryGetProperty("terra_issue", out var issue) && issue.TryGetInt32(out var n) ? n : raw.Length - i)).ToList();
            }
            catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or JsonException or KeyNotFoundException or InvalidOperationException)
            {
                log.LogWarning(ex, "WordPress unavailable");
                entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromSeconds(30);
                return [];
            }
        }) ?? [];
    }

    private static string StripHtml(string? html) => System.Net.WebUtility.HtmlDecode(TagRegex().Replace(html ?? "", "")).Trim();

    [GeneratedRegex("<[^>]+>")]
    private static partial Regex TagRegex();
}

/// <summary>
/// Sends critical logistics events to a Power Automate "When an HTTP request is received" flow.
/// Payloads are HMAC-SHA256 signed (X-Terra-Signature) and throttled per event type.
/// </summary>
public sealed class PowerAutomateNotifier(IHttpClientFactory httpFactory, IConfiguration config, ILogger<PowerAutomateNotifier> log) : BackgroundService
{
    private readonly Channel<LogisticsEvent> _queue = Channel.CreateBounded<LogisticsEvent>(new BoundedChannelOptions(100) { FullMode = BoundedChannelFullMode.DropOldest });
    private readonly Dictionary<string, DateTime> _lastSent = new();
    public int Sent { get; private set; }

    public bool Configured => !string.IsNullOrWhiteSpace(config["Webhooks:PowerAutomateUrl"]);

    public void Enqueue(LogisticsEvent e)
    {
        if (Configured) _queue.Writer.TryWrite(e);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await foreach (var e in _queue.Reader.ReadAllAsync(stoppingToken))
        {
            if (_lastSent.TryGetValue(e.Type, out var last) && DateTime.UtcNow - last < TimeSpan.FromSeconds(30)) continue;
            _lastSent[e.Type] = DateTime.UtcNow;
            await SendAsync(e, stoppingToken);
        }
    }

    public async Task<bool> SendAsync(LogisticsEvent e, CancellationToken ct)
    {
        var url = config["Webhooks:PowerAutomateUrl"];
        if (string.IsNullOrWhiteSpace(url)) return false;
        var body = JsonSerializer.Serialize(new
        {
            source = "terra",
            e.Type,
            e.Severity,
            e.ShipmentId,
            e.Mode,
            e.Message,
            occurredAt = DateTimeOffset.FromUnixTimeMilliseconds((long)e.At).ToString("O"),
            dashboardUrl = $"{config["App:PublicUrl"]?.TrimEnd('/')}/dashboard?tab=shipments&q={e.ShipmentId}",
        }, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        var secret = config["Webhooks:Secret"];
        var signature = string.IsNullOrEmpty(secret)
            ? null
            : "sha256=" + Convert.ToHexString(HMACSHA256.HashData(Encoding.UTF8.GetBytes(secret), Encoding.UTF8.GetBytes(body))).ToLowerInvariant();
        for (var attempt = 1; attempt <= 3; attempt++)
        {
            // a request message can only be sent once, so each attempt builds its own
            using var req = new HttpRequestMessage(HttpMethod.Post, url) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
            if (signature is not null) req.Headers.Add("X-Terra-Signature", signature);
            try
            {
                using var res = await httpFactory.CreateClient("webhooks").SendAsync(req, ct);
                if (res.IsSuccessStatusCode)
                {
                    Sent++;
                    return true;
                }
                log.LogWarning("Power Automate returned {Status}", (int)res.StatusCode);
            }
            catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
            {
                log.LogWarning(ex, "Power Automate webhook failed (attempt {Attempt})", attempt);
            }
            if (attempt < 3) await Task.Delay(TimeSpan.FromSeconds(attempt * 2), ct);
        }
        return false;
    }
}
