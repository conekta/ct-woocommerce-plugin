<?php

/*
Plugin Name: Conekta Payment Gateway
Plugin URI: https://wordpress.org/plugins/conekta-payment-gateway/
Description: Payment Gateway through Conekta.io for Woocommerce for both credit and debit cards as well as cash payments  and monthly installments for Mexican credit cards.
Version: 5.4.12
Requires at least: 6.6.2
Requires PHP: 7.4
Author: Conekta.io
Author URI: https://www.conekta.com
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
        include_once('conekta_pay_by_bank_block_gateway.php');

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

            // Cart snapshot (same structure used by the fragment update)
            $cart_snapshot = ckpg_build_conekta_cart_snapshot();

            // Get shipping information
            $shipping_cost = 0;
            $shipping_method_id = '';
            $shipping_method_label = '';

            if (WC()->cart && !WC()->cart->is_empty()) {
                $shipping_cost = amount_validation(WC()->cart->get_shipping_total());
                $chosen_methods = WC()->session->get('chosen_shipping_methods');
                if (!empty($chosen_methods) && is_array($chosen_methods)) {
                    $shipping_method_id = $chosen_methods[0];

                    $packages = WC()->shipping()->get_packages();
                    foreach ($packages as $package_key => $package) {
                        if (isset($package['rates'][$shipping_method_id])) {
                            $rate = $package['rates'][$shipping_method_id];
                            $shipping_method_label = $rate->get_label();
                            break;
                        }
                    }
                }
            }

            wp_localize_script('conekta-classic-checkout', 'conekta_settings', [
                'public_key' => $settings['cards_public_api_key'] ?? '',
                'enable_msi' => $settings['is_msi_enabled'] ?? 'no',
                'available_msi_options' => array_map('intval', (array)($settings['months'] ?? [])),
                'amount' => $cart_snapshot['amount'] ?? 0,
                'currency' => get_woocommerce_currency(),
                'cart_items' => $cart_snapshot['cart_items'] ?? [],
                'shipping_cost' => $shipping_cost,
                'shipping_method_id' => $shipping_method_id,
                'shipping_method_label' => $shipping_method_label,
                'discount_lines' => $cart_snapshot['discount_lines'] ?? [],
                'locale' => $short_locale,
                'three_ds_enabled' => $gateway->three_ds_enabled,
                'three_ds_mode' => $gateway->three_ds_mode,
                'checkout_url' => \WC_AJAX::get_endpoint('checkout'),
                'rest_url' => esc_url_raw(rest_url('conekta/v1/')),
                'create_3ds_order_url' => \WC_AJAX::get_endpoint('conekta_create_3ds_order'),
                'nonce' => wp_create_nonce('conekta-create-3ds-order')
            ]);
        }
    }
}

/**
 * Build discount lines from WC cart:
 *   1. Native coupons
 *   2. Negative fees (dynamic pricing plugins)
 *   3. Price-level discounts (regular_price vs effective cart price)
 */
function ckpg_build_conekta_discount_lines(): array {
    $discount_lines = [];
    if (!WC()->cart || WC()->cart->is_empty()) {
        return $discount_lines;
    }

    // Native WooCommerce coupons
    foreach (WC()->cart->get_applied_coupons() as $coupon_code) {
        $discount_amount = WC()->cart->get_coupon_discount_amount($coupon_code);
        if ($discount_amount > 0) {
            $discount_lines[] = [
                'code'   => $coupon_code,
                'amount' => amount_validation($discount_amount),
                'type'   => 'coupon',
            ];
        }
    }

    // Fee-based discounts (dynamic pricing plugins often add negative fees)
    foreach (WC()->cart->get_fees() as $fee) {
        if ($fee->total < 0) {
            $discount_lines[] = [
                'code'   => $fee->name ?: 'discount',
                'amount' => amount_validation(abs($fee->total)),
                'type'   => 'campaign',
            ];
        }
    }

    // Price-level discounts: dynamic pricing plugins that modify the product price
    // directly (not via coupons/fees). Compare regular_price with effective cart price.
    $price_discount_cents = 0;
    foreach (WC()->cart->get_cart() as $cart_item) {
        $product = $cart_item['data'];
        if (!$product) continue;

        $regular_price = (float) $product->get_regular_price();
        if ($regular_price <= 0) continue;

        $effective_subtotal = (float) $cart_item['line_subtotal'];
        $expected_subtotal  = $regular_price * $cart_item['quantity'];

        if ($expected_subtotal > $effective_subtotal) {
            $price_discount_cents += amount_validation($expected_subtotal - $effective_subtotal);
        }
    }
    if ($price_discount_cents > 0) {
        $discount_lines[] = [
            'code'   => 'dynamic_pricing',
            'amount' => $price_discount_cents,
            'type'   => 'campaign',
        ];
    }

    return $discount_lines;
}

/**
 * Build the cart snapshot used by both wp_localize_script and the checkout-update fragment.
 */
function ckpg_build_conekta_cart_snapshot(): array {
    if (!WC()->cart || WC()->cart->is_empty()) {
        return [];
    }

    $cart_items = [];
    foreach (WC()->cart->get_cart() as $cart_item) {
        $product = $cart_item['data'];
        $cart_items[] = [
            'id'           => $cart_item['product_id'],
            'name'         => $product->get_name() ?? '',
            'quantity'     => $cart_item['quantity'],
            'total'        => amount_validation($cart_item['line_total']),
            'variation_id' => $cart_item['variation_id'] ?? null,
        ];
    }

    return [
        'amount'         => amount_validation(WC()->cart->get_total('edit')),
        'cart_items'     => $cart_items,
        'discount_lines' => ckpg_build_conekta_discount_lines(),
    ];
}

/**
 * Send an updated cart-data fragment on every checkout AJAX refresh so the
 * JS-side conekta_settings stays in sync with dynamic pricing changes.
 */
add_filter('woocommerce_update_order_review_fragments', 'ckpg_conekta_cart_fragment');
function ckpg_conekta_cart_fragment($fragments) {
    $available_gateways = WC()->payment_gateways()->get_available_payment_gateways();
    if (!isset($available_gateways['conekta'])) {
        return $fragments;
    }

    $data = ckpg_build_conekta_cart_snapshot();
    if (!empty($data)) {
        $fragments['#conekta-cart-data'] =
            '<script id="conekta-cart-data" type="application/json">'
            . wp_json_encode($data)
            . '</script>';
    }

    return $fragments;
}

/**
 * Output the initial hidden element that the fragment system will replace.
 */
add_action('woocommerce_after_checkout_form', 'ckpg_conekta_cart_data_element');
function ckpg_conekta_cart_data_element() {
    $available_gateways = WC()->payment_gateways()->get_available_payment_gateways();
    if (!isset($available_gateways['conekta'])) {
        return;
    }

    $data = ckpg_build_conekta_cart_snapshot();
    echo '<script id="conekta-cart-data" type="application/json">'
        . wp_json_encode($data)
        . '</script>';
}
