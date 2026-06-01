<?php
/**
 * Conekta REST API endpoints for the Integration component checkout request.
 */

if (!defined('ABSPATH')) {
    exit;
}

use Conekta\Model\OrderRequest;
use Conekta\Model\OrderUpdate;
use Conekta\Model\OrderUpdateCustomerInfo;
use Conekta\Model\OrderCheckoutRequest;
use Conekta\Model\CustomerShippingContactsRequest;

class WC_Conekta_REST_API {

    const SESSION_ORDER_ID            = 'conekta_checkout_order_id';
    const SESSION_CHECKOUT_REQUEST_ID = 'conekta_checkout_request_id';
    const SESSION_LAST_AMOUNT         = 'conekta_checkout_last_amount';
    const SESSION_LAST_SHIPPING_HASH  = 'conekta_checkout_last_shipping_hash';

    public static function init() {
        add_action('rest_api_init', [self::class, 'register_routes']);
        add_action('wc_ajax_conekta_checkout_request', [self::class, 'wc_ajax_checkout_request']);
        add_action('template_redirect', [self::class, 'reset_session_on_checkout_entry']);
    }

    /**
     * Force a fresh Conekta order each time the user enters the checkout page.
     *
     * Why: the cached conekta_order_id lives in the WC session (~48h cookie),
     * so leaving the checkout and coming back used to reuse the previous order
     * and only mutate it via PUT. That meant the customer could pay an amount
     * tied to a stale snapshot. By clearing the session keys on a fresh GET of
     * /checkout/ we guarantee the next checkout-request POST creates a brand
     * new order; updates within the same page load still reuse it normally.
     *
     * Skipped on order-received / order-pay endpoints, on form submissions,
     * and on AJAX so we never wipe state mid-flow.
     */
    public static function reset_session_on_checkout_entry(): void {
        // Store API / WP REST calls (e.g. wc/store/v1/cart/apply-coupon from
        // Blocks) don't fire template_redirect normally, but some setups still
        // route through it. Skip explicitly — clearing our session mid-flow
        // forces a CREATE on the next checkout-request POST and breaks the
        // update-reuse invariant the e2e relies on.
        if (defined('REST_REQUEST') && REST_REQUEST) return;
        if (!function_exists('is_checkout') || !is_checkout()) return;
        if (function_exists('is_wc_endpoint_url') && is_wc_endpoint_url()) return;
        if (!empty($_POST)) return;
        if (wp_doing_ajax()) return;
        if (!WC()->session) return;
        self::clear_session();
    }

    public static function register_routes() {
        register_rest_route('conekta/v1', '/checkout-request', [
            'methods'             => 'POST',
            'callback'            => [self::class, 'handle_checkout_request'],
            'permission_callback' => '__return_true',
        ]);
    }

    /**
     * AJAX entry — runs in the WC frontend session so WC()->cart and WC()->customer are populated.
     */
    public static function wc_ajax_checkout_request() {
        $json   = file_get_contents('php://input');
        $params = json_decode($json, true) ?: [];

        if (empty($params['nonce']) || !wp_verify_nonce(sanitize_text_field($params['nonce']), 'conekta-checkout-request')) {
            wp_send_json(['success' => false, 'message' => 'Invalid nonce'], 403);
            return;
        }

        $request = new WP_REST_Request('POST');
        $request->set_body_params($params);
        $response = self::handle_checkout_request($request);
        wp_send_json($response->get_data(), $response->get_status());
    }

