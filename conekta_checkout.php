<?php

/*
Plugin Name: Conekta Payment Gateway
Plugin URI: https://wordpress.org/plugins/conekta-payment-gateway/
Description: Payment Gateway through Conekta.io for Woocommerce for both credit and debit cards as well as cash payments  and monthly installments for Mexican credit cards.
Version: 5.0.0
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
