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

?>

<h3>
	<?php esc_html_e( 'Conekta Payment', 'woothemes' ); ?>
</h3>

<p><?php esc_html_e( 'Allows payments with the Conekta platform.', 'woothemes' ); ?></p>

<table class="form-table">
	<?php $this->generate_settings_html(); ?>
</table>
