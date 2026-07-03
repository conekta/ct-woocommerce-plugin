<?php

/*
 * Title   : Conekta Payment Extension for WooCommerce
 * Author  : Cristina Randall
 * Url     : https://developers.conekta.com/docs/woocommerce
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

    // unit_price is line_subtotal/qty rounded to cents, so unit_price * quantity
    // (plus tax rounding) can drift a cent or two from the real WooCommerce
    // total in EITHER direction. Reconcile so the order total matches $total
    // exactly, keeping the tax line at its true value:
    //   - charging too little  -> add the missing cents to tax.
    //   - charging too much     -> refund the extra cents as a round_adjustment
    //                              discount (never reduce the reported tax).
    $delta = intval($total) - $amount;
    if ($delta > 0) {
        if (empty($order['tax_lines'])) {
            $order['tax_lines'] = [['amount' => 0, 'description' => 'Round Adjustment']];
        }
        $order['tax_lines'][0]['amount'] += $delta;
        if (empty($order['tax_lines'][0]['description'])) {
            $order['tax_lines'][0]['description'] = 'Round Adjustment';
        }
    } elseif ($delta < 0) {
        if (empty($order['discount_lines'])) {
            $order['discount_lines'] = [];
        }
        $order['discount_lines'][] = [
            'code'   => 'round_adjustment',
            'amount' => abs($delta),
            'type'   => 'campaign',
        ];
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
        'payment_method' => $data['payment_method'],
    );

    if (!empty($data['customer_message'])) {
        $metadata = array_merge(
            $metadata, array(
                'customer_message' => $data['customer_message'])
        );
    }

    return $metadata;
}

/**
 * Whether the unit_price reported to Conekta for this product already
 * includes tax. True only when the store enters prices tax-inclusive AND the
 * product is actually taxable (a tax-exempt product never carries tax even in
 * an inclusive store).
 */
function ckpg_item_tax_included(?WC_Product $product): bool
{
    if (!function_exists('wc_prices_include_tax') || !wc_prices_include_tax()) {
        return false;
    }
    if ($product && method_exists($product, 'is_taxable')) {
        return (bool) $product->is_taxable();
    }
    return true;
}

function ckpg_build_line_items($items, $version, &$price_level_discount = 0)
{
    $line_items = array();
    $price_level_discount = 0;

    foreach ($items as $item) {

        $sub_total   = floatval($item['line_subtotal']) * 1000;
        $sub_total   = $sub_total / floatval($item['qty']);
        $productmeta = new WC_Product($item['product_id']);
        $sku         = $productmeta->get_sku();
        $unit_price  = $sub_total;
        $item_name   = item_name_validation($item['name']);
        $unit_price  = intval(round(floatval($unit_price) / 10), 2);
        $quantity    = intval($item['qty']);

        // Send the effective unit price the customer actually pays (net of tax;
        // tax is itemized in tax_lines). We intentionally do NOT report the
        // regular price plus a `dynamic_pricing` discount line for sales /
        // dynamic-pricing plugins — that confused merchants. Real coupons and
        // negative fees remain explicit discount_lines. $price_level_discount is
        // kept at 0 for backward compatibility with callers.
        $variation_id = isset($item['variation_id']) ? intval($item['variation_id']) : 0;
        $price_product = $variation_id ? wc_get_product($variation_id) : $productmeta;
        $tags = wp_get_post_terms($item['product_id'], 'product_tag', array('fields' => 'names'));
        $brands = wp_get_post_terms($item['product_id'], 'product_brand', array('fields' => 'names'));

        $line_item_params = array(
            'name'        => $item_name,
            'unit_price'  => $unit_price,
            'quantity'    => $quantity,
            'tags'        => array_merge(['WooCommerce', "Conekta ".$version], $tags),
            'metadata'    => array(
                                    'soft_validations' => true,
                                    'images' =>  $productmeta->get_gallery_image_ids(),
                                    'tax_included' => ckpg_item_tax_included($price_product ?: $productmeta),
                                  ),
           'description' => $productmeta->get_description() ?: 'no description',
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
        // WooCommerce >= 3.0 returns WC_Order_Item_Tax objects whose ArrayAccess
        // keys are `tax_total` / `shipping_tax_total`. Older code paths (and the
        // legacy test fixtures) used `tax_amount` / `shipping_tax_amount`.
        $items_tax    = (float) ($tax['tax_total'] ?? $tax['tax_amount'] ?? 0);
        $shipping_tax = (float) ($tax['shipping_tax_total'] ?? $tax['shipping_tax_amount'] ?? 0);
        $label        = esc_html((string) ($tax['label'] ?? ''));

        if ($items_tax != 0) {
            $tax_lines[] = array(
                'description' => $label,
                'amount'      => amount_validation($items_tax),
            );
        }

        if ($shipping_tax != 0) {
            $tax_lines[] = array(
                'description' => 'Shipping tax',
                'amount'      => amount_validation($shipping_tax),
            );
        }
    }

    return $tax_lines;
}

/**
 * Build Conekta tax_lines from a live WC_Cart (Integration component path).
 *
 * Adapts WC()->cart->get_tax_totals() — which is keyed by rate code and
 * exposes ->label / ->amount (line-item tax in pesos) / ->shipping_amount
 * — into the row shape ckpg_build_tax_lines() already consumes from
 * $order->get_taxes(). Single source of truth for cents conversion and
 * zero-shipping-tax guarding.
 */
function ckpg_build_tax_lines_from_cart($cart): array
{
    if (!$cart || !method_exists($cart, 'get_tax_totals')) {
        return array();
    }

    $totals = $cart->get_tax_totals();
    if (empty($totals)) {
        return array();
    }

    $rows = array();
    foreach ($totals as $entry) {
        $rows[] = array(
            'tax_amount'          => (float) ($entry->amount ?? 0),
            'shipping_tax_amount' => (float) ($entry->shipping_amount ?? 0),
            'label'               => (string) ($entry->label ?? ''),
        );
    }

    return ckpg_build_tax_lines($rows);
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
                            'type'=> in_array($discount['type'] ?? '', ['coupon', 'campaign', 'loyalty', 'sign'])
                                    ? $discount['type']
                                    : 'coupon'
                        )
                    )
                );
            }
        }

    return $discount_lines;
}

