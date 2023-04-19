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
 * Checks the order balance.
 *
 * @param object $order to be checked.
 * @param float  $total to validate.
 */
function ckpg_check_balance( $order, $total ) {
	$amount = 0;

	foreach ( $order['line_items'] as $line_item ) {
		$amount = $amount + ( $line_item['unit_price'] * $line_item['quantity'] );
	}

	foreach ( $order['shipping_lines'] as $shipping_line ) {
		$amount = $amount + $shipping_line['amount'];
	}

	foreach ( $order['discount_lines'] as $discount_line ) {
		$amount = $amount - $discount_line['amount'];
	}

	foreach ( $order['tax_lines'] as $tax_line ) {
		$amount = $amount + $tax_line['amount'];
	}

	if ( $amount !== $total ) {
		$adjustment = abs( $amount - $total );

		$order['tax_lines'][0]['amount'] = $order['tax_lines'][0]['amount'] + intval( $adjustment );

		if ( empty( $order['tax_lines'][0]['description'] ) ) {
			$order['tax_lines'][0]['description'] = 'Round Adjustment';
		}
	}

	return $order;
}


/**
 * Generate the order metadata.
 *
 * @param object $data of the order whose metadata is to be generated.
 * @param array  $settings of the gateway.
 */
function ckpg_build_order_metadata( $data, $settings ) {
	$metadata = array(
		'plugin'         => 'Woocommerce',
		'plugin_version' => WC()->version,
		'reference_id'   => $data->get_id(),
	);

	$customer_note = $data->get_customer_note();
	if ( ! empty( $customer_note ) ) {
		$metadata = array_merge( $metadata, array( 'customer_message' => $data->get_customer_note() ) );
	}
	$data_array = $data->get_data();
	foreach ( $settings['order_metadata'] as $order_meta ) {
		$metadata = array_merge( $metadata, array( $order_meta => $data_array[ $order_meta ] ) );
	}
	if ( ! empty( $settings['product_metadata'] ) ) {
		$items = $data->get_items();
		foreach ( $items as $item ) {
			$index              = 'product-' . $item['product_id'];
			$metadata[ $index ] = '';
			foreach ( $settings['product_metadata'] as $product_meta ) {
				$metadata[ $index ] .= ckpg_recursive_build_product_metadata( $item[ $product_meta ], $product_meta );
			}
			$metadata[ $index ] = substr( $metadata[ $index ], 0, -2 );
		}
	}
	return $metadata;
}

/**
 * Recursively stringify metadata.
 *
 * @param array  $data_object object whose attributes are going to be stringified.
 * @param string $key recursively generated key for each metadata.
 */
function ckpg_recursive_build_product_metadata( $data_object, $key ) {
	$string = '';
	if ( 'array' === gettype( $data_object ) ) {
		foreach ( array_keys( $data_object ) as $data_key ) {
			$key_concat = strval( $key ) . '-' . strval( $data_key );
			if ( empty( $data_object[ $data_key ] ) ) {
				$string .= strval( $key_concat ) . ': NULL | ';
			} else {
				$string .= ckpg_recursive_build_product_metadata( $data_object[ $data_key ], $key_concat );
			}
		}
	} else {
		if ( empty( $data_object ) ) {
			$string .= strval( $key ) . ': NULL | ';
		} else {
			$string .= strval( $key ) . ': ' . strval( $data_object ) . ' | ';
		}
	}
	return $string;
}

/**
 * Bundle and format the order items information
 *
 * @param array  $items of the order to be processed.
 * @param string $version Conekta plugin version.
 */
function ckpg_build_line_items( $items, $version ) {
	$line_items = array();

	foreach ( $items as $item ) {

		$sub_total   = floatval( $item['line_subtotal'] ) * 1000;
		$sub_total   = $sub_total / floatval( $item['qty'] );
		$productmeta = new WC_Product( $item['product_id'] );
		$sku         = $productmeta->get_sku();
		$unit_price  = $sub_total;
		$item_name   = item_name_validation( $item['name'] );
		$unit_price  = intval( round( floatval( $unit_price ) / 10 ), 2 );
		$quantity    = intval( $item['qty'] );

		$line_item_params = array(
			'name'       => $item_name,
			'unit_price' => $unit_price,
			'quantity'   => $quantity,
			'tags'       => array( 'WooCommerce', 'Conekta ' . $version ),
			'metadata'   => array( 'soft_validations' => true ),
		);

		if ( ! empty( $sku ) ) {
			$line_item_params = array_merge(
				$line_item_params,
				array(
					'sku' => $sku,
				)
			);
		}

		$line_items = array_merge( $line_items, array( $line_item_params ) );
	}

	return $line_items;
}