    /**
     * Create-or-update the Conekta order that backs the Integration component.
     *
     *  - First call in a WC session  -> POST /orders (with checkout: Integration, card)
     *  - Subsequent calls            -> PUT  /orders/{id} (line_items + discount_lines + shipping_lines only)
     *
     * Reads everything from WC()->cart + WC()->customer — no payload-shape data.
     * customer_info and currency are NEVER sent on the update path: the Conekta
     * order keeps the customer it was created with.
     */
    public static function handle_checkout_request($request) {
        try {
            $gateway = self::get_gateway();
            if (!$gateway) {
                return new WP_REST_Response(['success' => false, 'message' => 'Conekta gateway not found'], 404);
            }

            // Validate-only mode runs WC's full checkout validation chain
            // (required fields, format, terms, plugin-added validators) and
            // returns errors WITHOUT creating/updating the Conekta order or
            // triggering the iframe charge. The classic JS calls this right
            // before driving the SDK submit so we never charge a card while
            // WC would have rejected the order on form errors.
            if ($request && $request->get_param('validate')) {
                return self::validate_only_response($request);
            }

            // Classic checkout fires the email-change handler before WC's
            // update_order_review syncs the form to WC()->customer. The client
            // sends the typed email so we can backfill the customer object,
            // keeping the snapshot read fully server-authoritative downstream.
            $email_from_body = $request ? $request->get_param('email') : null;
            if ($email_from_body && WC()->customer && !WC()->customer->get_billing_email()) {
                $clean_email = sanitize_email($email_from_body);
                if ($clean_email) {
                    WC()->customer->set_billing_email($clean_email);
                    WC()->customer->save();
                }
            }

            // Blocks: WC Blocks debounces its `wc/store/v1/cart/update-customer`
            // call separately from our useEffect, so when our POST hits the
            // server WC()->customer may still hold a stale shipping address.
            // The client now sends the live billing+shipping snapshot — apply
            // it directly so build_snapshot reads what the customer actually
            // typed, not what Blocks happened to sync last.
            $billing_body  = $request ? $request->get_param('billing')  : null;
            $shipping_body = $request ? $request->get_param('shipping') : null;
            self::apply_address_from_body(WC()->customer, 'billing',  $billing_body);
            self::apply_address_from_body(WC()->customer, 'shipping', $shipping_body);

            $snapshot = self::build_snapshot();

            if (empty($snapshot['line_items'])) {
                return new WP_REST_Response(['success' => false, 'message' => 'Cart is empty'], 400);
            }

            $existing_order_id    = WC()->session ? WC()->session->get(self::SESSION_ORDER_ID) : null;
            $existing_request_id  = WC()->session ? WC()->session->get(self::SESSION_CHECKOUT_REQUEST_ID) : null;
            $last_amount          = WC()->session ? WC()->session->get(self::SESSION_LAST_AMOUNT) : null;
            $last_shipping_hash   = WC()->session ? (WC()->session->get(self::SESSION_LAST_SHIPPING_HASH) ?: '') : '';
            $current_amount       = WC()->cart ? amount_validation((float) WC()->cart->get_total('edit')) : 0;
            // Hash the real shipping_contact from build_snapshot (NOT the
            // placeholder we may inject below on create). Lets the update
            // path detect "amount unchanged but the customer just typed
            // their address" and replace the 'Pendiente' fallback.
            $current_shipping_hash = self::shipping_contact_hash($snapshot['shipping_contact'] ?? []);

            $api = $gateway->get_api_instance($gateway->settings['cards_api_key'], $gateway->version);

            if ($existing_order_id && $existing_request_id) {
                if (
                    $last_amount !== null
                    && (int) $last_amount === (int) $current_amount
                    && $current_shipping_hash === $last_shipping_hash
                ) {
                    return new WP_REST_Response([
                        'success'             => true,
                        'mode'                => 'unchanged',
                        'conekta_order_id'    => $existing_order_id,
                        'checkout_request_id' => $existing_request_id,
                    ], 200);
                }

                try {
                    $balanced = ckpg_check_balance([
                        'line_items'     => $snapshot['line_items'],
                        'shipping_lines' => $snapshot['shipping_lines'],
                        'discount_lines' => $snapshot['discount_lines'],
                        'tax_lines'      => $snapshot['tax_lines'],
                    ], $current_amount);

                    $update = new OrderUpdate([
                        'line_items'     => $snapshot['line_items'],
                        'discount_lines' => $snapshot['discount_lines'],
                        'shipping_lines' => $snapshot['shipping_lines'],
                        'tax_lines'      => $balanced['tax_lines'],
                    ]);

                    // Backfill the real shipping_contact when it becomes
                    // available. The order may have been created with the
                    // 'Pendiente' placeholder (see below) before the customer
                    // typed the address. Without this update Conekta keeps the
                    // placeholder forever — visible on the merchant dashboard
                    // and breaks antifraud rules that key on the address.
                    if (!empty($snapshot['shipping_contact'])) {
                        $update->setShippingContact(new CustomerShippingContactsRequest($snapshot['shipping_contact']));
                    }

                    // Customer info (name + phone) can also drift after the
                    // initial create — e.g. the customer typed their phone in
                    // the shipping block (so build_snapshot resolves it via
                    // resolve_phone()) but the Conekta order was created
                    // earlier with billing_phone or the 0000000000 fallback.
                    // OrderUpdate accepts customer_info as of conekta-php
                    // 7.1.0, so push the latest values through.
                    if (!empty($snapshot['customer_info']['email'])) {
                        $update->setCustomerInfo(new OrderUpdateCustomerInfo($snapshot['customer_info']));
                    }

                    $api->updateOrder($existing_order_id, $update, $gateway->get_user_locale());

                    if (WC()->session) {
                        WC()->session->set(self::SESSION_LAST_AMOUNT, $current_amount);
                        WC()->session->set(self::SESSION_LAST_SHIPPING_HASH, $current_shipping_hash);
                    }

                    return new WP_REST_Response([
                        'success'             => true,
                        'mode'                => 'update',
                        'conekta_order_id'    => $existing_order_id,
                        'checkout_request_id' => $existing_request_id,
                    ], 200);
                } catch (\Exception $e) {
                    error_log('Conekta - update order failed, recreating: ' . $e->getMessage());
                    self::clear_session();
                }
            }

            // Customer info is only needed on creation; reject early if missing.
            if (empty($snapshot['customer_info']['email'])) {
                return new WP_REST_Response([
                    'success' => false,
                    'message' => 'customer email required to create checkout',
                    'code'    => 'missing_customer_email',
                ], 422);
            }

            // shipping_contact must be set at creation time so the SDK can
            // mount and render the payment form. If the customer hasn't typed
            // the address yet, seed it with the 'Pendiente' placeholder — the
            // update branch above will overwrite it with the real address
            // once WC()->customer has it. The WC order itself captures the
            // real address at process_payment time regardless.
            if (empty($snapshot['shipping_contact'])) {
                $snapshot['shipping_contact'] = [
                    'phone'    => '0000000000',
                    'receiver' => $snapshot['customer_info']['name'] ?: 'Cliente',
                    'address'  => [
                        'street1'     => 'Pendiente',
                        'postal_code' => '00000',
                        'city'        => 'Pendiente',
                        'state'       => 'Pendiente',
                        'country'     => 'MX',
                    ],
                ];
            }

            $msi_options = array_values(array_filter(
                array_map('intval', (array) ($gateway->settings['months'] ?? [])),
                fn($v) => $v > 0
            ));
            $checkout_data = [
                'type'                    => OrderCheckoutRequest::TYPE_INTEGRATION,
                'allowed_payment_methods' => self::build_allowed_payment_methods($gateway),
                'name'                    => 'WooCommerce checkout',
            ];

            if (!empty($msi_options)) {
                $checkout_data['monthly_installments_enabled'] = true;
                $checkout_data['monthly_installments_options'] = $msi_options;
            }

            $checkout = new OrderCheckoutRequest($checkout_data);

            $balanced = ckpg_check_balance([
                'line_items'     => $snapshot['line_items'],
                'shipping_lines' => $snapshot['shipping_lines'],
                'discount_lines' => $snapshot['discount_lines'],
                'tax_lines'      => $snapshot['tax_lines'],
            ], $current_amount);

            $order_request = new OrderRequest([
                'currency'       => $snapshot['currency'],
                'line_items'     => $snapshot['line_items'],
                'discount_lines' => $snapshot['discount_lines'],
                'shipping_lines' => $snapshot['shipping_lines'],
                'tax_lines'      => $balanced['tax_lines'],
                'customer_info'  => $snapshot['customer_info'],
                'checkout'       => $checkout,
                'metadata'       => [
                    'plugin'                 => 'woocommerce',
                    'plugin_conekta_version' => $gateway->version,
                    'woocommerce_version'    => WC()->version,
                    'payment_method'         => 'WC_Conekta_Gateway',
                ],
            ]);

            if (!empty($snapshot['shipping_contact'])) {
                $order_request->setShippingContact(new CustomerShippingContactsRequest($snapshot['shipping_contact']));
            }

            $conekta_order = $api->createOrder($order_request, $gateway->get_user_locale());

            $conekta_order_id    = $conekta_order->getId();
            $checkout_request_id = $conekta_order->getCheckout() ? $conekta_order->getCheckout()->getId() : null;

            if (WC()->session) {
                WC()->session->set(self::SESSION_ORDER_ID, $conekta_order_id);
                WC()->session->set(self::SESSION_CHECKOUT_REQUEST_ID, $checkout_request_id);
                WC()->session->set(self::SESSION_LAST_AMOUNT, $current_amount);
                WC()->session->set(self::SESSION_LAST_SHIPPING_HASH, $current_shipping_hash);
            }

            return new WP_REST_Response([
                'success'             => true,
                'mode'                => 'create',
                'conekta_order_id'    => $conekta_order_id,
                'checkout_request_id' => $checkout_request_id,
            ], 200);

        } catch (\Exception $e) {
            error_log('Conekta - checkout-request failed: ' . $e->getMessage());
            return new WP_REST_Response([
                'success' => false,
                'message' => $e->getMessage(),
            ], 500);
        }
    }

