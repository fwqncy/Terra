<?php
/**
 * Small, cached client for the Terra .NET API.
 *
 * @package TerraFleet
 */

declare(strict_types=1);

namespace TerraFleet;

if (!defined('ABSPATH')) {
    exit;
}

final class Api_Client
{
    public function __construct(private readonly string $base_url)
    {
    }

    public static function from_options(): self
    {
        return new self(untrailingslashit((string) get_option(OPTION_API, 'http://api:8080')));
    }

    /**
     * GET a JSON endpoint, cached in a transient so page views never hammer the API.
     *
     * @return array<mixed>|null Decoded JSON, or null when the API is unreachable.
     */
    public function get(string $path, int $ttl = 60): ?array
    {
        $key    = CACHE_PREFIX . md5($this->base_url . $path);
        $cached = get_transient($key);
        if (is_array($cached)) {
            return $cached;
        }
        if (get_transient($key . '_down')) {
            return null;
        }

        $response = wp_remote_get($this->base_url . $path, [
            'timeout' => 4,
            'headers' => ['Accept' => 'application/json'],
        ]);
        if (is_wp_error($response) || wp_remote_retrieve_response_code($response) !== 200) {
            // Remember the failure briefly so a down API doesn't slow every page.
            set_transient($key . '_down', 1, 15);
            return null;
        }

        $data = json_decode(wp_remote_retrieve_body($response), true);
        if (!is_array($data)) {
            return null;
        }
        set_transient($key, $data, $ttl);
        return $data;
    }

    /** @return list<array{rank:int,name:string,lifetime:float,deliveries:int,tokens:int}> */
    public function leaderboard(int $take = 10): array
    {
        $rows = $this->get('/api/leaderboard?take=' . max(1, min(50, $take)));
        return is_array($rows) ? array_values($rows) : [];
    }

    /** @return array<string,mixed>|null */
    public function snapshot(): ?array
    {
        return $this->get('/api/logistics/snapshot', 30);
    }
}