/**
 * Append a price-level discount to $discount_lines only if one doesn't already exist.
 * Prevents double-counting when multiple code paths detect the same discount.
 */
function ckpg_add_price_level_discount(array &$discount_lines, int $amount): void
{
    if ($amount <= 0) return;

    $already_exists = array_filter($discount_lines, fn($d) => ($d['code'] ?? '') === 'dynamic_pricing');
    if (!empty($already_exists)) return;

    $discount_lines[] = ['code' => 'dynamic_pricing', 'amount' => $amount, 'type' => 'campaign'];
}

/**
 * Conekta rejects a shipping_contact whose address.street1 is too short
 * (shipping_contact.address.street1.too_short / "contiene menos de 1
 * caracteres") and hard-fails the checkout with a 422. street1 accepts dashes
 * (e.g. "----a" is valid), so left-pad it with '-' up to a minimum of 5
 * characters; a street already >= 5 chars is returned unchanged.
 */
function ckpg_pad_street1(string $street): string
{
    return str_pad(trim($street), 5, '-', STR_PAD_LEFT);
}

/**
 * Conekta rejects a blank city with shipping_contact.address.city.invalid
 * ("Formato inválido para city") and, unlike street1, its format check does
 * NOT accept dashes — nor does metadata.soft_validations relax it. Fall back
 * to a plain "default" token, which clears the format check. A non-blank value
 * is returned trimmed and unchanged.
 */
function ckpg_default_if_blank(string $value): string
{
    $value = trim($value);
    return $value !== '' ? $value : 'default';
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

function ckpg_build_get_fees($fees): array
{
    $negative_fees = array();
    $positive_fees = array();

    foreach ($fees as $fee) {
        $price      = $fee->get_total();
        $fee_amount = floatval($price) * 1000;
        $fee_name   = (string)$fee->get_name();
        $fee_name   = esc_html($fee_name);
        $fee_amount_formatted = intval(round(floatval($fee_amount) / 10), 2);

        if ($price >= 0) {
            $positive_fees[] = array(
                'description' => $fee_name,
                'amount'      => $fee_amount_formatted
            );
        } else {
            $negative_fees[] = array(
                'code'   => $fee_name,
                'amount' => $fee_amount_formatted * -1,
                'type'   => 'campaign'
            );
        }
    } 

    $data = array(
        'discounts' => $negative_fees,
        'fees' => $positive_fees,
    );

    return $data;
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
                    'street1'     => ckpg_pad_street1($address1),
                    'street2'     => $address2,
                    'city'        => ckpg_default_if_blank($city),
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
                    'street1'     => ckpg_pad_street1($address1),
                    'street2'     => $address2,
                    'city'        => ckpg_default_if_blank($city),
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
    return (int) round($amount * 100);
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

/**
 * @param int $minutesToAdd
 * @return int
 * @throws Exception
 */
function get_expired_at_minutes(int $minutesToAdd): int
{
    $currentDate = new DateTime('now', new DateTimeZone('UTC'));
    $currentDate->add(new DateInterval("PT{$minutesToAdd}M"));
    return $currentDate->getTimestamp();
}

/**
 * Log informational messages
 * 
 * @param string $message Message to log
 * @param array $context Additional context data
 */
function info_log($message, $context = [])
{
    if (!empty($context)) {
        $message .= ' | Context: ' . json_encode($context);
    }
    error_log('[INFO] ' . $message);
}