    /**
     * Read everything Conekta needs from the live WC()->cart + WC()->customer.
     * WooCommerce keeps both in sync via update_order_review (classic) and
     * wc/store/v1/cart/update-customer (blocks) before our debounced POST fires.
     */
    private static function build_snapshot(): array {
        $line_items     = [];
        $discount_lines = [];
        $shipping_lines = [];
        $tax_lines      = [];
        $currency       = get_woocommerce_currency() ?: 'MXN';

        if (WC()->cart && !WC()->cart->is_empty()) {
            WC()->cart->calculate_totals();

            $tax_lines = ckpg_build_tax_lines_from_cart(WC()->cart);

            $price_level_discount = 0;
            foreach (WC()->cart->get_cart() as $cart_item) {
                $product = $cart_item['data'];
                if (!$product) continue;

                $unit_price_cents = amount_validation((float) $cart_item['line_subtotal'] / max(1, (int) $cart_item['quantity']));
                $regular_price    = (float) $product->get_regular_price();
                if ($regular_price > 0) {
                    $regular_unit_cents = amount_validation($regular_price);
                    if ($regular_unit_cents > $unit_price_cents) {
                        $price_level_discount += ($regular_unit_cents - $unit_price_cents) * (int) $cart_item['quantity'];
                        $unit_price_cents      = $regular_unit_cents;
                    }
                }

                $line_items[] = [
                    'name'       => item_name_validation($product->get_name()),
                    'unit_price' => $unit_price_cents,
                    'quantity'   => (int) $cart_item['quantity'],
                ];
            }

            foreach (WC()->cart->get_applied_coupons() as $code) {
                $amount = WC()->cart->get_coupon_discount_amount($code);
                if ($amount > 0) {
                    $discount_lines[] = [
                        'code'   => $code,
                        'amount' => amount_validation($amount),
                        'type'   => 'coupon',
                    ];
                }
            }

            foreach (WC()->cart->get_fees() as $fee) {
                if ($fee->total < 0) {
                    $discount_lines[] = [
                        'code'   => $fee->name ?: 'discount',
                        'amount' => amount_validation(abs($fee->total)),
                        'type'   => 'campaign',
                    ];
                }
            }

            if ($price_level_discount > 0) {
                $discount_lines[] = [
                    'code'   => 'dynamic_pricing',
                    'amount' => $price_level_discount,
                    'type'   => 'campaign',
                ];
            }

            $chosen_methods = WC()->session ? (WC()->session->get('chosen_shipping_methods') ?: []) : [];
            $shipping_total = amount_validation(WC()->cart->get_shipping_total());
            if ($shipping_total > 0 && !empty($chosen_methods[0])) {
                $method_label = $chosen_methods[0];
                foreach (WC()->shipping()->get_packages() as $package) {
                    if (isset($package['rates'][$chosen_methods[0]])) {
                        $method_label = $package['rates'][$chosen_methods[0]]->get_label();
                        break;
                    }
                }
                $shipping_lines[] = [
                    'amount'  => $shipping_total,
                    'carrier' => $method_label,
                    'method'  => $method_label,
                ];
            }
        }

        $customer_info    = [];
        $shipping_contact = [];
        if (WC()->customer) {
            $email = sanitize_email(WC()->customer->get_billing_email());
            if (!empty($email)) {
                $name = trim(WC()->customer->get_billing_first_name() . ' ' . WC()->customer->get_billing_last_name());
                // Both phone slots prefer the shipping_phone with billing as
                // fallback. Why shipping first for BOTH:
                //   - When "use same address for billing" is on, WC Blocks
                //     copies the shipping address to billing but does NOT
                //     sync the phone field — billing_phone keeps its previous
                //     (often stale) value. Preferring shipping_phone makes
                //     customer_info reflect what the customer just typed.
                //   - When the customer enters distinct addresses with
                //     distinct phones, shipping_phone is the freshly-entered
                //     one in the visible Dirección de envío block; that is a
                //     reasonable default contact for the order.
                //   - Falling back to billing_phone covers the legacy classic
                //     checkout flow that only has a single phone field.
                $billing_phone  = sanitize_text_field(WC()->customer->get_billing_phone());
                $shipping_phone = method_exists(WC()->customer, 'get_shipping_phone')
                    ? sanitize_text_field(WC()->customer->get_shipping_phone())
                    : '';
                $customer_phone = self::resolve_phone($billing_phone, $shipping_phone);
                $contact_phone  = self::resolve_phone($billing_phone, $shipping_phone);

                $customer_info = [
                    'email' => $email,
                    'name'  => $name ?: 'Cliente',
                    'phone' => $customer_phone ?: '0000000000',
                ];

                // Conekta requires shipping_contact to charge an order. Fall back
                // to billing fields when shipping is unset (matches WC's "ship to
                // same address" default).
                $first    = WC()->customer->get_shipping_first_name() ?: WC()->customer->get_billing_first_name();
                $last     = WC()->customer->get_shipping_last_name() ?: WC()->customer->get_billing_last_name();
                $address1 = WC()->customer->get_shipping_address_1() ?: WC()->customer->get_billing_address_1();
                $city     = WC()->customer->get_shipping_city() ?: WC()->customer->get_billing_city();
                $state    = WC()->customer->get_shipping_state() ?: WC()->customer->get_billing_state();
                $country  = WC()->customer->get_shipping_country() ?: WC()->customer->get_billing_country();
                $postcode = WC()->customer->get_shipping_postcode() ?: WC()->customer->get_billing_postcode();

                if (!empty($address1) && !empty($postcode)) {
                    $shipping_contact = [
                        'phone'    => $contact_phone ?: '0000000000',
                        'receiver' => trim("$first $last") ?: ($name ?: 'Cliente'),
                        'address'  => [
                            'street1'     => $address1,
                            'city'        => $city,
                            'state'       => $state,
                            'country'     => $country ?: 'MX',
                            'postal_code' => $postcode,
                        ],
                    ];
                }
            }
        }

        return [
            'currency'         => $currency,
            'line_items'       => $line_items,
            'discount_lines'   => $discount_lines,
            'shipping_lines'   => $shipping_lines,
            'tax_lines'        => $tax_lines,
            'customer_info'    => $customer_info,
            'shipping_contact' => $shipping_contact,
        ];
    }

