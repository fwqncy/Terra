<?php
/**
 * Removes Terra Fleet options and cached API responses.
 *
 * @package TerraFleet
 */

if (!defined('WP_UNINSTALL_PLUGIN')) {
    exit;
}

delete_option('terra_fleet_api_url');
delete_option('terra_fleet_app_url');
global $wpdb;
$wpdb->query("DELETE FROM {$wpdb->options} WHERE option_name LIKE '\\_transient\\_terra\\_fleet\\_%' OR option_name LIKE '\\_transient\\_timeout\\_terra\\_fleet\\_%'");
