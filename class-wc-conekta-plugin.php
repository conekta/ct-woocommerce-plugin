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

if ( ! class_exists( 'Conekta' ) ) {
	require_once 'lib/conekta-php/lib/Conekta.php';
}

/**
 * Title   : Conekta Payment Generic Plugin for WooCommerce
 * Author  : Conekta.io
 * Url     : https://wordpress.org/plugins/conekta-woocommerce
 */
class WC_Conekta_Plugin extends WC_Payment_Gateway {
	/**
	 * Current version of the plugin.
	 *
	 * @var string
	 */
	public $version = '3.1.0';
	/**
	 * Name of the WooCommerce plugin .
	 *
	 * @var string
	 */
	public $name = 'WooCommerce 2';
	/**
	 * Description of the plugin.
	 *
	 * @var string
	 */
	public $description = 'Payment Gateway through Conekta.io for Woocommerce for both credit and debit cards as well as cash payments in OXXO and monthly installments for Mexican credit cards.';
	/**
	 * Name of the plugin.
	 *
	 * @var string
	 */
	public $plugin_name = 'Conekta Payment Gateway for Woocommerce';
	/**
	 * Plugin URI.
	 *
	 * @var string
	 */
	public $plugin_uri = 'https://wordpress.org/plugins/conekta-woocommerce/';
	/**
	 * Plugin author.
	 *
	 * @var string
	 */
	public $author = 'Conekta.io';
	/**
	 * Author URI.
	 *
	 * @var string
	 */
	public $author_uri = 'https://www.conekta.io';
	/**
	 * Current language setting.
	 *
	 * @var string
	 */
	protected $lang;
	/**
	 * Array of messages in the current language setting.
	 *
	 * @var string
	 */
	protected $lang_messages;

	const CONEKTA_CUSTOMER_ID        = 'conekta_customer_id';
	const CONEKTA_PAYMENT_SOURCES_ID = 'conekta_payment_source_id';
	const CONEKTA_ON_DEMAND_ENABLED  = 'conekta_on_demand_enabled';
	const MINIMUM_ORDER_AMOUNT       = 20;

	/**
	 * Gets current plugin version.
	 *
	 * @access public
	 * @return string
	 */
	public function ckpg_get_version() {
		return $this->version;
	}

	/**
	 * Initializes language options.
	 *
	 * @access public
	 * @return WC_Conekta_Plugin
	 */
	public function ckpg_set_locale_options() {
		if ( function_exists( 'get_locale' ) && get_locale() !== '' ) {
			$current_lang = explode( '_', get_locale() );
			$this->lang   = $current_lang[0];
			$filename     = 'lang/' . $this->lang . '.php';
			if ( ! file_exists( plugin_dir_path( __FILE__ ) . $filename ) ) {
				$filename = 'lang/en.php';
			}
			$this->lang_messages = require $filename;
			\Conekta\Conekta::setLocale( $this->lang );
		}

		return $this;
	}

	/**
	 * Gets language options.
	 *
	 * @access public
	 * @return array
	 */
	public function ckpg_get_lang_options() {
		return $this->lang_messages;
	}

	/**
	 * Sends a payment notification via email.
	 *
	 * @access public
	 * @param int    $order_id  id of the paid order.
	 * @param string $customer name of the paid order.
	 */
	public function ckpg_offline_payment_notification( $order_id, $customer ) {
		global $woocommerce;
		$order        = new WC_Order( $order_id );
		$title        = sprintf( 'Se ha efectuado el pago del pedido %s', $order->get_order_number() );
		$body_message = '<p style=\"margin:0 0 16px\">Se ha detectado el pago del siguiente pedido:</p><br />' . $this->ckpg_assemble_email_payment( $order );

		// Email for customer.
		$customer      = esc_html( $customer );
		$customer      = sanitize_text_field( $customer );
		$mail_customer = $woocommerce->mailer();
		$message       = $mail_customer->wrap_message(
			// translators: %s is the name of the customer.
			sprintf( __( 'Hola, %s' ), $customer ),
			$body_message
		);
		$mail_customer->send( $order->get_billing_email(), $title, $message );
		unset( $mail_customer );
		// Email for admin site.
		$mail_admin = $woocommerce->mailer();
		$message    = $mail_admin->wrap_message(
			sprintf( __( 'Pago realizado satisfactoriamente' ) ),
			$body_message
		);
		$mail_admin->send( get_option( 'admin_email' ), $title, $message );
		unset( $mail_admin );
	}