    private static function get_gateway() {
        $gateways = WC()->payment_gateways->payment_gateways();
        return $gateways['conekta'] ?? null;
    }

    /**
     * Translate the gateway's wallets_enabled setting into the
     * allowed_payment_methods array sent to Conekta. Apple/Google are kept
     * as raw strings because the SDK enum doesn't expose constants for them.
     */
    public static function build_allowed_payment_methods($gateway): array {
        $wallets_enabled = isset($gateway->settings['wallets_enabled'])
            ? $gateway->settings['wallets_enabled'] === 'yes'
            : true;

        return $wallets_enabled
            ? [OrderCheckoutRequest::ALLOWED_PAYMENT_METHODS_CARD, 'apple', 'google']
            : [OrderCheckoutRequest::ALLOWED_PAYMENT_METHODS_CARD];
    }

    /**
     * Stable hash of the shipping_contact array — used to detect address
     * changes between checkout-request POSTs. Empty/missing contact returns
     * an empty string so the "first POST with placeholder" path keeps the
     * stored hash empty until a real address arrives.
     */
    public static function shipping_contact_hash(array $contact): string {
        return !empty($contact) ? md5(json_encode($contact)) : '';
    }

    /**
     * Pick the phone that should be sent to Conekta when we have two
     * candidates from WC()->customer. The shipping phone wins because
     * WC Blocks does NOT sync the phone field on the "use same address for
     * billing" toggle (only addresses), so billing_phone is frequently
     * stale relative to what the customer just typed. Billing is the
     * fallback for the classic flow that only has one phone field.
     */
    public static function resolve_phone(string $billing_phone, string $shipping_phone): string {
        return $shipping_phone ?: $billing_phone;
    }

