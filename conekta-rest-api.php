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

    // State for the in-flight Integration component checkout lives in a
    // WP transient instead of WC()->session. The Store API endpoints that
    // Blocks fires between our POSTs (e.g. wc/store/v1/cart/apply-coupon)
    // load wp_woocommerce_session, write back only their known cart keys,
    // and silently drop anything else — including the conekta_checkout_*
    // keys we tried to keep there. The transient sidesteps that race
    // entirely. TTL matches WC's 48h session expiry.
    const STATE_TRANSIENT_PREFIX = 'conekta_checkout_state_';
    const STATE_TRANSIENT_TTL    = 48 * 3600; // 48h in seconds (WC session expiry)

    // Placeholders sent to Conekta when the shopper hasn't provided the data
    // yet (the order is created early to mount the iframe). Centralized so the
    // "is this still a placeholder?" checks and the fallbacks stay in sync.
    const DEFAULT_CUSTOMER_NAME = 'Cliente';
    const DEFAULT_PHONE         = '0000000000';

    // Response mode returned by /checkout-request when the Conekta order backing
    // this checkout is ALREADY PAID: no new order is created and no new iframe
    // must be mounted, or the customer would pay twice. See paid_order_recovery.
    const MODE_ALREADY_PAID = 'already_paid';

    // WC order statuses searched when resolving the WooCommerce order behind a
    // conekta-order-id. Mirrors WC_Conekta_Plugin::find_order_for_webhook:
    // 'checkout-draft' is included because a Blocks charge can land while the
    // order is still a draft, and wc_get_orders() omits drafts by default.
    const RECOVERY_LOOKUP_STATUSES = ['pending', 'processing', 'on-hold', 'completed', 'failed', 'checkout-draft'];

    // Statuses that mean "this WC order already collected its payment".
    const PAID_STATUSES = ['processing', 'completed'];

    // WC order statuses that can still be holding an in-flight (possibly
    // already charged) payment.
    const UNPAID_STATUSES = ['pending', 'failed', 'on-hold', 'checkout-draft'];

    // How far back to look for a WooCommerce order that may be holding an
    // orphaned payment. Long enough for a customer to come back after a 3DS
    // mishap or a lost confirm, short enough that a stale orphan doesn't shadow
    // a genuinely new purchase days later.
    const ORPHAN_LOOKBACK = 6 * 3600;

    // Returned when a payment attempt exists but Conekta cannot be reached to
    // tell whether it was charged. We refuse to create a payable order in that
    // state — a blocked checkout is recoverable, a double charge is not.
    const CODE_VERIFICATION_UNAVAILABLE = 'payment_verification_unavailable';

    public static function init() {
        add_action('rest_api_init', [self::class, 'register_routes']);
        add_action('wc_ajax_conekta_checkout_request', [self::class, 'wc_ajax_checkout_request']);
        add_action('wc_ajax_conekta_confirm_order', [self::class, 'wc_ajax_confirm_order']);
        add_action('template_redirect', [self::class, 'reset_session_on_checkout_entry']);
    }

    /**
     * Order-first classic flow, final step: the SDK charged the card (onOrder
     * fired) and the JS asks us to complete the WC order that was created
     * BEFORE the charge. Reuses complete_wc_order_from_conekta(), which
     * verifies the Conekta order is actually paid, matches the amount and
     * guards against applying one payment to two orders.
     *
     * Auth: checkout nonce + the order key (only the customer who placed the
     * order has it). Even without both, the endpoint could not mark anything
     * paid that Conekta doesn't report as paid.
     */
    public static function wc_ajax_confirm_order() {
        $json   = file_get_contents('php://input');
        $params = json_decode($json, true) ?: [];

        if (empty($params['nonce']) || !wp_verify_nonce(sanitize_text_field($params['nonce']), 'conekta-checkout-request')) {
            wp_send_json(['success' => false, 'message' => 'Invalid nonce'], 403);
            return;
        }

        $order_id         = absint($params['order_id'] ?? 0);
        $order_key        = sanitize_text_field((string) ($params['order_key'] ?? ''));
        $conekta_order_id = sanitize_text_field((string) ($params['conekta_order_id'] ?? ''));

        $order = $order_id ? wc_get_order($order_id) : false;
        if (!$order || $order_key === '' || !hash_equals($order->get_order_key(), $order_key)) {
            wp_send_json(['success' => false, 'message' => 'Order not found'], 404);
            return;
        }
        if ($conekta_order_id === '') {
            wp_send_json(['success' => false, 'message' => 'conekta_order_id required'], 400);
            return;
        }

        // The order was linked to its Conekta order in process_payment,
        // BEFORE the charge. A confirm for a different Conekta id is not
        // this order's payment — reject instead of re-linking.
        $linked = (string) $order->get_meta('conekta-order-id');
        if ($linked !== '' && $linked !== $conekta_order_id) {
            wp_send_json(['success' => false, 'message' => 'conekta_order_id does not match this order'], 409);
            return;
        }

        $gateway = self::get_gateway();
        if (!$gateway) {
            wp_send_json(['success' => false, 'message' => 'Conekta gateway not found'], 404);
            return;
        }

        // Idempotent retry (double onOrder, JS retry after timeout): already
        // paid means there's nothing left to do but hand back the redirect.
        if (in_array($order->get_status(), ['processing', 'completed'], true)) {
            wp_send_json([
                'success'  => true,
                'redirect' => $gateway->get_return_url($order),
            ]);
            return;
        }

        $outcome = $gateway->complete_wc_order_from_conekta($order, $conekta_order_id);

        if (!empty($outcome['success'])) {
            wp_send_json([
                'success'  => true,
                'redirect' => $gateway->get_return_url($order),
            ]);
            return;
        }

        if (!empty($outcome['duplicate']) && !empty($outcome['existing_order'])) {
            wp_send_json([
                'success'  => true,
                'redirect' => $gateway->get_return_url($outcome['existing_order']),
            ]);
            return;
        }

        error_log(sprintf(
            'Conekta - confirm_order: FAILED for WC order #%d (Conekta order %s): %s',
            $order_id,
            $conekta_order_id,
            $outcome['error'] ?? 'unknown'
        ));
        wp_send_json([
            'success' => false,
            'message' => $outcome['error'] ?? 'unknown',
        ], 422);
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

            // Classic checkout fires the email-change handler before WC's
            // update_order_review syncs the form to WC()->customer. The client
            // sends the typed email so we can backfill the customer object,
            // keeping the snapshot read fully server-authoritative downstream.
            // Apply it whenever it differs (not only when missing) so a corrected
            // email actually propagates.
            $email_from_body = $request ? $request->get_param('email') : null;
            if ($email_from_body && WC()->customer) {
                $clean_email = sanitize_email($email_from_body);
                if ($clean_email && $clean_email !== WC()->customer->get_billing_email()) {
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

            $state                = self::state_get();
            $existing_order_id    = $state['order_id']           ?? null;
            $existing_request_id  = $state['checkout_request_id'] ?? null;
            $last_amount          = $state['last_amount']        ?? null;
            $last_shipping_hash   = $state['last_shipping_hash'] ?? '';
            $current_amount       = WC()->cart ? amount_validation((float) WC()->cart->get_total('edit')) : 0;
            // Hash the real shipping_contact from build_snapshot (NOT the
            // placeholder we may inject below on create). Lets the update
            // path detect "amount unchanged but the customer just typed
            // their address" and replace the 'Pendiente' fallback.
            $current_shipping_hash = self::shipping_contact_hash($snapshot['shipping_contact'] ?? []);

            // The order is created early (as soon as we have the email, to mount
            // the iframe) before the shopper typed their name, so customer_info
            // defaults to the 'Cliente' / 0000000000 placeholders. When the real
            // name finally arrives, RECREATE the order: Conekta freezes the
            // embedded customer at creation and only OrderUpdate.shipping_contact
            // is updatable, so a placeholder->real name can't be patched in.
            // (An email change, by contrast, is pushed via the update path below
            // — the order isn't paid yet, so updateOrder still accepts it.)
            $current_customer_name = $snapshot['customer_info']['name'] ?? '';
            $current_email         = $snapshot['customer_info']['email'] ?? '';
            $customer_became_real  = self::customer_became_real($state['customer_name'] ?? '', $current_customer_name);

            $api = $gateway->get_api_instance($gateway->settings['cards_api_key'], $gateway->version);

            if ($existing_order_id && $customer_became_real) {
                // Never drop a PAID order to recreate it with a nicer customer
                // name — that's a second payable order in front of a customer
                // who already paid. See paid_order_recovery.
                $recovered = self::paid_order_recovery($gateway, $api, $existing_order_id);
                if ($recovered) {
                    return new WP_REST_Response($recovered, 200);
                }
                self::clear_session();
                $existing_order_id   = null;
                $existing_request_id = null;
            }

            // Force WC to commit the session cookie so our writes below
            // persist. For a brand-new guest with no wp_woocommerce_session
            // cookie yet, WC_Session_Handler::has_session() returns false,
            // and save_data() is a no-op even after we ->set() keys. The
            // upshot is silent: the response succeeds, the keys appear set
            // in memory, but the next request loads an empty session and
            // our existing_order_id lookup returns null — falling back
            // into a create with a brand-new Conekta order on every POST.
            // set_customer_session_cookie(true) flips _has_cookie and
            // sends Set-Cookie in the response so the shutdown save runs.
            if (WC()->session && method_exists(WC()->session, 'set_customer_session_cookie')) {
                WC()->session->set_customer_session_cookie(true);
            }

            if ($existing_order_id && $existing_request_id) {
                // Link the Blocks draft WC order to this Conekta order as early
                // as possible (every request, before the unchanged short-circuit
                // below) so the order.paid webhook can always recover it — even
                // if process_payment_api never runs. Local, idempotent, no-op on
                // classic. See link_draft_order_to_conekta.
                self::link_draft_order_to_conekta($existing_order_id);

                // Also key "unchanged" on the email: it's not part of the
                // shipping_hash, so without this an email correction would
                // short-circuit here and never reach the setCustomerInfo update.
                if (
                    $last_amount !== null
                    && (int) $last_amount === (int) $current_amount
                    && $current_shipping_hash === $last_shipping_hash
                    && $current_email === ($state['customer_email'] ?? '')
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
                        'discount_lines' => $balanced['discount_lines'],
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
                    // resolve_address_source()) but the Conekta order was
                    // created earlier with the placeholder fallbacks.
                    // OrderUpdate accepts customer_info as of conekta-php
                    // 7.1.0, so push the latest values through (pre-payment;
                    // a paid order can't be updated).
                    if (!empty($snapshot['customer_info']['email'])) {
                        $update->setCustomerInfo(new OrderUpdateCustomerInfo($snapshot['customer_info']));
                    }

                    // Backfill reference_id on the Conekta order once the Blocks
                    // draft exists — it's null on create when the order was
                    // created before the draft. Pre-payment the metadata is still
                    // mutable. Resend the COMPLETE metadata (not a partial patch)
                    // so the plugin/version/checkout_type keys survive. This is
                    // the webhook's primary lookup; the reverse conekta-order-id
                    // meta stamped on the draft (link_draft_order_to_conekta) is
                    // its fallback.
                    $draft_id = self::get_blocks_draft_order_id();
                    if ($draft_id) {
                        $update->setMetadata(self::build_conekta_metadata(
                            $gateway,
                            self::resolve_checkout_type($request),
                            $draft_id
                        ));
                    }

                    $api->updateOrder($existing_order_id, $update, $gateway->get_user_locale());

                    self::state_set([
                        'order_id'           => $existing_order_id,
                        'checkout_request_id'=> $existing_request_id,
                        'last_amount'        => (int) $current_amount,
                        'last_shipping_hash' => $current_shipping_hash,
                        'customer_name'      => $current_customer_name,
                        'customer_email'     => $current_email,
                    ]);

                    return new WP_REST_Response([
                        'success'             => true,
                        'mode'                => 'update',
                        'conekta_order_id'    => $existing_order_id,
                        'checkout_request_id' => $existing_request_id,
                    ], 200);
                } catch (\Exception $e) {
                    error_log('Conekta - update order failed: ' . $e->getMessage());

                    // The most likely reason an update fails: Conekta rejects
                    // updates on a PAID order. Recreating here is exactly how
                    // the customer ends up charged twice, so check first.
                    $recovered = self::paid_order_recovery($gateway, $api, $existing_order_id);
                    if ($recovered) {
                        return new WP_REST_Response($recovered, 200);
                    }

                    error_log('Conekta - update order failed on an unpaid order, recreating');
                    self::clear_session();
                    $existing_order_id   = null;
                    $existing_request_id = null;
                }
            }

            // Last line of defence before creating a NEW payable Conekta order:
            // make sure the purchase in flight wasn't already paid. Either we
            // still hold an order id we're about to abandon, or our state is
            // gone and the WC order awaiting payment is the only trace left.
            $recovered = $existing_order_id
                ? self::paid_order_recovery($gateway, $api, $existing_order_id)
                : self::recover_paid_payment_without_state($gateway, $api, (string) $current_email);
            if ($recovered) {
                // A refusal (Conekta unreachable while a payment may be in
                // flight) is a 503: nothing payable is returned, and the
                // frontends surface `message` without mounting an iframe.
                $status = empty($recovered['success']) ? 503 : 200;
                return new WP_REST_Response($recovered, $status);
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
                    'phone'    => self::DEFAULT_PHONE,
                    'receiver' => $snapshot['customer_info']['name'] ?: self::DEFAULT_CUSTOMER_NAME,
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
                // Honor the gateway's "Vencimiento de las órdenes de pago
                // (Días)" setting — previously only cash/SPEI sent it and the
                // card checkout silently ignored it. With order-first this is
                // also the lifecycle of abandoned WC orders: when the Conekta
                // order expires, the order.expired webhook cancels the linked
                // pending WooCommerce order (releasing any stock hold), even
                // on stores without WooCommerce's own hold-stock auto-cancel.
                'expires_at'              => get_expired_at((int) ($gateway->settings['order_expiration'] ?? 1) ?: 1),
            ];

            if (!empty($msi_options)) {
                $checkout_data['monthly_installments_enabled'] = true;
                $checkout_data['monthly_installments_options'] = $msi_options;
            }

            $checkout = new OrderCheckoutRequest($checkout_data);

            // Record whether the order was created from the WooCommerce Blocks
            // or Classic checkout, and (Blocks-only) the WC draft order id as
            // reference_id when it already exists. Blocks creates a
            // `checkout-draft` order during checkout and keeps that id once
            // finalized, so it's the webhook's primary Conekta->Woo link.
            $checkout_type = self::resolve_checkout_type($request);
            $reference_id  = self::get_blocks_draft_order_id();
            $metadata      = self::build_conekta_metadata($gateway, $checkout_type, $reference_id);

            $balanced = ckpg_check_balance([
                'line_items'     => $snapshot['line_items'],
                'shipping_lines' => $snapshot['shipping_lines'],
                'discount_lines' => $snapshot['discount_lines'],
                'tax_lines'      => $snapshot['tax_lines'],
            ], $current_amount);

            $order_request = new OrderRequest([
                'currency'       => $snapshot['currency'],
                'line_items'     => $snapshot['line_items'],
                'discount_lines' => $balanced['discount_lines'],
                'shipping_lines' => $snapshot['shipping_lines'],
                'tax_lines'      => $balanced['tax_lines'],
                'customer_info'  => $snapshot['customer_info'],
                'checkout'       => $checkout,
                'metadata'       => $metadata,
            ]);

            if (!empty($snapshot['shipping_contact'])) {
                $order_request->setShippingContact(new CustomerShippingContactsRequest($snapshot['shipping_contact']));
            }

            $conekta_order = $api->createOrder($order_request, $gateway->get_user_locale());

            $conekta_order_id    = $conekta_order->getId();
            $checkout_request_id = $conekta_order->getCheckout() ? $conekta_order->getCheckout()->getId() : null;

            // Link the Blocks draft WC order to the freshly created Conekta
            // order so the order.paid webhook can recover it even if
            // process_payment_api never runs. (reference_id in the metadata
            // above covers the case where the draft already existed at create;
            // this reverse meta covers the case where it didn't.)
            self::link_draft_order_to_conekta($conekta_order_id);

            self::state_set([
                'order_id'           => $conekta_order_id,
                'checkout_request_id'=> $checkout_request_id,
                'last_amount'        => (int) $current_amount,
                'last_shipping_hash' => $current_shipping_hash,
                'customer_name'      => $current_customer_name,
                'customer_email'     => $current_email,
            ]);

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
     * Resolve the WooCommerce order behind a Conekta order id (the
     * conekta-order-id meta both the classic and blocks flows stamp before the
     * charge). An order that already collected the payment wins over a pending
     * one, so a leftover retry never shadows the real paid order.
     *
     * @return WC_Order|null
     */
    public static function find_wc_order_by_conekta_id(string $conekta_order_id) {
        if ($conekta_order_id === '') {
            return null;
        }

        $orders = wc_get_orders([
            'meta_key'   => 'conekta-order-id',
            'meta_value' => $conekta_order_id,
            'limit'      => 10,
            'status'     => self::RECOVERY_LOOKUP_STATUSES,
        ]);

        $fallback = null;
        foreach ($orders as $candidate) {
            if (in_array($candidate->get_status(), self::PAID_STATUSES, true)) {
                return $candidate;
            }
            if ($fallback === null) {
                $fallback = $candidate;
            }
        }

        return $fallback;
    }

    /**
     * THE double-charge guard. Called at every point where we are about to
     * abandon the Conekta order backing this checkout and create a NEW one.
     *
     * Why it exists: the plugin's other duplicate guards all protect against
     * one Conekta payment completing two WooCommerce orders. The failure we
     * were actually seeing is the opposite — TWO Conekta orders, each charged
     * for the same cart. It happens whenever the first charge succeeds but the
     * WC order never gets completed (the confirm call is lost, a 3DS challenge
     * navigates the page away, the customer reloads /checkout/): our state is
     * gone or an updateOrder on the now-paid order fails, we quietly create a
     * fresh order, the frontend mounts a fresh payable iframe, and the customer
     * pays again. Nothing downstream can catch that — the money is already
     * gone, twice.
     *
     * So: before creating a replacement, ask Conekta whether the current order
     * is already paid. If it is, never create a second one. Instead recover —
     * complete the WooCommerce order that payment belongs to and hand the
     * frontend a redirect to it, which also fixes the orphaned payment.
     *
     * Fails OPEN on an API error (returns null): a Conekta hiccup must not
     * block checkouts. Fails CLOSED when the payment is real but no WC order
     * can be completed: the response carries no redirect and the caller must
     * still refuse to create a new order — the order.paid webhook is the net
     * that reconciles it, and blocking beats charging twice.
     *
     * @param  mixed         $api       OrdersApi instance.
     * @param  WC_Order|null $wc_order  Known WC order for this payment, if any.
     * @return array|null Response payload when already paid, null otherwise.
     */
    /**
     * Payment status of a Conekta order, as a guard decision:
     *   'paid'    — charged; never create a replacement.
     *   'unpaid'  — safe to continue with the normal create/update flow.
     *   'unknown' — Conekta could not be reached, so we CANNOT tell. Callers
     *               decide: fail open before any charge is possible, fail
     *               closed once a charge may already have happened.
     */
    private static function read_payment_status($gateway, $api, string $conekta_order_id): string {
        try {
            $conekta_order = $api->getOrderById(
                $conekta_order_id,
                $gateway->get_user_locale(),
                null,
                WC_Conekta_Plugin::API_CLIENT
            );
        } catch (\Exception $e) {
            error_log(sprintf(
                'Conekta - read_payment_status: could not read Conekta order %s (%s)',
                $conekta_order_id,
                $e->getMessage()
            ));
            return 'unknown';
        }

        return (string) $conekta_order->getPaymentStatus() === 'paid' ? 'paid' : 'unpaid';
    }

    public static function paid_order_recovery($gateway, $api, string $conekta_order_id, $wc_order = null): ?array {
        if ($conekta_order_id === '' || !$gateway || !$api) {
            return null;
        }

        // 'unknown' fails OPEN here: both callers of this method run BEFORE any
        // charge is possible (the customer's name became real; an update was
        // rejected), so a Conekta hiccup must not block the checkout.
        if (self::read_payment_status($gateway, $api, $conekta_order_id) !== 'paid') {
            return null;
        }

        if (!$wc_order) {
            $wc_order = self::find_wc_order_by_conekta_id($conekta_order_id);
        }

        $redirect = null;
        if ($wc_order) {
            if (in_array($wc_order->get_status(), self::PAID_STATUSES, true)) {
                // Already completed (by the confirm endpoint or the webhook):
                // nothing to do but send the customer to their order, and drop
                // the state so a genuine NEXT purchase starts a fresh order.
                $redirect = $gateway->get_return_url($wc_order);
                self::clear_session();
            } elseif (!in_array($wc_order->get_status(), ['cancelled', 'refunded'], true)) {
                // Verifies paid + amount again and clears the state on success.
                $outcome = $gateway->complete_wc_order_from_conekta($wc_order, $conekta_order_id);
                if (!empty($outcome['success'])) {
                    $redirect = $gateway->get_return_url($wc_order);
                } elseif (!empty($outcome['existing_order'])) {
                    $redirect = $gateway->get_return_url($outcome['existing_order']);
                    self::clear_session();
                }
            }
        }

        error_log(sprintf(
            'Conekta - paid_order_recovery: Conekta order %s is ALREADY PAID — refusing to create a replacement (WC order %s, redirect %s)',
            $conekta_order_id,
            $wc_order ? '#' . $wc_order->get_id() : 'none',
            $redirect ?: 'none'
        ));

        $response = [
            'success'          => true,
            'mode'             => self::MODE_ALREADY_PAID,
            'conekta_order_id' => $conekta_order_id,
            'message'          => $redirect
                ? __('Tu pago ya fue recibido. Te llevamos a la confirmación de tu pedido.', 'woocommerce')
                : sprintf(
                    __('Ya recibimos un pago para este pedido (orden %s de Conekta), así que no generamos un segundo cargo. Si tu pedido no aparece como pagado, contacta a la tienda.', 'woocommerce'),
                    $conekta_order_id
                ),
        ];
        if ($redirect) {
            $response['redirect'] = $redirect;
        }

        return $response;
    }

    /**
     * Same guard as paid_order_recovery, for the case where our checkout state
     * is GONE — the most common way the double charge happened. A 3DS challenge
     * that navigates the top window, or simply reloading /checkout/, drops the
     * state transient (reset_session_on_checkout_entry), so the next POST would
     * create a brand new order with no memory of the charge that just went
     * through.
     *
     * The WooCommerce order survives that: WC keeps `order_awaiting_payment` in
     * its own session (blocks keeps the draft id) and the order carries the
     * conekta-order-id stamped before the charge. That's enough to ask Conekta
     * whether it was paid.
     *
     * Costs one extra API read only when such an order exists — i.e. only after
     * a "Place order" click, never on a first-time checkout.
     */
    private static function recover_paid_payment_without_state($gateway, $api, string $email = ''): ?array {
        $candidates = self::orphan_payment_candidates($email);
        if (empty($candidates)) {
            error_log('Conekta - orphan-payment guard: no in-flight WooCommerce order carries a conekta-order-id — creating a new Conekta order');
            return null;
        }

        foreach ($candidates as $candidate) {
            list($order, $linked) = $candidate;

            $status = self::read_payment_status($gateway, $api, $linked);
            error_log(sprintf(
                'Conekta - orphan-payment guard: WC order #%d (status "%s") is linked to Conekta order %s, payment status "%s"',
                $order->get_id(),
                $order->get_status(),
                $linked,
                $status
            ));

            if ($status === 'paid') {
                return self::paid_order_recovery($gateway, $api, $linked, $order);
            }

            // Fail CLOSED: unlike the pre-charge callers of paid_order_recovery,
            // here a charge may ALREADY have happened — that is the whole point
            // of this guard. Creating a payable order while we cannot tell is
            // exactly how the customer ends up charged twice, so refuse instead.
            // A blocked checkout is recoverable; a double charge is not.
            if ($status === 'unknown') {
                error_log(sprintf(
                    'Conekta - orphan-payment guard: REFUSING to create a replacement — cannot verify Conekta order %s of WC order #%d',
                    $linked,
                    $order->get_id()
                ));
                return [
                    'success' => false,
                    'code'    => self::CODE_VERIFICATION_UNAVAILABLE,
                    'message' => __('No pudimos verificar el estado de tu pago anterior. Espera un momento e intenta de nuevo; no generamos un segundo cargo.', 'woocommerce'),
                ];
            }
        }

        return null;
    }

    /**
     * WooCommerce orders that could be holding an orphaned payment, best
     * candidate first, as [WC_Order, conekta_order_id] pairs.
     *
     * Why not just the session: `order_awaiting_payment` (and the Blocks draft
     * id) is the cheap anchor, but it is NOT dependable — WC_Cart::empty_cart()
     * nulls it, and any session rotation loses it. Relying on it alone let a
     * paid-but-unreconciled order slip through and a REPLACEMENT Conekta order
     * be created (reproduced in e2e: a reload answered `mode: create` while
     * ord_…iKQ was already paid). So the session anchor is only tried first, and
     * the authoritative lookup is a query for the customer's own recent unpaid
     * orders that carry a conekta-order-id — the same link the webhook uses.
     *
     * @return array<int, array{0: WC_Order, 1: string}>
     */
    private static function orphan_payment_candidates(string $email = ''): array {
        $ids = [];

        if (WC()->session) {
            $awaiting = (int) WC()->session->get('order_awaiting_payment');
            if ($awaiting > 0) {
                $ids[] = $awaiting;
            }
        }
        $draft = (int) self::get_blocks_draft_order_id();
        if ($draft > 0) {
            $ids[] = $draft;
        }

        $query = [
            'limit'        => 5,
            'orderby'      => 'date',
            'order'        => 'DESC',
            'status'       => self::UNPAID_STATUSES,
            'date_created' => '>' . (time() - self::ORPHAN_LOOKBACK),
        ];
        // Scope to this shopper so we never look at someone else's order.
        $user_id = get_current_user_id();
        if ($user_id) {
            $query['customer_id'] = $user_id;
        } elseif ($email !== '') {
            $query['customer'] = $email;
        } else {
            // A guest with no email yet cannot own an in-flight payment.
            $query = null;
        }

        if ($query) {
            foreach (wc_get_orders($query) as $recent) {
                $ids[] = $recent->get_id();
            }
        }

        $candidates = [];
        foreach (array_unique($ids) as $id) {
            $order = wc_get_order($id);
            if (!$order) {
                continue;
            }
            // Paid or voided orders hold nothing to recover: a paid one is a
            // finished purchase, a cancelled one was deliberately dropped.
            if (!in_array($order->get_status(), self::UNPAID_STATUSES, true)) {
                continue;
            }
            $linked = (string) $order->get_meta('conekta-order-id');
            if ($linked === '') {
                continue;
            }
            $candidates[] = [$order, $linked];
        }

        return $candidates;
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

            foreach (WC()->cart->get_cart() as $cart_item) {
                $product = $cart_item['data'];
                if (!$product) continue;

                // Send the effective unit price the customer actually pays (net
                // of tax; tax is itemized in tax_lines). We intentionally do NOT
                // report the regular price plus a `dynamic_pricing` discount for
                // sales / dynamic-pricing plugins — that confused merchants.
                // Real coupons and negative fees remain explicit discount_lines.
                $unit_price_cents = amount_validation((float) $cart_item['line_subtotal'] / max(1, (int) $cart_item['quantity']));

                $line_items[] = [
                    'name'       => item_name_validation($product->get_name()),
                    'unit_price' => $unit_price_cents,
                    'quantity'   => (int) $cart_item['quantity'],
                    'metadata'   => [
                        'tax_included' => ckpg_item_tax_included($product),
                        // Lets the order.paid webhook rebuild a real WC order
                        // (right product, not just a name) when none exists —
                        // the wallet-path last resort.
                        'product_id'   => (string) $product->get_id(),
                    ],
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
            // NOTE: rounding reconciliation happens once in the request handler
            // (ckpg_check_balance against $current_amount), which emits the
            // round_adjustment discount / tax delta. build_snapshot returns the
            // raw lines so we don't reconcile twice.
        }

        $customer_info    = [];
        $shipping_contact = [];
        if (WC()->customer) {
            $email = sanitize_email(WC()->customer->get_billing_email());
            if (!empty($email)) {
                // Resolve the address block (shipping when the customer filled
                // it, else billing) ONCE and feed it to BOTH customer_info and
                // shipping_contact. Previously customer_info read billing-only,
                // so when the shopper filled just the shipping block (the common
                // WC Blocks case) the Conekta customer object was left with the
                // 'Cliente' / 0000000000 defaults even though shipping_contact
                // had the real name/phone. See resolve_address_source.
                $addr          = self::resolve_address_source(WC()->customer);
                $first         = $addr['first_name'];
                $last          = $addr['last_name'];
                $address1      = $addr['address_1'];
                $address2      = $addr['address_2'];
                $city          = $addr['city'];
                $state         = $addr['state'];
                $country       = $addr['country'];
                $postcode      = $addr['postcode'];
                $name          = trim("$first $last");
                $contact_phone = sanitize_text_field($addr['phone']);

                $customer_info = [
                    'email' => $email,
                    'name'  => $name ?: self::DEFAULT_CUSTOMER_NAME,
                    'phone' => $contact_phone ?: self::DEFAULT_PHONE,
                ];

                // Conekta requires shipping_contact to charge an order.
                // street1/city are normalized so Conekta's strict address
                // validation (street1.too_short, city.invalid) can't 422 the
                // whole checkout — soft_validations does NOT relax those.
                if (!empty($address1) && !empty($postcode)) {
                    $shipping_contact = [
                        'phone'    => $contact_phone ?: self::DEFAULT_PHONE,
                        'receiver' => $name ?: self::DEFAULT_CUSTOMER_NAME,
                        'address'  => [
                            'street1'     => ckpg_pad_street1($address1),
                            'city'        => ckpg_default_if_blank($city),
                            'state'       => $state,
                            'country'     => $country ?: 'MX',
                            'postal_code' => $postcode,
                        ],
                    ];
                    // street2 (colonia / interior): the cash/SPEI gateways
                    // already send it; the card path was silently dropping it.
                    // ALWAYS a string — Conekta accepts '' but rejects null —
                    // and sent even when empty so removing the colonia on an
                    // address edit actually clears it on the Conekta order.
                    $shipping_contact['address']['street2'] = $address2;
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
     * Normalize the checkout type sent by the frontend into 'blocks',
     * 'classic', or 'unknown' for the Conekta order metadata.
     */
    public static function resolve_checkout_type($request): string {
        $checkout_type = $request ? sanitize_text_field((string) $request->get_param('woocommerce_checkout_type')) : '';
        return in_array($checkout_type, ['blocks', 'classic'], true) ? $checkout_type : 'unknown';
    }

    /**
     * Build the COMPLETE Conekta order metadata. Used at creation AND when
     * backfilling reference_id on the update path — the update must resend the
     * full metadata (not a partial patch), so re-linking the WC order never
     * drops the plugin / version / checkout_type keys set at creation.
     *
     * reference_id (the WC draft order id) is included only when present —
     * Blocks-only, and only once the draft exists.
     */
    public static function build_conekta_metadata($gateway, string $checkout_type, ?int $reference_id): array {
        $metadata = [
            'plugin'                    => 'woocommerce',
            'plugin_conekta_version'    => $gateway->version,
            'woocommerce_version'       => WC()->version,
            'payment_method'            => 'WC_Conekta_Gateway',
            'woocommerce_checkout_type' => $checkout_type,
        ];
        if ($reference_id) {
            $metadata['reference_id'] = (string) $reference_id;
        }
        return $metadata;
    }

    /**
     * WooCommerce order id to write into the Conekta order metadata as
     * reference_id — BLOCKS ONLY.
     *
     * Blocks creates a `checkout-draft` WooCommerce order while the customer is
     * still on the checkout page (via the Store API) and that draft keeps its id
     * once the order is finalized. Reading it here, during checkout-request
     * (pre-payment), is the ONLY window to push the WC order id into Conekta:
     * by the time process_payment runs, the Conekta order is already paid and
     * its metadata can no longer be updated.
     *
     * Classic checkout has no order at this point (it's created on form submit,
     * after the charge), so this returns null there — reference_id stays
     * blocks-only and classic relies on the reverse `conekta-order-id` order
     * meta instead.
     *
     * Returns null unless the session points at a real, still-draft order, so a
     * stale id from a previous completed checkout never leaks into a new order.
     */
    public static function get_blocks_draft_order_id(): ?int {
        if (!WC()->session) {
            return null;
        }
        $draft_id = (int) WC()->session->get('store_api_draft_order');
        if ($draft_id <= 0) {
            return null;
        }
        $order = wc_get_order($draft_id);
        if (!$order || !$order->has_status('checkout-draft')) {
            return null;
        }
        return $draft_id;
    }

    /**
     * Stamp the conekta-order-id meta on the current Blocks checkout-draft WC
     * order, while the order is still unpaid. This is the Conekta->WooCommerce
     * link the order.paid webhook falls back to (find_order_for_webhook), so a
     * paid charge whose process_payment_api never runs (tab closed, network
     * drop) can still be reconciled — instead of "Order not found", i.e. paid
     * in Conekta but never completed in WooCommerce.
     *
     * The Conekta order is often created (on the first email POST) before WC
     * Blocks has created its draft order, so reference_id can't be set at
     * creation; stamping the reverse meta here, once the draft exists, closes
     * that gap. Local write only, idempotent, and BLOCKS-ONLY (classic has no
     * draft here, so this returns null there).
     *
     * @return int|null the linked draft order id, or null when there's no draft.
     */
    public static function link_draft_order_to_conekta(string $conekta_order_id): ?int {
        if ($conekta_order_id === '') {
            return null;
        }
        $draft_id = self::get_blocks_draft_order_id();
        if (!$draft_id) {
            return null;
        }
        $draft_order = wc_get_order($draft_id);
        if ($draft_order) {
            WC_Conekta_Plugin::update_conekta_order_meta($draft_order, $conekta_order_id, 'conekta-order-id');
        }
        return $draft_id;
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
     * Whether the customer name went from a placeholder (empty or the
     * DEFAULT_CUSTOMER_NAME fallback) to a real value. When true, the Conekta
     * order — created early with the placeholder — must be recreated, because
     * Conekta freezes the embedded customer at creation and rejects updates on
     * a paid order. Returns false if it was already real, or is still a
     * placeholder, so we don't recreate needlessly.
     */
    public static function customer_became_real(string $last_name, string $current_name): bool {
        $placeholder = ['', self::DEFAULT_CUSTOMER_NAME];
        return in_array($last_name, $placeholder, true)
            && !in_array($current_name, $placeholder, true);
    }

    /**
     * Pick which address block (shipping or billing) feeds the Conekta
     * shipping_contact, as a WHOLE block.
     *
     * Shipping wins only when the customer actually filled it in — we key the
     * decision on shipping_address_1 (the street line), NOT on state/country:
     * WooCommerce themes routinely pre-populate shipping_state and
     * shipping_country with store defaults even when the customer typed their
     * real address into billing. A per-field `shipping ?: billing` fallback
     * would then mix a billing street with a stale shipping state and break
     * Conekta's antifraud rules. When shipping_address_1 is empty we take the
     * billing block as a whole.
     *
     * first_name / last_name / phone still fall back to the other block when
     * the chosen block's value is empty, so the receiver name and contact
     * phone are never blank.
     *
     * @param object $customer object exposing get_{shipping,billing}_* getters
     * @return array{first_name:string,last_name:string,address_1:string,address_2:string,city:string,state:string,country:string,postcode:string,phone:string}
     */
    public static function resolve_address_source($customer): array {
        $get = function (string $prefix, string $field) use ($customer): string {
            $getter = "get_{$prefix}_{$field}";
            return method_exists($customer, $getter) ? trim((string) $customer->{$getter}()) : '';
        };

        $use_shipping = $get('shipping', 'address_1') !== '';
        $prefix = $use_shipping ? 'shipping' : 'billing';
        $other  = $use_shipping ? 'billing'  : 'shipping';

        return [
            'first_name' => $get($prefix, 'first_name') ?: $get('billing', 'first_name'),
            'last_name'  => $get($prefix, 'last_name')  ?: $get('billing', 'last_name'),
            'address_1'  => $get($prefix, 'address_1'),
            // address_2 (colonia / interior) follows the SAME block as
            // address_1 — no cross-block fallback, mixing blocks would pair
            // the wrong colonia with the street.
            'address_2'  => $get($prefix, 'address_2'),
            // City falls back to the other block when the chosen block left it
            // empty. Unlike state/country — which themes pre-fill with stale
            // store defaults, so a per-field fallback there would pair a real
            // street with a WRONG state — city is never auto-prefilled: an empty
            // city means the block genuinely lacks it, and sending '' makes
            // Conekta reject the WHOLE order with "Invalid format for
            // shipping_contact ... city". Borrowing the other block's city is
            // strictly better than shipping an empty string.
            'city'       => $get($prefix, 'city') ?: $get($other, 'city'),
            'state'      => $get($prefix, 'state'),
            'country'    => $get($prefix, 'country'),
            'postcode'   => $get($prefix, 'postcode'),
            // Phone follows the chosen address block; fall back to the other
            // block's phone so the shipping_contact phone is never empty.
            'phone'      => $get($prefix, 'phone') ?: $get($other, 'phone'),
        ];
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
        $fields = ['first_name', 'last_name', 'address_1', 'address_2', 'city', 'state', 'postcode', 'country', 'phone'];
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

    /**
     * Stable bucket key for the checkout-state transient. Uses WC's
     * customer_id which is cookie-derived for guests and user_id for
     * logged-in users — survives across our POSTs in the same browser
     * session, independent of WC Blocks' wp_woocommerce_session writes.
     */
    private static function state_transient_key(): ?string {
        if (!WC()->session || !method_exists(WC()->session, 'get_customer_id')) return null;
        $customer_id = WC()->session->get_customer_id();
        if (empty($customer_id)) return null;
        return self::STATE_TRANSIENT_PREFIX . $customer_id;
    }

    /**
     * Read the full checkout state blob. Returns an array (possibly empty)
     * to keep call sites uniform.
     */
    public static function state_get(): array {
        $key = self::state_transient_key();
        if (!$key) return [];
        $value = get_transient($key);
        return is_array($value) ? $value : [];
    }

    /**
     * Write the full state blob. We persist on every successful create or
     * update — set_transient itself goes straight to wp_options /
     * external object cache, no race with the Store API session writes.
     */
    public static function state_set(array $data): void {
        $key = self::state_transient_key();
        if (!$key) return;
        set_transient($key, $data, self::STATE_TRANSIENT_TTL);
    }

    public static function state_delete(): void {
        $key = self::state_transient_key();
        if (!$key) return;
        delete_transient($key);
    }

    public static function clear_session(): void {
        self::state_delete();
    }

}

add_action('init', ['WC_Conekta_REST_API', 'init']);