/**
 * Bundle and format the tax information
 *
 * @param array $taxes of the order to be processed.
 */
function ckpg_build_tax_lines( $taxes ) {
	$tax_lines = array();

	foreach ( $taxes as $tax ) {

		$tax_amount = floatval( $tax['tax_amount'] ) * 1000;
		$tax_name   = (string) $tax['label'];
		$tax_name   = esc_html( $tax_name );
		$tax_lines  = array_merge(
			$tax_lines,
			array(
				array(
					'description' => $tax_name,
					'amount'      => intval( round( floatval( $tax_amount ) / 10 ), 2 ),
				),
			)
		);

		if ( isset( $tax['shipping_tax_amount'] ) ) {
			$tax_amount = floatval( $tax['shipping_tax_amount'] ) * 1000;
			$amount     = intval( round( floatval( $tax_amount ) / 10 ), 2 );
			$tax_lines  = array_merge(
				$tax_lines,
				array(
					array(
						'description' => 'Shipping tax',
						'amount'      => $amount,
					),
				)
			);
		}
	}

	return $tax_lines;
}

/**
 * Bundle and format the shipping lines information
 *
 * @param array $data whose shipping lines is to be retrieved.
 */
function ckpg_build_shipping_lines( $data ) {
	$shipping_lines = array();

	if ( ! empty( $data['shipping_lines'] ) ) {
		$shipping_lines = $data['shipping_lines'];
	}

	return $shipping_lines;
}

/**
 * Bundle and format the discount information
 *
 * @param array $data whose discount shipping is to be retrieved.
 */
function ckpg_build_discount_lines( $data ) {
	$discount_lines = array();
	if ( ! empty( $data['discount_lines'] ) ) {
		$discounts = $data['discount_lines'];
		foreach ( $discounts as $discount ) {
			$discount_lines = array_merge(
				$discount_lines,
				array(
					array(
						'code'   => (string) $discount['code'],
						'amount' => (string) $discount['amount'] * 100,
						'type'   => 'coupon',
					),
				)
			);
		}
	}

	return $discount_lines;
}

/**
 * Bundle and format the shipping contact information
 *
 * @param array $data whose shipping contact is to be retrieved.
 */
function ckpg_build_shipping_contact( $data ) {
	$shipping_contact = array();

	if ( ! empty( $data['shipping_contact'] ) ) {
		$shipping_contact = array_merge( $data['shipping_contact'], array( 'metadata' => array( 'soft_validations' => true ) ) );

	}

	return $shipping_contact;
}

/**
 * Bundle and format the customer information
 *
 * @param array $data whose customer information is to be retrieved.
 */
function ckpg_build_customer_info( $data ) {
	$customer_info = array_merge( $data['customer_info'], array( 'metadata' => array( 'soft_validations' => true ) ) );

	return $customer_info;
}

/**
 * Bundle and format the order information
 *
 * @param WC_Order $order whose data is to be retrieved.
 */