    /**
     * Hydrate WC()->customer with a billing/shipping address sent in the
     * /checkout-request body. Each field is only applied when non-empty —
     * we want to fill stale slots, not blank out fields the customer
     * already set elsewhere. Returns the list of field keys that were
     * actually written, so callers (and tests) can verify the effect.
     *
     * Why we bypass WC()->customer: WC Blocks debounces its own server
     * sync via `wc/store/v1/cart/update-customer`. Our debounced POST can
     * win that race and observe a stale shipping address, which produces
     * a cache-hit ("mode=unchanged") and leaves the Conekta order with
     * the old shipping_contact.
     */
    public static function apply_address_from_body($customer, string $type, $address): array {
        if (!$customer || !in_array($type, ['billing', 'shipping'], true) || !is_array($address)) {
            return [];
        }
        $fields = ['first_name', 'last_name', 'address_1', 'city', 'state', 'postcode', 'country', 'phone'];
        $written = [];
        foreach ($fields as $field) {
            if (empty($address[$field])) continue;
            $setter = "set_{$type}_{$field}";
            if (method_exists($customer, $setter)) {
                $customer->{$setter}(sanitize_text_field((string) $address[$field]));
                $written[] = $field;
            }
        }
        return $written;
    }

    public static function clear_session(): void {
        if (!WC()->session) return;
        WC()->session->__unset(self::SESSION_ORDER_ID);
        WC()->session->__unset(self::SESSION_CHECKOUT_REQUEST_ID);
        WC()->session->__unset(self::SESSION_LAST_AMOUNT);
        WC()->session->__unset(self::SESSION_LAST_SHIPPING_HASH);
    }

