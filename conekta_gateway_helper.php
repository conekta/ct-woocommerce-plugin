<?php

/*
 * Title   : Conekta Payment Extension for WooCommerce
 * Author  : Cristina Randall
 * Url     : https://www.conekta.io/es/docs/plugins/woocommerce
 */

function ckpg_check_balance($order, $total): array
{
    $amount = 0;

    foreach ($order['line_items'] as $line_item) {
        $amount = $amount + ($line_item['unit_price'] * $line_item['quantity']);
    }

    foreach ($order['shipping_lines'] as $shipping_line) {
        $amount = $amount + $shipping_line['amount'];
    }

    foreach ($order['discount_lines'] as $discount_line) {
        $amount = $amount - $discount_line['amount'];
    }

    foreach ($order['tax_lines'] as $tax_line) {
        $amount = $amount + $tax_line['amount'];
    }

    if ($amount != $total) {
        $adjustment = abs($amount - $total);

        $order['tax_lines'][0]['amount'] =
            $order['tax_lines'][0]['amount'] + intval($adjustment);

        if (empty($order['tax_lines'][0]['description'])) {
            $order['tax_lines'][0]['description'] = 'Round Adjustment';
        }
    }

    return $order;
}



function ckpg_build_order_metadata($data): array
{
    $metadata = array(
        'reference_id' => $data['order_id'],
        'plugin_conekta_version' => $data['plugin_conekta_version'],
        'plugin' => 'woocommerce',
        'woocommerce_version' => $data['woocommerce_version'],
    );

    if (!empty($data['customer_message'])) {
        $metadata = array_merge(
            $metadata, array(
                'customer_message' => $data['customer_message'])
        );
    }

    return $metadata;
}

function ckpg_build_line_items($items, $version)
{
    $line_items = array();

    foreach ($items as $item) {

        $sub_total   = floatval($item['line_subtotal']) * 1000;
        $sub_total   = $sub_total / floatval($item['qty']);
        $productmeta = new WC_Product($item['product_id']);
        $sku         = $productmeta->get_sku();
        $unit_price  = $sub_total;
        $item_name   = item_name_validation($item['name']);
        $unit_price  = intval(round(floatval($unit_price) / 10), 2);
        $quantity    = intval($item['qty']);


        $line_item_params = array(
            'name'        => $item_name,
            'unit_price'  => $unit_price,
            'quantity'    => $quantity,
            'tags'        => ['WooCommerce', "Conekta ".$version],
            'metadata'    => array('soft_validations' => true)
        );

        if (!empty($sku)) {
            $line_item_params = array_merge(
                $line_item_params,
                array(
                    'sku' => $sku
                )
            );
        }

        $line_items = array_merge($line_items, array($line_item_params));
    }

    return $line_items;
}

function ckpg_build_tax_lines($taxes): array
{
    $tax_lines = array();

    foreach ($taxes as $tax) {


        $tax_amount = floatval($tax['tax_amount']) * 1000;
        $tax_name    = (string)$tax['label'];
        $tax_name    = esc_html($tax_name);


        $tax_lines  = array_merge($tax_lines, array(
            array(
                'description' => $tax_name,
                'amount'      => intval(round(floatval($tax_amount) / 10), 2)
            )
        ));

        if (isset($tax['shipping_tax_amount'])) {
            $tax_amount = floatval($tax['shipping_tax_amount']) * 1000;
            $amount     = intval(round(floatval($tax_amount) / 10), 2);
            $tax_lines  = array_merge(
                $tax_lines, array(
                    array(
                        'description' => 'Shipping tax',
                        'amount'      => $amount
                    )
                )
            );
        }
    }

    return $tax_lines;
}

function ckpg_build_shipping_lines($data)
{
    $shipping_lines = array();

    if(!empty($data['shipping_lines'])) {
        $shipping_lines = $data['shipping_lines'];
    }

    return $shipping_lines;
}

function ckpg_build_discount_lines($data): array
{
    $discount_lines = array();
    if (!empty($data['discount_lines'])) {
        $discounts = $data['discount_lines'];
        foreach ($discounts as $discount) {
            $discount_lines = array_merge(
                $discount_lines,
                    array(
                        array(
                            'code' => (string) $discount['code'],
                            'amount' => $discount['amount'] ,
                            'type'=> 'coupon'
                        )
                    )
                );
            }
        }

    return $discount_lines;
}

function ckpg_build_shipping_contact($data): array
{
    $shipping_contact = array();

    if (!empty($data['shipping_contact'])) {
        $shipping_contact = array_merge($data['shipping_contact'], array('metadata' => array('soft_validations' => true)));

    }

    return $shipping_contact;
}

function ckpg_build_customer_info($data)
{
    $customer_info = array_merge($data['customer_info'], array('metadata' => array('soft_validations' => true)));

    return $customer_info;
}

