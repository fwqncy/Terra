<?php
/**
 * Shortcodes: [terra_leaderboard take="10"], [terra_network], [terra_play label="Play Terra"].
 * All output is escaped; data comes from the cached API client.
 *
 * @package TerraFleet
 */

declare(strict_types=1);

namespace TerraFleet;

if (!defined('ABSPATH')) {
    exit;
}

/**
 * Compact numbers like the app (12.3K, 4.5M) using the site locale's decimal point.
 */
function compact_number(float $value): string
{
    $units = ['', 'K', 'M', 'B', 'T'];
    $i     = 0;
    while (abs($value) >= 1000 && $i < count($units) - 1) {
        $value /= 1000;
        $i++;
    }
    return number_format_i18n($value, $i === 0 ? 0 : 1) . $units[$i];
}

add_shortcode('terra_leaderboard', static function ($atts): string {
    $atts = shortcode_atts(['take' => 10, 'title' => __('Top depots', 'terra-fleet')], (array) $atts, 'terra_leaderboard');
    wp_enqueue_style('terra-fleet');
    $rows = Api_Client::from_options()->leaderboard((int) $atts['take']);

    ob_start();
    ?>
    <section class="terra-card" aria-label="<?php echo esc_attr($atts['title']); ?>">
        <h3 class="terra-title"><?php echo esc_html($atts['title']); ?></h3>
        <?php if (!$rows) : ?>
            <p class="terra-empty"><?php esc_html_e('The leaderboard is warming up. Check back after the first fleets sync.', 'terra-fleet'); ?></p>
        <?php else : ?>
            <table class="terra-table">
                <thead>
                    <tr>
                        <th scope="col">#</th>
                        <th scope="col"><?php esc_html_e('Depot', 'terra-fleet'); ?></th>
                        <th scope="col" class="num"><?php esc_html_e('Coins earned', 'terra-fleet'); ?></th>
                        <th scope="col" class="num"><?php esc_html_e('Deliveries', 'terra-fleet'); ?></th>
                    </tr>
                </thead>
                <tbody>
                <?php foreach ($rows as $row) : ?>
                    <tr>
                        <td><?php echo esc_html((string) (int) ($row['rank'] ?? 0)); ?></td>
                        <td><?php echo esc_html((string) ($row['name'] ?? '')); ?></td>
                        <td class="num"><?php echo esc_html(compact_number((float) ($row['lifetime'] ?? 0))); ?></td>
                        <td class="num"><?php echo esc_html(number_format_i18n((int) ($row['deliveries'] ?? 0))); ?></td>
                    </tr>
                <?php endforeach; ?>
                </tbody>
            </table>
        <?php endif; ?>
    </section>
    <?php
    return (string) ob_get_clean();
});

add_shortcode('terra_network', static function (): string {
    wp_enqueue_style('terra-fleet');
    $snap = Api_Client::from_options()->snapshot();
    if (!$snap || !isset($snap['kpis'])) {
        return '<p class="terra-empty">' . esc_html__('Live network numbers are unavailable right now.', 'terra-fleet') . '</p>';
    }
    $k     = $snap['kpis'];
    $tiles = [
        __('On-time delivery', 'terra-fleet') => number_format_i18n(((float) $k['otd']) * 100, 1) . '%',
        __('In transit', 'terra-fleet')       => number_format_i18n((int) $k['inTransit']),
        __('Delayed', 'terra-fleet')          => number_format_i18n((int) $k['delayed']),
        __('CO₂ (24 h)', 'terra-fleet')       => number_format_i18n(((float) $k['co2Kg24h']) / 1000, 1) . ' t',
    ];

    ob_start();
    ?>
    <section class="terra-card terra-network" aria-label="<?php esc_attr_e('Live Brisbane network', 'terra-fleet'); ?>">
        <span class="terra-caption"><?php esc_html_e('Live from the depot', 'terra-fleet'); ?></span>
        <dl class="terra-tiles">
            <?php foreach ($tiles as $label => $value) : ?>
                <div><dt><?php echo esc_html($label); ?></dt><dd><?php echo esc_html($value); ?></dd></div>
            <?php endforeach; ?>
        </dl>
    </section>
    <?php
    return (string) ob_get_clean();
});

add_shortcode('terra_play', static function ($atts): string {
    $atts = shortcode_atts(['label' => __('Play Terra', 'terra-fleet'), 'path' => '/city'], (array) $atts, 'terra_play');
    wp_enqueue_style('terra-fleet');
    $url = untrailingslashit((string) get_option(OPTION_APP, 'http://localhost:8081')) . '/' . ltrim((string) $atts['path'], '/');
    return sprintf('<a class="terra-button" href="%s">%s &rarr;</a>', esc_url($url), esc_html($atts['label']));
});