    /**
     * Run WC's checkout validation against the submitted form data and return
     * any errors that would otherwise block process_checkout. We hook into
     * woocommerce_after_checkout_validation at PHP_INT_MAX (so we observe
     * errors collected by every other listener) and throw a sentinel exception
     * to abort process_checkout before order creation / payment.
     */
    private static function validate_only_response($request): WP_REST_Response {
        if (!class_exists('WC_Checkout')) {
            return new WP_REST_Response([
                'success' => false,
                'message' => 'WC checkout unavailable',
            ], 500);
        }

        $form_data = $request->get_param('form_data');
        if (!is_array($form_data) || empty($form_data)) {
            return new WP_REST_Response([
                'success' => false,
                'message' => 'form_data required',
            ], 400);
        }

        $original_post = $_POST;
        // process_checkout reads $_POST exclusively, so feed it the form
        // values verbatim — including the customer's _wpnonce so WC's own
        // checkout-process nonce check passes.
        $_POST = $form_data;

        $captured = new WP_Error();
        $sentinel = 'CONEKTA_VALIDATE_ONLY';
        $listener = function ($data, $errors) use ($captured, $sentinel) {
            foreach ($errors->get_error_codes() as $code) {
                foreach ($errors->get_error_messages($code) as $msg) {
                    $captured->add($code, $msg);
                }
            }
            throw new \Exception($sentinel);
        };
        add_action('woocommerce_after_checkout_validation', $listener, PHP_INT_MAX, 2);

        try {
            WC()->checkout()->process_checkout();
        } catch (\Exception $e) {
            if ($e->getMessage() !== $sentinel) {
                $captured->add('checkout_exception', wp_strip_all_tags($e->getMessage()));
            }
        } finally {
            remove_action('woocommerce_after_checkout_validation', $listener, PHP_INT_MAX);
            $_POST = $original_post;
            if (function_exists('wc_clear_notices')) {
                wc_clear_notices();
            }
        }

        if ($captured->has_errors()) {
            $messages = [];
            foreach ($captured->get_error_codes() as $code) {
                foreach ($captured->get_error_messages($code) as $msg) {
                    $messages[] = [
                        'code'    => $code,
                        'message' => wp_strip_all_tags($msg),
                    ];
                }
            }
            return new WP_REST_Response([
                'success' => false,
                'mode'    => 'validate',
                'errors'  => $messages,
            ], 422);
        }

        return new WP_REST_Response([
            'success' => true,
            'mode'    => 'validate',
        ], 200);
    }
}

add_action('init', ['WC_Conekta_REST_API', 'init']);
