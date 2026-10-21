<?php
/**
 * Plugin Name:       Terra Fleet
 * Plugin URI:        https://github.com/terra-sim/terra
 * Description:       Connects WordPress to the Terra logistics sim: Dispatch issues for the app's headless CMS, plus live leaderboard and network shortcodes.
 * Version:           1.0.0
 * Requires at least: 6.4
 * Requires PHP:      8.1
 * Author:            Terra
 * License:           MIT
 * Text Domain:       terra-fleet
 *
 * @package TerraFleet
 */

declare(strict_types=1);

namespace TerraFleet;

if (!defined('ABSPATH')) {
    exit;
}

const VERSION      = '1.0.0';
const OPTION_API   = 'terra_fleet_api_url';
const OPTION_APP   = 'terra_fleet_app_url';
const CACHE_PREFIX = 'terra_fleet_';

require_once __DIR__ . '/includes/class-api-client.php';
require_once __DIR__ . '/includes/shortcodes.php';
require_once __DIR__ . '/includes/settings.php';
require_once __DIR__ . '/includes/rest.php';

/**
 * Dispatch issue numbers live in post meta and are exposed to the REST API,
 * which the Terra API reads as `terra_issue`.
 */
add_action('init', static function (): void {
    register_post_meta('post', 'terra_issue', [
        'type'              => 'integer',
        'single'            => true,
        'show_in_rest'      => true,
        'sanitize_callback' => 'absint',
        'auth_callback'     => static fn (): bool => current_user_can('edit_posts'),
    ]);
});

add_action('rest_api_init', static function (): void {
    register_rest_field('post', 'terra_issue', [
        'get_callback' => static fn (array $post): int => (int) get_post_meta((int) $post['id'], 'terra_issue', true),
        'schema'       => ['type' => 'integer', 'context' => ['view', 'edit']],
    ]);
});

add_action('wp_enqueue_scripts', static function (): void {
    wp_register_style('terra-fleet', plugins_url('assets/terra.css', __FILE__), [], VERSION);
});

register_activation_hook(__FILE__, static function (): void {
    add_option(OPTION_API, 'http://api:8080');
    add_option(OPTION_APP, 'http://localhost:8081');
});
