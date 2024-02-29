<?php
use Automattic\WooCommerce\Blocks\Payments\Integrations\AbstractPaymentMethodType;

/**
 * conekta Payments Blocks integration
 *
 * @since 1.0.3
 */
final class WC_Gateway_Conekta_Blocks_Support extends AbstractPaymentMethodType {

	/**
	 * The gateway instance.
	 *
	 * @var WC_Conekta_Gateway
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
			'wc-conekta-payments-blocks',
			$script_url,
			$script_asset[ 'dependencies' ],
			$script_asset[ 'version' ],
			true
		);

		return [ 'wc-conekta-payments-blocks' ];
	}

    /**
     * Returns an array of key=>value pairs of data made available to the payment methods script.
     *
     * @return array
     */
    public function get_payment_method_data(): array
    {
        return [
            'is_cash_enabled'                => filter_var($this->get_setting( 'is_cash_enabled' ),FILTER_VALIDATE_BOOLEAN),
            'is_card_enabled'                => filter_var($this->get_setting( 'is_card_enabled' ),FILTER_VALIDATE_BOOLEAN),
            'is_bank_transfer_enabled'       => filter_var($this->get_setting( 'is_bank_transfer_enabled' ),FILTER_VALIDATE_BOOLEAN),
            'title'       		             => $this->get_setting( 'title' ),
            'description' 		             => $this->get_description(),
            'supports'    			         => array_filter( $this->gateway->supports, [ $this->gateway, 'supports' ] )
        ];
    }
    /**
     * Returns the payment method description.
     *
     * @return string
     */
    public function get_description(): string
    {
        $paymentMethods = "Paga con";

        $enabledMethods = [];

        if (filter_var($this->get_setting('is_cash_enabled'), FILTER_VALIDATE_BOOLEAN)) {
            $enabledMethods[] = 'efectivo';
        }

        if (filter_var($this->get_setting('is_card_enabled'), FILTER_VALIDATE_BOOLEAN)) {
            $enabledMethods[] = 'tarjeta de crédito, débito';
        }

        if (filter_var($this->get_setting('is_bank_transfer_enabled'), FILTER_VALIDATE_BOOLEAN)) {
            $enabledMethods[] = 'transferencia bancaria';
        }

        if (!empty($enabledMethods)) {
            $lastMethod = array_pop($enabledMethods);
            $paymentMethods .= ' ' . implode(', ', $enabledMethods);
            if (!empty($enabledMethods)) {
                $paymentMethods .= ' o ';
            }
            $paymentMethods .= $lastMethod;
        }
        return $paymentMethods;
    }
}
