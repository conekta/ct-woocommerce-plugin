<?php
use Automattic\WooCommerce\Blocks\Payments\Integrations\AbstractPaymentMethodType;

/**
 * conekta Payments Blocks integration
 *
 * @since 1.0.3
 */
final class WC_Gateway_Conekta_Pay_By_Bank_Blocks_Support extends AbstractPaymentMethodType {

	/**
	 * The gateway instance.
	 *
	 * @var WC_Gateway_Conekta_Pay_By_Bank_Blocks_Support
	 */
	private $gateway;

	/**
	 * Payment method name/id/slug.
	 *
	 * @var string
	 */
	protected $name = 'conekta_pay_by_bank';

	/**
	 * Initializes the payment method type.
	 */
	public function initialize() {
		$this->settings = get_option( sprintf('woocommerce_%s_settings', $this->name), [] );
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
		$script_path       = sprintf('/build/js/frontend/%s.js', $this->name);
		$script_asset_path = WC_Conekta_Plugin::plugin_abspath() . sprintf('build/js/frontend/%s.asset.php', $this->name);
		$script_asset      = file_exists( $script_asset_path )
			? require( $script_asset_path )
			: array(
				'dependencies' => array(),
				'version'      => '1.2.0'
			);
		$script_url        = WC_Conekta_Plugin::plugin_url() . $script_path;

		wp_register_script(
			sprintf('wc-%s-payments-blocks', $this->name),
			$script_url,
			$script_asset[ 'dependencies' ],
			$script_asset[ 'version' ],
			true
		);

		return [ sprintf('wc-%s-payments-blocks', $this->name) ];
	}

    /**
     * Returns an array of key=>value pairs of data made available to the payment methods script.
     *
     * @return array
     */
    public function get_payment_method_data(): array
    {
        return [
            'is_enabled'                => filter_var($this->get_setting( 'enabled' ),FILTER_VALIDATE_BOOLEAN),
            'title'       		        => $this->get_setting( 'title' ),
            'description' 		        => $this->get_setting( 'description' ),
            'supports'    			    => array_filter( $this->gateway->supports, [ $this->gateway, 'supports' ] ),
            'name'                      => $this->name,
			'api_key'                   => $this->get_setting( 'api_key' ),
        ];
    }
}