/**
* Bundle and format the order information
* Send as much information about the order as possible to Conekta
*/
function ckpg_get_request_data($order)
{
    if ($order AND $order != null)
    {
        // Discount Lines
        $order_coupons  = $order->get_items('coupon');
        $discount_lines = array();

        foreach($order_coupons as $index => $coupon) {
            $discount_lines = array_merge($discount_lines,
                array(
                    array(
                        'code'   => $coupon['name'],
                        'type'   => $coupon['type'],
                        'amount' => round($coupon['discount_amount'] * 100)
                    )
                )
            );
        }

        //PARAMS VALIDATION
        $amountShipping = amount_validation($order->get_shipping_total());

        // Shipping Lines
        $shipping_method = $order->get_shipping_method();
        if (!empty($shipping_method)) {
            $shipping_lines  = array(
                array(
                    'amount'  => $amountShipping,
                    'carrier' => $shipping_method,
                    'method'  => $shipping_method
                )
            );

            //PARAM VALIDATION
            $name      = string_validation($order->get_shipping_first_name());
            $last      = string_validation($order->get_shipping_last_name());
            $address1  = string_validation($order->get_shipping_address_1());
            $address2  = string_validation($order->get_shipping_address_2());
            $city      = string_validation($order->get_shipping_city());
            $state     = string_validation($order->get_shipping_state());
            $country   = string_validation($order->get_shipping_country());
            $postal    = post_code_validation($order->get_shipping_postcode());


            $shipping_contact = array(
                'phone'    => $order->get_billing_phone(),
                'receiver' => sprintf('%s %s', $name, $last),
                'address' => array(
                    'street1'     => $address1,
                    'street2'     => $address2,
                    'city'        => $city,
                    'state'       => $state,
                    'country'     => $country,
                    'postal_code' => $postal
                ),
            );
        } else {
            $name      = string_validation($order->get_billing_first_name());
            $last      = string_validation($order->get_billing_last_name());
            $address1  = string_validation($order->get_billing_address_1());
            $address2  = string_validation($order->get_billing_address_2());
            $city      = string_validation($order->get_billing_city());
            $state     = string_validation($order->get_billing_state());
            $country   = string_validation($order->get_billing_country());
            $postal    = post_code_validation($order->get_billing_postcode());
            $shipping_lines  = array(
                array(
                    'amount'   => 0,
                    'carrier'  => 'carrier',
                    'method'   => 'pickup'
                )
            );
            $shipping_contact = array(
                'phone'    => $order->get_billing_phone(),
                'receiver' => sprintf('%s %s', $name, $last),
                'address' => array(
                    'street1'     => $address1,
                    'street2'     => $address2,
                    'city'        => $city,
                    'state'       => $state,
                    'country'     => $country,
                    'postal_code' => $postal
                ),
            );
        }

         //PARAM VALIDATION
        $customer_name = sprintf('%s %s', $order->get_billing_first_name(), $order->get_billing_last_name());
        $phone         = sanitize_text_field($order->get_billing_phone());

        // Customer Info
        $customer_info = array(
            'name'  => $customer_name,
            'phone' => $phone,
            'email' => $order->get_billing_email()
        );
       

        $amount               = validate_total($order->get_total());
        $currency             = get_woocommerce_currency();

        $data = array(
            'order_id'             => $order->get_id(),
            'amount'               => $amount,
            'currency'             => $currency,
            'description'          => sprintf('Charge for %s', $order->get_billing_email()),
            'customer_info'        => $customer_info,
            'shipping_lines'       => $shipping_lines
        );
        if (!empty($address1) && !empty($postal)) {
            $data = array_merge($data, array('shipping_contact' => $shipping_contact));
        }
        $customer_note = $order->get_customer_note();
        if (!empty($customer_note)) {
            $data = array_merge($data, array('customer_message' => $order->get_customer_note()));
        }

        if(!empty($discount_lines)) {
            $data = array_merge($data, array('discount_lines' => $discount_lines));
        }

        return $data;
    }

    return false;
}

function amount_validation(float $amount) : int
{
    return  $amount * 100;
}

function item_name_validation($item='')
{
    if((string)$item){
      return sanitize_text_field($item);
    }

    return $item;
}

function string_validation($string='')
{
    return $string;
}

function post_code_validation($post_code='')
{
    if(strlen($post_code) > 5){
        return substr($post_code,0, 5);
    }

    return $post_code;
}

function int_validation($input_field)
{
    if(is_numeric($input_field)){
        return sanitize_text_field(intval($input_field));
    }

    return $input_field;
}

function validate_total($total='')
{
    if(is_numeric($total)){
        return (float) $total * 100;
    }

    return $total;
}

/**
 * @param int $daysToAdd
 * @return int
 * @throws Exception
 */
function get_expired_at(int $daysToAdd): int
{
    $timeZone = new DateTimeZone('America/Mexico_City');
    $currentDate = new DateTime('now', $timeZone);
    $currentDate->add(new DateInterval("P{$daysToAdd}D"));
    return $currentDate->getTimestamp();
}