<?php

/*
Plugin Name: Conekta Payment Gateway
Plugin URI: https://wordpress.org/plugins/conekta-payment-gateway/
Description: Payment Gateway through Conekta.io for Woocommerce for both credit and debit cards as well as cash payments  and monthly installments for Mexican credit cards.
Version: 5.4.3
Requires at least: 6.6.2
Requires PHP: 7.4
Author: Conekta.io
Author URI: https://www.conekta.io
License: GNU General Public License v3.0
License URI: http://www.gnu.org/licenses/gpl-3.0.html
*/

/*
 * Title   : Conekta Payment Extension for WooCommerce
 * Author  : Conekta.io
 * Url     : https://www.conekta.io/es/docs/plugins/woocommerce
 */

function ckpg_conekta_checkout_init_your_gateway()
{
    if (class_exists('WC_Payment_Gateway'))
    {
    
        include_once('conekta_gateway_helper.php');
        include_once('conekta_plugin.php');
        include_once('conekta_block_gateway.php');
        include_once('conekta_cash_block_gateway.php');
        include_once('conekta_bnpl_block_gateway.php');
        include_once('conekta_bank_transfer_block_gateway.php');

    }
}

add_action('plugins_loaded', 'ckpg_conekta_checkout_init_your_gateway', 0);

add_filter( 'plugin_action_links_' . plugin_basename( __FILE__ ), 'plugin_action_links' );

function plugin_action_links( $links  ): array
{
    $plugin_links = [
        '<a href="admin.php?page=wc-settings&tab=checkout&section=conekta">' . esc_html__( 'Settings', 'WC_Conekta_Gateway' ) . '</a>',
    ];
    return array_merge( $plugin_links, $links );
}

add_action('wp_enqueue_scripts', 'ckpg_enqueue_classic_checkout_script');

function ckpg_enqueue_classic_checkout_script() {
    if (is_checkout() && ! is_wc_endpoint_url()) {
        $available_gateways = WC()->payment_gateways()->get_available_payment_gateways();

        if (isset($available_gateways['conekta'])) {
            wp_enqueue_script(
                'conekta-checkout-classic',
                'https://pay.conekta.com/v1.0/js/conekta-checkout.min.js',
                [],
                null,
                true
            );

            // Enqueue translations
            $translations_path = 'resources/js/frontend/classic-translations.js';
            $translations_url = plugin_dir_url(__FILE__) . $translations_path;
            $translations_path = plugin_dir_path(__FILE__) . $translations_path;

            wp_enqueue_script(
                'conekta-classic-translations',
                $translations_url,
                [],
                file_exists($translations_path) ? filemtime($translations_path) : null,
                true
            );

            $script_path = 'resources/js/frontend/classic-checkout.js';
            $script_url = plugin_dir_url(__FILE__) . $script_path;
            $script_path = plugin_dir_path(__FILE__) . $script_path;

            wp_enqueue_script(
                'conekta-classic-checkout',
                $script_url,
                ['conekta-checkout-classic', 'conekta-classic-translations'],
                file_exists($script_path) ? filemtime($script_path) : null,
                true
            );

            $settings = get_option('woocommerce_conekta_settings');
            $locale = get_locale();
            $short_locale = substr($locale, 0, 2);
            $gateway = $available_gateways['conekta'];

            // Get cart items for classic checkout
            $cart_items = [];
            if (WC()->cart && !WC()->cart->is_empty()) {
                foreach (WC()->cart->get_cart() as $cart_item_key => $cart_item) {
                    $product = $cart_item['data'];
                    $cart_items[] = [
                        'id' => $cart_item['product_id'],
                        'name' => $product->get_name(),
                        'quantity' => $cart_item['quantity'],
                        'total' => $cart_item['line_total'] * 100, // Convert to cents
                        'variation_id' => $cart_item['variation_id'] ?? null
                    ];
                }
            }

            wp_localize_script('conekta-classic-checkout', 'conekta_settings', [
                'public_key' => $settings['cards_public_api_key'] ?? '',
                'enable_msi' => $settings['is_msi_enabled'] ?? 'no',
                'available_msi_options' => array_map('intval', (array)($settings['months'] ?? [])),
                'amount' => WC()->cart->get_total('edit') * 100,
                'currency' => get_woocommerce_currency(),
                'cart_items' => $cart_items,
                'locale' => $short_locale,
                'three_ds_enabled' => $gateway->three_ds_enabled,
                'three_ds_mode' => $gateway->three_ds_mode
            ]);
        }
    }
}