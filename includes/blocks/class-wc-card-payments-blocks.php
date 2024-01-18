<?php
use Automattic\WooCommerce\Blocks\Payments\Integrations\AbstractPaymentMethodType;

/**
 * Card Payments Blocks integration
 *
 * @since 1.0.3
 */
final class WC_Gateway_Card_Blocks_Support extends AbstractPaymentMethodType {

	/**
	 * The gateway instance.
	 *
	 * @var WC_Conekta_Card_Gateway
	 */
	private $gateway;

	/**
	 * Payment method name/id/slug.
	 *
	 * @var string
	 */
	protected $name = 'conekta';

	/**
	 * Initializes the payment method type.
	 */
	public function initialize() {
		$this->settings = get_option( 'woocommerce_conekta_settings', [] );
		$gateways       = WC()->payment_gateways->payment_gateways();
		$this->gateway  = $gateways[ $this->name ];
	}

	/**
	 * Returns if this payment method should be active. If false, the scripts will not be enqueued.
	 *
	 * @return boolean
	 */
	public function is_active() {
		return $this->gateway->is_available();
	}

	/**
	 * Returns an array of scripts/handles to be registered for this payment method.
	 *
	 * @return array
	 */
	public function get_payment_method_script_handles() {
		$script_path       = '/build/js/frontend/blocks.js';
		$script_asset_path = WC_Conekta_Plugin::plugin_abspath() . 'build/js/frontend/blocks.asset.php';
		$script_asset      = file_exists( $script_asset_path )
			? require( $script_asset_path )
			: array(
				'dependencies' => array(),
				'version'      => '1.2.0'
			);
		$script_url        = WC_Conekta_Plugin::plugin_url() . $script_path;

		wp_register_script(
			'wc-card-payments-blocks',
			$script_url,
			$script_asset[ 'dependencies' ],
			$script_asset[ 'version' ],
			true
		);

		return [ 'wc-card-payments-blocks' ];
	}

	/**
	 * Returns an array of key=>value pairs of data made available to the payment methods script.
	 *
	 * @return array
	 */
	public function get_payment_method_data() {
		return [
			'is_cash_enabled'       => filter_var($this->get_setting( 'is_cash_enabled' ),FILTER_VALIDATE_BOOLEAN),
			'title'       				  => $this->get_setting( 'title' ),
			'description' 				  => 'Paga con tarjeta de crédito, débito, efectivo o transferencia bancaria.',
			'supports'    					=> array_filter( $this->gateway->supports, [ $this->gateway, 'supports' ] )
		];
	}
}
