<?php

/*
* Title   : Conekta Payment extension for WooCommerce
* Author  : Conekta.io
* Url     : https://wordpress.org/plugins/conekta-payment-gateway/
*/

class WC_Conekta_Plugin extends WC_Payment_Gateway
{
	public $version  = "4.0.2";
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

	public function ckpg_offline_payment_notification($order_id, $customer)
	{
		global $woocommerce;
		$order = new WC_Order($order_id);

		$title = sprintf("Se ha efectuado el pago del pedido %s", $order->get_order_number());
		$body_message = "<p style=\"margin:0 0 16px\">Se ha detectado el pago del siguiente pedido:</p><br />" . $this->ckpg_assemble_email_payment($order);

		// Email for customer
		$customer = esc_html($customer);
		$customer = sanitize_text_field($customer);

		$mail_customer = $woocommerce->mailer();
		$message = $mail_customer->wrap_message(
			sprintf(__('Hola, %s'), $customer),
			$body_message
		);
		$mail_customer->send($order->get_billing_email(), $title, $message);
		unset($mail_customer);
		//Email for admin site
		$mail_admin = $woocommerce->mailer();
		$message = $mail_admin->wrap_message(
			sprintf(__('Pago realizado satisfactoriamente')),
			$body_message
		);
		$mail_admin->send(get_option("admin_email"), $title, $message);
		unset($mail_admin);
	}

	public function ckpg_assemble_email_payment($order)
	{
		ob_start();

		wc_get_template('emails/email-order-details.php', array('order' => $order, 'sent_to_admin' => false, 'plain_text' => false, 'email' => ''));

		return ob_get_clean();
	}
	
}