	/**
	 * Generates the payment email using the template.
	 *
	 * @access public
	 * @param WC_Order $order whose payment email is to be generated.
	 */
	public function ckpg_assemble_email_payment( $order ) {
		ob_start();

		wc_get_template(
			'emails/email-order-details.php',
			array(
				'order'         => $order,
				'sent_to_admin' => false,
				'plain_text'    => false,
				'email'         => '',
			)
		);

		return ob_get_clean();
	}

	/**
	 * Updates metadata in DB.
	 *
	 * @access public
	 * @param int    $user_id of the user whose metadata is to be updated.
	 * @param string $meta_options to be updated.
	 * @param string $meta_value to replace the current metadata value.
	 */
	public static function ckpg_update_conekta_metadata( $user_id, $meta_options, $meta_value ) {
		global $wpdb;

		if ( empty( self::ckpg_get_conekta_metadata( $user_id, $meta_options ) ) ) {
			$wpdb->insert(
				'wp_woocommerce_conekta_metadata',
				array(
					'id_user'     => $user_id,
					'meta_option' => $meta_options,
					'meta_value'  => $meta_value, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_value
				)
			); // db call ok.
		} else {
			$wpdb->update(
				'wp_woocommerce_conekta_metadata',
				array(
					'meta_value' => $meta_value, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_value
				),
				array(
					'id_user'     => $user_id,
					'meta_option' => $meta_options,
				)
			); // db call ok; no-cache ok.
		}
	}

	/**
	 * Obtains metadata from DB.
	 *
	 * @access public
	 * @param int    $user_id of the user whose metadata is to be obtained.
	 * @param string $meta_options specific metadata to be obtained.
	 */
	public static function ckpg_get_conekta_metadata( $user_id, $meta_options ) {
		global $wpdb;

		$meta_value = $wpdb->get_var(
			$wpdb->prepare(
				'SELECT meta_value FROM wp_woocommerce_conekta_metadata WHERE id_user = %d AND meta_option = %s',
				$user_id,
				$meta_options
			)
		); // db call ok; no-cache ok.

		return $meta_value;
	}

	/**
	 * Deletes metadata from DB.
	 *
	 * @access public
	 * @param int    $user_id of the user whose metadata is to be deleted.
	 * @param string $meta_options specific metadata to be deleted.
	 */
	public static function ckpg_delete_conekta_metadata( $user_id, $meta_options ) {
		global $wpdb;

		if ( ! empty( self::ckpg_get_conekta_metadata( $user_id, $meta_options ) ) ) {
			$wpdb->delete(
				'wp_woocommerce_conekta_metadata',
				array(
					'id_user'     => $user_id,
					'meta_option' => $meta_options,
				)
			); // db call ok; no-cache ok.
		}

	}

	/**
	 * Obtains an unfinished order from DB.
	 *
	 * @access public
	 * @param int    $customer_id of the user of the order we want to find.
	 * @param string $cart_hash of the order we want to find.
	 */
	public static function ckpg_get_conekta_unfinished_order( $customer_id, $cart_hash ) {
		global $wpdb;

		$order_data = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT order_id, order_number FROM wp_woocommerce_conekta_unfinished_orders WHERE customer_id = %d AND cart_hash = %s AND status_name = %s',
				$customer_id,
				$cart_hash,
				'pending'
			)
		); // db call ok; no-cache ok.

		return ( ! empty( $order_data ) ) ? $order_data[0] : null;
	}

	/**
	 * Creates an unfinished order (if not yet existent) in DB.
	 *
	 * @access public
	 * @param int    $user_id of the customer that has created the order.
	 * @param string $cart_hash of the new order.
	 * @param string $order_id Conekta ID of the new order.
	 * @param int    $order_number WooCommerce ID of the new order.
	 */
	public static function ckpg_insert_conekta_unfinished_order( $user_id, $cart_hash, $order_id, $order_number ) {
		global $wpdb;

		$found = self::ckpg_get_conekta_unfinished_order( $user_id, $cart_hash );
		if ( empty( $found ) ) {
			$wpdb->insert(
				'wp_woocommerce_conekta_unfinished_orders',
				array(
					'customer_id'  => $user_id,
					'cart_hash'    => $cart_hash,
					'order_id'     => $order_id,
					'order_number' => $order_number,
					'status_name'  => 'pending',
				)
			); // db call ok.
		} else {
			$wpdb->update(
				'wp_woocommerce_conekta_unfinished_orders',
				array(
					'status_name' => 'paid',
				),
				array(
					'customer_id'  => $user_id,
					'cart_hash'    => $cart_hash,
					'order_id'     => $order_id,
					'order_number' => $order_number,
				)
			); // db call ok; no-cache ok.
		}
	}
}