function ckpg_get_request_data( $order ) {
	$token                = '';
	$monthly_installments = '';
	$on_demand_enabled    = false;
	$payment_card         = null;
	if ( $order && null !== $order ) {
		// Discount Lines.
		$order_coupons  = $order->get_items( 'coupon' );
		$discount_lines = array();

		foreach ( $order_coupons as $index => $coupon ) {
			$discount_lines = array_merge(
				$discount_lines,
				array(
					array(
						'code'   => $coupon['name'],
						'type'   => $coupon['type'],
						'amount' => $coupon['discount_amount'] * 100,
					),
				)
			);
		}

		// PARAMS VALIDATION.
		$amount_shipping = amount_validation( $order->get_total_shipping() );

		// Shipping Lines.
		$shipping_method = $order->get_shipping_method();
		if ( ! empty( $shipping_method ) ) {
			$shipping_lines = array(
				array(
					'amount'  => (int) number_format( $amount_shipping ),
					'carrier' => $shipping_method,
					'method'  => $shipping_method,
				),
			);

			// PARAM VALIDATION.
			$name     = string_validation( $order->get_shipping_first_name() );
			$last     = string_validation( $order->get_shipping_last_name() );
			$address1 = string_validation( $order->get_shipping_address_1() );
			$address2 = string_validation( $order->get_shipping_address_2() );
			$city     = string_validation( $order->get_shipping_city() );
			$state    = string_validation( $order->get_shipping_state() );
			$country  = string_validation( $order->get_shipping_country() );
			$postal   = post_code_validation( $order->get_shipping_postcode() );

			$shipping_contact = array(
				'phone'    => $order->get_billing_phone(),
				'receiver' => sprintf( '%s %s', $name, $last ),
				'address'  => array(
					'street1'     => $address1,
					'street2'     => $address2,
					'city'        => $city,
					'state'       => $state,
					'country'     => $country,
					'postal_code' => $postal,
				),
			);
		} else {
			$shipping_lines = array(
				array(
					'amount'  => 0,
					'carrier' => 'carrier',
					'method'  => 'pickup',
				),
			);
		}

		// PARAM VALIDATION.
		$customer_name = sprintf( '%s %s', $order->get_billing_first_name(), $order->get_billing_last_name() );
		$phone         = sanitize_text_field( $order->get_billing_phone() );

		// Customer Info.
		$customer_info = array(
			'name'  => $customer_name,
			'phone' => $phone,
			'email' => $order->get_billing_email(),
		);

		// PARAMS VALIDATION.
		if ( ! empty( filter_input( INPUT_POST, 'conekta_token' ) ) ) {
			$token = string_validation( filter_input( INPUT_POST, 'conekta_token' ) );
		}

		if ( ! empty( filter_input( INPUT_POST, 'monthly_installments' ) ) ) {
			$monthly_installments = int_validation( filter_input( INPUT_POST, 'monthly_installments' ) );
		}

		if ( ! empty( filter_input( INPUT_POST, 'conekta-card-save' ) ) ) {
			$on_demand_enabled = filter_input( INPUT_POST, 'conekta-card-save' );
		}

		if ( ! empty( filter_input( INPUT_POST, 'payment_card' ) ) ) {
			$payment_card = string_validation( filter_input( INPUT_POST, 'payment_card' ) );
		}

		$amount    = validate_total( $order->get_total() );
		$currency  = get_woocommerce_currency();
		$address_1 = $order->get_shipping_address_1();
		$data      = array(
			'order_id'             => $order->get_id(),
			'amount'               => $amount,
			'token'                => $token,
			'monthly_installments' => $monthly_installments,
			'currency'             => $currency,
			'description'          => sprintf( 'Charge for %s', $order->get_billing_email() ),
			'customer_info'        => $customer_info,
			'shipping_lines'       => $shipping_lines,
			'on_demand_enabled'    => $on_demand_enabled,
			'payment_card'         => $payment_card,
		);
		if ( ! empty( $address1 ) ) {
			$data = array_merge( $data, array( 'shipping_contact' => $shipping_contact ) );
		}
		$customer_note = $order->get_customer_note();
		if ( ! empty( $customer_note ) ) {
			$data = array_merge( $data, array( 'customer_message' => $order->get_customer_note() ) );
		}

		if ( ! empty( $discount_lines ) ) {
			$data = array_merge( $data, array( 'discount_lines' => $discount_lines ) );
		}

		return $data;
	}

	return false;
}
/**
 * Validates an amount.
 *
 * @param float $amount to be validated.
 */
function amount_validation( $amount = '' ) {
	if ( is_numeric( $amount ) ) {
		$amount = (float) $amount * 100;
	}

	return $amount;
}
/**
 * Validates an item name.
 *
 * @param string $item name to be validated.
 */
function item_name_validation( $item = '' ) {
	if ( ! empty( $item ) ) {
		return sanitize_text_field( $item );
	}

	return $item;
}
/**
 * Validates a string.
 *
 * @param string $string value to be validated.
 */
function string_validation( $string = '' ) {
	if ( ! empty( $string ) ) {
		return esc_html( $string );
	}

	return $string;
}
/**
 * Validates a post code.
 *
 * @param string $post_code value to be validated.
 */
function post_code_validation( $post_code = '' ) {
	if ( strlen( $post_code ) > 5 ) {
		return substr( $post_code, 0, 5 );
	}

	return $post_code;
}
/**
 * Validates a number as integer.
 *
 * @param float $input_field value to be validated.
 */
function int_validation( $input_field ) {
	if ( is_numeric( $input_field ) ) {
		return intval( $input_field );
	}

	return $input_field;
}
/**
 * Validates a number as total.
 *
 * @param float $total value to be validated.
 */
function validate_total( $total = '' ) {
	if ( is_numeric( $total ) ) {
		return (float) $total * 100;
	}

	return $total;
}

