<?php

/*
* Title   : Conekta Payment extension for WooCommerce
* Author  : Conekta.io
* Url     : https://wordpress.org/plugins/conekta-payment-gateway/
*/

class WC_Conekta_Plugin extends WC_Payment_Gateway
{
	public $version  = "4.0.3";
	public $name = "WooCommerce 2";
	public $description = "Payment Gateway through Conekta.io for Woocommerce for both credit and debit cards as well as cash payments  and monthly installments for Mexican credit cards.";
	public $plugin_name = "Conekta Payment Gateway for Woocommerce";
	public $plugin_URI = "https://wordpress.org/plugins/conekta-payment-gateway/";
	public $author = "Conekta.io";
	public $author_URI = "https://www.conekta.io";



	public function ckpg_get_version()
	{
		return $this->version;
	}

    /**
     * Plugin url.
     *
     * @return string
     */
    public static function plugin_url() {
        return untrailingslashit( plugins_url( '/', __FILE__ ) );
    }

    /**
     * Plugin url.
     *
     * @return string
     */
    public static function plugin_abspath() {
        return trailingslashit( plugin_dir_path( __FILE__ ) );
    }
}
