<?php
/**
 * REST: GET /wp-json/terra/v1/leaderboard — a cached proxy so headless pages and
 * Power Automate can read the leaderboard from the WordPress origin.
 *
 * @package TerraFleet
 */

declare(strict_types=1);

namespace TerraFleet;

use WP_REST_Request;
use WP_REST_Response;

if (!defined('ABSPATH')) {
    exit;
}

add_action('rest_api_init', static function (): void {
    register_rest_route('terra/v1', '/leaderboard', [
        'methods'             => 'GET',
        'permission_callback' => '__return_true',
        'args'                => [
            'take' => [
                'type'              => 'integer',
                'default'           => 10,
                'minimum'           => 1,
                'maximum'           => 50,
                'sanitize_callback' => 'absint',
            ],
        ],
        'callback'            => static function (WP_REST_Request $request): WP_REST_Response {
            $rows     = Api_Client::from_options()->leaderboard((int) $request->get_param('take'));
            $response = new WP_REST_Response(['rows' => $rows, 'source' => 'terra-api'], 200);
            $response->header('Cache-Control', 'public, max-age=60');
            return $response;
        },
    ]);
});
