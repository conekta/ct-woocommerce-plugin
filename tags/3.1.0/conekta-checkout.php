<?php
/**
 * Conekta Payment Gateway
 *
 * Payment Gateway through Conekta.io for Woocommerce for both credit and debit cards as well as cash payments in OXXO and monthly installments for Mexican credit cards.
 *
 * @package conekta-woocommerce
 * @link    https://wordpress.org/plugins/conekta-woocommerce/
 * @author  Conekta.io
 * @license http://www.gnu.org/licenses/gpl-3.0.html GNU General Public License v3.0
 */

/**
 * Plugin Name: Conekta Payment Gateway
 * Plugin URI: https://wordpress.org/plugins/conekta-woocommerce/
 * Description: Payment Gateway through Conekta.io for Woocommerce for both credit and debit cards as well as cash payments in OXXO and monthly installments for Mexican credit cards.
 * Version: 3.1.0
 * Author: Conekta.io
 * Author URI: https://www.conekta.io
 * License: GNU General Public License v3.0
 * License URI: http://www.gnu.org/licenses/gpl-3.0.html
 */

/**
 * Initializes a gateway.
 *
 * @access public
 */
function ckpg_conekta_checkout_init_your_gateway() {
	if ( class_exists( 'WC_Payment_Gateway' ) ) {
		if ( null !== filter_input( INPUT_GET, 'wc-ajax' ) && 'checkout' === filter_input( INPUT_POST, 'wc-ajax' ) ) {
			if ( null !== filter_input( INPUT_POST, 'payment_method' ) ) {
				include_once 'conekta-gateway-helper.php';
				include_once 'class-wc-conekta-plugin.php';
				include_once 'class-wc-conekta-payment-gateway.php';
			}
		} else {
			include_once 'conekta-gateway-helper.php';
			include_once 'class-wc-conekta-plugin.php';
			include_once 'class-wc-conekta-payment-gateway.php';
		}
	}
}

add_action( 'plugins_loaded', 'ckpg_conekta_checkout_init_your_gateway', 0 );

/**
 * Creates the required tables when necessary.
 *
 * @access public
 */
function ckpg_conekta_activation() {

	global $wpdb;
	$charset_collate = $wpdb->get_charset_collate();

	// phpcs:disable WordPress.DB.DirectDatabaseQuery.SchemaChange
	// phpcs:disable WordPress.DB.PreparedSQL.NotPrepared
	$wpdb->get_results(
		'CREATE TABLE IF NOT EXISTS ' . $wpdb->prefix . 'woocommerce_conekta_metadata ( meta_id bigint(20) unsigned NOT NULL AUTO_INCREMENT, id_user VARCHAR(256) NOT NULL, meta_option VARCHAR(255) NOT NULL, meta_value longtext, PRIMARY KEY  (meta_id), KEY id_user (id_user), KEY meta_id (meta_id) ) ' . $charset_collate . ';'
	); // db call ok; no-cache ok.

	$wpdb->get_results(
		'CREATE TABLE IF NOT EXISTS ' . $wpdb->prefix . 'woocommerce_conekta_unfinished_orders ( id bigint(20) unsigned NOT NULL AUTO_INCREMENT, customer_id VARCHAR(255) NOT NULL, cart_hash VARCHAR(255) NOT NULL, order_id VARCHAR(255) NOT NULL, order_number INT NOT NULL, status_name VARCHAR(255) NOT NULL, PRIMARY KEY  (id) ) ' . $charset_collate . ';'
	); // db call ok; no-cache ok.
	// phpcs:enable WordPress.DB.DirectDatabaseQuery.SchemaChange
	// phpcs:enable WordPress.DB.PreparedSQL.NotPrepared
}

register_activation_hook( __FILE__, 'ckpg_conekta_activation' );

/**
 * Adds the required scripts and styles to checkout page.
 *
 * @access public
 */
function ckpg_conekta_checkout_custom_scripts_and_styles() {

	if ( ! is_checkout() ) {
		return;
	}

	// Register CSS.
	wp_deregister_style( 'checkout_card' );
	wp_register_style( 'checkout_card', plugins_url( 'assets/css/card.scss', __FILE__ ), false, '1.0.0' );
	wp_enqueue_style( 'checkout_card' );

	// Register JS.
	wp_register_script( 'conekta_checkout_js', plugins_url( '/assets/js/conekta_checkout-js.js', __FILE__ ), array( 'jquery' ), '1.0.0', true );
	wp_enqueue_script( 'conekta_checkout_js' );
	wp_localize_script( 'conekta_checkout_js', 'conekta_checkout_js', array( 'ajaxurl' => admin_url( 'admin-ajax.php' ) ) );

	wp_register_script( 'tokenize', WP_PLUGIN_URL . '/' . plugin_basename( dirname( __FILE__ ) ) . '/assets/js/tokenize.js', array( 'jquery' ), '1.0', true ); // check import convention.
	wp_enqueue_script( 'tokenize' );
	wp_localize_script( 'tokenize', 'tokenize', array( 'ajaxurl' => admin_url( 'admin-ajax.php' ) ) );

	wp_register_script( 'conekta-checkout', 'https://pay.conekta.com/v1.0/js/conekta-checkout.min.js', array( 'jquery' ), '1.0', true );
	wp_enqueue_script( 'conekta-checkout' );

}
add_action( 'wp_enqueue_scripts', 'ckpg_conekta_checkout_custom_scripts_and_styles' );
