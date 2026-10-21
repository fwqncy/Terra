<?php
/**
 * Settings → Terra Fleet: where the Terra API and the app live.
 *
 * @package TerraFleet
 */

declare(strict_types=1);

namespace TerraFleet;

if (!defined('ABSPATH')) {
    exit;
}

add_action('admin_init', static function (): void {
    foreach ([OPTION_API => __('Terra API URL', 'terra-fleet'), OPTION_APP => __('Terra app URL', 'terra-fleet')] as $option => $label) {
        register_setting('terra_fleet', $option, [
            'type'              => 'string',
            'sanitize_callback' => static function ($value) use ($option): string {
                $url = esc_url_raw(trim((string) $value), ['http', 'https']);
                if ($url === '') {
                    add_settings_error($option, 'invalid', __('Enter a full http(s) URL.', 'terra-fleet'));
                    return (string) get_option($option);
                }
                // Clear cached API responses when the address changes.
                global $wpdb;
                $wpdb->query($wpdb->prepare("DELETE FROM {$wpdb->options} WHERE option_name LIKE %s", '_transient_' . CACHE_PREFIX . '%'));
                return untrailingslashit($url);
            },
        ]);
        add_settings_field($option, $label, static function () use ($option): void {
            printf(
                '<input type="url" class="regular-text code" id="%1$s" name="%1$s" value="%2$s" autocomplete="off" spellcheck="false" />',
                esc_attr($option),
                esc_attr((string) get_option($option))
            );
        }, 'terra_fleet', 'terra_fleet_main', ['label_for' => $option]);
    }
    add_settings_section('terra_fleet_main', '', static function (): void {
        echo '<p>' . esc_html__('Shortcodes: [terra_leaderboard take="10"], [terra_network], [terra_play label="Play Terra" path="/city"].', 'terra-fleet') . '</p>';
    }, 'terra_fleet');
});

add_action('admin_menu', static function (): void {
    add_options_page(__('Terra Fleet', 'terra-fleet'), __('Terra Fleet', 'terra-fleet'), 'manage_options', 'terra-fleet', static function (): void {
        if (!current_user_can('manage_options')) {
            return;
        }
        $health = Api_Client::from_options()->get('/api/health', 10);
        ?>
        <div class="wrap">
            <h1><?php esc_html_e('Terra Fleet', 'terra-fleet'); ?></h1>
            <p>
                <?php esc_html_e('API status:', 'terra-fleet'); ?>
                <strong><?php echo $health ? esc_html__('Connected', 'terra-fleet') : esc_html__('Not reachable', 'terra-fleet'); ?></strong>
            </p>
            <form action="options.php" method="post">
                <?php
                settings_fields('terra_fleet');
                do_settings_sections('terra_fleet');
                submit_button(__('Save Settings', 'terra-fleet'));
                ?>
            </form>
        </div>
        <?php
    });
});
